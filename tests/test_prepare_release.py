"""Protect user data when exporting a public release."""

import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "prepare-release.py"
SPEC = importlib.util.spec_from_file_location("nadou_prepare_release", SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class PrepareReleaseTests(unittest.TestCase):
    def test_unlisted_root_files_stay_out_of_public_release(self):
        for relative in ("_self_restart.bat", "_self_restart.sh", "private-notes.md", "scratch.py"):
            self.assertFalse(release.included(relative), relative)
        for relative in ("run.bat", "main.py", "安装依赖.bat", "备份恢复说明.md"):
            self.assertTrue(release.included(relative), relative)
        self.assertTrue(release.included("API/.env.example"))
        self.assertFalse(release.included("API/.env"))
        self.assertFalse(release.included("API/custom.env"))

    def test_complete_zip_excludes_private_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            public = {
                "main.py": b"print('example')\n",
                "VERSION": b"2026.10.03\n",
                "static/index.html": b"<title>nadou ai</title>",
                "LICENSE": b"example license",
                "API/.env.example": b"COMFLY_API_KEY=\n",
            }
            private = {
                "API/.env": b"SAMPLE_SECRET=private",
                "data/asset_library.json": b'{"private":true}',
                "assets/output/image.png": b"private-image",
            }
            for relative, content in {**public, **private}.items():
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            files = [(relative, root / relative) for relative in public if release.included(relative)]
            with patch.object(release, "ROOT", root):
                target, archive, notes = release.build_release(
                    files, "2026.10.03", {"items": [{"text": "隔离样例"}]}
                )
            self.assertTrue(target.exists())
            self.assertTrue(notes.exists())
            with zipfile.ZipFile(archive) as bundle:
                names = set(bundle.namelist())
            self.assertIn("main.py", names)
            self.assertIn("static/index.html", names)
            self.assertIn("API/.env.example", names)
            self.assertIn("RELEASE_FILES.json", names)
            self.assertTrue(all(not release.included(path) for path in private))
            self.assertTrue(names.isdisjoint(private))


if __name__ == "__main__":
    unittest.main()
