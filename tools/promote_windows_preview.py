"""Package the exact desktop and component already measured in a development preview."""
import argparse
import hashlib
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile, ZipInfo

from windows_qa_release import CURRENT, RELEASES, ROOT


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pinned_bytes(folder, pin):
    name = pin['archive']
    if Path(name).name != name:
        raise ValueError('Expected an archive filename')
    data = (folder / name).read_bytes()
    if sha(data) != pin['sha256'] or len(data) != pin['bytes']:
        raise ValueError('Archive differs from the measured input: ' + name)
    return data


def promote(evidence, inputs, output, tag):
    measured = json.loads(evidence.read_bytes())
    source = measured['source']
    preview = measured['preview']
    with ZipFile(BytesIO(pinned_bytes(inputs, source))) as sources, ZipFile(BytesIO(pinned_bytes(inputs, preview))) as original:
        build = json.loads(original.read('BUILDINFO.json'))
        if build.get('candidate') is not None or not build.get('preview') or build.get('baseline') == 'M5 ' + tag.upper():
            raise ValueError('Expected a preview from before this candidate')
        version = build['version']
        component = build['component']
        src = f'dalizi-files-{version}/'
        if (sha(original.read('DaliziFiles.exe')) != preview['exeSha256'] or
                build['exeSha256'].lower() != preview['exeSha256'] or
                sha(original.read(f"components/{component['id']}.zip")) != component['zipSha256'] or
                sources.read(src+'resources/harness/component.sha256').decode().strip() != component['manifestSha256'] or
                sha(sources.read(src+'src-tauri/Cargo.lock')) != build['lockSha256'].lower()):
            raise ValueError('Preview host, component or lockfile differs from its recorded inputs')
        label = 'M5 ' + tag.upper()
        build.pop('baseline')
        build.update(candidate=label, promotedFrom=dict(preview=build.pop('preview'), sha256=preview['sha256']),
                     sourceArchive=source['archive'], sourceSha256=source['sha256'])
        instructions = original.read('使用说明.txt').decode('utf-8').splitlines()
        start = instructions.index(f'呆梨文件 Dalizi Files {version}')
        intro = [f'本地 {label} 候选包。请完整解压到新目录。', '组件和任务记录的使用方法见 Harness-使用与验收.txt。', '']
        replacements = {
            'BUILDINFO.json': (json.dumps(build, ensure_ascii=False, indent=2)+'\n').encode(),
            '使用说明.txt': ('\n'.join(intro+instructions[start:])+'\n').encode(),
            'Harness-使用与验收.txt': (ROOT/'docs/HARNESS_M5.md').read_text(encoding='utf-8').encode(),
        }
        listed = original.namelist()
        if len(listed) != len(set(listed)) or not (set(replacements) | {'预览说明.txt','SHA256SUMS.txt'}).issubset(listed):
            raise ValueError('Unexpected preview layout')
        names = sorted(set(listed) - {'预览说明.txt','SHA256SUMS.txt'})
        output.mkdir(parents=True, exist_ok=True)
        dest = output / f'dalizi-files-{version}-windows-x64-harness-m5-{tag}.zip'
        sums = dest.with_suffix('.zip.sha256.txt')
        if dest.exists() or sums.exists():
            raise FileExistsError('A candidate archive or checksum already exists')
        with TemporaryDirectory(dir=output) as temp:
            staged = Path(temp)/dest.name
            index = {}
            with ZipFile(staged,'x') as package:
                for name in names:
                    data = replacements[name] if name in replacements else original.read(name)
                    package.writestr(ZipInfo(name), data, compress_type=ZIP_STORED if name.endswith('.zip') else ZIP_DEFLATED, compresslevel=9)
                    index[name] = sha(data).upper()
                manifest = ''.join(f'{digest}  {name}\n' for name,digest in index.items()).encode()
                package.writestr(ZipInfo('SHA256SUMS.txt'), manifest, compress_type=ZIP_DEFLATED)
            with ZipFile(staged) as package:
                if package.read('SHA256SUMS.txt') != manifest or any(sha(package.read(n)).upper() != h for n,h in index.items()):
                    raise ValueError('Candidate read-back verification failed')
            digest = sha(staged.read_bytes())
            frozen = ROOT / f'docs/verification/harness-m5-{tag}-windows11.json'
            if frozen.exists() and json.loads(frozen.read_bytes())['candidate']['sha256'] != digest:
                raise ValueError(f'New bytes differ from the frozen {label} candidate')
            staged_sum = Path(temp)/sums.name
            staged_sum.write_bytes(f'{digest}  {dest.name}\n'.encode('ascii'))
            dest.hardlink_to(staged)
            try:
                sums.hardlink_to(staged_sum)
            except OSError:
                dest.unlink()
                raise
    print(json.dumps(dict(archive=dest.name, bytes=dest.stat().st_size, sha256=digest, exeSha256=preview['exeSha256'],
                          sourceHead=build['commit'], dirty=build['dirty'], component=component,
                          sourceArchive=source['archive'],sourceSha256=source['sha256'],promotedFrom=build['promotedFrom']),indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', required=True, type=Path, help='Independent verification record containing source and preview pins')
    parser.add_argument('--inputs', type=Path, default=ROOT/'dist')
    parser.add_argument('--release', choices=RELEASES, default=CURRENT)
    parser.add_argument('--output-dir', type=Path, default=ROOT/'dist')
    args = parser.parse_args()
    promote(args.evidence, args.inputs, args.output_dir, args.release)
