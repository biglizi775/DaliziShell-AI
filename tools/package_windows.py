"""Build an allowlisted Windows release ZIP from a verified executable/license set."""
import argparse
import base64
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import zipfile
from tempfile import TemporaryDirectory
from collect_windows_notices import windows_tree
from windows_architecture import executable_architecture, TARGETS
from package_winpty import stage_winpty, VERSION as WINPTY_VERSION

if not __debug__:
    raise RuntimeError('Run the packager without -O so that release gates are enforced')

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--licenses', required=True, type=Path, help='Verified licenses directory from this dependency set')
parser.add_argument('--exe', type=Path, help='Production release executable, including a custom Cargo target directory')
parser.add_argument('--winpty-archive', type=Path, help='Local pinned WinPTY ZIP for an offline build')
parser.add_argument('--output-dir', type=Path, help='Output directory; defaults to dist. Existing packages are never overwritten.')
parser.add_argument('--preview', help='Development preview name, with notes in docs/PREVIEW_<name>.md; separate from the frozen release')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
exe = args.exe.resolve() if args.exe else root / 'src-tauri/target/release/dalizi-files.exe'
assert exe.is_file(), 'Build the release executable first'
architecture = executable_architecture(exe)
target = TARGETS[architecture]
if args.preview:
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', args.preview) or len(args.preview)>48:
        parser.error('Use a short preview name')
    preview_notes=root/'docs'/f'PREVIEW_{args.preview}.md'
    if not preview_notes.is_file(): parser.error('Missing preview notes')
binary = exe.read_bytes()
info_format = 'dalizi-files/windows-build-info/v1'
winpty = None
if info_format.encode() in binary or architecture == 'x86':
    # Earlier x86 binaries also expose this read-only entry point. Older x64
    # binaries do not recognize it and would start their normal desktop.
    info = json.loads(subprocess.check_output([str(exe), '--dalizi-build-info'], timeout=15))
    assert (info['identifier'] == 'com.dalizi.files' and info['version'] == version and info['debug'] is False
            and info['architecture'] == {'x86':'x86', 'x64':'x86_64'}[architecture]), 'Build the production desktop host'
    if info.get('format') == info_format:
        assert info.get('winpty') == WINPTY_VERSION, 'WinPTY version mismatch'
        winpty = WINPTY_VERSION
elif args.preview:
    assert (b'com.dalizi.files' in binary and b'com.dalizi.files.index-scope-test-' not in binary
            and b'com.dalizi.files.workspace-test' not in binary), 'Build the production desktop host'
if not winpty and (args.winpty_archive or args.preview == 'legacy-terminal'):
    parser.error('The supplied desktop executable does not declare WinPTY support')
command = "$ProgressPreference='SilentlyContinue'; (Get-Item -LiteralPath '" + str(exe).replace("'", "''") + "').VersionInfo.FileVersion"
pe_version = subprocess.check_output(['powershell', '-NoProfile', '-EncodedCommand',
    base64.b64encode(command.encode('utf-16-le')).decode()], text=True).strip()
assert pe_version.split('.')[:3] == version.split('.'), f'Executable version mismatch: {pe_version}'
for name, number in windows_tree(target):
    if name == 'dalizi-files':
        continue
    folder = args.licenses / 'rust' / f'{name}-{number}'
    assert folder.is_dir() and any(p.is_file() for p in folder.rglob('*')), f'Missing license: {name}-{number}'
assert (args.licenses / 'frontend').is_dir(), 'Frontend licenses required'
for file in args.licenses.rglob('*'):
    assert not file.is_symlink(), f'Unexpected license symlink: {file}'

prefix = f'dalizi-files-{version}-windows-{architecture}'
if args.preview:
    prefix += '-preview-'+args.preview+'-'+hashlib.sha256(binary).hexdigest()[:12]
output = args.output_dir.resolve() if args.output_dir else root / 'dist'

def assemble(stage, archive):
    stage.mkdir(parents=True)
    shutil.copy2(exe, stage / 'DaliziFiles.exe')
    if winpty:
        stage_winpty(stage, architecture, args.winpty_archive)
    shutil.copy2(root / 'LICENSE', stage / 'LICENSE')
    shutil.copy2(root / 'tools/check_windows_runtime.ps1', stage / 'Check-Windows.ps1')
    shutil.copy2(root / 'THIRD_PARTY_NOTICES.md', stage / 'THIRD_PARTY_NOTICES.txt')
    shutil.copytree(args.licenses, stage / 'licenses')
    shutil.copy2(root / f'docs/RELEASE_{version}.md', stage / '更新说明.txt')
    shutil.copy2(root / 'docs/CHANGELOG.md', stage / '更新历史.txt')
    (stage / '使用说明.txt').write_text(f'''呆梨文件 Dalizi Files {version}

Windows 桌面程序架构为 {architecture}，需要 Microsoft Edge WebView2 Runtime。{'缺少 ConPTY 的系统自动使用 terminal/ 内的 WinPTY。' if winpty else '内嵌终端需要系统 ConPTY。'}各版本的实测范围见预览说明或更新说明。
可先在解压目录运行 PowerShell 命令 .\\Check-Windows.ps1，查看系统版本、架构与 WebView2 检测结果。
解压完整压缩包后运行 DaliziFiles.exe；无需安装 Node.js、Python 或 7-Zip。
本程序未签名。内置 SSH 无需系统 OpenSSH；兼容模式需要 OpenSSH Client。

升级：先退出旧程序，将完整压缩包解压到新目录。保留旧程序目录和 DaliziData/ 个人配置。
此发行包不包含个人数据。

双面板：文件标签点击“双面板”，两侧独立浏览，箭头按钮选择复制或移动；
“设为工作目录”切换左侧目录。
SSH：内置模式登录后自动显示服务器概况、终端和远程目录。拖动分隔条调整
高度，或在工具栏选择分屏、文件、终端。目录支持筛选、跳转和复制路径。
SFTP：远程文件支持批量与文件夹上传/下载，任务面板提供暂停、取消、重试。
续传仅在本次运行内有效，先校验已有字节，不自动重新登录；退出前完成传输
或使用“清理续传临时文件”。异常退出可能留下 .dalizi-*.part，请核对后清理。
目录最多展开 2000 项/32 层，不跟随链接；同名文件不覆盖，取消不回滚成功项。

此版还包含便携偏好、搜索语法/应用内定位、7z/ZIP 密码压缩、
标签排序/恢复以及窗口、预览刷新稳定性修复，详见更新说明。
许可证见 LICENSE、THIRD_PARTY_NOTICES.txt 和 licenses/。
完整手册：https://github.com/biglizi775/DaliziShell-AI/blob/main/docs/USER_GUIDE.md
下载：https://github.com/biglizi775/DaliziShell-AI/releases
''', encoding='utf-8')
    if args.preview:
        shutil.copyfile(preview_notes,stage/'预览说明.txt')
        guide = stage / '使用说明.txt'
        guide.write_text(f'本地开发预览 {args.preview}。参见 预览说明.txt。\n' + guide.read_text(encoding='utf-8'), encoding='utf-8')
    digest = lambda data: hashlib.sha256(data).hexdigest().upper()
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True, encoding='utf-8').strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=root, text=True, encoding='utf-8').strip())
    (stage / 'BUILDINFO.json').write_text(json.dumps({'version': version, 'commit': commit,
        'dirty': dirty, 'candidate': None,
        **({'preview':args.preview} if args.preview else {}),
        'target': target, **({'winpty':winpty} if winpty else {}), 'exeSha256': digest(exe.read_bytes()),
        'lockSha256': digest((root / 'src-tauri/Cargo.lock').read_bytes())}, indent=2) + '\n', encoding='utf-8')
    files = sorted(p for p in stage.rglob('*') if p.is_file())
    (stage / 'SHA256SUMS.txt').write_text(''.join(f'{digest(p.read_bytes())}  {p.relative_to(stage).as_posix()}\n' for p in files), encoding='utf-8')
    files.append(stage / 'SHA256SUMS.txt')
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=9, strict_timestamps=False) as z:
        for file in files:
            z.write(file, file.relative_to(stage).as_posix(), compress_type=zipfile.ZIP_STORED if file.suffix == '.zip' else zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        for file in files:
            assert z.read(file.relative_to(stage).as_posix()) == file.read_bytes()
    return len(files), digest(archive.read_bytes())


# Extended-length paths also cover dependencies whose license filenames are deep inside crates.
out_name = str(output)
if os.name == 'nt' and not out_name.startswith('\\\\?\\'):
    out_name = ('\\\\?\\UNC\\' + out_name[2:]) if out_name.startswith('\\\\') else ('\\\\?\\' + out_name)
destination = Path(out_name)
destination.mkdir(parents=True, exist_ok=True)
final_dir = destination / prefix
final_zip = destination / (prefix + '.zip')
final_sum = final_zip.with_suffix('.zip.sha256.txt')
if any(path.exists() for path in (final_dir, final_zip, final_sum)):
    raise FileExistsError('Refusing to overwrite an existing package')

with TemporaryDirectory(dir=destination) as temporary:
    work = Path(temporary)
    stage, archive, checksum = work/'contents', work/'package.zip', work/'checksum'
    count, sha = assemble(stage, archive)
    checksum.write_text(f'{sha}  {final_zip.name}\n', encoding='ascii')
    # Windows rename fails if the destination exists. Only roll back files published by this invocation.
    stage.rename(final_dir)
    try:
        checksum.rename(final_sum)
        try:
            archive.rename(final_zip)
        except OSError:
            final_sum.rename(checksum)
            raise
    except OSError:
        final_dir.rename(stage)
        raise

print(json.dumps({'package': str(output / final_zip.name), 'files': count,
                  'bytes': final_zip.stat().st_size, 'sha256': sha}, ensure_ascii=False))
