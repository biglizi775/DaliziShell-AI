"""Package current Git-visible source without caches or user data (stdlib only)."""
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path
import subprocess
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
subprocess.run(['node', 'tools/check_repo.cjs'], cwd=root, check=True)
raw = subprocess.check_output(
    ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root
)
files = sorted({name for name in raw.decode('utf-8').split('\0') if name and (root / name).is_file()})
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
prefix = f'dalizi-files-{version}'
stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
output = root / 'dist'
output.mkdir(exist_ok=True)
archive = output / f'{prefix}-source-{stamp}.zip'
with ZipFile(archive, 'x', compression=ZIP_DEFLATED, compresslevel=9) as package:
    for name in files:
        source = root / name
        if source.is_symlink():
            raise ValueError(f'Refusing to include a symlink: {name}')
        package.write(source, f'{prefix}/{name}')
digest = sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.sha256').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
archive.with_suffix('.files.txt').write_text('\n'.join(files) + '\n', encoding='utf-8')
print(f'Source archive: {archive}')
print(f'Files: {len(files)}, bytes: {archive.stat().st_size}')
print(f'SHA-256: {digest}')
