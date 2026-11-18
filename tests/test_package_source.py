"""Rehearse a dirty checkout, excluded local data, and a corrupt sidecar."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import package_source as source


class SourceSnapshot(unittest.TestCase):
    def test_snapshot_from_working_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory).resolve()
            root, output = base / "checkout", base / "dist"
            root.mkdir()
            subprocess.run(["git", "init", "-q", str(root)], check=True)

            def write(name, data):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                return path

            write("package.json", json.dumps({"version": "1.0.0"}).encode())
            app = write("ui/index.html", b"staged")
            subprocess.run(["git", "add", "ui/index.html"], cwd=root, check=True)
            app.write_bytes(b"current")
            write("src-tauri/src/feature.rs", b"untracked feature")
            write("promo-film/dist/player.js", b"source")
            write("promo-film/.openai/hosting.json", b"private")
            write("promo-film/dist/actual-ui/session.png", b"screenshot")
            write("unrelated/export.json", b"personal")
            archive, sha, count = source.freeze(root, output)
            self.assertEqual(count, 4)
            with ZipFile(archive) as zipped:
                self.assertSetEqual(set(zipped.namelist()), {"dalizi-files-1.0.0/" + name for name in (
                    "package.json", "ui/index.html", "src-tauri/src/feature.rs", "promo-film/dist/player.js",
                )})
                self.assertEqual(zipped.read("dalizi-files-1.0.0/ui/index.html"), b"current")
                self.assertEqual(zipped.read("dalizi-files-1.0.0/src-tauri/src/feature.rs"), b"untracked feature")
            os.utime(app, (1000000000, 1000000000))
            self.assertEqual(source.freeze(root, output), (archive, sha, count))
            app.write_bytes(b"changed again")
            other, new_sha, _ = source.freeze(root, output)
            self.assertNotEqual(sha, new_sha)
            self.assertEqual(source.digest(archive), sha)
            other.with_suffix(".files.txt").write_bytes(b"damaged")
            with self.assertRaisesRegex(ValueError, "Existing artifact differs"):
                source.freeze(root, output)
            write("ui/new.svg", b"future required asset")
            with self.assertRaisesRegex(ValueError, "ui/new.svg"):
                source.freeze(root, output)


if __name__ == "__main__":
    unittest.main()
