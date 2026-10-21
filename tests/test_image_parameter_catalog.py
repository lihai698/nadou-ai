"""图片参数目录的独立行为测试；不读取应用配置或调用生成服务。"""
import unittest
from unittest.mock import Mock

from backend import image_provider_service as service


def fields(engine='api', model='plain', provider=None, predicate=None):
    return service.build_image_param_fields(engine, provider or {}, model,
        is_gpt_image_2_model=predicate or (lambda value: value == 'gpt-image-2'),
        IMAGE_PARAM_RESOLUTIONS=[{'value':'1k','label':'1K'},{'value':'2k','label':'2K'}],
        IMAGE_PARAM_RATIOS=[{'value':'1:1','label':'1:1'}], ONLINE_IMAGE_REFERENCE_MAX=7)


class ImageParameterCatalogTests(unittest.IsolatedAsyncioTestCase):
    def test_default_fields_match_request_keys_and_controls(self):
        result=fields()
        self.assertEqual([field['key'] for field in result],['size','quality','n','reference_images'])
        self.assertEqual(result[0]['default'],{'ratio':'1:1','resolution':'1k'})
        self.assertEqual(result[2],{'key':'n','type':'int','label':'数量','control':'chips','options':[1,2,3,4],'default':1})
        self.assertEqual(result[3],{'key':'reference_images','type':'refs','label':'参考图','max':7})

    def test_gpt_auto_resolution_is_only_added_for_api_engine(self):
        result=fields(model='gpt-image-2')
        self.assertEqual(result[0]['default']['resolution'],'auto')
        self.assertEqual(result[0]['resolutions'][0],{'value':'auto','label':'自动'})
        self.assertEqual(fields('volcengine','gpt-image-2')[0]['default']['resolution'],'1k')

    def test_quality_options_keep_order_and_default(self):
        for engine in ('api','volcengine'):
            quality=fields(engine)[1]
            self.assertEqual([item['value'] for item in quality['options']],['auto','low','medium','high'])
            self.assertEqual((quality['default'],quality['type'],quality['control']),('auto','select','chips'))

    def test_modelscope_and_other_engines_have_no_quality_field(self):
        for engine in ('modelscope','other','',None):
            self.assertEqual([field['key'] for field in fields(engine)],['size','n','reference_images'])

    def test_runninghub_returns_only_existing_dynamic_notice(self):
        result=fields('runninghub')
        self.assertEqual(len(result),1)
        self.assertEqual((result[0]['key'],result[0]['type']),('_rh_notice','notice'))
        self.assertIn('工作流',result[0]['label'])

    def test_non_api_does_not_call_gpt_model_predicate(self):
        predicate=Mock(side_effect=AssertionError('unexpected model inspection'))
        fields('runninghub',predicate=predicate)
        fields('modelscope',predicate=predicate)
        predicate.assert_not_called()

    def test_returned_mutable_controls_do_not_leak_between_calls(self):
        first=fields();first[1]['options'][0]['label']='changed';first[2]['options'].append(9)
        second=fields()
        self.assertEqual(second[1]['options'][0]['label'],'自动')
        self.assertEqual(second[2]['options'],[1,2,3,4])

    async def test_engine_selection_retains_runninghub_precedence(self):
        provider={'id':'modelscope','protocol':'fixture'};events=[]
        result=await service.image_params(' ModelScope ','chosen',load_api_providers=lambda:[provider],
            is_runninghub_provider=lambda value:events.append(('runninghub',value)) or True,
            is_volcengine_provider=lambda value:events.append(('volcengine',value)) or True,
            build_image_param_fields=lambda *args:events.append(('fields',args)) or [{'fixture':True}])
        self.assertEqual(result,{'engine':'runninghub','submit':'/api/canvas-image-tasks','fields':[{'fixture':True}]})
        self.assertEqual(events,[('runninghub',provider),('fields',('runninghub',provider,'chosen'))])

    async def test_modelscope_id_precedes_volcengine_check(self):
        volc=Mock(side_effect=AssertionError('unexpected protocol inspection'))
        result=await service.image_params(' ModelScope ','model',load_api_providers=lambda:[],
            is_runninghub_provider=lambda value:False,is_volcengine_provider=volc,build_image_param_fields=lambda *args:[])
        self.assertEqual(result['engine'],'modelscope');volc.assert_not_called()

    async def test_provider_loading_and_fields_callbacks_are_live(self):
        for provider_id,providers,expected in [('v',[{'id':'v','protocol':'volcengine'}],'volcengine'),('missing',[], 'api'),('',[], 'api')]:
            with self.subTest(provider_id=provider_id):
                load=Mock(return_value=providers);build=Mock(return_value=['fields'])
                result=await service.image_params(provider_id,'selected',load_api_providers=load,
                    is_runninghub_provider=lambda value:False,is_volcengine_provider=lambda value:value.get('protocol')=='volcengine',build_image_param_fields=build)
                self.assertEqual(result,{'engine':expected,'submit':'/api/canvas-image-tasks','fields':['fields']})
                load.assert_called_once_with();build.assert_called_once_with(expected,providers[0] if providers else {},'selected')


if __name__=='__main__':unittest.main()
