"""Read three independent acceptance reports. Missing or invalid evidence never passes."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
from collect_windows_guest_report import evaluate, MAX_REPORT
from windows_qa_release import CURRENT, RELEASES, ROOT, record

CLOUD_CHECKS=['official-route-selected-answer','only-A-has-one-unread-task',
              'same-answer-after-second-launch','restored-answer-read-without-resubmission']


def evaluate_cloud(raw, tag, release):
    row=json.loads(raw)
    pin=release['candidate']
    if not (isinstance(row,dict) and type(row.get('schema')) is int and row['schema']==1 and
            row.get('suite')=='operator-cloud-turn' and row.get('mode')=='Live' and row.get('release')==tag and
            row.get('candidateZipSha256')==pin['sha256'] and row.get('exeSha256')==pin['exeSha256'] and
            row.get('componentZipSha256')==pin['component']['zipSha256']):
        raise ValueError('Different release or report kind')
    stamp=datetime.fromisoformat(row['utc'])
    if not stamp.tzinfo or stamp.utcoffset().total_seconds()!=0:
        raise ValueError('Missing UTC run time')
    if row.get('passed') is False and row.get('stage') in {'first-launch','first-receipt','restart','restored-receipt'}:
        return False
    if not (row.get('passed') is True and row.get('stage')=='complete' and row.get('checks')==CLOUD_CHECKS and
            row.get('model') in {'deepseek-flash','deepseek-v4-pro','deepseek-v4-flash'} and
            row.get('operatorObservedSwitchToB') is True and 'failure' not in row):
        raise ValueError('Missing successful operator and receipt checks')
    return True


def assess(tag, candidate, win10=None, win11=None, cloud=None):
    release=record(tag)
    with candidate.open('rb') as f:
        digest=hashlib.file_digest(f,'sha256').hexdigest()
    if digest!=release['candidate']['sha256']:
        raise ValueError('Candidate ZIP differs from the selected release')
    checks={}
    for key, path, judge in [('cleanWindows10',win10,lambda r:evaluate(r,'10',release)),
                             ('cleanWindows11',win11,lambda r:evaluate(r,'11',release)),
                             ('authenticatedCloudTurn',cloud,lambda r:evaluate_cloud(r,tag,release))]:
        if not path:
            checks[key]={'status':'missing'}
            continue
        try:
            with path.open('rb') as f: raw=f.read(MAX_REPORT+1)
            if len(raw)>MAX_REPORT: raise ValueError('Oversized report')
            ok=judge(raw)
            checks[key]={'status':'passed' if ok else 'failed','reportSha256':hashlib.sha256(raw).hexdigest()}
        except (OSError,ValueError,TypeError,KeyError,RecursionError):
            checks[key]={'status':'invalid'}
    passed=all(item['status']=='passed' for item in checks.values())
    return {'release':tag,'candidateZipSha256':digest,'checks':checks,'allEvidencePassed':passed}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release',choices=RELEASES,default=CURRENT)
    parser.add_argument('--candidate',type=Path)
    for opt in ['windows10','windows11','cloud']: parser.add_argument('--'+opt,type=Path)
    args=parser.parse_args()
    try:
        result=assess(args.release,args.candidate or ROOT/'dist'/record(args.release)['candidate']['archive'],
                      args.windows10,args.windows11,args.cloud)
    except (OSError,ValueError):
        parser.exit(2,'Cannot verify the selected candidate archive.\n')
    print(json.dumps(result,indent=2))
    raise SystemExit(0 if result['allEvidencePassed'] else 1)
