import tempfile,unittest
from unittest.mock import patch
from pathlib import Path
try:
 from backend.canvas_video_speech import VideoSpeech, transcribe_chunks, normalize_segments
except ImportError:
 VideoSpeech=transcribe_chunks=normalize_segments=None

class SpeechTests(unittest.TestCase):
 def test_chunks_cross_sentence_and_silent_tail(self):
  self.assertIsNotNone(transcribe_chunks,'缺少分段转写')
  calls=[]
  def transcribe(start,duration):
   calls.append((start,duration))
   return [{'start':290,'end':310,'text':'跨段完整句'}] if start==0 else []
  r=transcribe_chunks(660,transcribe)
  self.assertEqual(calls,[(0,330),(310,330),(610,50)])
  self.assertEqual(r,[{'start':290,'end':310,'text':'跨段完整句'}])
 def test_segment_retry_once_and_cancel(self):
  self.assertIsNotNone(transcribe_chunks);calls=[]
  def fail(a,b):calls.append(a);raise ValueError('失败')
  with self.assertRaisesRegex(ValueError,'第 1 段'):transcribe_chunks(660,fail)
  self.assertEqual(len(calls),2);self.assertEqual(transcribe_chunks(660,fail,cancelled=lambda:True),[])
 def test_no_download_until_explicit_install_and_validate_cloud(self):
  self.assertIsNotNone(VideoSpeech)
  with tempfile.TemporaryDirectory() as tmp:
   s=VideoSpeech(Path(tmp),lambda:[],lambda p:'',None)
   self.assertFalse(s.installation_status()['installed']);self.assertEqual(list(Path(tmp).rglob('*.bin')),[])
   with self.assertRaisesRegex(ValueError,'安装'):s.transcribe({'path':'none','durationSeconds':1},{'mode':'local'})
   with self.assertRaisesRegex(ValueError,'时间戳'):s.transcribe({'path':'none','durationSeconds':1},{'mode':'cloud','providerId':'unknown','model':'x'})
 def test_segments_require_real_timestamps(self):
  self.assertIsNotNone(normalize_segments)
  self.assertEqual(normalize_segments([{'start':1,'end':2,'text':' hello '}]),[{'start':1.,'end':2.,'text':'hello'}])
  for value in [None,[{'text':'无时间'}],[{'start':3,'end':2,'text':'错'}]]:
   with self.assertRaises(ValueError):normalize_segments(value)
 def test_configured_cloud_uses_verbose_json_and_requires_segments(self):
  calls=[];data={'segments':[{'start':.2,'end':1.2,'text':'测试对白'}],'language':'zh'}
  class Response:
   def raise_for_status(self):pass
   def json(self):return data
  class Client:
   def __init__(self,**kw):pass
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def post(self,url,**kw):calls.append((url,kw));return Response()
  with tempfile.TemporaryDirectory() as tmp:
   audio=Path(tmp)/'audio.mp3';audio.write_bytes(b'test-audio')
   providers=lambda:[{'id':'test','enabled':True,'base_url':'https://example.invalid/v1','audio_models':['speech'],'audio_timestamp_models':['speech']}]
   engine=VideoSpeech(Path(tmp)/'speech',providers,lambda p:'test-only',None)
   with patch('backend.canvas_video_speech.httpx.Client',Client):
    result=engine.transcribe({'path':str(audio),'durationSeconds':2},{'mode':'cloud','providerId':'test','model':'speech'})
    self.assertEqual(result['segments'][0]['text'],'测试对白');self.assertEqual(calls[0][0],'https://example.invalid/v1/audio/transcriptions');self.assertEqual(calls[0][1]['data']['response_format'],'verbose_json')
    data.pop('segments')
    with self.assertRaisesRegex(ValueError,'时间戳'):engine.transcribe({'path':str(audio),'durationSeconds':2},{'mode':'cloud','providerId':'test','model':'speech'})
