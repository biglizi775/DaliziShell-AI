"""Pinned QA releases. A package/VM/report is always bound to a known record."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
RELEASES = ('rc3', 'rc4', 'rc5', 'rc6', 'rc7')
CURRENT = RELEASES[-1]


def record_path(tag):
    if tag not in RELEASES:
        raise ValueError('Unknown Windows QA release')
    return ROOT / f'docs/verification/harness-m5-{tag}-windows11.json'


def record(tag):
    return json.loads(record_path(tag).read_bytes())


def kit_names(tag):
    return {'public-v0.5.1.zip':'PUBLIC.ZIP', f'candidate-{tag}.zip':'RC'+tag[2:]+'.ZIP',
            'verify_windows_guest.ps1':'VERIFY.PS1','windows_guest_scenarios.js':'SCENARIO.JS',
            'README.md':'README.MD','SHA256SUMS.txt':'SUMS.TXT'}


def disc_entry(tag):
    return (ROOT/'tools/run_windows_guest_disc.ps1').read_bytes().replace(b'__QA_RELEASE__',tag.upper().encode('ascii'))
