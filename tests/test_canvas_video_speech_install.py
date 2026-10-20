import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from backend.canvas_video_speech import VideoSpeech
from backend.canvas_video_media import VideoCancelled


class InstallFallbackTests(unittest.TestCase):
    def run_install(self, corrupt=False, cancelled=False):
        with tempfile.TemporaryDirectory() as folder:
            engine = VideoSpeech(folder, lambda:[], lambda p:'', None)
            engine.runtime.mkdir(parents=True)
            marker = engine.runtime/'old.bin'; marker.write_bytes(b'previous')
            payload = b'fixed model bytes'
            engine.manifest = {'version':'test','assets':[{
                'name':'model.bin','kind':'model','size':len(payload),
                'sha256':hashlib.sha256(payload).hexdigest(),
                'url':'https://primary.invalid/model','mirrors':['https://mirror.invalid/model']}]}
            calls = []
            class Response:
                def __enter__(self):return self
                def __exit__(self,*a):pass
                def raise_for_status(self):pass
                def iter_bytes(self,*a):yield b'bad' if corrupt else payload
            class Client:
                def __init__(self,**kw):pass
                def __enter__(self):return self
                def __exit__(self,*a):pass
                def stream(self,method,url):
                    calls.append(url)
                    if 'primary' in url:raise httpx.ConnectTimeout('unreachable')
                    return Response()
            with patch('backend.canvas_video_speech.httpx.Client',Client), patch.object(engine,'_health'):
                if corrupt or cancelled:
                    with self.assertRaises(VideoCancelled if cancelled else ValueError):
                        engine.install(cancelled=lambda:cancelled)
                    self.assertEqual(marker.read_bytes(), b'previous')
                else:
                    engine.install()
                    self.assertEqual((engine.runtime/'model.bin').read_bytes(),payload)
                self.assertEqual(len(calls),2)

    def test_fallback_keeps_checksum_verification(self):self.run_install()
    def test_bad_mirror_preserves_previous_install(self):self.run_install(corrupt=True)
    def test_cancellation_preserves_previous_install(self):self.run_install(cancelled=True)
