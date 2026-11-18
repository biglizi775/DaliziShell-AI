"""Exercise both packaged EXEs on a fresh disposable Windows runner (not a developer profile)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from windows_qa_release import CURRENT, RELEASES, record

ROOT = Path(__file__).resolve().parents[1]
OLD_URL = 'https://github.com/biglizi775/DaliziShell-AI/releases/download/v0.5.1/dalizi-files-0.5.1-windows-x64.zip'


def archive_host(path, expected_zip, expected_exe, candidate, fresh=False):
    # Hash and extract from the same file handle. BUILDINFO alone is not an independent pin.
    with path.open('rb') as f:
        zip_sha = hashlib.file_digest(f,'sha256').hexdigest()
        if expected_zip is not None and zip_sha != expected_zip:
            raise ValueError('Archive does not match the selected release')
        f.seek(0)
        with zipfile.ZipFile(f) as z:
            member='DaliziFiles.exe'
            if z.namelist().count(member)!=1:
                raise ValueError('Expected exactly one desktop host')
            data=z.read(member)
            exe_sha=hashlib.sha256(data).hexdigest()
            if exe_sha!=expected_exe:
                raise ValueError('The packaged host does not match the independently selected executable')
            if candidate or fresh:
                build=json.loads(z.read('BUILDINFO.json'))
                if (z.namelist().count('BUILDINFO.json')!=1 or build.get('candidate')!=candidate
                        or (fresh and build.get('kind')!='integration')
                        or not build.get('component') or build['exeSha256'].lower()!=exe_sha):
                    raise ValueError('Candidate BUILDINFO does not match the selected host')
    return data, {'zipSha256':zip_sha, 'exeSha256':exe_sha}


def main(args):
    hosted = os.getenv('GITHUB_ACTIONS') == 'true' and os.getenv('RUNNER_ENVIRONMENT') == 'github-hosted'
    if not args.inspect and not hosted and os.getenv('DALIZI_DISPOSABLE_GUEST') != 'yes':
        raise RuntimeError('Use a disposable test guest; for developer machines run verify_chat_rollback.ps1.')
    if args.ci_exe and not hosted:
        raise RuntimeError('Fresh-build evidence requires a GitHub-hosted runner')
    if args.inspect and args.report:
        raise ValueError('Inspection cannot produce an execution report')
    if args.report and args.report.exists():
        raise FileExistsError('Output report already exists')
    tag=args.release or CURRENT
    spec=record(tag)
    old=spec['archiveCompatibility']['officialInput']
    new=spec['candidate']
    new_zip, new_exe = new['sha256'], new['exeSha256']
    if args.ci_exe:
        with args.ci_exe.open('rb') as f:
            new_zip, new_exe = None, hashlib.file_digest(f,'sha256').hexdigest()
    with tempfile.TemporaryDirectory() as temp:
        d = Path(temp)
        previous = args.previous or d / 'official.zip'
        if not args.previous:
            with urllib.request.urlopen(OLD_URL, timeout=180) as src, previous.open('xb') as dst:
                shutil.copyfileobj(src, dst)
        old_data, old_info=archive_host(previous,old['zipSha256'],old['exeSha256'],None)
        new_data, new_info=archive_host(args.candidate,new_zip,new_exe,None if args.ci_exe else 'M5 '+tag.upper(),fresh=bool(args.ci_exe))
        inputs={'baseline':old_info,'candidate':new_info,
                'candidateSource':'fresh-ci-build' if args.ci_exe else 'recorded-release','tag':tag}
        if args.inspect:
            print(json.dumps({'executed':False,'inputs':inputs}))
            return
        (d/'old.exe').write_bytes(old_data)
        (d/'new.exe').write_bytes(new_data)
        node = shutil.which('node') or str(Path(os.environ['LOCALAPPDATA'])/'DaliziDev/node-v24.22.1-win-x64/node.exe')
        desktop=d/'desktop-report.json'
        subprocess.run([node, 'tools/chat_rollback_smoke.cjs', d/'old.exe', d/'new.exe', 'disposable',desktop], cwd=ROOT, check=True)
        measured=json.loads(desktop.read_bytes())
        if (measured.get('schema')!=1 or measured.get('suite')!='desktop-chat-rollback'
                or measured.get('mode')!='disposable' or not measured.get('passed')
                or measured.get('oldExeSha256')!=old_info['exeSha256'] or measured.get('newExeSha256')!=new_info['exeSha256']):
            raise ValueError('Executed host evidence does not match the input archives')
        report={'schema':1,'suite':measured['suite'],'utc':measured['utc'],'executed':True,'inputs':inputs,
                'environment':'github-hosted' if hosted else 'operator-declared-disposable',
                'passed':measured['passed']}
        if args.report:
            with args.report.open('x',encoding='utf-8') as dest:
                json.dump(report,dest,indent=2)
                dest.write('\n')
        print(json.dumps(report))


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--candidate', type=Path, required=True)
    cli.add_argument('--previous', type=Path, help='Optional previously downloaded official ZIP')
    source=cli.add_mutually_exclusive_group()
    source.add_argument('--release',choices=RELEASES,help='Verify both original release pins (default: current candidate)')
    source.add_argument('--ci-exe',type=Path,help='Independent freshly built release EXE; hosted CI only')
    cli.add_argument('--inspect',action='store_true',help='Verify both archive/host pairs without launching the desktops')
    cli.add_argument('--report',type=Path,help='New file for measured rollback evidence')
    main(cli.parse_args())
