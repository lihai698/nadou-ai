"""启动脚本的入口和默认地址必须与后端绑定规则一致。"""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StartupScriptTests(unittest.TestCase):
    def test_all_windows_batch_launchers_use_windows_line_endings(self):
        paths = [ROOT / name for name in ("run.bat", "安装依赖.bat", "检查核心流程.bat")]
        for path in paths:
            raw = path.read_bytes()
            self.assertIn(b"\r\n", raw, path.as_posix())
            self.assertNotIn(b"\n", raw.replace(b"\r\n", b""), path.as_posix())

    def test_macos_launcher_derives_browser_host_from_bind_host(self):
        script = (ROOT / "mac-启动服务.sh").read_text(encoding="utf-8")
        self.assertIn('bash mac-安装依赖.sh --no-pause', script)
        self.assertIn('dependency_marker.py --check', script)
        self.assertIn('BIND_HOST="${NADOU_BIND_HOST:-}"', script)
        self.assertIn('APP_HOST="127.0.0.1"', script)
        self.assertIn('APP_URL="http://${APP_HOST}:3000/"', script)
        self.assertNotIn('APP_URL="http://${LAN_IP}:3000/"', script)

    def test_macos_dependency_installer_has_noninteractive_mode(self):
        script = (ROOT / "mac-安装依赖.sh").read_text(encoding="utf-8")
        self.assertIn('"${1:-}" = "--no-pause"', script)
        self.assertIn("dependency_marker.py --write", script)

    def test_windows_launcher_uses_real_entrypoint(self):
        raw = (ROOT / "run.bat").read_bytes()
        self.assertIn(b"\r\n", raw)
        self.assertNotIn(b"\n", raw.replace(b"\r\n", b""))
        script = raw.decode("utf-8-sig")
        self.assertIn("tools\\check-environment.py", script)
        self.assertIn("main.py", script)
        self.assertIn("安装依赖.bat\" --no-pause", script)
        self.assertIn("dependency_marker.py --check", script)
        self.assertNotIn("启动服务.bat", script)

    def test_dependency_installer_can_run_without_interactive_pause(self):
        raw = (ROOT / "安装依赖.bat").read_bytes()
        self.assertIn(b"\r\n", raw)
        self.assertNotIn(b"\n", raw.replace(b"\r\n", b""))
        script = raw.decode("utf-8-sig")
        self.assertIn('tools\\dependency_marker.py" --write', script)
        self.assertIn('"%~1"=="--no-pause"', script)
        self.assertTrue(
            all(line.strip() == 'if "%NO_PAUSE%"=="0" pause' for line in script.splitlines() if line.strip().endswith("pause")),
            "--no-pause 模式下的失败分支不能无条件等待按键",
        )


if __name__ == "__main__":
    unittest.main()
