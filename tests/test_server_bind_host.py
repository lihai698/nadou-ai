"""启动入口默认只能被本机访问，放开监听必须显式配置。"""

import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHECK = textwrap.dedent("""
    import os
    import runpy
    import sys
    import uvicorn

    sys.path.insert(0, os.getcwd())

    def capture_run(app, **settings):
        print('BIND_HOST=' + settings['host'])
        assert settings['port'] == 3000

    uvicorn.run = capture_run
    runpy.run_path('main.py', run_name='__main__')
""")


class ServerBindHostTests(unittest.TestCase):
    def test_default_is_local_and_external_binding_requires_explicit_setting(self):
        with tempfile.TemporaryDirectory(prefix="nadou-bind-host-") as directory:
            isolated = Path(directory)
            shutil.copy2(ROOT / "main.py", isolated / "main.py")
            shutil.copytree(ROOT / "backend", isolated / "backend",
                            ignore=shutil.ignore_patterns("__pycache__"))
            (isolated / "static").mkdir()
            (isolated / "workflows").mkdir()
            environment = os.environ.copy()
            environment.pop("NADOU_BIND_HOST", None)
            environment["PYTHONPATH"] = str(isolated)
            environment.pop("PYTHONHOME", None)
            for configured, expected in ((None, "127.0.0.1"), ("0.0.0.0", "0.0.0.0")):
                with self.subTest(configured=configured):
                    current = environment.copy()
                    if configured is not None:
                        current["NADOU_BIND_HOST"] = configured
                    result = subprocess.run(
                        [sys.executable, "-c", CHECK], cwd=isolated, env=current,
                        capture_output=True, text=True, encoding="utf-8", errors="replace",
                        timeout=45, check=False,
                    )
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn(f"BIND_HOST={expected}", result.stdout)


if __name__ == "__main__":
    unittest.main()
