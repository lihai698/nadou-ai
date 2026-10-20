import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
from backend.canvas_local_vision import LocalVideoVision
from backend.canvas_video_deconstruction import create_video_deconstruction_router
from tests import test_canvas_video_deconstruction as base_tests


class LocalLifecycleTests(unittest.TestCase):
    def test_capability_reports_loaded_backend_support(self):
        from types import SimpleNamespace
        manager = SimpleNamespace(local_vision=object(),providers=lambda:[])
        speech = SimpleNamespace(installation_status=lambda:{'installed':True})
        router = create_video_deconstruction_router(manager=lambda:manager,user_id=lambda *a:'test',speech_engine=lambda:speech)
        endpoint = next(r.endpoint for r in router.routes if r.path.endswith('/models'))
        self.assertTrue(endpoint()['localAnalysis'])
        manager.local_vision = None
        self.assertFalse(endpoint()['localAnalysis'])

    def test_reused_service_is_never_stopped(self):
        engine = LocalVideoVision('.', lambda u:u)
        with patch.object(engine, '_model', return_value='local'):
            self.assertEqual(engine.acquire(), 'local')
            engine.release()
        self.assertIsNone(engine.process)
        self.assertEqual(engine.users, 0)

    def test_owned_service_stops_only_after_last_task(self):
        engine = LocalVideoVision('.', lambda u:u)
        process = engine.process = Mock()
        with patch.object(engine, '_model', return_value='local'):
            engine.acquire(); engine.acquire(); engine.release()
            process.terminate.assert_not_called()
            engine.release()
        process.terminate.assert_called_once()

    def test_unconfigured_model_fails_without_cloud_fallback(self):
        with tempfile.TemporaryDirectory() as folder:
            engine = LocalVideoVision(folder, lambda u:u)
            with patch.object(engine, '_model', side_effect=httpx.ConnectError('offline')):
                with self.assertRaises(ValueError):engine.acquire()
            self.assertEqual(engine.users, 0)


class AutomaticLocalTests(unittest.TestCase):
    setUp = base_tests.DeconstructionTests.setUp
    tearDown = base_tests.DeconstructionTests.tearDown
    create = base_tests.DeconstructionTests.create
    wait = base_tests.DeconstructionTests.wait
    def test_local_runs_without_provider_or_manual_confirmation_and_releases(self):
        manager = self.create()
        self.providers.clear()
        local = Mock()
        local.acquire.return_value = 'local'
        local.analyze = manager.call_vision
        manager.local_vision = local
        result = self.wait(manager.prepare(self.context,'owner','table',{'localAnalysis':True}), {'ready','failed'})
        manager.close()
        self.assertEqual(result['status'], 'ready', result)
        self.assertEqual(len(self.calls), 3)
        self.assertTrue(all(c['provider']=='__local_video__' for c in self.calls))
        local.release.assert_called_once()

    def test_local_preparation_failure_releases_model(self):
        manager = self.create()
        local = manager.local_vision = Mock()
        local.acquire.return_value = 'local'
        manager.media_factory = lambda c:Mock(fingerprint=lambda c:'fp',detect=Mock(side_effect=ValueError('bad video')))
        result = self.wait(manager.prepare(self.context,'owner','table',{'localAnalysis':True}), {'failed'})
        self.assertEqual(result['status'], 'failed')
        local.release.assert_called_once()
