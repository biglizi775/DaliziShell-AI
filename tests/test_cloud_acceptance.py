"""Synthetic report/ledger inputs test the verifier only; none are release evidence."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from check_harness_release_gates import assess, CLOUD_CHECKS, evaluate_cloud
from windows_qa_release import record


class CloudGate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.release=record('rc6')
        pin=cls.release['candidate']
        cls.ok=dict(schema=1,suite='operator-cloud-turn',mode='Live',release='rc6',utc='2026-11-16T17:00:00.0000000Z',
                    candidateZipSha256=pin['sha256'],exeSha256=pin['exeSha256'],componentZipSha256=pin['component']['zipSha256'],
                    passed=True,stage='complete',model='deepseek-flash',operatorObservedSwitchToB=True,checks=CLOUD_CHECKS)

    def test_reports_require_matching_release_and_actual_checks(self):
        self.assertTrue(evaluate_cloud(json.dumps(self.ok),'rc6',self.release))
        for k,v in [('release','rc5'),('exeSha256','0'*64),('candidateZipSha256','0'*64),('mode','Rehearse'),
                    ('checks',CLOUD_CHECKS[:-1]),('utc','2026-11-16'),('stage','restart'),('model','fixture'),
                    ('operatorObservedSwitchToB',False),('passed',1),('failure','wrong-model-endpoint')]:
            with self.subTest(k=k),self.assertRaises(ValueError):
                evaluate_cloud(json.dumps({**self.ok,k:v}),'rc6',self.release)
        self.assertFalse(evaluate_cloud(json.dumps({**self.ok,'passed':False,'stage':'first-receipt','failure':'wrong-model-endpoint'}),'rc6',self.release))

    def test_independent_families_cloud_and_candidate(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);candidate=root/'candidate';candidate.write_bytes(b'test package')
            release=copy.deepcopy(self.release);pin=release['candidate']
            pin['sha256']=hashlib.sha256(candidate.read_bytes()).hexdigest()
            cloud=root/'cloud.json';cloud.write_text(json.dumps({**self.ok,'candidateZipSha256':pin['sha256']}))
            inputs=[]
            for family,build in [('10','19045.1'),('11','22631.1')]:
                row=copy.deepcopy(release['offlineKit']['rehearsal'])
                row.update(mode='Guest',publicExecutables=True,candidateZipSha256=pin['sha256'],
                           executedExeSha256=[release['archiveCompatibility']['officialInput']['exeSha256'],pin['exeSha256']])
                row['environment'].update(standardUser=True,activeAdapterCount=0,freshProductProfile=True,windowsFamily=family,osBuild=build)
                inputs.append(root/family);inputs[-1].write_text(json.dumps(row))
            with patch('check_harness_release_gates.record',return_value=release):
                self.assertTrue(assess('rc6',candidate,*inputs,cloud)['allEvidencePassed'])
                swapped=assess('rc6',candidate,*reversed(inputs),None)
                self.assertEqual([x['status'] for x in swapped['checks'].values()],['invalid','invalid','missing'])
                self.assertFalse(swapped['allEvidencePassed'])
                cloud.write_bytes(b'{'*33000)
                self.assertEqual(assess('rc6',candidate,*inputs,cloud)['checks']['authenticatedCloudTurn']['status'],'invalid')
                candidate.write_bytes(b'other archive')
                with self.assertRaises(ValueError):assess('rc6',candidate,*inputs,cloud)

    @unittest.skipUnless(sys.platform=='win32','Windows PowerShell verifier')
    def test_bad_ledger_cases_with_real_powershell_51(self):
        proc=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-File',str(ROOT/'tests/cloud_receipt_checks.ps1')],
                            capture_output=True,timeout=30)
        self.assertEqual(proc.returncode,0,proc.stderr.decode(errors='replace'))


if __name__=='__main__':unittest.main()
