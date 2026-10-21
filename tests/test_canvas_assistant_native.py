import copy
import unittest

from fastapi import HTTPException

from backend.canvas_assistant_native import native_catalog, prepare_native_action, validate_native_snapshot, native_effect, public_workflow_fields


class NativeActionTests(unittest.TestCase):
    def test_catalog_describes_actual_authorization_and_type_specific_run_limits(self):
        for kind in ('classic','smart'):
            for row in native_catalog(kind):
                if row['type']=='audio':continue
                self.assertIn('安全编辑',row['confirmation'])
                self.assertIn('本轮授权',row['confirmation'])
                self.assertNotIn('原生动作须用户确认',row['confirmation'])
                self.assertNotIn('服务执行仍待逐类接入',row['limits'])
                self.assertIn('真实回执',row['limits'])
                if 'run' not in row['availableActions']:self.assertIn('不开放独立 run',row['limits'])
        classic={r['type']:r for r in native_catalog('classic')}
        smart={r['type']:r for r in native_catalog('smart')}
        self.assertIn('无远端取消',classic['comfy']['limits'])
        self.assertIn('有限关键帧',classic['video']['limits'])
        self.assertIn('空智能节点',smart['smart-image']['limits'])
        self.assertIn('API 图片',smart['smart-image']['limits'])
        self.assertIn('视频和其他引擎沿用原入口',smart['smart-image']['limits'])

    def test_paused_audio_blocks_writes_until_original_task_has_ended(self):
        from backend.canvas_assistant_node_rules import is_busy
        for node_type, kind in [('generator','classic'),('smart-image','smart')]:
            c=self.canvas(node_type);c['kind']=kind;n=c['nodes'][0]
            for status in ('queued','running','query-paused','unknown'):
                n.update(audioTaskId='original-audio',audioStatus=status,running=False)
                with self.subTest(kind=kind,status=status):
                    self.assertTrue(is_busy(n))
                    with self.assertRaises(HTTPException) as caught:
                        prepare_native_action(c,{'action':'update','nodeId':'n','patch':{'title':'changed'}},'audio-write')
                    self.assertEqual(caught.exception.status_code,409)
            n['audioStatus']='done';self.assertFalse(is_busy(n))
            prepare_native_action(c,{'action':'update','nodeId':'n','patch':{'title':'changed'}},'audio-write')

    def test_audio_catalog_is_read_only(self):
        c=self.canvas('audio')
        row=next(row for row in native_catalog('classic') if row['type']=='audio')
        self.assertEqual(set(row['availableActions']),{'preview','query'})
        for action in ('create','update','run'):
            with self.subTest(action=action),self.assertRaises(HTTPException):
                prepare_native_action(c,{'action':action,'type':'audio','nodeId':'n','patch':{'title':'x'}},'audio-action')

    def test_lora_confirm_config_drift_and_saved_coupled_fields(self):
        c=self.canvas('msgen');n=c['nodes'][0]
        n.update(msgenModel='custom',msCustomModel='manual',msLoraEnabled=False,msLoraId='old',msLoraStrength=0.4)
        providers=[{'id':'modelscope','ms_loras':[{'id':'selected','target_model':'manual','strength':0.8}]}]
        p=prepare_native_action(c,{'action':'lora_parameters','nodeId':'n','patch':{'msLoraEnabled':True,'msLoraId':'selected'}},'lora',providers=providers)
        self.assertFalse(p['chargeable']);validate_native_snapshot(c,p,providers=providers)
        changed=copy.deepcopy(providers);changed[0]['ms_loras'][0]['strength']=0.7
        with self.assertRaises(HTTPException):validate_native_snapshot(c,p,providers=changed)
        with self.assertRaises(HTTPException):native_effect(c,p)
        n.update(p['arguments']['patch'])
        with self.assertRaises(HTTPException):native_effect(c,p)
        n.update(p['effectFields']);self.assertEqual(native_effect(c,p)['state'],'completed')
        n['msCustomModel']='foreign'
        with self.assertRaises(HTTPException):native_effect(c,p)


    def test_smart_group_run_binds_new_branch_inputs_and_original_tasks(self):
        from backend.canvas_assistant_native import native_run_result, native_run_input_hash, native_smart_group_output
        c=self.canvas('smart-group');c['kind']='smart';n=c['nodes'][0]
        n.update(items=['prompt'],images=[{'url':'/assets/ref.png'}],runSettings={'engine':'api','apiKind':'image','provider_id':'manual','model':'selected','count':2})
        c['nodes'].append({'id':'prompt','type':'smart-prompt','text':'分组正文'})
        p=prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':2},'group-action')
        self.assertIn('run',next(r for r in native_catalog('smart') if r['type']=='smart-group')['availableActions'])
        self.assertNotIn(p['outputNodeId'],[v['id'] for v in c['nodes']])
        n['assistantNativeRun']={'actionId':p['id'],'taskKind':'image','taskIds':['one','two'],'outputNodeId':p['outputNodeId'],'inputHash':p['runInputHash']}
        out={'id':p['outputNodeId'],'type':'smart-image','images':[], 'assistantNativeOrigin':{'actionId':p['id'],'sourceNodeId':'n','inputHash':p['runInputHash']}}
        c['nodes'].append(out);c['connections'].append({'from':'n','to':out['id'],'kind':'flow'})
        self.assertEqual(native_run_input_hash(c,'n'),p['runInputHash'])
        self.assertEqual(native_smart_group_output(c,p)['id'],out['id'])
        tasks=[{'task_id':i,'status':'succeeded','canvas_id':'c','node_id':'n','assistant_action_id':p['id'],'input_hash':p['runInputHash'],'provider_id':'manual','model':'selected','result':{'images':['/output/'+i+'.png']}} for i in ['one','two']]
        n['images'] += [{'url':'/output/one.png'},{'url':'/output/two.png'}]
        self.assertEqual(native_run_result(c,p,tasks)['state'],'accepted')
        out['images']=[{'url':'/output/one.png'},{'url':'/output/two.png'}]
        self.assertEqual(native_run_result(c,p,tasks)['state'],'completed')
        for field in ['canvas_id','node_id','assistant_action_id','input_hash']:
            with self.subTest(field=field),self.assertRaises(HTTPException):native_run_result(c,p,[{**tasks[0],field:'foreign'},tasks[1]])
        out['assistantNativeOrigin']['sourceNodeId']='foreign'
        with self.assertRaises(HTTPException):native_run_result(c,p,tasks)

    def test_smart_group_rejects_unselected_models_loops_unknown_and_budget_changes(self):
        c=self.canvas('smart-group');c['kind']='smart';n=c['nodes'][0]
        n.update(items=['prompt'],runSettings={'engine':'api','apiKind':'image','provider_id':'manual','model':'selected','count':1})
        c['nodes'].append({'id':'prompt','type':'smart-prompt','text':'正文'})
        for patch in [{'runSettings':{}},{'runSettings':{**n['runSettings'],'engine':'comfy'}},{'submissionUnknown':True}]:
            changed=copy.deepcopy(c);changed['nodes'][0].update(patch)
            with self.subTest(patch=patch),self.assertRaises(HTTPException):prepare_native_action(changed,{'action':'run','nodeId':'n','maxCalls':1},'g')
        with self.assertRaises(HTTPException):prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':2},'g')
        c['nodes'][1]['type']='smart-loop'
        with self.assertRaises(HTTPException):prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':1},'g')

    def test_video_run_binds_strict_provider_output_and_original_task(self):
        from backend.canvas_assistant_native import native_run_result,native_run_input_hash,native_comfy_foreign_busy
        c=self.canvas('video');n=c['nodes'][0]
        n.update(apiProvider='video-p',model='video-m',duration=5,outputEnabled=True)
        c['nodes'].append({'id':'out','type':'output','images':[]});c['connections']=[{'from':'n','to':'out'}]
        providers=[{'id':'video-p','enabled':True,'video_models':['video-m']}]
        p=prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':1},'video-action',providers=providers)
        self.assertEqual(p['runSettings']['taskKind'],'video');self.assertEqual(p['outputNodeId'],'out')
        before=p['runInputHash'];n['assistantNativeRun']={'actionId':'video-action','taskKind':'video','taskIds':['canvas_video_original1'],'plannedTaskId':'canvas_video_original1','submissionStarted':True}
        c['nodes'][1]['_pending']=[{'canvasTaskId':'canvas_video_original1','canvasTaskType':'video','assistantNativeActionId':'video-action','run':{'node':{'id':'n'}}}]
        self.assertEqual(native_run_input_hash(c,'n'),before);self.assertFalse(native_comfy_foreign_busy(c,p))
        c['nodes'][1]['_pending'].append({'canvasTaskId':'foreign','canvasTaskType':'video','run':{'node':{'id':'n'}}})
        self.assertTrue(native_comfy_foreign_busy(c,p));c['nodes'][1]['_pending'].pop()
        c['nodes'][1]['_pending'].append({'canvasTaskType':'online-image','assistantNativeActionId':'video-action','run':{'node':{'id':'n'}}})
        self.assertTrue(native_comfy_foreign_busy(c,p));c['nodes'][1]['_pending'].pop()
        task={'task_id':'canvas_video_original1','status':'succeeded','canvas_id':'c','node_id':'n','assistant_action_id':'video-action','input_hash':before,'provider_id':'video-p','model':'video-m','result':{'videos':['/output/video.mp4']}}
        self.assertEqual(native_run_result(c,p,[task])['state'],'accepted')
        n['generatedOutputs']=['/output/video.mp4']
        self.assertEqual(native_run_result(c,p,[task])['state'],'accepted')
        projected=native_run_result(c,p,[task])['tasks'][0]
        for field in ['canvas_id','node_id','assistant_action_id','input_hash','provider_id','model']:
            self.assertEqual(projected[field],task[field])
        c['nodes'][1]['images']=[{'url':'/output/video.mp4','kind':'video'}]
        completed=native_run_result(c,p,[task])
        self.assertEqual(completed['state'],'completed')
        self.assertEqual(completed['result']['urls'],['/output/video.mp4'])
        for field in ['canvas_id','node_id','assistant_action_id','input_hash']:
            with self.subTest(field=field),self.assertRaises(HTTPException):native_run_result(c,p,[{**task,field:'foreign'}])
        c['connections']=[];self.assertNotEqual(native_run_input_hash(c,'n'),before)
        for invalid in [[],[{'id':'video-p','enabled':False,'video_models':['video-m']}],[{'id':'video-p','video_models':['other']}]]:
            with self.assertRaises(HTTPException):prepare_native_action(self.canvas('video'),{'action':'run','nodeId':'n','maxCalls':1},'invalid',providers=invalid)

    def test_video_planned_id_is_query_only_not_fake_acceptance(self):
        from backend.canvas_assistant_native import native_run_result
        c=self.canvas('video');n=c['nodes'][0];n.update(apiProvider='p',model='m',outputEnabled=True)
        c['nodes'].append({'id':'out','type':'output','images':[]});c['connections']=[{'from':'n','to':'out'}]
        p=prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':1},'v',providers=[{'id':'p','video_models':['m']}])
        n['assistantNativeRun']={'actionId':'v','taskKind':'video','taskIds':[],'plannedTaskId':'canvas_video_planned1','submissionStarted':True}
        r=native_effect(c,p);self.assertEqual(r['state'],'submission_unknown');self.assertTrue(r['queryPlannedTask'])
        t={'task_id':'canvas_video_planned1','status':'running','canvas_id':'c','node_id':'n','assistant_action_id':'v','input_hash':p['runInputHash'],'provider_id':'p','model':'m'}
        self.assertEqual(native_run_result(c,p,[t])['state'],'accepted')

    def test_rh_model_single_run_keeps_selected_model_and_task_ownership(self):
        from backend.canvas_assistant_native import native_run_result
        c=self.canvas('rh');n=c['nodes'][0]
        n.update(rhMode='model',rhConfigKey='model:user-model',rhModel='user-model',model='user-model',apiProvider='runninghub',count=1,outputEnabled=True)
        c['nodes'].append({'id':'out','type':'output','images':[]});c['connections']=[{'from':'n','to':'out'}]
        p=prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':1},'rh-run')
        self.assertEqual(p['runSettings'],{'provider':'runninghub','model':'user-model','maxCalls':1,'taskKind':'image'})
        self.assertIn('run',next(row for row in native_catalog('classic') if row['type']=='rh')['availableActions'])
        n['assistantNativeRun']={'actionId':'rh-run','taskKind':'image','taskIds':['rh-original']}
        c['nodes'][1]['images']=[{'url':'/output/rh.png'}]
        task={'task_id':'rh-original','status':'succeeded','canvas_id':'c','node_id':'n','provider_id':'runninghub','model':'user-model','result':{'images':['/output/rh.png']}}
        self.assertEqual(native_run_result(c,p,[task])['state'],'completed')
        for patch in [{'rhMode':'workflow'},{'rhConfigKey':'app:other'},{'rhModel':'other'},{'model':'other'},{'apiProvider':'other'},{'count':2},{'outputEnabled':False},{'submissionUnknown':True}]:
            broken=copy.deepcopy(c);broken['nodes'][0].pop('assistantNativeRun',None);broken['nodes'][0].update(patch)
            with self.subTest(patch=patch),self.assertRaises(HTTPException):prepare_native_action(broken,{'action':'run','nodeId':'n','maxCalls':1},'reject')
        n['rhModel']='changed'
        with self.assertRaises(HTTPException):native_effect(c,p)

    def test_rh_workflow_and_app_runs_bind_saved_selection_and_original_task(self):
        for mode, field, value in [('workflow', 'workflowId', 'wf-user'), ('app', 'webappId', 'app-user')]:
            with self.subTest(mode=mode):
                c=self.canvas('rh');n=c['nodes'][0]
                n.update(rhMode=mode,rhConfigKey=f'{mode}:{value}',apiProvider='runninghub',count=1,outputEnabled=True,rhParams={'12::steps':{'value':'20'}})
                n[field]=value
                n['rhWorkflowInfo' if mode=='workflow' else 'rhAppInfo']={'nodeInfoList':[{'nodeId':'12','fieldName':'steps','fieldType':'INT'}]}
                c['nodes'].append({'id':'out','type':'output','images':[]});c['connections']=[{'from':'n','to':'out'}]
                p=prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':1},f'rh-{mode}')
                self.assertEqual(p['runSettings'],{'provider':'runninghub','model':f'{mode}:{value}','maxCalls':1,'taskKind':'runninghub'})
                self.assertEqual(p['outputNodeId'],'out')
                self.assertEqual(len(p['runInputHash']),64)
                n['assistantNativeRun']={'actionId':p['id'],'taskKind':'runninghub','taskIds':['rh-original'],'inputHash':p['runInputHash'],'outputNodeId':'out'}
                receipt=native_effect(c,p)
                self.assertEqual(receipt['state'],'accepted')
                self.assertEqual(receipt['taskIds'],['rh-original'])
                n['assistantNativeRun']['status']='succeeded'
                c['nodes'][1]['images']=[{'url':'/output/rh.png'}]
                with self.assertRaises(HTTPException):native_effect(c,p)
                n['assistantNativeRun']['resultUrls']=['/output/current-rh.png']
                with self.assertRaises(HTTPException):native_effect(c,p)
                c['nodes'][1]['images'].append({'url':'/output/current-rh.png'})
                receipt=native_effect(c,p)
                self.assertEqual(receipt['state'],'completed')
                self.assertEqual(receipt['taskIds'],['rh-original'])
                for key,value in [('inputHash','foreign'),('outputNodeId','other')]:
                    saved=n['assistantNativeRun'][key];n['assistantNativeRun'][key]=value
                    with self.assertRaises(HTTPException):native_effect(c,p)
                    n['assistantNativeRun'][key]=saved
                n[field]='changed'
                with self.assertRaises(HTTPException):native_effect(c,p)

    def test_smart_image_api_run_binds_node_model_count_and_saved_original_tasks(self):
        from backend.canvas_assistant_native import native_run_result
        c=self.canvas('smart-image');c['kind']='smart'
        node=c['nodes'][0]
        node.update(images=[],runSettings={'engine':'api','apiKind':'image','provider_id':'manual','model':'selected','count':2})
        p=prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':2},'smart-run')
        self.assertEqual(p['runSettings'],{'provider':'manual','model':'selected','maxCalls':2,'taskKind':'image'})
        self.assertIn('run',next(r for r in native_catalog('smart') if r['type']=='smart-image')['availableActions'])
        node['assistantNativeRun']={'actionId':'smart-run','taskKind':'image','taskIds':['a','b']}
        node['images']=[{'url':'/output/a.png','kind':'image'},{'url':'/output/b.png','kind':'image'}]
        tasks=[{'task_id':i,'status':'succeeded','provider_id':'manual','model':'selected','result':{'images':['/output/'+i+'.png']}} for i in ['a','b']]
        self.assertEqual(native_run_result(c,p,tasks)['state'],'completed')
        node['runSettings']['model']='changed'
        with self.assertRaises(HTTPException):native_effect(c,p)

    def test_smart_image_run_rejects_unsupported_branches_and_unconfirmed_count(self):
        c=self.canvas('smart-image');c['kind']='smart';node=c['nodes'][0]
        node.update(images=[],runSettings={'engine':'api','apiKind':'image','provider_id':'manual','model':'selected','count':1})
        cases=[('images',[{'url':'/output/original.png'}]),('runSettings',{'engine':'comfy','model':'selected'}),('runSettings',{'engine':'api','apiKind':'video','provider_id':'manual','model':'selected'}),('runSettings',{'engine':'api','apiKind':'image','provider_id':'','model':'selected'})]
        for field,value in cases:
            changed=copy.deepcopy(c);changed['nodes'][0][field]=value
            with self.assertRaises(HTTPException):prepare_native_action(changed,{'action':'run','nodeId':'n','maxCalls':1},'reject')
        with self.assertRaises(HTTPException):prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':2},'reject')
        c['nodes'].append({'id':'loop','type':'smart-loop','variablePrompts':['a','b']});c['connections']=[{'from':'loop','to':'n','kind':'input'}]
        with self.assertRaises(HTTPException):prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':1},'reject')
        c['connections']=[];node['inputNodeIds']=['loop']
        with self.assertRaises(HTTPException):prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':1},'reject')

    def test_comfy_busy_allows_only_action_owned_unaccepted_placeholder(self):
        from backend.canvas_assistant_native import native_comfy_foreign_busy
        canvas={'nodes':[{'id':'c','type':'comfy','running':True,'assistantNativeRun':{'actionId':'a','taskKind':'comfy','taskIds':[]}}, {'id':'o','type':'output','_pending':[{'id':'p','assistantNativeActionId':'a','run':{'node':{'id':'c'}}}]}], 'connections':[{'from':'c','to':'o'}]}
        self.assertFalse(native_comfy_foreign_busy(canvas,{'id':'a','nodeId':'c'}))
        pending=canvas['nodes'][1]['_pending'][0]
        for field,value in [('assistantNativeActionId','foreign'),('taskId','unaccepted')]:
            changed=copy.deepcopy(canvas);changed['nodes'][1]['_pending'][0][field]=value
            self.assertTrue(native_comfy_foreign_busy(changed,{'id':'a','nodeId':'c'}))
        pending.pop('assistantNativeActionId')
        self.assertTrue(native_comfy_foreign_busy(canvas,{'id':'a','nodeId':'c'}))

    def test_run_result_rejects_malformed_or_foreign_task_bindings(self):
        from backend.canvas_assistant_native import native_run_result
        c=self.canvas('generator');c['nodes'][0]['count']=1
        p=prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':1},'run')
        c['nodes'][0].update(assistantNativeRun={'actionId':'run','taskKind':'image','taskIds':['original']},generatedOutputs=['/output/real.png'])
        task={'task_id':'original','canvas_id':'c','node_id':'n','provider_id':'user-provider','model':'user-model','status':'succeeded','result':{'images':['/output/real.png']}}
        self.assertEqual(native_run_result(c,p,[task])['state'],'completed')
        for field in ['canvas_id','node_id','provider_id','model']:
            with self.subTest(field=field),self.assertRaises(HTTPException):native_run_result(c,p,[{**task,field:'foreign'}])
        for malformed in [None,'invalid',[]]:
            with self.subTest(malformed=malformed),self.assertRaises(HTTPException):native_run_result(c,p,[malformed])

    def test_generator_run_requires_explicit_budget_and_preserves_original_model(self):
        c=self.canvas('generator');c['nodes'][0].update(apiProvider='p',model='user-image',count=2)
        for args in [{'action':'run','nodeId':'n'}, {'action':'run','nodeId':'n','maxCalls':1}]:
            with self.assertRaises(HTTPException):prepare_native_action(c,args,'run')
        p=prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':2},'run')
        self.assertTrue(p['chargeable']);self.assertEqual(p['runSettings'],{'provider':'p','model':'user-image','maxCalls':2,'taskKind':'image'})
        with self.assertRaises(HTTPException):native_effect(c,p)
        c['nodes'][0]['assistantNativeRun']={'actionId':'run','taskKind':'image','taskIds':['a','b']}
        self.assertEqual(native_effect(c,p)['state'],'accepted')
        c['nodes'][0]['model']='changed'
        with self.assertRaises(HTTPException):native_effect(c,p)

    def test_comfy_run_uses_comfy_task_kind_and_accounts_for_upscale_task(self):
        c=self.canvas('comfy');node=c['nodes'][0]
        node.update(count=1,mode='enhance',enhanceUpscale=True,comfyWorkflow='public.json')
        proposal=prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':2},'comfy-run')
        self.assertEqual(proposal['runSettings'],{'provider':'comfyui','model':'Z-Image-Enhance.json + upscale.json','maxCalls':2,'taskKind':'comfy'})
        node['assistantNativeRun']={'actionId':'comfy-run','taskKind':'comfy','taskIds':['first','second']}
        self.assertEqual(native_effect(c,proposal)['taskKind'],'comfy')
        node['mode']='text'
        with self.assertRaises(HTTPException):prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':2},'comfy-run-2')

    def test_comfy_run_result_accepts_local_task_record_without_api_model_binding(self):
        from backend.canvas_assistant_native import native_run_result
        c=self.canvas('comfy');node=c['nodes'][0]
        node.update(count=1,mode='text',comfyWorkflow='public.json',generatedOutputs=['/output/comfy.png'])
        p=prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':1},'comfy-result')
        node['assistantNativeRun']={'actionId':'comfy-result','taskKind':'comfy','taskIds':['comfy-task']}
        task={'task_id':'comfy-task','status':'succeeded','result':{'images':['/output/comfy.png']}}
        self.assertEqual(native_run_result(c,p,[task])['state'],'completed')

    def test_comfy_legacy_count_does_not_multiply_native_task_budget(self):
        from backend.canvas_assistant_native import native_run_result
        for mode, upscale, expected in [('text',False,1),('custom',False,1),('enhance',False,1),('enhance',True,2),('edit',True,2)]:
            with self.subTest(mode=mode,upscale=upscale):
                c=self.canvas('comfy');node=c['nodes'][0]
                node.update(count=8,mode=mode,enhanceUpscale=upscale,editUpscale=upscale,generatedOutputs=['/output/comfy.png'])
                p=prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':expected},'comfy-result')
                ids=['first','second'][:expected]
                node['assistantNativeRun']={'actionId':'comfy-result','taskKind':'comfy','taskIds':ids}
                tasks=[{'task_id':i,'status':'succeeded','result':{'images':['/output/intermediate.png' if expected==2 and i=='first' else '/output/comfy.png']}} for i in ids]
                self.assertEqual(native_run_result(c,p,tasks)['state'],'completed')
                node['generatedOutputs']=[]
                self.assertEqual(native_run_result(c,p,tasks)['state'],'accepted')
                tasks[0]['status']='failed'
                self.assertEqual(native_run_result(c,p,tasks)['state'],'failed')
                with self.assertRaises(HTTPException):
                    prepare_native_action(c,{'action':'run','nodeId':'n','maxCalls':8*expected},'inflated')

    def test_native_connections_preserve_canvas_rules_and_saved_edge_receipt(self):
        for kind in ['classic','smart']:
            c=self.canvas('generator' if kind=='classic' else 'smart-loop');c['kind']=kind
            c['nodes'].append({'id':'from','type':'prompt' if kind=='classic' else 'smart-prompt','text':'正文'})
            args={'action':'connect','nodeId':'n','sourceId':'from'}
            p=prepare_native_action(c,args,'edge')
            with self.assertRaises(HTTPException):native_effect(c,p)
            c['connections']=[{'from':'from','to':'n',**({'kind':'input'} if kind=='smart' else {})}]
            self.assertEqual(native_effect(c,p)['state'],'completed')
            with self.assertRaises(HTTPException):prepare_native_action(c,{'action':'connect','nodeId':'from','sourceId':'n'},'cycle')
            with self.assertRaises(HTTPException):prepare_native_action(c,{**args,'sourceId':'n'},'self')

    def test_task_control_is_bound_to_original_saved_id_and_supported_service(self):
        canvas=self.canvas('output');canvas['nodes'][0]['_pending']=[{'canvasTaskType':'online-image','canvasTaskId':'old','status':'query-paused'}]
        p=prepare_native_action(canvas,{'action':'task_refresh','nodeId':'n','taskKind':'image','taskId':'old'},'refresh')
        self.assertFalse(p['chargeable']);self.assertTrue(p['serverAction'])
        for action,kind,task in [('task_refresh','image','foreign'),('task_cancel','image','old'),('task_refresh','comfy','old')]:
            with self.subTest(action=action,kind=kind),self.assertRaises(HTTPException):
                prepare_native_action(canvas,{'action':action,'nodeId':'n','taskKind':kind,'taskId':task},'refresh')

    def test_materialize_is_non_chargeable_and_requires_user_model_and_saved_chain(self):
        canvas=self.canvas('shot-table')
        canvas['nodes'][0]['shotTableData']={'source':{'sourceUrl':'/output/source.mp4'},'rows':[{'id':'r','imagePrompt':'商品'}],'generationMap':{}}
        args={'action':'shot_materialize','nodeId':'n','selectedRowIds':['r']}
        with self.assertRaises(HTTPException):prepare_native_action(canvas,args,'make')
        settings={'provider_id':'p','model':'user-image','engine':'api','ratio':'square','resolution':'1k','quality':'auto'}
        p=prepare_native_action(canvas,args,'make',creation_settings=settings,providers=[{'id':'p','image_models':['user-image']}],image_model_confirmed=True)
        self.assertFalse(p['chargeable'])
        with self.assertRaises(HTTPException):native_effect(canvas,p)

        canvas['nodes'] += [{'id':'p1','type':'prompt','text':'商品'},
            {'id':'g','type':'generator','apiProvider':'p','model':'user-image','ratio':'square','resolution':'1k','quality':'auto','count':1,'shotTableOrigin':{'tableId':'n','rowId':'r'}},
            {'id':'o','type':'output','images':[]}]
        canvas['connections']=[{'from':'p1','to':'g'},{'from':'g','to':'o'}]
        canvas['nodes'][0]['shotTableData']['generationMap']={'/output/source.mp4:r':{'promptId':'p1','generatorId':'g','outputId':'o'}}
        self.assertEqual(native_effect(canvas,p)['state'],'completed')
        canvas['nodes'][2]['model']='forced'
        with self.assertRaises(HTTPException):native_effect(canvas,p)

    def test_materialize_rejects_broken_foreign_or_busy_existing_chain_before_mutation(self):
        settings={'provider_id':'p','model':'user-image','ratio':'square','resolution':'1k','quality':'auto'}
        canvas=self.canvas('shot-table')
        canvas['nodes'][0]['shotTableData']={'source':{'sourceUrl':'/output/source.mp4'},'rows':[{'id':'r','imagePrompt':'商品'}],'generationMap':{'/output/source.mp4:r':{'promptId':'p1','generatorId':'g','outputId':'o'}}}
        canvas['nodes'] += [{'id':'p1','type':'prompt','text':'商品'}, {'id':'g','type':'generator','shotTableOrigin':{'tableId':'n','rowId':'r'}}, {'id':'o','type':'output'}]
        canvas['connections']=[{'from':'p1','to':'g'},{'from':'g','to':'o'}]
        args={'action':'shot_materialize','nodeId':'n','selectedRowIds':['r']}
        for mode in ['missing','foreign','busy','disconnected']:
            broken=copy.deepcopy(canvas)
            if mode=='missing':broken['nodes'].pop()
            elif mode=='foreign':broken['nodes'][2]['shotTableOrigin']['tableId']='other'
            elif mode=='busy':broken['nodes'][3]['_pending']=[{'status':'running'}]
            else:broken['connections']=[]
            before=copy.deepcopy(broken)
            with self.subTest(mode=mode),self.assertRaises(HTTPException):
                prepare_native_action(broken,args,'reuse',creation_settings=settings,providers=[{'id':'p','image_models':['user-image']}],image_model_confirmed=True)
            self.assertEqual(broken,before)

    def test_malformed_pending_owner_is_conservatively_busy(self):
        canvas=self.canvas('generator')
        canvas['connections']=[{'from':'n','to':'out'}]
        for run in ['broken', {'node':'broken'}, ['broken']]:
            canvas['nodes']=canvas['nodes'][:1]+[{'id':'out','type':'output','_pending':[{'status':'running','run':run}]}]
            with self.subTest(run=run),self.assertRaises(HTTPException):
                prepare_native_action(canvas,{'action':'run','nodeId':'n','maxCalls':3},'run')

    def test_public_dynamic_schema_keeps_full_fields_and_marks_inferred_media(self):
        fields=[{'nodeId':'12','fieldName':'image','fieldValue':'input.png'},
                {'nodeId':'12','fieldName':'scheduler','fieldType':'SELECT','fieldValue':['normal','simple']}]
        fields += [{'nodeId':str(i),'fieldName':'steps','fieldType':'INT'} for i in range(120)]
        public=public_workflow_fields({'type':'rh'},fields)
        self.assertEqual(len(public),122)
        self.assertFalse(public[0]['editable'])
        self.assertEqual(public[1]['options'],['normal','simple'])

    def test_workflow_edits_bind_real_config_and_preserve_native_parameter_storage(self):
        canvas=self.canvas('comfy');canvas['nodes'][0].update(comfyWorkflow='public.json',mode='custom')
        fields=[{'id':'steps','type':'number','min':1,'max':30,'step':1}]
        args={'action':'workflow_parameters','nodeId':'n','patch':{'steps':12}}
        p=prepare_native_action(canvas,args,'params',workflow_fields=fields)
        validate_native_snapshot(canvas,p,workflow_fields=fields)
        with self.assertRaises(HTTPException):validate_native_snapshot(canvas,p,workflow_fields=[{**fields[0],'max':20}])
        with self.assertRaises(HTTPException):prepare_native_action(canvas,{**args,'patch':{'steps':1.5}},'params',workflow_fields=fields)
        with self.assertRaises(HTTPException):native_effect(canvas,p)
        canvas['nodes'][0]['comfyParams']={'steps':12,'other':'preserved'}
        self.assertEqual(native_effect(canvas,p)['state'],'completed')
        rh=self.canvas('rh');rh['nodes'][0]['rhAppInfo']={'nodeInfoList':[{'nodeId':'12','fieldName':'steps','fieldType':'INT','min':1,'max':30}]}
        p=prepare_native_action(rh,{'action':'workflow_parameters','nodeId':'n','patch':{'12::steps':12}},'rh')
        rh['nodes'][0]['rhParams']={'12::steps':{'value':'12','sourceFromUpstream':False}}
        self.assertEqual(native_effect(rh,p)['state'],'completed')

    def test_dynamic_edits_reject_inactive_mode_media_and_enabled_random_values(self):
        canvas=self.canvas('comfy');canvas['nodes'][0].update(comfyWorkflow='public.json',mode='text')
        args={'action':'workflow_parameters','nodeId':'n','patch':{'steps':12}}
        fields=[{'id':'steps','type':'number','min':1,'max':30}]
        with self.assertRaises(HTTPException):prepare_native_action(canvas,args,'params',workflow_fields=fields)
        canvas['nodes'][0]['mode']='custom';fields[0]['random_enabled']=True
        with self.assertRaises(HTTPException):prepare_native_action(canvas,args,'params',workflow_fields=fields)
        canvas['nodes'][0]['comfyRandomActive']={'steps':False}
        self.assertEqual(prepare_native_action(canvas,args,'params',workflow_fields=fields)['action'],'workflow_parameters')
        fields[0].update(type='image',random_enabled=False)
        with self.assertRaises(HTTPException):prepare_native_action(canvas,{**args,'patch':{'steps':'https://example.com/arbitrary.png'}},'params',workflow_fields=fields)
        for field in [{'id':'steps','type':'textarea'},{'id':'steps','type':'text','input':'prompt'},{'id':'steps','type':'text','name':'正向提示词'}]:
            with self.subTest(field=field),self.assertRaises(HTTPException):prepare_native_action(canvas,{**args,'patch':{'steps':'unused text'}},'params',workflow_fields=[field])

    def test_group_edit_preserves_nodes_and_rejects_smart_absorption(self):
        for kind,t,member_type in [('classic','group','image'),('smart','smart-group','smart-prompt')]:
            canvas=self.canvas(t);canvas['kind']=kind;canvas['nodes'].append({'id':'m','type':member_type})
            p=prepare_native_action(canvas,{'action':'group_members','nodeId':'n','memberIds':['m']},'members')
            with self.assertRaises(HTTPException):native_effect(canvas,p)
            canvas['nodes'][0]['items']=['m'];self.assertEqual(native_effect(canvas,p)['state'],'completed')
        canvas['nodes'][1]['type']='smart-image'
        with self.assertRaises(HTTPException):prepare_native_action(canvas,{'action':'group_members','nodeId':'n','memberIds':['m']},'members')

    def test_shared_output_busy_tasks_are_scoped_to_original_generator(self):
        canvas=self.canvas('generator')
        canvas['nodes'].append({'id':'out','type':'output','_pending':[
            {'canvasTaskId':'foreign','status':'query-paused','run':{'node':{'id':'other'}}}]})
        canvas['connections']=[{'from':'n','to':'out'}]
        self.assertEqual(prepare_native_action(canvas,{'action':'run','nodeId':'n','maxCalls':3},'run')['action'],'run')
        canvas['nodes'][1]['_pending'][0]['run']['node']['id']='n'
        with self.assertRaises(HTTPException):prepare_native_action(canvas,{'action':'run','nodeId':'n','maxCalls':3},'run')
        canvas['nodes'][1]['_pending'][0]['status']='succeeded'
        self.assertEqual(prepare_native_action(canvas,{'action':'run','nodeId':'n','maxCalls':3},'run')['action'],'run')
        canvas['nodes'][1]['_pending'][0].pop('run')
        canvas['nodes'][1]['_pending'][0]['status']='query-paused'
        with self.assertRaises(HTTPException):prepare_native_action(canvas,{'action':'run','nodeId':'n','maxCalls':3},'run')

    def test_unfinished_direct_and_output_tasks_block_new_run_but_terminal_tasks_do_not(self):
        canvas=self.canvas('generator'); node=canvas['nodes'][0]
        node['pending']=True
        with self.assertRaises(HTTPException): prepare_native_action(canvas, {'action':'run','nodeId':'n','maxCalls':3}, 'run')
        node.pop('pending')
        node['_directPending']=[{'canvasTaskType':'online-image','canvasTaskId':'old','status':'running'}]
        with self.assertRaises(HTTPException): prepare_native_action(canvas, {'action':'run','nodeId':'n','maxCalls':3}, 'run')
        node['_directPending']=[{'canvasTaskType':'online-image','canvasTaskId':'old','status':'succeeded'}]
        self.assertEqual(prepare_native_action(canvas, {'action':'run','nodeId':'n','maxCalls':3}, 'run')['action'],'run')
        node.pop('_directPending');node['_pending']=[{'canvasTaskType':'online-image','canvasTaskId':'old','status':'query-paused'}]
        with self.assertRaises(HTTPException): prepare_native_action(canvas, {'action':'run','nodeId':'n','maxCalls':3}, 'run')
        node.pop('_pending');canvas['nodes'].append({'id':'out','type':'output','_pending':[{'canvasTaskType':'online-image','canvasTaskId':'old','status':'running'}]});canvas['connections']=[{'from':'n','to':'out'}]
        with self.assertRaises(HTTPException): prepare_native_action(canvas, {'action':'run','nodeId':'n','maxCalls':3}, 'run')

    def test_smart_table_edits_available_without_generic_creation(self):
        canvas=self.canvas('smart-shot-table');canvas['kind']='smart'
        canvas['nodes'][0]['shotTableData']={'revision':0,'rows':[{'id':'r','cells':{'motion':'old'}}],'columns':[{'id':'motion','kind':'builtin'}]}
        row=next(r for r in native_catalog('smart') if r['type']=='smart-shot-table')
        self.assertNotIn('create',row['availableActions'])
        self.assertIn('shot_edit',row['availableActions'])
        proposal=prepare_native_action(canvas,{'action':'shot_edit','nodeId':'n','rowId':'r','columnId':'motion','value':'缓慢推镜'},'edit-smart')
        canvas['nodes'][0]['shotTableData'].update(revision=1,rows=[{'id':'r','cells':{'motion':'缓慢推镜'},'motionPrompt':'缓慢推镜'}])
        self.assertEqual(native_effect(canvas,proposal)['state'],'completed')

    def test_shot_motion_edit_and_column_contract_preserve_video_prompt(self):
        canvas=self.canvas('shot-table');canvas['nodes'][0]['shotTableData']={'version':1,'revision':2,'rows':[{'id':'r','cells':{'motion':'old'},'motionPrompt':'old'}],'columns':[{'id':'motion','kind':'builtin','label':'运镜'}]}
        p=prepare_native_action(canvas,{'action':'shot_edit','nodeId':'n','rowId':'r','columnId':'motion','value':'new'},'edit')
        canvas['nodes'][0]['shotTableData']['rows'][0]['cells']['motion']='new'
        with self.assertRaises(HTTPException):native_effect(canvas,p)
        canvas['nodes'][0]['shotTableData']['revision']=3
        self.assertEqual(native_effect(canvas,p)['state'],'completed')
        self.assertEqual(canvas['nodes'][0]['shotTableData']['rows'][0]['motionPrompt'],'old')
        p=prepare_native_action(canvas,{'action':'shot_column','nodeId':'n','columnAction':'add','label':'细节'},'column')
        self.assertEqual(p['arguments']['columnId'],'assistant-column-column')
        with self.assertRaises(HTTPException):prepare_native_action(canvas,{'action':'shot_column','nodeId':'n','columnAction':'delete','columnId':'motion'},'delete')


    def test_modelscope_sizes_bind_native_coupled_fields_and_ranges(self):
        canvas=self.canvas('msgen');canvas['nodes'][0].update(msRatio='story',msResolution='4k')
        p=self.prepare(canvas,patch={'msCustomWidth':'1536','msCustomHeight':'1024'})
        self.assertEqual(p['effectFields'],{'msCustomWidth':'1536','msCustomHeight':'1024','msCustomSize':'1536x1024','msResolution':'custom','msRatio':''})
        for patch in [{'msCustomWidth':'bad'},{'msCustomSize':'1536x1024'},{'msResolution':'auto'},{'msRatio':'tall'}]:
            with self.subTest(patch=patch),self.assertRaises(HTTPException):self.prepare(canvas,patch=patch)

    def test_auto_resolution_requires_current_model_support(self):
        canvas=self.canvas('generator')
        with self.assertRaises(HTTPException):self.prepare(canvas,patch={'resolution':'auto'})
        for model in ['gpt-image-2','vendor/gpt-image-2-v1','gptimage2']:
            canvas['nodes'][0]['model']=model
            self.assertEqual(self.prepare(canvas,patch={'resolution':'auto'})['effectFields']['resolution'],'auto')

    def test_clip_unreachable_move_trim_are_rejected_before_partial_edit(self):
        canvas=self.canvas('clip');canvas['nodes'][0]['clipData']={'clips':[
            {'id':'a','kind':'video','startFrame':0,'endFrame':90,'sourceOffsetFrames':0,'sourceDurationFrames':120},
            {'id':'b','kind':'image','startFrame':90,'endFrame':180}]}
        for args in [{'clipId':'b','clipAction':'move','startFrame':0},{'clipId':'a','clipAction':'trim','startFrame':10,'endFrame':200},{'clipId':'a','clipAction':'trim','startFrame':100,'endFrame':110}]:
            with self.subTest(args=args),self.assertRaises(HTTPException):prepare_native_action(canvas,{'action':'clip_edit','nodeId':'n',**args},'edit')
        valid=prepare_native_action(canvas,{'action':'clip_edit','nodeId':'n','clipId':'a','clipAction':'trim','startFrame':10,'endFrame':80},'edit')
        self.assertEqual(valid['arguments']['endFrame'],80)

    def test_image_custom_size_preflight_binds_coupled_native_fields(self):
        canvas=self.canvas('generator');canvas['nodes'][0].update(customHeight='1024',resolution='4k',ratio='story')
        p=self.prepare(canvas,patch={'customWidth':'1536'})
        self.assertEqual(p['effectFields'],{'customWidth':'1536','customHeight':'1024','customSize':'1536x1024','resolution':'custom','ratio':'','_apiResolutionUserSet':True})
        for patch in [{'customWidth':'wrong'}, {'customWidth':'32'}, {'customRatio':'9:16'}, {'customSize':'1024x1024'}]:
            with self.subTest(patch=patch),self.assertRaises(HTTPException): self.prepare(canvas,patch=patch)
    def test_parameters_follow_node_specific_native_controls(self):
        for node_type, patch in [('video', {'resolution':'1080p'}), ('video', {'resolution':'780P'}), ('video', {'resolution':''}), ('generator', {'resolution':'2k','ratio':'story','count':8}), ('generator', {'ratio':'source'})]:
            with self.subTest(node_type=node_type,patch=patch): self.prepare(self.canvas(node_type),patch=patch)
        for node_type, patch in [('generator',{'ratio':'tall'}), ('generator',{'count':50}), ('generator',{'resolution':'1080p'}), ('video',{'resolution':'1k'}), ('video',{'duration':61}), ('llm',{'mode':'parallel'}), ('midjourney',{'lastAction':'imagine'})]:
            with self.subTest(node_type=node_type,patch=patch),self.assertRaises(HTTPException): self.prepare(self.canvas(node_type),patch=patch)

    def test_readable_history_submission_and_media_facts_are_never_editable(self):
        cases = [('llm','outputText','伪造'), ('smart-image','runPrompt','伪造'), ('smart-image','lastPrompt','伪造'), ('smart-image','runModelPrompt','伪造'), ('midjourney','lastAction','伪造'), ('midjourney','lastImageCount',4), ('image','width',999), ('image','kind','video')]
        for node_type, field, value in cases:
            canvas=self.canvas(node_type)
            if node_type.startswith('smart-'): canvas['kind']='smart'
            with self.subTest(node_type=node_type,field=field), self.assertRaises(HTTPException):
                self.prepare(canvas,patch={field:value})

    def test_smart_loop_writes_explicit_fields_without_splitting_multiline_text(self):
        canvas = self.canvas('smart-loop'); canvas['kind'] = 'smart'
        values = ['多行\n同一字段', '', '第二个有效字段']
        proposal = prepare_native_action(canvas, {'action': 'loop_prompts', 'nodeId': 'n', 'values': values}, 'fields')
        self.assertEqual(proposal['arguments']['values'], values)
        for invalid in [['ok', {}], ['x' * 12001], 'joined', []]:
            with self.assertRaises(HTTPException):
                prepare_native_action(canvas, {'action': 'loop_prompts', 'nodeId': 'n', 'values': invalid}, 'fields')
        with self.assertRaises(HTTPException):
            self.prepare(canvas, patch={'variablePrompt': '多行\n字段'})

    def test_clip_remove_is_native_edit_not_direct_exclusion_or_media_rewrite(self):
        canvas = self.canvas('clip')
        canvas['nodes'][0]['clipData'] = {'clips': [{'id': 'piece', 'sourceNodeId': 'src', 'sourceResultId': 'result'}], 'excludedSources': ['["src","old"]']}
        proposal = prepare_native_action(canvas, {'action': 'clip_edit', 'nodeId': 'n', 'clipId': 'piece', 'clipAction': 'remove'}, 'remove')
        self.assertEqual(proposal['arguments']['clipAction'], 'remove')
        for patch in [{'excludedSources': []}, {'clipData': {}}, {'url': '/output/fake.mp4'}]:
            with self.assertRaises(HTTPException): self.prepare(canvas, patch=patch)

    def canvas(self, node_type='loop'):
        return {'id':'c', 'kind':'classic', 'updated_at':7, 'nodes':[{'id':'n', 'type':node_type, 'count':3, 'model':'user-model','apiProvider':'user-provider'}], 'connections':[]}

    def prepare(self, canvas=None, **args):
        return prepare_native_action(canvas or self.canvas(), {'action':'update', 'nodeId':'n', 'patch':{'count':4}, **args}, 'action-1')

    def test_preflight_binds_saved_state_and_does_not_apply_or_change_model(self):
        canvas=self.canvas()
        before=copy.deepcopy(canvas)
        proposal=self.prepare(canvas)
        self.assertEqual(proposal['state'],'pending')
        self.assertEqual(proposal['updatedAt'],7)
        self.assertEqual(proposal['arguments']['patch'],{'count':4})
        self.assertFalse(proposal['chargeable'])
        self.assertEqual(canvas,before)
        validate_native_snapshot(canvas, proposal)
        canvas['nodes'][0]['count']=5
        with self.assertRaises(HTTPException): validate_native_snapshot(canvas,proposal)

    def test_current_native_types_have_explicit_action_contracts(self):
        classic={row['type']:row for row in native_catalog('classic')}
        smart={row['type']:row for row in native_catalog('smart')}
        self.assertEqual(len(classic),16)
        self.assertEqual(set(classic['audio']['actions']),{'preview','query'})
        self.assertEqual(len(smart),5)
        self.assertIn('run',classic['llm']['actions'])
        self.assertNotIn('run',classic['image']['actions'])
        self.assertIn('shot_edit',classic['shot-table']['actions'])
        self.assertIn('clip_edit',classic['clip']['actions'])

    def test_model_credentials_results_unknown_fields_and_wrong_types_rejected(self):
        for patch in ({'model':'forced'},{'apiProvider':'forced'},{'taskId':'fake'},{'url':'/output/fake.png'}, {'api_key':'secret'}, {'count':101},{'count':True},{'count':4.5},{'mode':'unknown'},{'showPrompt':'true'}):
            with self.subTest(patch=patch), self.assertRaises(HTTPException): self.prepare(patch=patch)

    def test_busy_readonly_missing_foreign_and_unsupported_action_rejected(self):
        for change in ({'readOnly':True}, {'readonly':True}):
            canvas=self.canvas(); canvas.update(change)
            with self.assertRaises(HTTPException): self.prepare(canvas)
        canvas=self.canvas(); canvas['nodes'][0]['running']=True
        with self.assertRaises(HTTPException): self.prepare(canvas)
        for args in ({'nodeId':'other'}, {'action':'delete'}, {'action':'run','nodeId':'n','maxCalls':3}, {'action':'code','code':'alert(1)'}):
            with self.subTest(args=args), self.assertRaises(HTTPException): self.prepare(**args)

    def test_run_requires_confirmation_and_never_overrides_selected_provider(self):
        proposal=self.prepare(self.canvas('generator'), action='run', patch={},maxCalls=3)
        self.assertTrue(proposal['chargeable'])
        self.assertEqual(proposal['nodeType'],'generator')
        self.assertEqual(proposal['arguments'],{'nodeId':'n','maxCalls':3})

    def test_llm_run_requires_one_call_and_preserves_selected_chat_model(self):
        canvas=self.canvas('llm')
        canvas['nodes'][0].update(llmProvider='codex', model='gpt-6.1-sol', userInput='把这段文案改成图片提示词')
        proposal=self.prepare(canvas, action='run', patch={}, maxCalls=1)
        self.assertTrue(proposal['chargeable'])
        self.assertEqual(proposal['runSettings'], {'provider':'codex','model':'gpt-6.1-sol','maxCalls':1,'taskKind':'llm'})
        with self.assertRaises(HTTPException):
            self.prepare(canvas, action='run', patch={}, maxCalls=2)

    def test_llm_run_effect_requires_saved_output(self):
        from backend.canvas_assistant_native import native_effect
        canvas=self.canvas('llm')
        canvas['nodes'][0].update(llmProvider='codex', model='gpt-6.1-sol', outputText='已保存的图片提示词')
        proposal=self.prepare(canvas, action='run', patch={}, maxCalls=1)
        canvas['nodes'][0]['assistantNativeRun']={'actionId':proposal['id'],'taskKind':'llm','taskIds':[],'status':'succeeded','outputText':'已保存的图片提示词'}
        receipt=native_effect(canvas, proposal)
        self.assertEqual(receipt['state'],'completed')
        self.assertEqual(receipt['outputText'],'已保存的图片提示词')
        self.assertEqual(receipt['synchronousEvidence']['actionId'],proposal['id'])
        for field,value in [('outputText','手改正文'),('model','foreign'),('llmProvider','foreign')]:
            changed=__import__('copy').deepcopy(canvas);changed['nodes'][0][field]=value
            with self.assertRaises(HTTPException):native_effect(changed,proposal)

    def test_smart_prompt_run_uses_selected_text_model_and_saved_text(self):
        canvas=self.canvas('smart-prompt');canvas['kind']='smart'
        node=canvas['nodes'][0]
        node.update(text='旧结果',llmInstruction='处理原文',llmEnabled=True,llmProvider='codex',llmModel='gpt-6.1-sol')
        proposal=prepare_native_action(canvas,{'action':'run','nodeId':'n','maxCalls':1},'smart-llm')
        row=next(r for r in native_catalog('smart') if r['type']=='smart-prompt')
        self.assertIn('run',row['availableActions'])
        self.assertEqual(proposal['runSettings'],{'provider':'codex','model':'gpt-6.1-sol','maxCalls':1,'taskKind':'llm'})
        node['assistantNativeRun']={'actionId':'smart-llm','taskKind':'llm','taskIds':[],'status':'succeeded','outputText':'改写正文'}
        node['text']='改写正文'
        self.assertEqual(native_effect(canvas,proposal)['outputText'],'改写正文')
        for field,value in [('text','手动修改'),('llmModel','other'),('llmProvider','other')]:
            changed=copy.deepcopy(canvas);changed['nodes'][0][field]=value
            with self.subTest(field=field),self.assertRaises(HTTPException):native_effect(changed,proposal)

    def test_smart_prompt_run_rejects_disabled_missing_model_or_empty_input(self):
        canvas=self.canvas('smart-prompt');canvas['kind']='smart'
        node=canvas['nodes'][0]
        node.update(text='旧结果',llmInstruction='处理原文',llmEnabled=True,llmProvider='codex',llmModel='gpt-6.1-sol')
        for field,value in [('llmEnabled',False),('llmModel',''),('llmProvider',''),('llmInstruction','')]:
            changed=copy.deepcopy(canvas);changed['nodes'][0][field]=value
            with self.subTest(field=field),self.assertRaises(HTTPException):
                prepare_native_action(changed,{'action':'run','nodeId':'n','maxCalls':1},'smart-llm')
        for limit in [0,2,True]:
            with self.subTest(limit=limit),self.assertRaises(HTTPException):
                prepare_native_action(canvas,{'action':'run','nodeId':'n','maxCalls':limit},'smart-llm')

    def test_dynamic_parameter_values_are_checked_against_native_schema(self):
        canvas=self.canvas('rh')
        canvas['nodes'][0]['rhAppInfo']={'nodeInfoList':[{'nodeId':'12','fieldName':'steps','fieldType':'INT','min':1,'max':30,'fieldValue':20}]}
        proposal=self.prepare(canvas,action='workflow_parameters',patch={'12::steps':10})
        self.assertEqual(proposal['arguments']['patch'],{'12::steps':10})
        for patch in ({'12::steps':31}, {'unknown':2}, {'12::steps':{'token':'private'}}):
            with self.subTest(patch=patch),self.assertRaises(HTTPException): self.prepare(canvas,action='workflow_parameters',patch=patch)

    def test_export_action_requires_explicit_format_and_saved_receipt(self):
        canvas=self.canvas('generator')
        canvas['nodes'].append({'id':'p','type':'prompt','text':'咖啡海报'})
        canvas['connections']=[{'id':'edge-1','from':'p','to':'n'}]
        proposal=prepare_native_action(canvas,{'action':'export','nodeId':'n','nodeIds':['p','n'],'includeResources':False},'export-json')
        self.assertEqual(proposal['exportFormat'],'json')
        self.assertEqual(proposal['exportNodeIds'],['p','n'])
        with self.assertRaises(HTTPException): native_effect(canvas,proposal)
        scope=proposal['exportScopeHash']
        canvas['nodes'][0]['assistantExportReceipts']=[{
            'actionId':'export-json','status':'download_started','format':'json','nodeId':'n','filename':'workflow.json','includeResources':False,'nodeIds':['p','n'],
            'connectionIds':['edge-1'],'scopeHash':scope,'bytes':256,'archiveMagic':'','downloadedAt':1,
        }]
        receipt=native_effect(canvas,proposal)
        self.assertEqual(receipt['state'],'completed');self.assertEqual(receipt['exportReceipt']['format'],'json')
        changed=copy.deepcopy(canvas);changed['nodes'][1]['text']='改过的正文'
        with self.assertRaises(HTTPException):native_effect(changed,proposal)

    def test_export_zip_receipt_checks_zip_header_and_range(self):
        canvas=self.canvas('generator')
        proposal=prepare_native_action(canvas,{'action':'export','nodeId':'n','includeResources':True},'export-zip')
        node=canvas['nodes'][0]
        node['assistantExportReceipts']=[{
            'actionId':'export-zip','status':'download_started','format':'zip','nodeId':'n','filename':'workflow.zip','includeResources':True,'nodeIds':['n'],'connectionIds':[],
            'scopeHash':proposal['exportScopeHash'],'bytes':64,'archiveMagic':'PK','downloadedAt':1,
        }]
        self.assertEqual(native_effect(canvas,proposal)['exportFormat'],'zip')
        node['assistantExportReceipts'][0]['archiveMagic']=''
        with self.assertRaises(HTTPException):native_effect(canvas,proposal)

    def test_export_rejects_ambiguous_scope_busy_member_and_incomplete_receipt(self):
        canvas=self.canvas('prompt');canvas['nodes'].append({'id':'p','type':'prompt','text':'正文'})
        for args in [dict(nodeIds=['p'],includeResources=False),dict(nodeIds=[],includeResources=False),dict(nodeIds=['n','n'],includeResources=False),dict(nodeIds=['n']),dict(nodeIds=['n'],includeResources='false')]:
            with self.subTest(args=args),self.assertRaises(HTTPException):
                prepare_native_action(canvas,{'action':'export','nodeId':'n',**args},'export')
        canvas['nodes'][1]['running']=True
        with self.assertRaises(HTTPException):prepare_native_action(canvas,{'action':'export','nodeId':'n','nodeIds':['n','p'],'includeResources':False},'export')
