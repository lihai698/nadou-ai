"""在无私人文件的代码副本验证 API 设置保存及重启加载。"""

import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

SAVE_SCRIPT = textwrap.dedent("""
    import asyncio
    from pathlib import Path
    import sys
    sys.path.insert(0, str(Path.cwd()))
    import httpx
    import main

    async def verify():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://isolated.test") as client:
            saved = await client.put("/api/providers", json=[{
                "id": "comfly", "name": "隔离平台", "base_url": "https://example.invalid/v1",
                "protocol": "openai", "api_key": "isolated=key",
                "chat_models": ["isolated-chat"], "image_models": ["isolated-image"]
            }])
            assert saved.status_code == 200, saved.status_code
            config = (await client.get("/api/config")).json()
            assert config["base_url"] == "https://example.invalid/v1"
            assert config["has_api_key"] is True
        assert main.read_api_env_value("COMFLY_API_KEY") == "isolated=key"
        assert main.read_api_env_value("COMFLY_BASE_URL") == "https://example.invalid/v1"
        contents = Path(main.API_ENV_FILE).read_text(encoding="utf-8")
        assert "# keep comment" in contents
        assert "CUSTOM_NOTE=untouched" in contents
        assert contents.count("COMFLY_API_KEY=") == 1

    asyncio.run(verify())
    print("SAVED")
""")

RESTART_SCRIPT = textwrap.dedent("""
    import asyncio
    from pathlib import Path
    import sys
    sys.path.insert(0, str(Path.cwd()))
    import httpx
    import main

    async def verify():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://isolated.test") as client:
            config = (await client.get("/api/config")).json()
            providers = (await client.get("/api/providers")).json()["providers"]
        assert config["base_url"] == "https://example.invalid/v1"
        assert config["has_api_key"] is True
        saved = next(item for item in providers if item["id"] == "comfly")
        assert saved["has_key"] is True
        assert saved["chat_models"] == ["isolated-chat"]
        assert main.read_api_env_value("COMFLY_API_KEY") == "isolated=key"

    asyncio.run(verify())
    print("RELOADED")
""")


class LocalEnvEntryTests(unittest.TestCase):
    def test_provider_save_and_restart_load_use_extracted_store(self):
        with tempfile.TemporaryDirectory(prefix="nadou-config-entry-") as directory:
            isolated = Path(directory)
            shutil.copy2(ROOT / "main.py", isolated / "main.py")
            shutil.copytree(ROOT / "backend", isolated / "backend",
                            ignore=shutil.ignore_patterns("__pycache__"))
            (isolated / "static").mkdir()
            (isolated / "workflows").mkdir()
            (isolated / "API").mkdir()
            (isolated / "API" / ".env").write_text(
                "# keep comment\nCUSTOM_NOTE=untouched\nCOMFLY_API_KEY=old\n",
                encoding="utf-8",
            )
            process_env = os.environ.copy()
            for name in ("COMFLY_API_KEY", "COMFLY_BASE_URL", "CHAT_MODELS", "IMAGE_MODELS",
                         "PYTHONPATH", "PYTHONHOME"):
                process_env.pop(name, None)
            # 运行时环境可能启用了安全路径模式，显式把隔离副本加入导入路径，
            # 避免测试意外导入工作区或找不到临时副本的 main.py。
            process_env["PYTHONPATH"] = str(isolated)
            for script, marker in ((SAVE_SCRIPT, "SAVED"), (RESTART_SCRIPT, "RELOADED")):
                result = subprocess.run(
                    [sys.executable, "-c", script], cwd=isolated, env=process_env,
                    capture_output=True, text=True, encoding="utf-8", errors="replace",
                    timeout=45, check=False,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn(marker, result.stdout)


if __name__ == "__main__":
    unittest.main()
