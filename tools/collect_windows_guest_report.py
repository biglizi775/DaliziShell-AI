"""Recover a pinned candidate's guest report without connecting the guest network."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re

from windows_qa_release import CURRENT, RELEASES, record
MAX_REPORT = 32768


def payload(data, tag):
    # A log can have firmware output. Don't silently select an earlier pass after another run.
    parts = data.split(b'\n')
    lines = [line.removesuffix(b'\r') for line in parts[:-1] if line.startswith(b'DALIZI-RC')]
    if parts[-1].startswith(b'DALIZI-RC') or len(lines) != 1:
        raise ValueError('Expected exactly one report frame; retain each run in a separate log')
    match = re.fullmatch(b'DALIZI-'+re.escape(tag.upper().encode('ascii'))+
                         rb' ([0-9a-fA-F]{64}) ([A-Za-z0-9+/=]{1,43692})', lines[0])
    if match is None:
        raise ValueError('Report frame is incomplete or belongs to a different candidate')
    raw = base64.b64decode(match[2], validate=True)
    if len(raw) > MAX_REPORT or hashlib.sha256(raw).hexdigest() != match[1].decode().lower():
        raise ValueError('Report checksum or length mismatch')
    return raw


def evaluate(raw, family, release):
    report = json.loads(raw)
    if not isinstance(report, dict):
        raise ValueError('Expected a JSON report object')
    candidate = release['candidate']
    old = release['archiveCompatibility']['officialInput']
    if not (type(report.get('schema')) is int and report['schema'] == 1 and report.get('suite') == 'offline-start-and-rollback'
            and report.get('mode') == 'Guest' and report.get('publicExecutables') is True
            and report.get('candidateZipSha256') == candidate['sha256']
            and report.get('componentZipSha256') == candidate['component']['zipSha256']
            and report.get('oldZipSha256') == old['zipSha256']):
        raise ValueError('Not a public-executable guest report for the selected release')
    env = report['environment']
    if not isinstance(env, dict):
        raise ValueError('Missing guest environment')
    build = re.fullmatch(r'(\d+)\.\d+', env.get('osBuild', ''))
    expected_family = ('11' if int(build[1]) >= 22000 else '10') if build and int(build[1]) >= 17763 else None
    if not (family == env.get('windowsFamily') == expected_family
            and env.get('x64') is True and env.get('standardUser') is True
            and type(env.get('activeAdapterCount')) is int and env['activeAdapterCount'] == 0
            and env.get('freshProductProfile') is True and env.get('developmentCommandsOnPath') == []):
        raise ValueError('Wrong Windows family or guest preconditions')
    if report.get('passed') is False:
        return False
    stages = report.get('stages', [])
    # Compare the actual case list of this frozen kit. Passing a rehearsal cannot
    # establish guest provenance; it supplies only the expected check names/order.
    reference = release['offlineKit']['rehearsal']['stages']
    expected = [(s['stage'], s['passed']) for s in reference]
    def count(value):
        return type(value) is int and value >= 0
    if not isinstance(stages, list) or not all(isinstance(s,dict) for s in stages):
        raise ValueError('Invalid stage list')
    if not (report.get('passed') is True and report.get('finalStage') == 'newRestore'
            and report.get('temporaryFilesRemoved') is True and report.get('readOnlyInstallVerified') is True
            and type(report.get('nodeAliveAfterExit')) is int and report['nodeAliveAfterExit'] == 0
            and report.get('executedExeSha256') == [old['exeSha256'], candidate['exeSha256']]
            and re.fullmatch(r'Edg/\d+\.\d+\.\d+\.\d+', report.get('webView2',''))
            and [(s.get('stage'), s.get('passed')) for s in stages] == expected):
        raise ValueError('Guest report lacks required execution or case evidence')
    for stage, spec in zip(stages, reference):
        metrics=stage.get('metrics')
        if not (isinstance(metrics,dict) and all(count(metrics.get(k)) for k in spec['metrics'])
                and count(stage.get('webViewTargetReadyMs')) and count(stage.get('elapsedMs'))
                and stage['webViewTargetReadyMs'] <= stage['elapsedMs']):
            raise ValueError('Missing or invalid timing evidence')
    for k in ('hostPeakWorkingSetBytes','nodePeakWorkingSetBytes'):
        if not count(report.get(k)) or not report[k]:
            raise ValueError('Missing process memory evidence')
    return True


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--release', choices=RELEASES, default=CURRENT)
    ap.add_argument('--log', required=True, type=Path)
    ap.add_argument('--family', required=True, choices=['10','11'])
    ap.add_argument('--output', required=True, type=Path)
    args=ap.parse_args()
    with args.log.open('rb') as source:
        data = source.read(1024 * 1024 + 1)
    if len(data)>1024*1024:
        raise ValueError('Serial log exceeds 1 MiB; select only the run of interest')
    raw=payload(data,args.release)
    ok=evaluate(raw,args.family,record(args.release))
    with args.output.open('xb') as out:
        out.write(raw)
    print('Verified guest report fields.' if ok else 'Guest run failed; retained its report.')
    return 0 if ok else 1


if __name__=='__main__':
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, TypeError, OSError) as exc:
        raise SystemExit(f'No report collected: {exc}')
