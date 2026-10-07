import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from backend.depth_capture import DepthCaptureManager, extract_runtime


class DepthCaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_task_is_idempotent_and_interrupted_task_can_be_retried(self):
        source = self.root / "source.mp4"
        source.write_bytes(b"sample")
        manager = DepthCaptureManager(self.root / "data", self.root / "output", lambda name: "/output/" + name)
        with patch("backend.depth_capture.threading.Thread.start"):
            first = manager.create("/assets/source.mp4", str(source), "operation-123456789012345")
            second = manager.create("/assets/source.mp4", str(source), "operation-123456789012345")
        self.assertEqual(first["id"], second["id"])
        with self.assertRaises(ValueError):
            manager.create("/assets/another.mp4", str(source), "operation-123456789012345")
        restarted = DepthCaptureManager(self.root / "data", self.root / "output", lambda name: "/output/" + name)
        self.assertEqual(restarted.get(first["id"])["status"], "failed")
        self.assertIn("服务重启", restarted.get(first["id"])["error"])

    def test_zip_extraction_rejects_path_escape(self):
        archive = self.root / "bad.zip"
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("../outside.txt", "bad")
        with self.assertRaisesRegex(ValueError, "非法路径"):
            extract_runtime(archive, self.root / "install")
        self.assertFalse((self.root / "outside.txt").exists())


class DepthCaptureApiTests(unittest.TestCase):
    def setUp(self):
        import main
        self.main = main
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.assets = self.root / "assets"
        self.assets.mkdir()
        self.patches = [
            patch.object(main, "ASSETS_DIR", str(self.assets)),
            patch.object(main, "OUTPUT_DIR", str(self.root / "legacy-output")),
            patch.object(main, "OUTPUT_OUTPUT_DIR", str(self.assets / "output")),
            patch.object(main, "DATA_DIR", str(self.root / "data")),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_rejects_external_source_and_accepts_local_video(self):
        request = self.main.CanvasDepthCaptureRequest
        with self.assertRaises(self.main.HTTPException) as raised:
            self.main.create_canvas_depth_capture(request(source_url="https://example.com/a.mp4",
                operation_id="operation-123456789012345"))
        self.assertEqual(raised.exception.status_code, 400)
        source = self.assets / "sample.mp4"
        source.write_bytes(b"video")
        fake = {"id":"a" * 32, "source_path":str(source), "source_url":"/assets/sample.mp4",
                "status":"queued", "operation_id":"operation-123456789012345"}
        with patch.object(self.main, "canvas_depth_capture_manager") as get_manager:
            get_manager.return_value.create.return_value = fake
            result = self.main.create_canvas_depth_capture(request(source_url="/assets/sample.mp4",
                operation_id="operation-123456789012345"))
        self.assertNotIn("source_path", result)
        self.assertEqual(result["id"], fake["id"])


if __name__ == "__main__":
    unittest.main()
