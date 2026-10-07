"""Exercise the legacy token route in a copy with only synthetic configuration."""

import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

ISOLATED_CHECK = textwrap.dedent(r"""
    import asyncio
    import builtins
    import json
    import os
    import sys
    from pathlib import Path
    from unittest.mock import patch

    import httpx
    sys.path.insert(0, str(Path.cwd()))
    import main

    async def check():
        legacy_path = Path(main.GLOBAL_CONFIG_FILE)
        legacy_path.write_text(json.dumps({"modelscope_token": "fake-legacy-secret"}), encoding="utf-8")
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://isolated.test") as client:
            # An environment key wins over the old file and remains usable by old pages.
            response = await client.get("/api/config/token")
            assert response.status_code == 200 and response.json() == {"token": "fake-env-secret"}
            assert response.headers["cache-control"] == "no-store, no-cache, must-revalidate, max-age=0"
            assert response.headers["pragma"] == "no-cache"
            assert response.headers["expires"] == "0"
            assert "Origin" in response.headers["vary"]
            response = await client.get("/api/config/token/status")
            assert response.status_code == 200 and response.json() == {"configured": True}
            assert response.headers["cache-control"] == "no-store, no-cache, must-revalidate, max-age=0"
            response = await client.get("/api/config/token", headers={"Origin": "http://isolated.test"})
            assert response.status_code == 200 and response.json() == {"token": "fake-env-secret"}
            response = await client.get("/api/config/token", headers={"Origin": "http://isolated.test:80"})
            assert response.status_code == 200

            for headers in (
                {"Origin": "http://attacker.test"},
                {"Origin": "https://isolated.test", "X-Forwarded-Proto": "https"},
                {"Origin": "http://isolated.test:8080"},
                {"Origin": "null"},
                {"Origin": "http://isolated.test/path"},
                {"Origin": "http://isolated.test:bad"},
            ):
                response = await client.get("/api/config/token", headers=headers)
                assert response.status_code == 403, (headers, response.status_code)
                assert "fake-env-secret" not in response.text
                response = await client.get("/api/config/token/status", headers=headers)
                assert response.status_code == 403, (headers, response.status_code)
                assert "fake-env-secret" not in response.text

            # Remove the synthetic environment key and exercise the actual fallback.
            (Path(main.API_ENV_FILE)).unlink()
            os.environ.pop("MODELSCOPE_API_KEY", None)
            main.MODELSCOPE_API_KEY = ""
            assert main.modelscope_api_key() == "fake-legacy-secret"
            response = await client.get("/api/config/token", headers={"Origin": "http://isolated.test"})
            assert response.status_code == 200 and response.json() == {"token": "fake-legacy-secret"}
            response = await client.get("/api/config/token/status", headers={"Origin": "http://isolated.test"})
            assert response.status_code == 200 and response.json() == {"configured": True}

            messages = []
            with patch.object(main, "write_diagnostic", side_effect=lambda message, **kw: messages.append(message)):
                legacy_path.write_text('{"modelscope_token": "fake-secret", invalid', encoding="utf-8")
                response = await client.get("/api/config/token", headers={"X-Request-ID": "synthetic-request"})
                assert response.status_code == 200 and response.json() == {"token": ""}
                assert "legacy_config_invalid" in messages[-1]
                assert "request_id=synthetic-request" in messages[-1]
                response = await client.get("/api/config/token/status")
                assert response.status_code == 200 and response.json() == {"configured": False}

                legacy_path.write_text('["wrong shape"]', encoding="utf-8")
                response = await client.get("/api/config/token")
                assert response.json() == {"token": ""}
                assert "error=InvalidSchema" in messages[-1]

                legacy_path.write_text('{"modelscope_token": 123}', encoding="utf-8")
                response = await client.get("/api/config/token")
                assert response.json() == {"token": ""}
                assert "error=InvalidSchema" in messages[-1]

                original_open = builtins.open
                def denied_open(path, *args, **kwargs):
                    if str(path) == str(legacy_path):
                        raise PermissionError("permission fake-private-secret")
                    return original_open(path, *args, **kwargs)
                with patch("builtins.open", side_effect=denied_open):
                    response = await client.get("/api/config/token")
                assert response.status_code == 200 and response.json() == {"token": ""}
                assert "legacy_config_read_failed error=PermissionError" in messages[-1]

                legacy_path.unlink()
                before = len(messages)
                response = await client.get("/api/config/token")
                assert response.json() == {"token": ""}
                assert len(messages) == before

            diagnostic_text = "\n".join(messages)
            for private_text in ("fake-secret", "fake-private-secret", str(legacy_path)):
                assert private_text not in diagnostic_text

        async with httpx.AsyncClient(transport=transport, base_url="https://isolated.test") as client:
            response = await client.get("/api/config/token", headers={"Origin": "https://isolated.test"})
            assert response.status_code == 200

    asyncio.run(check())
    print("isolated token route checks passed")
""")


class LegacyConfigTokenTests(unittest.TestCase):
    def test_origin_guard_and_legacy_fallback(self):
        with tempfile.TemporaryDirectory(prefix="nadou-token-route-") as directory:
            isolated = Path(directory)
            shutil.copy2(ROOT / "main.py", isolated / "main.py")
            shutil.copytree(ROOT / "backend", isolated / "backend",
                            ignore=shutil.ignore_patterns("__pycache__"))
            (isolated / "static").mkdir()
            (isolated / "workflows").mkdir()
            (isolated / "API").mkdir()
            (isolated / "API" / ".env").write_text(
                "MODELSCOPE_API_KEY=fake-env-secret\n", encoding="utf-8"
            )
            process_env = os.environ.copy()
            for key in ("MODELSCOPE_API_KEY", "PYTHONPATH", "PYTHONHOME"):
                process_env.pop(key, None)
            process_env["PYTHONPATH"] = str(isolated)
            result = subprocess.run(
                [sys.executable, "-c", ISOLATED_CHECK],
                cwd=isolated,
                env=process_env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=45,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("isolated token route checks passed", result.stdout)


if __name__ == "__main__":
    unittest.main()
