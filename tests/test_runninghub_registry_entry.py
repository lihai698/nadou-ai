"""RunningHub registry/field entry contracts with synthetic HTTP and config."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch
import httpx
import main


class RunningHubRegistryEntryTests(unittest.IsolatedAsyncioTestCase):
    def test_field_types_keep_media_boolean_number_and_text_order(self):
        for name,value,expected in [('image','1','IMAGE'),('video','a.mp4','VIDEO'),('audio','x.wav','AUDIO'),
                                    ('enabled','false','BOOLEAN'),('seed','123','NUMBER'),('prompt','demo','TEXT')]:
            with self.subTest(name=name): self.assertEqual(main.runninghub_infer_workflow_field_type(name,value),expected)

    def test_workflow_fields_skip_links_and_preserve_structured_values(self):
        fields=main.runninghub_workflow_node_info_list({'1':{'inputs':{'image':['7',0],'seed':42,'settings':{'x':1},'empty':None}},'2':None})
        self.assertEqual([row['fieldName'] for row in fields],['seed','settings','empty'])
        self.assertEqual(fields[0]['fieldType'],'NUMBER');self.assertEqual(fields[1]['fieldValue'],'{"x": 1}')
        self.assertEqual(fields[2]['fieldValue'],'');self.assertTrue(all(row['nodeId']=='1' for row in fields))

    def test_model_aliases_and_task_endpoints_keep_live_provider_callbacks(self):
        self.assertEqual(main.runninghub_endpoint_alias_for_model('gpt-image-2/text-to-image-custom'),'rhart-image-g-2/text-to-image')
        with patch.object(main,'runninghub_endpoint_url',return_value='synthetic-endpoint') as endpoint:
            self.assertEqual(main.runninghub_task_endpoint({},'/openapi/v2/demo'),'synthetic-endpoint')
        endpoint.assert_called_once_with({},'/openapi/v2/demo')

    def test_registry_payload_keeps_current_defaults_and_display_name_mapping(self):
        with patch.object(main,'RUNNINGHUB_DEFAULT_IMAGE_MODELS',['image-default']),patch.object(main,'RUNNINGHUB_DEFAULT_VIDEO_MODELS',['video-default']),patch.object(main,'RUNNINGHUB_FALLBACK_CHAT_MODELS',['chat-default']):
            value=main.runninghub_registry_payload([{'name_en':'image-a','output_type':'image','name_cn':'测试 图片'},
                                                  {'name_en':'video-a','output_type':'video'},{'name_en':'chat-a','output_type':'chat'}])
        self.assertEqual(value['image_models'],['image-a','image-default']);self.assertEqual(value['video_models'],['video-a','video-default'])
        self.assertEqual(value['chat_models'],['chat-default']);self.assertEqual(value['total'],5)
        self.assertEqual(value['model_names']['image-a'],'测试 图片')

    async def run_registry(self,respond,**kwargs):
        client_type=httpx.AsyncClient
        with tempfile.TemporaryDirectory(prefix='nadou-rh-registry-') as directory:
            with patch.object(main,'STATIC_RUNNINGHUB_MODEL_REGISTRY_FILE',str(Path(directory)/'absent.json')), \
                 patch.object(main,'RUNNINGHUB_MODEL_REGISTRY_URL','https://rh.test/registry'), \
                 patch.object(main,'RUNNINGHUB_LLM_MODELS_URLS',['https://rh.test/llm']), \
                 patch.object(main,'runninghub_openapi_url',return_value='https://rh.test/models'), \
                 patch.object(main,'runninghub_api_headers',return_value={}), \
                 patch.object(main.httpx,'AsyncClient',side_effect=lambda **_options:client_type(transport=httpx.MockTransport(respond),trust_env=False)):
                return await main.fetch_runninghub_model_registry({},**kwargs)

    async def test_registry_merges_llm_once_and_preserves_metadata(self):
        requests=[]
        def respond(request):
            requests.append(request.url.path)
            if request.url.path=='/models':return httpx.Response(200,json={'data':{'models':[{'name_en':'image-a','output_type':'image'},{'name_en':'chat-a','output_type':'chat'}]}})
            return httpx.Response(200,json={'data':[{'id':'chat-a'},{'id':'chat-b'}]})
        items,meta=await self.run_registry(respond,include_meta=True)
        self.assertEqual([main.runninghub_model_id(item) for item in items],['image-a','chat-a','chat-b'])
        self.assertEqual(requests,['/models','/llm']);self.assertEqual(meta['source'],'openapi')
        self.assertEqual((meta['openapi_count'],meta['llm_count']),(2,2))

    async def test_registry_failure_keeps_fallback_or_raises_when_disabled(self):
        respond=lambda request:httpx.Response(503,json={'error':{'message':'synthetic unavailable'}})
        items,meta=await self.run_registry(respond,include_meta=True)
        self.assertEqual(items,main.runninghub_registry_fallback());self.assertEqual(meta['source'],'fallback')
        with self.assertRaises(main.HTTPException) as caught:await self.run_registry(respond,include_fallback=False)
        self.assertEqual(caught.exception.status_code,502)

    async def test_model_definition_reuses_registry_entry_and_alias_fallback(self):
        item={'name_en':'image-a','endpoint':'native/a','output_type':'image'}
        with patch.object(main,'fetch_runninghub_model_registry',new=AsyncMock(return_value=[item])):
            self.assertIs(await main.runninghub_model_definition({},'native/a'),item)
            result=await main.runninghub_model_definition({},'gpt-image-2/edit-custom')
        self.assertEqual(result['endpoint'],'rhart-image-g-2/image-to-image');self.assertEqual(result['params'],[])

    def test_workflow_entry_uses_the_existing_lock_and_selection_boundary(self):
        fields=[{'nodeId':'1','fieldName':'prompt','fieldValue':'self-made'}]
        with patch.object(main,'runninghub_workflow_store_key',return_value='flow-a'), \
             patch.object(main,'load_runninghub_workflow_store',return_value={}), \
             patch.object(main,'runninghub_provider_workflow_config',return_value=None), \
             patch.object(main,'runninghub_select_workflow_config',return_value={'fields':fields,'workflowJson':{'1':{}}}):
            result=main.runninghub_entry_config_from_model({},'workflow:flow-a')
        self.assertEqual(result['kind'],'workflow');self.assertEqual(result['id'],'flow-a');self.assertEqual(result['fields'],fields)
        self.assertEqual(result['optionalImageMode'],'prune-workflow')


if __name__=='__main__':unittest.main()
