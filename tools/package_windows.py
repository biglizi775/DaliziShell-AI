"""Build an allowlisted Windows release ZIP from a verified executable/license set."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--licenses', required=True, type=Path, help='Verified licenses directory from this dependency set')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
exe = root / 'src-tauri/target/release/dalizi-files.exe'
assert exe.is_file(), 'Build the release executable first'
command = "(Get-Item -LiteralPath '" + str(exe).replace("'", "''") + "').VersionInfo.FileVersion"
pe_version = subprocess.check_output(['powershell', '-NoProfile', '-EncodedCommand',
    base64.b64encode(command.encode('utf-16-le')).decode()], text=True).strip()
assert pe_version.split('.')[:3] == version.split('.'), f'Executable version mismatch: {pe_version}'
tree = subprocess.check_output(['cargo', 'tree', '--locked', '--offline', '--target', 'x86_64-pc-windows-msvc',
    '--prefix', 'none', '--edges', 'normal,build', '--format', '{p}'], cwd=root / 'src-tauri', text=True)
for name, number in set(re.findall(r'^([\w-]+) v([\w.+-]+)', tree, re.M)):
    if name == 'dalizi-files':
        continue
    folder = args.licenses / 'rust' / f'{name}-{number}'
    assert folder.is_dir() and any(p.is_file() for p in folder.rglob('*')), f'Missing license: {name}-{number}'
assert (args.licenses / 'frontend').is_dir(), 'Frontend licenses required'
for file in args.licenses.rglob('*'):
    assert not file.is_symlink(), f'Unexpected license symlink: {file}'

prefix = f'dalizi-files-{version}-windows-x64'
stage = root / 'dist' / prefix
archive = root / 'dist' / f'{prefix}.zip'
assert not stage.exists() and not archive.exists(), 'Refusing to overwrite an existing package'
stage.mkdir(parents=True)
shutil.copy2(exe, stage / 'DaliziFiles.exe')
shutil.copy2(root / 'LICENSE', stage / 'LICENSE')
shutil.copy2(root / 'THIRD_PARTY_NOTICES.md', stage / 'THIRD_PARTY_NOTICES.txt')
shutil.copytree(args.licenses, stage / 'licenses')
shutil.copy2(root / f'docs/RELEASE_{version}.md', stage / '更新说明.txt')
(stage / '使用说明.txt').write_text(f'''呆梨文件 Dalizi Files {version}

Windows 10 1809+ / Windows 11 x64，需要 Microsoft Edge WebView2 Runtime。
解压完整压缩包后运行 DaliziFiles.exe；无需安装 Node.js、Python 或 7-Zip。
本程序未签名。内置 SSH 无需系统 OpenSSH；兼容模式需要 OpenSSH Client。

升级：先退出旧程序，将新版文件解压到原目录。保留原有 DaliziData/ 个人配置，
不要删除工作目录中的 .dalizi/ 记忆与聊天档案。此发行包不包含个人数据。

双面板：文件标签点击“双面板”，两侧独立浏览，箭头按钮选择复制或移动；
“设为工作目录”切换左侧目录。AI 和记忆始终跟随左侧工作目录。
SFTP：远程文件支持批量与文件夹上传/下载，任务面板提供暂停、取消、重试。
续传仅在本次运行内有效，先校验已有字节，不自动重新登录；退出前完成传输
或使用“清理续传临时文件”。异常退出可能留下 .dalizi-*.part，请核对后清理。
目录最多展开 2000 项/32 层，不跟随链接；同名文件不覆盖，取消不回滚成功项。

此版还包含便携偏好、搜索语法/应用内定位、7z/ZIP 密码压缩、目录聊天档案、
标签排序/恢复以及窗口、预览刷新稳定性修复，详见更新说明。
许可证见 LICENSE、THIRD_PARTY_NOTICES.txt 和 licenses/。
完整手册：https://github.com/biglizi775/DaliziShell-AI/blob/main/docs/USER_GUIDE.md
下载：https://github.com/biglizi775/DaliziShell-AI/releases
''', encoding='utf-8')
digest = lambda data: hashlib.sha256(data).hexdigest().upper()
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
(stage / 'BUILDINFO.json').write_text(json.dumps({'version': version, 'commit': commit,
    'target': 'x86_64-pc-windows-msvc', 'exeSha256': digest(exe.read_bytes()),
    'lockSha256': digest((root / 'src-tauri/Cargo.lock').read_bytes())}, indent=2) + '\n', encoding='utf-8')
files = sorted(p for p in stage.rglob('*') if p.is_file())
(stage / 'SHA256SUMS.txt').write_text(''.join(f'{digest(p.read_bytes())}  {p.relative_to(stage).as_posix()}\n' for p in files), encoding='utf-8')
files.append(stage / 'SHA256SUMS.txt')
with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=9, strict_timestamps=False) as z:
    for file in files:
        z.write(file, file.relative_to(stage).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for file in files:
        assert z.read(file.relative_to(stage).as_posix()) == file.read_bytes()
sha = digest(archive.read_bytes())
archive.with_suffix('.zip.sha256.txt').write_text(f'{sha}  {archive.name}\n', encoding='utf-8')
print(json.dumps({'package': str(archive), 'files': len(files), 'bytes': archive.stat().st_size, 'sha256': sha}, ensure_ascii=False))
