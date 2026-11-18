"""Collect Windows build notices offline from the exact crates in Cargo.lock (Python 3.11+)."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import tomllib
from windows_architecture import TARGETS

ROOT = Path(__file__).resolve().parents[1]
WIN = TARGETS['x64']
FALLBACK = ROOT / 'resources/release-notices'
PREFIX = ('license', 'licence', 'copying', 'notice', 'copyright', 'unlicense', 'authors', 'third_party_notice')


def cargo(*args):
    exe = shutil.which('cargo') or str(Path.home() / '.cargo/bin/cargo.exe')
    return subprocess.check_output([exe, *args, '--manifest-path', str(ROOT / 'src-tauri/Cargo.toml')], cwd=ROOT, encoding='utf-8')


def windows_tree(target=WIN):
    tree = cargo('tree', '--locked', '--offline', '--target', target, '--prefix', 'none',
                 '--edges', 'normal,build', '--format', '{p}')
    return sorted(set(re.findall(r'^([\w-]+) v([\w.+-]+)', tree, re.M)))


def collect(dest, target=WIN):
    dest = dest.resolve()
    if dest.exists():
        raise ValueError('Refusing to overwrite notices: ' + str(dest))
    dest.parent.mkdir(parents=True, exist_ok=True)
    packages = json.loads(cargo('metadata', '--format-version', '1', '--locked', '--offline', '--filter-platform', target))['packages']
    by_key = {(p['name'], p['version']): p for p in packages}
    lock = tomllib.loads((ROOT / 'src-tauri/Cargo.lock').read_text(encoding='utf-8'))
    sums = {(p['name'], p['version']): p.get('checksum') for p in lock['package']}
    extras = json.loads((FALLBACK / 'fallbacks.json').read_text(encoding='utf-8'))
    inventory = []
    with tempfile.TemporaryDirectory(dir=dest.parent) as tmp:
        stage = Path(tmp) / 'licenses'
        for key in windows_tree(target):
            p = by_key[key]
            label = '-'.join(key)
            out = stage / 'rust' / label
            out.mkdir(parents=True)
            source_dir = Path(p['manifest_path']).parent
            notes = []
            if p['source'] is None and p['name'] in ('dalizi-files', 'dalizi-harness-client'):
                shutil.copyfile(ROOT / 'LICENSE', out / 'LICENSE')
                notes.append('LICENSE')
            elif key == ('portable-pty', '0.9.0') and source_dir == ROOT / 'src-tauri/vendor/portable-pty':
                shutil.copyfile(source_dir / 'LICENSE.md', out / 'LICENSE.md')
                notes.append('LICENSE.md')
            else:
                crate = source_dir.parents[2] / 'cache' / source_dir.parent.name / (label + '.crate')
                data = crate.read_bytes()
                if hashlib.sha256(data).hexdigest() != sums[key]:
                    raise ValueError('Locked crate checksum mismatch: ' + label)
                with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tf:
                    for member in tf:
                        parts = PurePosixPath(member.name).parts
                        if not member.isfile() or not any(s.lower().startswith(PREFIX) for s in parts[1:]):
                            continue
                        if len(parts) < 2 or parts[0] != label or any(s in ('.', '..') or ':' in s or '\\' in s for s in parts):
                            raise ValueError('Invalid crate path: ' + member.name)
                        target = out.joinpath(*parts[1:])
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with target.open('xb') as dst, tf.extractfile(member) as src:
                            shutil.copyfileobj(src, dst)
                        notes.append('/'.join(parts[1:]))
            sources = []
            for extra in (x for x in extras if x['package'] == label):
                d = (FALLBACK / 'texts' / (extra['sha256'] + '.txt')).read_bytes()
                if hashlib.sha256(d).hexdigest() != extra['sha256']:
                    raise ValueError('Changed upstream notice: ' + label)
                with (out / extra['name']).open('xb') as dst:
                    dst.write(d)
                notes.append(extra['name'])
                sources.append(extra['url'])
            if not notes:
                raise ValueError('Missing actual notice text: ' + label)
            inventory.append(dict(name=key[0], version=key[1], license=p['license'],
                                  repository=p['repository'], crateSha256=sums[key], files=sorted(notes), extraSources=sources))
        vendor = ROOT / 'ui/vendor'
        for f in sorted(vendor.rglob('*')):
            if f.is_file() and (f.name.lower().startswith(PREFIX) or f.relative_to(vendor).as_posix() in ('pdfjs/README.md', 'xterm-patches.md')):
                target = stage / 'frontend' / f.relative_to(vendor)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(f, target)
        (stage / 'packages.json').write_text(json.dumps(inventory, indent=2) + '\n', encoding='utf-8')
        stage.rename(dest)
    print(f'{len(inventory)} Windows Rust packages; notices in {dest}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--architecture', choices=TARGETS, default='x64')
    args = parser.parse_args()
    collect(args.output, TARGETS[args.architecture])
