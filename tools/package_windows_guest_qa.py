"""Freeze the current candidate's independently recorded hashes into a standalone offline kit."""
import argparse
import hashlib
import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from windows_qa_release import ROOT, CURRENT, record


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def package(previous, candidate, output):
    baseline = record(CURRENT)
    archive=baseline['candidate']
    old=baseline['archiveCompatibility']['officialInput']
    old_test,new_test=baseline['rehearsalExeSha256']
    hashes_to_pin=dict(oldZip=old['zipSha256'],newZip=archive['sha256'],oldExe=old['exeSha256'],
        newExe=archive['exeSha256'],componentZip=archive['component']['zipSha256'],testOld=old_test,testNew=new_test)
    if not all(re.fullmatch('[0-9a-f]{64}',v) for v in hashes_to_pin.values()) or {old_test,new_test} & {old['exeSha256'],archive['exeSha256']}:
        raise ValueError('Expected release hashes and distinct isolated rehearsal binaries')
    component_id=archive['component']['id']
    if not re.fullmatch(r'[a-zA-Z0-9.-]+',component_id):
        raise ValueError('Invalid component ID')
    marker=b'__DALIZI_QA_PINS__'
    template=(ROOT/'tools/verify_windows_guest.ps1').read_bytes()
    if template.count(marker)!=1:
        raise ValueError('Expected exactly one verifier pin block')
    script=template.replace(marker,json.dumps(dict(tag=CURRENT,componentId=component_id,**hashes_to_pin),
                                                separators=(',',':')).encode('ascii'))
    new_member=f'candidate-{CURRENT}.zip'
    inputs = {
        'public-v0.5.1.zip': previous,
        new_member: candidate,
        'windows_guest_scenarios.js': ROOT / 'tools/windows_guest_scenarios.js',
        'README.md': ROOT / 'docs/WINDOWS_GUEST_QA.md',
    }
    hashes = {name: sha(path) for name, path in inputs.items()}
    if hashes['public-v0.5.1.zip'] != baseline['archiveCompatibility']['officialInput']['zipSha256']:
        raise ValueError('Expected the pinned original public v0.5.1 ZIP')
    if hashes[new_member] != archive['sha256']:
        raise ValueError('Expected the exact candidate ZIP in the release record')
    hashes['verify_windows_guest.ps1']=hashlib.sha256(script).hexdigest()
    output.mkdir(parents=True, exist_ok=True)
    final = output / f'dalizi-m5-{CURRENT}-offline-acceptance.zip'
    sums = final.with_suffix('.zip.sha256.txt')
    if final.exists() or sums.exists():
        raise FileExistsError('Refusing to overwrite an existing acceptance kit or checksum')
    with tempfile.TemporaryDirectory(dir=output) as temp:
        staged = Path(temp) / 'kit.zip'
        with zipfile.ZipFile(staged, 'x', zipfile.ZIP_STORED) as z:
            z.writestr(zipfile.ZipInfo('verify_windows_guest.ps1'),script)
            for name, path in inputs.items():
                with path.open('rb') as stream, z.open(zipfile.ZipInfo(name), 'w') as dest:
                    shutil.copyfileobj(stream, dest, 1024 * 1024)
            z.writestr(zipfile.ZipInfo('SHA256SUMS.txt'), ''.join(f'{s}  {n}\n' for n,s in hashes.items()))
        with zipfile.ZipFile(staged) as z:
            for name, expected in hashes.items():
                with z.open(name) as stream:
                    if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
                        raise ValueError(f'Acceptance kit verification failed: {name}')
        digest = sha(staged)
        # Both links are create-new; a concurrent builder cannot overwrite the winner.
        final.hardlink_to(staged)
        with sums.open('x', encoding='ascii') as f:
            f.write(f'{digest}  {final.name}\n')
    print(f'{final} ({final.stat().st_size} bytes, SHA256 {digest})')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--previous', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, default=ROOT/'dist')
    args = parser.parse_args()
    package(args.previous, args.candidate, args.output_dir)
