"""Package a standalone, operator-driven online check without changing the release or offline kit."""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import zipfile
from windows_qa_release import ROOT, CURRENT, RELEASES, record


def package(tag, folder):
    candidate = record(tag)['candidate']
    component = candidate['component']
    pins = dict(release=tag, zip=candidate['sha256'], exe=candidate['exeSha256'],
                component=component['zipSha256'], member=f"components/{component['id']}.zip")
    script = (ROOT/'tools/verify_cloud_turn.ps1').read_bytes()
    marker = b'__DALIZI_CLOUD_PINS__'
    if script.count(marker) != 1:
        raise ValueError('Expected one release pin block')
    guide = (ROOT/'docs/WINDOWS_CLOUD_QA.md').read_bytes()
    guide = f'本工具对应 M5 {tag.upper()}。\n\n'.encode('utf-8') + guide
    files = {'verify_cloud_turn.ps1':script.replace(marker,json.dumps(pins,separators=(',',':')).encode('ascii')),
             'cloud_check_core.ps1':(ROOT/'tools/cloud_check_core.ps1').read_bytes(),
             'README.md':guide}
    folder.mkdir(parents=True,exist_ok=True)
    out = folder/f'dalizi-m5-{tag}-cloud-check.zip'
    with tempfile.TemporaryDirectory(dir=folder) as tmp:
        staged = Path(tmp)/'staged.zip'
        with zipfile.ZipFile(staged,'x') as z:
            for name,data in files.items():
                z.writestr(zipfile.ZipInfo(name),data)
        with zipfile.ZipFile(staged) as z:
            if set(z.namelist())!=set(files) or any(z.read(name)!=data for name,data in files.items()):
                raise ValueError('Packaged verifier differs from source or pins')
        sha = hashlib.sha256(staged.read_bytes()).hexdigest()
        out.hardlink_to(staged)
    print(f'{out} ({out.stat().st_size} bytes, SHA256 {sha})')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release',choices=RELEASES[RELEASES.index('rc6'):],default=CURRENT)
    parser.add_argument('--output-dir',type=Path,default=ROOT/'dist')
    args=parser.parse_args()
    package(args.release,args.output_dir)
