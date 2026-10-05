"""Workflow ZIP exports must not claim to contain resources they skipped."""
import io
import json
import hashlib
import sys
import tempfile
import unittest
import zipfile
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class CanvasWorkflowExportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        for name, relative in {
            'ASSETS_DIR': 'assets',
            'OUTPUT_DIR': 'output',
            'OUTPUT_OUTPUT_DIR': 'output/generated',
            'OUTPUT_INPUT_DIR': 'output/input',
            'LOCAL_UPLOAD_DIR': 'output/local',
        }.items():
            path = root / relative
            path.mkdir(parents=True, exist_ok=True)
            self.stack.enter_context(patch.object(main, name, str(path)))
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url='http://export.test')
        self.addAsyncCleanup(self.client.aclose)

    async def test_missing_local_resource_rejects_complete_zip(self):
        response = await self.client.post('/api/canvas-workflows/export', json={
            'nodes': [{'id': 'image', 'type': 'image',
                       'url': '/assets/input/missing.png',
                       'images': [{'url': '/assets/input/missing.png'}]}],
            'connections': [],
            'include_resources': True,
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn('1 个本地素材文件缺失', response.json()['detail'])
        self.assertIn('导出不包含资源的 JSON', response.json()['detail'])

    async def test_existing_assets_and_storage_files_are_included(self):
        asset = Path(main.ASSETS_DIR) / 'reference.png'
        stored = Path(main.OUTPUT_OUTPUT_DIR) / 'result.png'
        asset.write_bytes(b'reference-image')
        stored.write_bytes(b'generated-image')
        response = await self.client.post('/api/canvas-workflows/export', json={
            'nodes': [{'id': 'image', 'type': 'image',
                       'url': '/assets/reference.png',
                       'images': [{'url': '/api/storage-files/generated/result.png'}]}],
            'connections': [],
            'include_resources': True,
        })
        self.assertEqual(response.status_code, 200, response.text)
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            workflow = json.loads(archive.read('workflow.json'))
            resources = {item['url']: item['archive'] for item in workflow['resources']}
            self.assertEqual(archive.read(resources['/assets/reference.png']), asset.read_bytes())
            self.assertEqual(archive.read(resources['/api/storage-files/generated/result.png']), stored.read_bytes())

    async def test_audio_and_video_resources_round_trip_for_both_canvas_shapes(self):
        """自制 WAV/WebM 在普通、智能节点形状中导出并重新导入后字节不变。"""
        fixture_root = Path(__file__).resolve().parent / "fixtures" / "canvas-ui" / "multimedia-export"
        source_files = {
            "/assets/验收音频.wav": fixture_root / "验收音频.wav",
            "/assets/验收短视频.webm": fixture_root / "验收短视频.webm",
        }
        for url, source in source_files.items():
            target = Path(main.ASSETS_DIR) / Path(url).name
            target.write_bytes(source.read_bytes())

        classic_nodes = [
            {"id": "audio", "type": "image", "url": "/assets/验收音频.wav",
             "name": "验收音频.wav", "mediaKind": "audio", "mime": "audio/wav"},
            {"id": "video", "type": "image", "url": "/assets/验收短视频.webm",
             "name": "验收短视频.webm", "mediaKind": "video", "mime": "video/webm"},
        ]
        smart_nodes = [
            {"id": "smart-audio", "type": "smart-image", "images": [{
                "url": "/assets/验收音频.wav", "name": "验收音频.wav", "kind": "audio", "mime": "audio/wav"}]},
            {"id": "smart-video", "type": "smart-image", "images": [{
                "url": "/assets/验收短视频.webm", "name": "验收短视频.webm", "kind": "video", "mime": "video/webm"}]},
        ]

        for label, nodes in (("classic", classic_nodes), ("smart", smart_nodes)):
            response = await self.client.post("/api/canvas-workflows/export", json={
                "nodes": nodes,
                "connections": [],
                "include_resources": True,
                "filename": f"{label}-multimedia.zip",
            })
            self.assertEqual(response.status_code, 200, response.text)
            with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                workflow = json.loads(archive.read("workflow.json"))
                resources = {item["url"]: item for item in workflow["resources"]}
                self.assertEqual(set(resources), set(source_files))
                for url, source in source_files.items():
                    archived = resources[url]["archive"]
                    content = archive.read(archived)
                    self.assertEqual(content, source.read_bytes())
                    self.assertEqual(resources[url]["size"], len(content))
                    self.assertEqual(hashlib.sha256(content).hexdigest(), hashlib.sha256(source.read_bytes()).hexdigest())

            imported = await self.client.post(
                "/api/canvas-workflows/import",
                files={"file": (f"{label}-multimedia.zip", response.content, "application/zip")},
            )
            self.assertEqual(imported.status_code, 200, imported.text)
            body = imported.json()
            self.assertEqual(len(body["nodes"]), 2)
            self.assertTrue(set(source_files).issubset(body["resource_map"]))
            self.assertTrue(all(str(node.get("url") or node.get("images", [{}])[0].get("url"))
                                .startswith("/assets/") for node in body["nodes"]))


if __name__ == '__main__':
    unittest.main()
