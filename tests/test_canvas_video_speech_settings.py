import asyncio,unittest
from unittest.mock import patch

class VideoSettingsTests(unittest.TestCase):
 def test_multi_output_identity_matches_frontend_id_priority(self):
  import main
  doc={'nodes':[{'id':'out','type':'output','images':[{'id':'native-id','resultId':'provider-id','url':'/assets/v.mp4'}]}]}
  with patch.object(main,'load_canvas',return_value=doc):
   ctx={'canvas_id':'test','node_id':'out','source_url':'/assets/v.mp4','result_id':'native-id'}
   self.assertEqual(main.validate_video_deconstruction_source(ctx,'owner')['result_id'],'native-id')
 def test_smart_canvas_shot_table_source_is_accepted(self):
  import main
  doc={'nodes':[
   {'id':'video','type':'smart-image','images':[{'id':'smart-video','url':'/assets/v.mp4','kind':'video'}]},
   {'id':'table','type':'smart-shot-table','shotTableData':{'revision':4,'rows':[]}},
  ]}
  with patch.object(main,'load_canvas',return_value=doc):
   ctx={'canvas_id':'test','node_id':'video','source_url':'/assets/v.mp4','result_id':'smart-video','table_id':'table','table_revision':4}
   self.assertEqual(main.validate_video_deconstruction_source(ctx,'owner')['table_id'],'table')
 def test_provider_audio_fields_preserve_old_configuration(self):
  import main
  old={'id':'test','name':'旧配置','base_url':'https://example.com/v1','chat_models':['chat'],'image_models':['image'],'video_models':['video'],'model_names':{'chat':'对话'}}
  value=main.normalize_provider(old)
  self.assertEqual(value.get('audio_models'),[]);self.assertEqual(value.get('audio_timestamp_models'),[])
  for key in ['chat_models','image_models','video_models','model_names']:self.assertEqual(value[key],old[key])
  new=main.normalize_provider({**old,'audio_models':['speech'],'audio_timestamp_models':['speech','unconfigured']})
  self.assertEqual(new['audio_timestamp_models'],['speech'])
  parsed=main.ApiProviderPayload(**new);self.assertEqual(parsed.audio_models,['speech'])
 def test_llm_optional_parameters_reach_actual_upstream(self):
  import main
  bodies=[]
  class Response:
   content=b'yes'
   def raise_for_status(self):pass
   def json(self):return {'choices':[{'message':{'content':'ok'}}]}
  class Client:
   def __init__(self,**kw):pass
   async def __aenter__(self):return self
   async def __aexit__(self,*a):pass
   async def post(self,url,**kw):bodies.append(kw['json']);return Response()
  with patch.object(main,'get_api_provider',return_value={'id':'test','protocol':'openai'}),patch.object(main,'resolve_chat_provider',return_value=('https://example.com',{},'model')),patch.object(main.httpx,'AsyncClient',Client):
   asyncio.run(main.canvas_llm(main.CanvasLLMRequest(message='test',provider='test')))
   asyncio.run(main.canvas_llm(main.CanvasLLMRequest(message='test',provider='test',temperature=.2,max_tokens=4000)))
  self.assertNotIn('temperature',bodies[0]);self.assertNotIn('max_tokens',bodies[0]);self.assertEqual(bodies[1]['temperature'],.2);self.assertEqual(bodies[1]['max_tokens'],4000)
