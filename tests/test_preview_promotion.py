"""Promotion preserves measured program bytes and refuses to redefine a frozen candidate."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import promote_windows_preview as promotion


class PreviewPromotion(unittest.TestCase):
    def test_measured_inputs_and_frozen_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            docs = root / 'docs'
            (docs / 'verification').mkdir(parents=True)
            guide = docs / 'HARNESS_M5.md'
            guide.write_bytes(b'candidate guide\n')
            component = b'fixture component'
            exe = b'fixture desktop'
            pin = promotion.sha(b'manifest')
            source = root / 'source.zip'
            with ZipFile(source, 'x') as z:
                z.writestr('dalizi-files-1.0.0/src-tauri/Cargo.lock', b'locked')
                z.writestr('dalizi-files-1.0.0/resources/harness/component.sha256', pin)
            preview = root / 'preview.zip'
            build = dict(version='1.0.0', preview='workspace', candidate=None, baseline='M5 RC6',
                         exeSha256=promotion.sha(exe), lockSha256=promotion.sha(b'locked'), dirty=True, commit='example',
                         component=dict(id='fixture',zipSha256=promotion.sha(component),manifestSha256=pin))
            with ZipFile(preview, 'x') as z:
                z.writestr('DaliziFiles.exe', exe)
                z.writestr('components/fixture.zip', component)
                z.writestr('BUILDINFO.json', json.dumps(build))
                z.writestr('使用说明.txt', 'Preview\r\n\r\n呆梨文件 Dalizi Files 1.0.0\r\n')
                for name in ('SHA256SUMS.txt','Harness-使用与验收.txt','预览说明.txt'):
                    z.writestr(name, 'old')
            def input_pin(file):
                return dict(archive=file.name, bytes=file.stat().st_size, sha256=promotion.sha(file.read_bytes()))
            evidence = root / 'evidence.json'
            evidence.write_text(json.dumps(dict(source=input_pin(source),preview=dict(**input_pin(preview),exeSha256=promotion.sha(exe)))))
            with patch.object(promotion, 'ROOT', root), contextlib.redirect_stdout(io.StringIO()):
                promotion.promote(evidence, root, root/'out', 'rc7')
                result = next((root/'out').glob('*.zip'))
                with ZipFile(result) as z:
                    self.assertEqual(z.read('DaliziFiles.exe'), exe)
                    self.assertEqual(z.read('components/fixture.zip'), component)
                    meta = json.loads(z.read('BUILDINFO.json'))
                    self.assertEqual(meta['sourceSha256'], input_pin(source)['sha256'])
                    self.assertEqual(meta['candidate'], 'M5 RC7')
                    self.assertNotIn('preview',meta)
                frozen = docs/'verification/harness-m5-rc7-windows11.json'
                frozen.write_text(json.dumps(dict(candidate=dict(sha256=promotion.sha(result.read_bytes())))))
                with self.assertRaises(FileExistsError):
                    promotion.promote(evidence, root, root/'out', 'rc7')
                guide.write_bytes(b'different guide\n')
                with self.assertRaisesRegex(ValueError, 'frozen'):
                    promotion.promote(evidence, root, root/'retry', 'rc7')
                self.assertEqual(list((root/'retry').iterdir()), [])
                source.write_bytes(b'different source')
                with self.assertRaisesRegex(ValueError, 'measured input'):
                    promotion.promote(evidence, root, root/'retry', 'rc7')


if __name__ == '__main__':
    unittest.main()
