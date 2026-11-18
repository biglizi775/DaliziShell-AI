"""Collector tests use synthetic guest fields; no fixture is release evidence."""
import base64
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
from collect_windows_guest_report import evaluate, payload
from windows_qa_release import record

RELEASE = record('rc3')
REHEARSAL = RELEASE['offlineKit']['rehearsal']


def fixture(family='11'):
    row = copy.deepcopy(REHEARSAL)
    row.update(mode='Guest', publicExecutables=True, executedExeSha256=[
        RELEASE['archiveCompatibility']['officialInput']['exeSha256'], RELEASE['candidate']['exeSha256']])
    row['environment'].update(windowsFamily=family, osBuild='19045.1' if family=='10' else '22631.1',
                              standardUser=True, activeAdapterCount=0, freshProductProfile=True)
    return row


def frame(raw):
    return b'DALIZI-RC3 '+hashlib.sha256(raw).hexdigest().encode()+b' '+base64.b64encode(raw)+b'\r\n'


class GuestReport(unittest.TestCase):
    def test_exact_families_and_checklists(self):
        for family in ('10','11'):
            self.assertTrue(evaluate(json.dumps(fixture(family)),family,RELEASE))
        with self.assertRaises(ValueError):
            evaluate(json.dumps(fixture('10')),'11',RELEASE)
        with self.assertRaises(ValueError):
            evaluate(json.dumps(REHEARSAL),'11',RELEASE)

    def test_does_not_accept_partial_or_mismatched_evidence(self):
        for path, value in [
            (('environment','osBuild'),'19045.1'), (('environment','standardUser'),False),
            (('environment','activeAdapterCount'),False), (('environment','developmentCommandsOnPath'),['cargo']),
            (('environment','freshProductProfile'),False), (('nodeAliveAfterExit',),1),
            (('executedExeSha256',),REHEARSAL['executedExeSha256']), (('candidateZipSha256',),'0'*64),
            (('stages',),fixture()['stages'][:-1]), (('stages',4,'passed'),[]),
            (('stages',4,'metrics'),{}), (('stages',0,'elapsedMs'),-1), (('readOnlyInstallVerified',),False)]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                row=fixture()
                target=row
                for key in path[:-1]:
                    target=target[key]
                target[path[-1]]=value
                evaluate(json.dumps(row),'11',RELEASE)

    def test_new_release_requires_its_own_public_execution_and_checklist(self):
        for previous,current in [('rc4','rc5'),('rc5','rc6'),('rc6','rc7')]:
            with self.subTest(current=current):
                release = record(current)
                with self.assertRaises(ValueError):
                    evaluate(json.dumps(release['offlineKit']['rehearsal']), '11', release)
                with self.assertRaises(ValueError):
                    evaluate(json.dumps(fixture()), '11', release)
                row = fixture()
                row['candidateZipSha256'] = release['candidate']['sha256']
                row['executedExeSha256'][1] = release['candidate']['exeSha256']
                row['stages'] = copy.deepcopy(record(previous)['offlineKit']['rehearsal']['stages'])
                with self.assertRaises(ValueError):
                    evaluate(json.dumps(row), '11', release)

    def test_transport_requires_one_intact_frame(self):
        raw=b'{"kind":"optical-transport-only"}'
        valid=frame(raw)
        self.assertEqual(raw,payload(b'firmware\r\n'+valid+b'other text\n','rc3'))
        with self.assertRaises(ValueError):
            payload(valid,'rc4')
        current=valid.replace(b'DALIZI-RC3 ',b'DALIZI-RC4 ',1)
        self.assertEqual(raw,payload(current,'rc4'))
        with self.assertRaises(ValueError):
            payload(valid+current,'rc4')
        with self.assertRaises(ValueError):
            evaluate(json.dumps(fixture()),'11',record('rc4'))
        for invalid in (b'',valid+valid,valid.rstrip(),valid[:-7]+b'\n',
                        valid.replace(hashlib.sha256(raw).hexdigest().encode(),b'0'*64),
                        frame(b'x'*32769)):
            with self.subTest(length=len(invalid)), self.assertRaises(ValueError):
                payload(invalid,'rc3')
        with self.assertRaises(ValueError):
            evaluate(payload(valid,'rc3'),'11',RELEASE)

    def test_failed_run_retained_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            source,output=folder/'serial.log',folder/'report.json'
            def run():
                return subprocess.run([sys.executable,TOOLS/'collect_windows_guest_report.py','--family','11','--release','rc3',
                                       '--log',source,'--output',output],capture_output=True)
            failed=fixture()
            failed.update(passed=False,finalStage='prepare',stages=[])
            raw=json.dumps(failed).encode()
            source.write_bytes(frame(raw))
            self.assertNotEqual(run().returncode,0)
            self.assertEqual(output.read_bytes(),raw)
            source.write_bytes(frame(json.dumps(fixture()).encode()))
            self.assertNotEqual(run().returncode,0)
            self.assertEqual(output.read_bytes(),raw)
            output.unlink()
            source.write_bytes(frame(json.dumps(REHEARSAL).encode()))
            self.assertNotEqual(run().returncode,0)
            self.assertFalse(output.exists())


if __name__=='__main__':
    unittest.main()
