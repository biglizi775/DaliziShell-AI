"""Check that a self-consistent package cannot stand in for a recorded release or CI's host."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from verify_public_rollback import archive_host


class RollbackInputs(unittest.TestCase):
    def test_independent_exe_and_archive_pins(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            def make(name, host, candidate='M5 RC4', kind=None):
                p=folder/name
                digest=hashlib.sha256(host).hexdigest()
                with zipfile.ZipFile(p,'x') as z:
                    z.writestr('DaliziFiles.exe',host)
                    z.writestr('BUILDINFO.json',json.dumps({'candidate':candidate,'kind':kind,'exeSha256':digest,
                                                            'component':{'id':'test'}}))
                return p,hashlib.sha256(p.read_bytes()).hexdigest(),digest
            good,zip_pin,exe_pin=make('tested.zip',b'tested fixture')
            wrong,wrong_zip,wrong_exe=make('other.zip',b'different fixture')
            data,info=archive_host(good,zip_pin,exe_pin,'M5 RC4')
            self.assertEqual((data,info['exeSha256']),(b'tested fixture',exe_pin))
            integration,_,_=make('fresh.zip',data,None,'integration')
            self.assertEqual(archive_host(integration,None,exe_pin,None,fresh=True)[0],data)
            with self.assertRaises(ValueError):
                archive_host(integration,None,exe_pin,'M5 RC4')
            with self.assertRaises(ValueError):
                archive_host(good,None,exe_pin,None,fresh=True)
            for z,e,label in ((zip_pin,wrong_exe,'M5 RC4'),(None,exe_pin,'M5 RC4'),
                              (wrong_zip,wrong_exe,'M5 RC3')):
                with self.subTest(z=z,e=e,label=label),self.assertRaises(ValueError):
                    archive_host(wrong,z,e,label)


if __name__=='__main__':
    unittest.main()
