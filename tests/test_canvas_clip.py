"""真实剪辑导出验收：全部素材现场生成，不读取用户画布或素材。"""
import array
import copy
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

try:
    from backend.canvas_clip import CanvasClipManager, CanvasClipConflict, find_media_tools, validate_public_media_url
except ImportError:
    CanvasClipManager = None


class CanvasClipTests(unittest.TestCase):
    def test_export_service_exists(self):
        self.assertIsNotNone(CanvasClipManager, "缺少真实剪辑导出服务")

    def setUp(self):
        if CanvasClipManager is None:
            return
        self.temp = tempfile.TemporaryDirectory(prefix="nadou-clip-test-")
        self.root = Path(self.temp.name)
        self.media = self.root / "media"
        self.media.mkdir()
        self.tools = find_media_tools(Path(__file__).resolve().parents[1] / "data")
        self.ffmpeg, self.ffprobe = self.tools
        # BMP 不需要测试环境额外安装图片库。
        import struct
        pixels = bytes([0, 0, 255]) * 64 * 64
        (self.media / "red.bmp").write_bytes(b"BM" + struct.pack("<IHHI", 54 + len(pixels), 0, 0, 54)
            + struct.pack("<IiiHHIIiiII", 40, 64, 64, 1, 24, 0, len(pixels), 0, 0, 0, 0) + pixels)
        self.run_ffmpeg("-f", "lavfi", "-i", "color=blue:s=320x180:r=30:d=1", "-f", "lavfi", "-i", "sine=frequency=700:sample_rate=48000:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(self.media / "sound.mp4"))
        self.run_ffmpeg("-f", "lavfi", "-i", "color=green:s=320x180:r=30:d=0.5", "-f", "lavfi", "-i", "color=yellow:s=320x180:r=30:d=0.5", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(self.media / "silent.mp4"))
        self.manager = CanvasClipManager(self.root / "data", self.root / "output", lambda name: "/output/" + name,
            lambda url: str(self.media / url.removeprefix("/assets/")) if url.startswith("/assets/") else None,
            [self.media], tools=self.tools)

    def tearDown(self):
        if CanvasClipManager is not None:
            self.manager.close()
            self.temp.cleanup()

    def run_ffmpeg(self, *args):
        return subprocess.run([self.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True, check=True, timeout=90).stdout

    def clip(self, id="a", kind="video", file="sound.mp4", start=0, end=15, offset=0):
        return {"id": id, "kind": kind, "url": "/assets/" + file, "sourceOffsetFrames": offset,
            "startFrame": start, "endFrame": end, "sourceDurationFrames": 30, "name": file}

    def request(self, clips=None, scope="full", muted=False, request_id="test-request"):
        return {"canvas_id": "canvas-test", "node_id": "node-test", "request_id": request_id, "scope": scope,
            "clipData": {"version": 1, "fps": 30, "exportMuted": muted, "clips": clips or [self.clip()]}}

    def finish(self, request):
        created = self.manager.create(request)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            task = self.manager.get(created["id"])
            if task["status"] in {"succeeded", "failed"}:
                return task
            time.sleep(0.05)
        self.fail("真实导出超时")

    def result_path(self, result):
        return self.root / "output" / result["url"].removeprefix("/output/")

    def probe(self, path):
        return json.loads(subprocess.check_output([self.ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)]))

    def pixel(self, path, second):
        return tuple(self.run_ffmpeg("-ss", str(second), "-i", str(path), "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1")[:3])

    def energy(self, path, second):
        raw = self.run_ffmpeg("-ss", str(second), "-i", str(path), "-t", "0.12", "-vn", "-ac", "1", "-f", "s16le", "pipe:1")
        values = array.array("h", raw)
        return math.sqrt(sum(x*x for x in values) / max(1, len(values)))

    def test_mixed_full_preserves_sound_black_gap_and_fixed_format(self):
        clips = [self.clip("image", "image", "red.bmp", 0, 9), self.clip("sound", start=15, end=30), self.clip("silent", file="silent.mp4", start=30, end=45, offset=15)]
        task = self.finish(self.request(clips))
        self.assertEqual(task["status"], "succeeded", task["error"])
        self.assertEqual((task["canvas_id"], task["node_id"]), ("canvas-test", "node-test"))
        path = self.result_path(task["results"][0])
        probe = self.probe(path)
        video = next(s for s in probe["streams"] if s["codec_type"] == "video")
        audio = next(s for s in probe["streams"] if s["codec_type"] == "audio")
        self.assertEqual((video["codec_name"], video["width"], video["height"], video["pix_fmt"], video["r_frame_rate"]), ("h264", 1920, 1080, "yuv420p", "30/1"))
        self.assertEqual((audio["codec_name"], audio["sample_rate"], audio["channels"]), ("aac", "48000", 2))
        self.assertAlmostEqual(float(probe["format"]["duration"]), 1.5, delta=0.04)
        self.assertLess(max(self.pixel(path, 0.4)), 8)
        self.assertGreater(self.energy(path, 0.7), 100)
        self.assertLess(self.energy(path, 0.05), 10)
        self.assertLess(self.energy(path, 0.34), 10)
        self.assertLess(self.energy(path, 1.2), 10)
        self.assertGreater(self.pixel(path, 1.2)[0], 180)  # 源 offset 指向黄色后半段

    def test_muted_has_no_audio_and_segments_keep_offset_and_order(self):
        task = self.finish(self.request([self.clip("first", file="silent.mp4", start=12, end=18, offset=18), self.clip("second", start=20, end=23)], "segments", True))
        self.assertEqual(task["status"], "succeeded", task["error"])
        self.assertEqual([x["sourceClipId"] for x in task["results"]], ["first", "second"])
        self.assertTrue(task["results"][0]["name"].startswith("clip-001"))
        path = self.result_path(task["results"][0])
        self.assertFalse(any(s["codec_type"] == "audio" for s in self.probe(path)["streams"]))
        self.assertAlmostEqual(task["results"][0]["durationSeconds"], 0.2, delta=0.04)
        self.assertGreater(self.pixel(path, 0.05)[0], 180)

    def test_invalid_frames_paths_and_overlaps_rejected_without_task(self):
        for changes in [{"startFrame": -1}, {"endFrame": 0}, {"endFrame": 1.5}, {"sourceOffsetFrames": True}, {"url": "/assets/../outside.mp4"}, {"url": "file:///secret.mp4"}, {"url": "/assets/missing.mp4"}]:
            clip = self.clip()
            clip.update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.manager.create(self.request([clip]))
        with self.assertRaises(ValueError):
            self.manager.create(self.request([self.clip(), self.clip("b", start=12, end=20)]))

    def test_real_source_boundary_and_partial_failure_keep_successes(self):
        task = self.finish(self.request([self.clip("good", start=0, end=3), self.clip("bad", start=4, end=20, offset=20)], "segments"))
        self.assertEqual(task["status"], "failed")
        self.assertEqual([x["sourceClipId"] for x in task["results"]], ["good"])
        self.assertIn("部分", task["error"])
        self.assertIn("bad", task["error"])
        self.assertTrue(self.result_path(task["results"][0]).is_file())
        self.assertTrue((self.media / "sound.mp4").is_file())

    def test_idempotency_node_mutex_and_canvas_ownership(self):
        payload = self.request()
        first = self.manager.create(payload)
        self.assertEqual(self.manager.create(copy.deepcopy(payload))["id"], first["id"])
        changed = self.request(muted=True)
        with self.assertRaises(CanvasClipConflict):
            self.manager.create(changed)
        other = self.request(request_id="other")
        with self.assertRaises(CanvasClipConflict):
            self.manager.create(other)
        other["canvas_id"] = "other-canvas"
        second = self.manager.create(other)
        self.assertNotEqual(second["id"], first["id"])
        self.assertEqual(self.manager.get(second["id"])["canvas_id"], "other-canvas")

    def test_private_remote_and_credential_urls_rejected(self):
        for url in ["http://127.0.0.1/a.mp4", "http://169.254.169.254/a", "http://[::1]/a", "https://user:pass@example.com/a", "http://192.168.1.2/a", "http://example.com:22/a", "file:///a"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_public_media_url(url)

    def test_one_frame_export_and_restart_keep_completed_result(self):
        task = self.finish(self.request([self.clip(end=1)], muted=True))
        self.assertEqual(task["status"], "succeeded", task["error"])
        stream = self.probe(self.result_path(task["results"][0]))["streams"][0]
        self.assertEqual(stream["nb_frames"], "1")
        restarted = CanvasClipManager(self.root / "data", self.root / "output", lambda name: "/output/" + name,
            self.manager.local_path, [self.media], tools=self.tools)
        try:
            self.assertEqual(restarted.get(task["id"])["results"], task["results"])
            self.assertEqual(restarted.create(self.request([self.clip(end=1)], muted=True))["id"], task["id"])
        finally:
            restarted.close()

    def test_api_creates_owned_task_and_returns_errors(self):
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        import main
        client = TestClient(main.app)
        with patch.object(main, "canvas_clip_manager", return_value=self.manager, create=True):
            response = client.post("/api/canvas-clip/export", json=self.request())
            self.assertEqual(response.status_code, 200, response.text)
            value = response.json()
            self.assertEqual(set(value), {"id", "status", "canvas_id", "node_id"})
            task = client.get("/api/canvas-clip/tasks/" + value["id"]).json()
            self.assertEqual(task["canvas_id"], "canvas-test")
            self.assertEqual(client.get("/api/canvas-clip/tasks/missing").status_code, 404)
            self.assertEqual(client.post("/api/canvas-clip/export", json=self.request(muted=True)).status_code, 409)
            invalid = self.request()
            invalid["clipData"]["fps"] = 24
            self.assertEqual(client.post("/api/canvas-clip/export", json=invalid).status_code, 400)

    def test_playlist_cannot_read_files_outside_media_directory(self):
        # 将合法路径伪装成媒体，不能借 FFmpeg 的 playlist/concat 解复用器
        # 二次打开目录外文件或网络地址。
        (self.media / "outside.ffconcat").write_text("ffconcat version 1.0\nfile '../secret.mp4'\nduration 1\n", encoding="utf-8")
        (self.root / "secret.mp4").write_bytes((self.media / "sound.mp4").read_bytes())
        task = self.finish(self.request([self.clip(file="outside.ffconcat")]))
        self.assertEqual(task["status"], "failed")
        self.assertEqual(task["results"], [])

    def test_native_route_uses_snapshot_storage_and_installed_tools(self):
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        import main
        client = TestClient(main.app)
        patches = {"DATA_DIR": str(self.root / "api-data"), "ASSETS_DIR": str(self.media),
            "OUTPUT_DIR": str(self.root / "legacy"), "OUTPUT_OUTPUT_DIR": str(self.root / "output"),
            "OUTPUT_INPUT_DIR": str(self.media), "LOCAL_UPLOAD_DIR": str(self.media),
            "_canvas_clip_manager": None, "_canvas_clip_manager_key": None}
        with patch.multiple(main, **patches):
            try:
                created = client.post("/api/canvas-clip/export", json=self.request([self.clip(kind="image", file="red.bmp", end=3)]))
                self.assertEqual(created.status_code, 200, created.text)
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    task = client.get("/api/canvas-clip/tasks/" + created.json()["id"]).json()
                    if task["status"] in {"succeeded", "failed"}:
                        break
                    time.sleep(0.05)
                self.assertEqual(task["status"], "succeeded", task["error"])
                self.assertTrue(task["results"][0]["url"].startswith("/api/storage-files/generated/"))
                name = task["results"][0]["name"]
                self.assertTrue((self.root / "output" / name).is_file())
            finally:
                if main._canvas_clip_manager:
                    main._canvas_clip_manager.close()

    def test_workflow_import_rewrites_clip_source_exclusion_url_only(self):
        import main
        old = "/assets/旧素材.mp4"
        new = "/api/storage-files/generated/导入素材.mp4"
        source_key = json.dumps(["upstream-node", old], ensure_ascii=False, separators=(",", ":"))
        unaffected = ['plain text ' + old, '["node","unknown-result"]', '["node",2]',
            '["node","' + old + '","extra"]', '{"url":"' + old + '"}', '[broken',
            json.dumps([old, "stable-result-id"], ensure_ascii=False)]
        nodes = [{"id": "clip-node", "clipData": {"clips": [{"id": "clip-a", "url": old,
            "sourceNodeId": "upstream-node", "sourceResultId": old}], "excludedSources": [source_key],
            "unrelatedStrings": unaffected}}]
        original = copy.deepcopy(nodes)
        replaced = main.canvas_workflow_replace_strings(nodes, {old: new})
        data = replaced[0]["clipData"]
        self.assertEqual(data["clips"][0]["url"], new)
        self.assertEqual(data["clips"][0]["sourceResultId"], new)
        self.assertEqual(data["excludedSources"], [json.dumps(["upstream-node", new], ensure_ascii=False, separators=(",", ":"))])
        self.assertEqual(data["unrelatedStrings"], unaffected)
        self.assertEqual(nodes, original)


if __name__ == "__main__":
    unittest.main()
