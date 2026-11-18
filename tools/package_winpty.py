"""Stage the pinned, architecture-matched WinPTY runtime beside a desktop EXE."""
import argparse
import hashlib
import io
from pathlib import Path
import tempfile
import urllib.request
import zipfile

VERSION = '0.4.3'
ASSET = f'winpty-{VERSION}-msvc2015.zip'
URL = f'https://github.com/rprichard/winpty/releases/download/{VERSION}/{ASSET}'
SHA256 = '35a48ece2ff4acdcbc8299d4920de53eb86b1fb41e64d2fe5ae7898931bcee89'
DEFAULT_ARCHIVE = Path(__file__).resolve().parents[1] / 'src-tauri/target' / ASSET


def stage_winpty(destination, architecture, archive=None):
    platform = {'x64': 'x64', 'x86': 'ia32'}[architecture]
    local = archive or DEFAULT_ARCHIVE
    if archive is not None or local.is_file():
        contents = local.read_bytes()
    else:
        with urllib.request.urlopen(URL, timeout=30) as response:
            contents = response.read(3 * 1024 * 1024)
    if hashlib.sha256(contents).hexdigest() != SHA256:
        raise ValueError('WinPTY archive does not match the pinned upstream release')
    with zipfile.ZipFile(io.BytesIO(contents)) as upstream:
        files = {name: upstream.read(f'{platform}/bin/{name}') for name in ('winpty.dll', 'winpty-agent.exe')}
        files['LICENSE.txt'] = upstream.read('LICENSE')
    dest = destination / 'terminal'
    if dest.exists():
        if all((dest / name).is_file() and (dest / name).read_bytes() == data for name, data in files.items()):
            return
        raise FileExistsError(f'Another terminal runtime exists at {dest}')
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination) as temp:
        stage = Path(temp) / 'terminal'
        stage.mkdir()
        for name, data in files.items():
            (stage / name).write_bytes(data)
        stage.rename(dest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='Directory containing the desktop or terminal test EXE')
    parser.add_argument('--architecture', required=True, choices=('x64', 'x86'))
    parser.add_argument('--archive', type=Path, help='Use a pre-downloaded upstream archive for an offline build')
    args = parser.parse_args()
    stage_winpty(args.output, args.architecture, args.archive)
