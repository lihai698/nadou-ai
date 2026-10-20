"""作品检查服务的独立边界；文件是真实自制图片，任务只使用本地桩。"""
import copy
import importlib
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from PIL import Image

from backend.canvas_assistant_canvas_rules import node_reference_assets


class ResultInspectionServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        owner = importlib.import_module('backend.canvas_assistant_result_review')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        Image.new('RGB', (72, 48), 'white').save(self.root / 'result.png')
        self.canvas = {'id': 'canvas', 'kind': 'classic', 'nodes': [
            {'id': 'image', 'type': 'image', 'url': '/output/result.png'}]}
        self.asset = node_reference_assets(self.canvas)[0]['id']
        self.payload = SimpleNamespace(canvasId='canvas', provider='fixture', model='vision')
        self.saved = {'agent': {'modelCalls': 1}}
        self.calls = []

        def load(canvas_id):
            self.calls.append(('canvas', canvas_id))
            return self.canvas

        def providers():
            self.calls.append(('providers',))
            return [{'id': 'fixture', 'supports_vision': True}]

        def roots():
            self.calls.append(('roots',))
            return [self.root]

        self.service = owner.ResultInspectionService(
            load_canvas=load, providers=providers,
            resolve_result_file=lambda url: self.root / url.rsplit('/', 1)[-1], result_roots=roots,
            query_image=self.query_image, query_native_task=self.query_native_task)

    async def query_image(self, task_id):
        self.calls.append(('image', task_id))
        return {'status': 'succeeded', 'result': {'images': ['/output/result.png']}}

    async def query_native_task(self, kind, task_id):
        self.calls.append(('native', kind, task_id))
        return {'status': 'succeeded', 'result': {'videos': ['/output/result.mp4']}}

    async def own_proposal(self, proposal_id):
        self.calls.append(('proposal', proposal_id))
        if proposal_id != 'owned':
            raise HTTPException(404, '只能读取本轮已有生成方案')
        return {'id': 'owned', 'state': 'submitted', 'taskId': 'task', 'referenceImages': []}

    async def inspect(self, **args):
        return await self.service.inspect_or_review(
            'inspect_result', {'assetIds': [self.asset], 'proposalId': '', **args}, 'step',
            payload=self.payload, saved_turn=self.saved, own_proposal=self.own_proposal)

    async def review(self, inspection, *, status='passed', delivered=True):
        self.saved['agent'] = {'resultInspection': inspection, 'modelCalls': 2,
                               'lastModelInputImages': ['/output/result.png'] if delivered else []}
        return await self.service.inspect_or_review(
            'record_result_review', {'inspectionId': inspection['id'], 'status': status,
                                     'findings': ['抽查可读'], 'limitations': []}, 'review',
            payload=self.payload, saved_turn=self.saved, own_proposal=self.own_proposal)

    async def test_real_image_snapshot_and_inputs_remain_unchanged(self):
        before = copy.deepcopy((self.canvas, self.saved))
        result = await self.inspect()
        self.assertEqual(result['images'], ['/output/result.png'])
        self.assertEqual(result['resultInspection']['images'][0]['width'], 72)
        self.assertEqual((self.canvas, self.saved), before)
        self.assertEqual(self.calls, [('canvas', 'canvas'), ('roots',), ('canvas', 'canvas'), ('providers',)])

    async def test_read_only_inspection_never_promotes_unconfirmed_requirements(self):
        inspection = (await self.inspect())['resultInspection']
        result = await self.review(inspection)
        self.assertEqual(result['review']['visualStatus'], 'passed')
        self.assertEqual(result['review']['status'], 'unknown')

    async def test_unseen_image_cannot_receive_visual_review(self):
        inspection = (await self.inspect())['resultInspection']
        with self.assertRaises(HTTPException) as caught:
            await self.review(inspection, delivered=False)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn('未实际读取', caught.exception.detail)

    async def test_unknown_review_allowed_without_visual_delivery(self):
        inspection = (await self.inspect())['resultInspection']
        result = await self.review(inspection, delivered=False, status='unknown')
        self.assertEqual(result['review']['status'], 'unknown')

    async def test_replaced_file_invalidates_saved_inspection(self):
        inspection = (await self.inspect())['resultInspection']
        Image.new('RGB', (24, 24), 'red').save(self.root / 'result.png')
        with self.assertRaises(HTTPException) as caught:
            await self.review(inspection)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn('未保存旧评价', caught.exception.detail)

    async def test_canvas_changed_during_io_is_rejected(self):
        from backend.canvas_assistant_quality import inspect_images

        def changed(*args, **kwargs):
            result = inspect_images(*args, **kwargs)
            self.canvas['nodes'][0]['title'] = '检查中发生变化'
            return result

        with patch('backend.canvas_assistant_quality.inspect_images', changed):
            with self.assertRaises(HTTPException) as caught:
                await self.inspect()
        self.assertIn('检查期间画布已变化', caught.exception.detail)
        self.assertNotIn(('providers',), self.calls)

    async def test_arbitrary_asset_url_is_rejected_before_file_access(self):
        with self.assertRaises(HTTPException) as caught:
            await self.inspect(assetIds=['/output/result.png'])
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(self.calls, [('canvas', 'canvas')])

    async def test_image_task_reads_current_owned_proposal_before_query(self):
        await self.inspect(assetIds=[], proposalId='owned')
        self.assertEqual(self.calls[:3], [('canvas', 'canvas'), ('proposal', 'owned'), ('image', 'task')])

    async def test_foreign_proposal_preserves_ownership_error(self):
        with self.assertRaises(HTTPException) as caught:
            await self.inspect(assetIds=[], proposalId='foreign')
        self.assertEqual(caught.exception.status_code, 404)
        self.assertFalse(any(c[0] == 'image' for c in self.calls))

    async def test_pending_video_rejected_before_query(self):
        self.saved['nativeActions'] = [{'id': 'video', 'action': 'run', 'nodeType': 'video',
                                        'state': 'pending', 'receipt': {'taskIds': ['original']}}]
        with self.assertRaises(HTTPException) as caught:
            await self.inspect(assetIds=[], proposalId='video')
        self.assertEqual(caught.exception.status_code, 409)
        self.assertFalse(any(c[0] == 'native' for c in self.calls))

    async def test_more_than_two_videos_rejected_before_file_access(self):
        self.canvas['nodes'] = [{'id': 'v', 'type': 'output', 'videos': [
            '/output/a.mp4', '/output/b.mp4', '/output/c.mp4']}]
        assets = node_reference_assets(self.canvas)
        with self.assertRaises(HTTPException) as caught:
            await self.inspect(assetIds=[a['id'] for a in assets])
        self.assertEqual(caught.exception.status_code, 422)
        self.assertIn('最多核验2段', caught.exception.detail)
        self.assertEqual(self.calls, [('canvas', 'canvas')])

    async def test_missing_file_service_fails_before_canvas_access(self):
        self.service.resolve_result_file = None
        with self.assertRaises(HTTPException) as caught:
            await self.inspect()
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.calls, [])
