"""Exercise Windows restart ownership against disposable local servers, not user data."""

import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == "nt", "Windows launcher")
class LocalServerRestartTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="nadou restart 中文 ")
        self.root = Path(self.directory.name)
        (self.root / "tools").mkdir()
        shutil.copyfile(ROOT / "tools/stop-local-server.ps1", self.root / "tools/stop-local-server.ps1")
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=10)
        self.directory.cleanup()

    def start_server(self, name="main.py"):
        script = self.root / name
        script.write_text(
            "import socket, time\n"
            "s = socket.socket()\n"
            f"s.bind(('127.0.0.1', {self.port}))\n"
            "s.listen()\n"
            "time.sleep(120)\n", encoding="utf-8")
        child = subprocess.Popen([sys.executable, str(script)], creationflags=subprocess.CREATE_NO_WINDOW)
        self.children.append(child)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with socket.socket() as probe:
                if probe.connect_ex(("127.0.0.1", self.port)) == 0:
                    return child
            self.assertIsNone(child.poll())
            time.sleep(0.05)
        self.fail("Disposable server did not start")

    def stop_server(self):
        return subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
             str(self.root / "tools/stop-local-server.ps1"), "-Port", str(self.port)],
            capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)

    def test_restart_stops_only_own_backend_and_preserves_files(self):
        fixtures = {"data/canvases.json": b'{"nodes":[1],"edges":[2]}',
                    "API/.env": b"MODEL=test-fixture-only\n", "assets/image.png": b"fixture"}
        for name, content in fixtures.items():
            path = self.root / name
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(content)
        old = self.start_server()
        result = self.stop_server()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        old.wait(timeout=10)
        # A new backend can acquire the same port after the old backend exits.
        new = self.start_server()
        self.assertIsNone(new.poll())
        for name, content in fixtures.items():
            self.assertEqual((self.root / name).read_bytes(), content)

    def test_unrelated_listener_is_not_stopped(self):
        other = self.start_server("other.py")
        result = self.stop_server()
        self.assertNotEqual(result.returncode, 0)
        self.assertIsNone(other.poll())

    def test_already_closed_backend_needs_no_cleanup(self):
        result = self.stop_server()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_real_batch_relaunch_loads_changed_source_and_keeps_running(self):
        shutil.copyfile(ROOT / "run.bat", self.root / "run.bat")
        (self.root / "tools/dependency_marker.py").write_text("pass\n", encoding="utf-8")
        (self.root / "tools/check-environment.py").write_text(
            "import socket, sys\n"
            f"port = {self.port}\n"
            "if '--print-port' in sys.argv: print(port)\n"
            "elif '--print-port-state' in sys.argv:\n"
            " s = socket.socket()\n"
            " print('existing' if s.connect_ex(('127.0.0.1', port)) == 0 else 'available')\n"
            " s.close()\n", encoding="utf-8")
        environment = dict(os.environ)
        environment["PATH"] = str(Path(sys.executable).parent) + os.pathsep + environment.get("PATH", "")
        marker = self.root / "started.txt"

        def launch(version):
            (self.root / "main.py").write_text(
                "import os, socket, time\nfrom pathlib import Path\n"
                "s = socket.socket()\n"
                f"s.bind(('127.0.0.1', {self.port}))\ns.listen()\n"
                f"Path(__file__).with_name('started.txt').write_text('{version}:' + str(os.getpid()))\n"
                "time.sleep(120)\n", encoding="utf-8")
            child = subprocess.Popen(["cmd.exe", "/c", "run.bat", "--no-browser"],
                                     cwd=self.root, env=environment, stdin=subprocess.DEVNULL,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     creationflags=subprocess.CREATE_NO_WINDOW)
            self.children.append(child)
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if marker.exists() and marker.read_text().startswith(version + ":"):
                    self.assertIsNone(child.poll(), "Launcher must remain attached to the backend")
                    return marker.read_text()
                self.assertIsNone(child.poll(), "Launcher exited before starting the backend")
                time.sleep(0.1)
            self.fail("Batch launcher did not load changed source")

        try:
            first = launch("morning")
            second = launch("afternoon")
            self.assertNotEqual(first.split(":")[1], second.split(":")[1])
        finally:
            self.stop_server()


if __name__ == "__main__":
    unittest.main()
