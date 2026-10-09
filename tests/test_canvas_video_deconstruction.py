import unittest,tempfile,time,threading
from pathlib import Path
try:
 from backend.canvas_video_deconstruction import VideoDeconstructionManager
except ImportError:VideoDeconstructionManager=None

class Media:
 def fingerprint(self,c):return 'fp'
 def detect(self,c,**kw):return {'durationSeconds':3,'hasAudio':False,'cuts':[{'seconds':1,'score':.4,'index':0},{'seconds':2,'score':.5,'index':1}],'coverage':{'detectedCuts':2,'keptCuts':2,'capped':False}}
 def extract_frames(self,c,seconds,**kw):return {'frames':[{'index':i,'seconds':s,'url':f'/output/frame-{s}.jpg'} for i,s in enumerate(seconds)],'failures':[]}
 def extract_audio(self,c,**kw):return {'hasAudio':False}

class DeconstructionTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.calls=[];self.providers=[{'id':'user','enabled':True,'chat_models':['vision-user'],'_configuration_revision':'one'}]
  self.context={'canvas_id':'A','node_id':'v','result_id':'primary','source_url':'/assets/v.mp4','operation_id':'request-1','table_revision':0}
 def tearDown(self):
  if hasattr(self,'manager'):self.manager.close()
  self.tmp.cleanup()
 def create(self):
  self.assertIsNotNone(VideoDeconstructionManager,'缺少拆解任务管理器')
  async def vision(fields):
   self.calls.append(fields);return {'text':'```json\n{"shotSize":"特写","visual":"真实画面分析","mood":"温暖","onScreenText":"字幕","imagePrompt":"生成提示","motionPrompt":"推进"}\n```'}
  self.manager=VideoDeconstructionManager(Path(self.tmp.name),lambda c,u:dict(c),lambda c:Media(),lambda:self.providers,vision,None)
  return self.manager
 def wait(self,t,status):
  end=time.monotonic()+5
  while time.monotonic()<end:
   v=self.manager.get(t['id'],'owner')
   if v['status'] in status:return v
   time.sleep(.01)
  self.fail(v)
 def test_confirmation_blocks_all_model_calls(self):
  m=self.create();t=self.wait(m.prepare(self.context,'owner','table',{}),{'awaiting-confirmation'})
  self.assertEqual(self.calls,[]);self.assertEqual(t['quote']['visionCalls'],3)
  m.confirm(t['id'],'owner',{'providerId':'user','model':'vision-user','speech':{'mode':'local'}},t['quote']['id'])
  r=self.wait(t,{'ready','failed'});self.assertEqual(r['status'],'ready',r);self.assertEqual(len(r['rows']),3)
  self.assertEqual(r['rows'][0]['cells']['visual'],'真实画面分析');self.assertEqual(len(self.calls[0]['images']),3);self.assertEqual(self.calls[0]['temperature'],.2)
 def test_replay_foreign_user_and_changed_config_rejected(self):
  m=self.create();t=self.wait(m.prepare(self.context,'owner','table',{}),{'awaiting-confirmation'})
  with self.assertRaises(ValueError):m.get(t['id'],'other')
  self.providers[0]['_configuration_revision']='changed'
  with self.assertRaises(ValueError):m.confirm(t['id'],'owner',{'providerId':'user','model':'vision-user'},t['quote']['id'])
  self.assertEqual(self.calls,[])
 def test_cancel_before_confirmation_is_terminal(self):
  m=self.create();t=self.wait(m.prepare(self.context,'owner','table',{}),{'awaiting-confirmation'});m.cancel(t['id'],'owner')
  with self.assertRaises(ValueError):m.confirm(t['id'],'owner',{'providerId':'user','model':'vision-user'},t['quote']['id'])
  self.assertEqual(m.get(t['id'],'owner')['status'],'cancelled');self.assertEqual(self.calls,[])
 def test_same_operation_payload_conflict(self):
  m=self.create();m.prepare(self.context,'owner','detect',{})
  with self.assertRaises(ValueError):m.prepare(self.context,'owner','table',{})
 def test_confirmation_replay_and_expired_quote(self):
  m=self.create();t=self.wait(m.prepare(self.context,'owner','table',{}),{'awaiting-confirmation'})
  with self.assertRaises(ValueError):m.confirm(t['id'],'owner',{'providerId':'user','model':'vision-user'},'old')
  m.confirm(t['id'],'owner',{'providerId':'user','model':'vision-user'},t['quote']['id'])
  with self.assertRaises(ValueError):m.confirm(t['id'],'owner',{'providerId':'user','model':'vision-user'},t['quote']['id'])
  self.wait(t,{'ready'});self.assertEqual(len(self.calls),3)
 def test_partial_failure_and_target_only_retry(self):
  m=self.create();calls=0
  async def vision(fields):
   nonlocal calls
   calls+=1
   if calls==2:return {'text':'[]'}
   return {'text':'{"shotSize":"特写","visual":"有效画面","mood":"温暖","onScreenText":"","imagePrompt":"图","motionPrompt":"动"}'}
  m.call_vision=vision;t=self.wait(m.prepare(self.context,'owner','table',{}),{'awaiting-confirmation'})
  m.confirm(t['id'],'owner',{'providerId':'user','model':'vision-user'},t['quote']['id']);r=self.wait(t,{'ready'})
  self.assertEqual(sum(x['visionFailed'] for x in r['rows']),1)
  c={**self.context,'operation_id':'retry'};retry=self.wait(m.prepare(c,'owner','retry-shot',{'priorTaskId':t['id'],'rowIds':['shot-2']}),{'awaiting-confirmation'})
  self.assertEqual(retry['quote']['visionCalls'],1);m.confirm(retry['id'],'owner',{'providerId':'user','model':'vision-user'},retry['quote']['id'])
  rr=self.wait(retry,{'ready'});self.assertEqual(calls,4);self.assertFalse(rr['rows'][1]['visionFailed'])
 def test_restart_reconciles_pending_confirmation(self):
  m=self.create();t=self.wait(m.prepare(self.context,'owner','table',{}),{'awaiting-confirmation'});m.close()
  self.manager=VideoDeconstructionManager(Path(self.tmp.name),lambda c,u:c,lambda c:Media(),lambda:self.providers,None,None)
  self.assertEqual(self.manager.get(t['id'],'owner')['status'],'interrupted')
 def test_response_schema_and_text_only_model(self):
  from backend.canvas_video_deconstruction import parse_analysis,vision_supported
  valid='{"shotSize":"近景","visual":"画面","mood":"平静","onScreenText":"","imagePrompt":"图","motionPrompt":"动","custom-a":"服装"}'
  self.assertEqual(parse_analysis('说明'+valid+'结束',[{'id':'custom-a'}])['custom-a'],'服装')
  for v in ['[]','{}',valid.replace('"画面"','123')]:
   with self.assertRaises(ValueError):parse_analysis(v,[])
  self.assertFalse(vision_supported({'supports_vision':False},'text'))
 def test_cancel_prevents_unsent_calls_and_concurrency_at_most_four(self):
  import asyncio
  m=self.create();started=threading.Event();release=threading.Event();count=0;maximum=0;live=0
  class DenseMedia(Media):
   def detect(self,c,**kw):return {'durationSeconds':7,'hasAudio':False,'cuts':[{'seconds':i,'score':.4,'index':i-1} for i in range(1,7)]}
  m.media_factory=lambda c:DenseMedia()
  async def held(fields):
   nonlocal count,live,maximum
   count+=1;live+=1;maximum=max(maximum,live)
   if count==4:started.set()
   while not release.is_set():await asyncio.sleep(.01)
   live-=1;return {'text':'invalid'}
  m.call_vision=held;t=self.wait(m.prepare(self.context,'owner','table',{}),{'awaiting-confirmation'})
  m.confirm(t['id'],'owner',{'providerId':'user','model':'vision-user'},t['quote']['id']);self.assertTrue(started.wait(3))
  m.cancel(t['id'],'owner');release.set();m.close()
  self.assertEqual(count,4);self.assertEqual(maximum,4);self.assertEqual(m.get(t['id'],'owner')['status'],'cancelled')
 def test_changed_source_blocks_confirmation(self):
  m=self.create();t=self.wait(m.prepare(self.context,'owner','table',{}),{'awaiting-confirmation'})
  def changed(c,u):raise ValueError('原视频已改变')
  m.validate_source=changed
  with self.assertRaisesRegex(ValueError,'改变'):m.confirm(t['id'],'owner',{'providerId':'user','model':'vision-user'},t['quote']['id'])
  self.assertEqual(self.calls,[])
 def test_visual_retry_preserves_prior_speech_state(self):
  m=self.create();t=self.wait(m.prepare(self.context,'owner','table',{}),{'awaiting-confirmation'})
  m.confirm(t['id'],'owner',{'providerId':'user','model':'vision-user'},t['quote']['id']);self.wait(t,{'ready'})
  m.tasks[t['id']]['speech']={'status':'ready','segments':[{'start':0,'end':1,'text':'原对白'}]}
  retry=self.wait(m.prepare({**self.context,'operation_id':'retry-speech-state'},'owner','retry-shot',{'priorTaskId':t['id'],'rowIds':['shot-1']}),{'awaiting-confirmation'})
  self.assertEqual(retry['quote']['audioCalls'],0)
  m.confirm(retry['id'],'owner',{'providerId':'user','model':'vision-user'},retry['quote']['id']);r=self.wait(retry,{'ready'})
  self.assertEqual(r['speech']['status'],'ready');self.assertEqual(r['rows'][0]['cells']['dialogue'],'原对白')
