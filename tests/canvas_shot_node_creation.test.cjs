const {installEditorBridges}=require('./canvas_editor_bridge_test_helpers.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const model=require('../static/js/canvas-video-deconstruction-model.js');
const hostLib=require('../static/js/canvas-video-deconstruction-host.js');
const ui=require('../static/js/canvas-video-deconstruction-ui.js');

function fixture(smart=false,defaults={}){
 let serial=0;const notices=[],errors=[],focused=[];
 const e={window:{CanvasVideoDeconstructionHost:hostLib,CanvasClipHost:require('../static/js/canvas-clip-host.js'),CanvasClipModel:require('../static/js/canvas-clip-model.js'),CanvasClipBridge:{probeDuration:async()=>4}},nodes:[],connections:[],canvas:{id:'test',connections:[]},canvasId:'test',viewport:{scale:1},selected:new Set(),selectedIds:[],selectedId:'',selectedImage:{},SIZE_MAP:{square:{}},API_RATIO_VALUES:{square:'1:1'},initialSmartSettings:{},
  escapeHtml:x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),setPromptDraftForNode:(n,t)=>Object.assign(n,{promptDraftText:t,promptDraftHtml:t,promptDraftTouched:true}),uid:p=>p+(++serial),pushUndo(){},scheduleSave(){},saveCanvas:async()=>true,render(){},refreshSelectionVisuals(){},syncSelectionUi(){},imageForDisplay:x=>x,mediaKindForItem:x=>x.kind,
  imageApiProviders:()=>[{id:'p',image_models:['m']}],videoApiProviders:()=>[{id:'vp',video_models:['vm']}],providerVideoModels:()=>['vm'],imageProviders:()=>[{id:'p'}],providerImageModels:()=>['m'],cloneSmartSettings:x=>({...x}),smartSettingsForNode:()=>({engine:'api',apiKind:'image',...defaults}),canvasAssistantCreationSettings:()=>defaults,
  classicViewportHost:()=>e,smartViewportHost:()=>e,CanvasViewport:{fitAllNodesViewport:(_,ids)=>focused.push([...ids])},SmartViewport:{fitAllNodesViewport:(_,ids)=>focused.push([...ids])},setStatus:x=>notices.push(x),toast:x=>notices.push(x)};
 e.defaultNodeSize=type=>({w:type==='generator'?380:400});
 e.nodeRect=n=>({x:n.x,y:n.y,w:n.w||360,h:n.h||260,width:n.w||316,height:n.h||260});
 vm.createContext(e);
 const file=smart?'smart-canvas.js':'canvas.js',source=fs.readFileSync(require.resolve('../static/js/'+file),'utf8'),name=smart?'initSmartVideoDeconstructionBridge':'initCanvasVideoDeconstructionBridge';
 installEditorBridges(e,source,smart?'smart':'classic');
 const start=source.indexOf('function '+name+'(');vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),e);e[name]();
 const host=e.window.CanvasVideoDeconstructionBridge;host.onError=x=>errors.push(x.message);
 const table=host.createBlankTable({x:0,y:0});host.editTable(table.id,d=>model.editManualRow(model.editManualRow(d,'add'),'add'));
 table.shotTableData.rows.forEach((r,i)=>r.imagePrompt='镜头画面 '+i);table.shotTableData.selectedRowIds=table.shotTableData.rows.map(r=>r.id);
 return {e,host,table,errors,notices,focused};
}
function mounted(f,action='create-rows'){const listeners={},status={textContent:'',hidden:true},body={querySelector:()=>status,classList:{add(){}},addEventListener:(k,fn)=>listeners[k]=fn};ui.mount({dataset:{},querySelector:()=>body},f.table,f.host);const button={dataset:{vdAction:action},disabled:false};return {body,button,click:()=>listeners.click({stopPropagation(){},target:{closest:()=>button}})};}
const imageText=(n,smart)=>n.type==='prompt'?n.text:smart?n.promptDraftText:n.viewAdjustPrompt;
function setImageText(n,smart,text){if(n.type==='prompt')n.text=text;else if(smart)n.promptDraftText=text;else n.viewAdjustPrompt=text;}
function legacyImagePrompt(f,smart,row,text=row.imagePrompt){
 const map=Object.values(f.table.shotTableData.generationMap).find(v=>f.e.nodes.find(n=>n.id===v.generatorId)?.shotTableOrigin.rowId===row.id),g=f.e.nodes.find(n=>n.id===map.generatorId),p={id:'legacy-'+row.id,type:smart?'smart-prompt':'prompt',text,x:g.x-350,y:g.y},edges=smart?f.e.canvas.connections:f.e.connections;
 if(map.promptId!==g.id){const old=map.promptId;f.e.nodes.splice(f.e.nodes.findIndex(n=>n.id===old),1);for(let i=edges.length-1;i>=0;i--)if(edges[i].from===old||edges[i].to===old)edges.splice(i,1);}
 delete g.viewAdjustPrompt;delete g.promptDraftText;delete g.promptDraftHtml;map.promptId=p.id;
 for(let i=edges.length-1;i>=0;i--)if(edges[i].from===f.table.id&&edges[i].to===g.id)edges.splice(i,1);
 f.e.nodes.push(p);edges.push({from:f.table.id,to:p.id,kind:'story'},{from:p.id,to:g.id});return {map,g,p,edges};
}

for(const smart of [false,true]){
 const label=smart?'智能':'普通';
 test(label+'真实桥：缺模型直接建原生链，按钮不打开弹窗或调用生成',async()=>{
  const f=fixture(smart),m=mounted(f);assert.match(m.body.innerHTML,/创建所选镜头节点/);assert.doesNotMatch(m.body.innerHTML,/generation-setup/);
  await m.click();assert.deepEqual(f.errors,[]);assert.equal(f.focused.length,1);
  const g=f.e.nodes.find(n=>n.id===Object.values(f.table.shotTableData.generationMap)[0].generatorId);
  assert.equal(g.type,smart?'smart-image':'generator');assert.equal(smart?g.runSettings.provider_id:g.apiProvider,'');assert.equal(smart?g.runSettings.model:g.model,'');
  assert.equal(f.e.nodes.length,smart?5:13);assert.equal((smart?f.e.canvas.connections:f.e.connections).length,smart?4:14);assert.equal(m.button.disabled,false);
 });
 test(label+'真实桥：继承有效设置、逐镜错开，重复创建保留手改节点',()=>{
  const f=fixture(smart,{provider_id:'p',model:'m',ratio:'custom',customRatio:'5:4',customRatioWidth:5,customRatioHeight:4});
  const rows=f.table.shotTableData.rows,a=f.host.createRows(f.table.id,[rows[0].id]),b=f.host.createRows(f.table.id,[rows[1].id]);
  const g=f.e.nodes.find(n=>n.id===a.generatorIds[0]),p=f.e.nodes.find(n=>n.id===a.nodeIds[0]);setImageText(p,smart,'手工内容');if(smart)g.runSettings.model='手选模型';else g.model='手选模型';
  assert.equal((smart?g.runSettings:g).customRatioWidth,5);assert.equal((smart?g.runSettings:g).ratio,'custom');assert.notEqual(g.y,f.e.nodes.find(n=>n.id===b.generatorIds[0]).y);
  const again=f.host.createRows(f.table.id,rows.map(r=>r.id));assert.equal(again.createdIds.length,0);assert.equal(again.reusedIds.length,2);assert.equal(imageText(p,smart),'手工内容');assert.equal(smart?g.runSettings.model:g.model,'手选模型');
 });
 test(label+'按画布类型创建逐镜链，两类提示词分别引用',()=>{
  const f=fixture(smart),row=f.table.shotTableData.rows[0];row.motionPrompt='从低角度全景开始，缓慢向前推进并拉近人物面部';
  const a=f.host.createRows(f.table.id,[row.id]),map=Object.values(f.table.shotTableData.generationMap)[0],p=f.e.nodes.find(n=>n.id===map.promptId),edges=smart?f.e.canvas.connections:f.e.connections;
  assert.equal(map.promptId===map.generatorId,smart);assert.equal(imageText(p,smart),model.rowPrompt(row));assert.ok(!imageText(p,smart).includes(row.motionPrompt));const video=f.e.nodes.find(n=>n.id===map.video.generatorId);assert.equal(imageText(f.e.nodes.find(n=>n.id===map.video.promptId),smart),row.motionPrompt);assert.equal(f.e.nodes.length,smart?3:7);assert.equal(edges.filter(c=>c.from===f.table.id&&c.to===p.id&&c.kind==='story').length,1);assert.equal(f.e.nodes.filter(n=>['prompt','smart-prompt'].includes(n.type)).length,smart?0:2);
  f.host.createRows(f.table.id,[row.id]);assert.equal(imageText(p,smart),model.rowPrompt(row));assert.equal(edges.filter(c=>c.from===f.table.id&&c.to===p.id).length,1);
  f.host.editTable(f.table.id,d=>model.editCell(d,row.id,'motionPrompt','绕人物顺时针移动'));assert.equal(imageText(p,smart),row.imagePrompt);assert.equal(imageText(f.e.nodes.find(n=>n.id===map.video.promptId),smart),'绕人物顺时针移动');
 });
 test(label+'旧图片提示词按画布结构保留或合并，手改内容不覆盖',()=>{
  const f=fixture(smart),row=f.table.shotTableData.rows[0];row.motionPrompt='缓慢推进';f.host.createRows(f.table.id,[row.id]);
  const {map,p,g,edges}=legacyImagePrompt(f,smart,row,'我手写的画面');delete map.promptFormat;
  const count=f.e.nodes.length;f.host.createRows(f.table.id,[row.id]);assert.equal(imageText(smart?g:p,smart),'我手写的画面');assert.equal(f.e.nodes.length,count-(smart?1:0));assert.equal(f.e.nodes.includes(p),!smart);assert.ok(edges.some(c=>c.from===f.table.id&&c.to===(smart?g:p).id));
  f.host.editTable(f.table.id,d=>model.editCell(d,row.id,'imagePrompt','表格的新画面'));assert.equal(imageText(smart?g:p,smart),'我手写的画面');
 });
 test(label+'旧提示词仍被使用、运行中或图片已有不同手写输入时保留内容',()=>{
  for(const reason of ['shared','running','edited']){
   const f=fixture(smart),row=f.table.shotTableData.rows[0];f.host.createRows(f.table.id,[row.id]);const {g,p,edges}=legacyImagePrompt(f,smart,row);
   if(reason==='shared'){edges.push({from:p.id,to:'other'});p.text=row.imagePrompt+'\n\n【分镜提示词：动作与运镜】\n共享动作';Object.values(f.table.shotTableData.generationMap)[0].promptFormat='image-motion-v1';}if(reason==='running')g.running=true;if(reason==='edited')setImageText(g,smart,'图片节点中的独立手写内容');
   const original=p.text,made=f.host.createRows(f.table.id,[row.id]);assert.ok(f.e.nodes.includes(p));assert.equal(p.text,original);if(smart)assert.ok(made.warnings.some(w=>w.includes('已保留')));if(reason==='edited')assert.equal(imageText(g,smart),'图片节点中的独立手写内容');
  }
 });
 test(label+'真实桥：失效模型、空选、只读和部分删除均有明确边界',()=>{
  const f=fixture(smart,{provider_id:'p',model:'removed'}),ids=f.table.shotTableData.selectedRowIds;
  assert.throws(()=>f.host.createRows(f.table.id,[]),/选择镜头/);f.e.canvas.readOnly=true;assert.throws(()=>f.host.createRows(f.table.id,ids),/只读/);delete f.e.canvas.readOnly;
  const a=f.host.createRows(f.table.id,ids);const g=f.e.nodes.find(n=>n.id===a.generatorIds[0]);assert.equal(smart?g.runSettings.model:g.model,'');
  f.e.nodes.splice(f.e.nodes.findIndex(n=>n.id===a.nodeIds[0]),1);const before=f.e.nodes.length;assert.throws(()=>f.host.createRows(f.table.id,ids),/部分删除或断开|配图链已删除/);assert.equal(f.e.nodes.length,before);
  for(let i=f.e.nodes.length-1;i>=0;i--)if(a.nodeIds.includes(f.e.nodes[i].id))f.e.nodes.splice(i,1);
  assert.ok(f.host.createRows(f.table.id,ids).createdIds.length);
 });
 test(label+'实际按钮：保存失败能重试且不重复建，等待保存时防连点',async()=>{
  const f=fixture(smart),m=mounted(f);let resolve;f.host.saveNow=()=>new Promise(r=>resolve=r);
  const first=m.click();const count=f.e.nodes.length;await m.click();assert.equal(f.e.nodes.length,count);resolve(false);await first;
  assert.match(f.errors[0],/尚未保存成功/);assert.equal(f.focused.length,0);assert.equal(m.button.disabled,false);
  f.host.saveNow=async()=>true;await m.click();assert.equal(f.e.nodes.length,count);assert.equal(f.focused.length,1);assert.match(f.notices.at(-1),/复用 2 镜/);
 });
 test(label+'实际按钮：保存过程中切画布，拒绝在新画布定位',async()=>{
  const f=fixture(smart),m=mounted(f);let resolve;f.host.saveNow=()=>new Promise(r=>resolve=r);const run=m.click();f.e.canvas.id='other';f.e.canvasId='other';resolve(true);await run;
  assert.equal(f.focused.length,0);assert.match(f.errors[0],/返回原画布/);assert.equal(m.button.disabled,false);
 });
 test(label+'视频链使用本镜画面与独立视频提示词，重复创建保留模型和手改，断线不建副本',()=>{
  const f=fixture(smart,{videoProvider:'vp',videoModel:'vm',videoDuration:6}),ids=f.table.shotTableData.selectedRowIds;
  assert.throws(()=>f.host.createVideoRows(f.table.id,ids),/先创建画面节点/);assert.equal(f.e.nodes.length,1);
  const row=f.table.shotTableData.rows[0];row.motionPrompt='镜头推近，人物缓缓转身';f.host.createRows(f.table.id,ids);
  const made=f.host.createVideoRows(f.table.id,ids),map=Object.values(f.table.shotTableData.generationMap)[0],v=map.video,g=f.e.nodes.find(n=>n.id===v.generatorId),p=f.e.nodes.find(n=>n.id===v.promptId),edges=smart?f.e.canvas.connections:f.e.connections;
  assert.equal(g.type,smart?'smart-image':'video');assert.equal(imageText(p,smart),model.videoPrompt(row));assert.ok(edges.some(c=>c.from===map.outputId&&c.to===g.id));assert.equal(v.promptId===v.generatorId,smart);assert.equal(smart?g.runSettings.videoModel:g.model,'vm');
  f.host.editTable(f.table.id,d=>model.editCell(d,row.id,'motionPrompt','摇镜'));assert.match(imageText(p,smart),/摇镜/);
  setImageText(p,smart,'手写动作');if(smart)g.runSettings.videoModel='手选';else g.model='手选';const count=f.e.nodes.length;
  const reuse=f.host.createVideoRows(f.table.id,ids);assert.equal(reuse.createdIds.length,0);assert.equal(imageText(p,smart),'手写动作');assert.equal(f.e.nodes.length,count);
  edges.splice(edges.findIndex(c=>c.from===map.outputId&&c.to===g.id),1);assert.throws(()=>f.host.createVideoRows(f.table.id,ids),/部分删除或断开/);assert.equal(f.e.nodes.length,count);
 });
 test(label+'视频按钮可保存和定位，未配置模型保持空白',async()=>{
  const f=fixture(smart);f.host.createRows(f.table.id,f.table.shotTableData.selectedRowIds);const b=mounted(f);await b.click();assert.deepEqual(f.errors,[]);const v=Object.values(f.table.shotTableData.generationMap)[0].video,g=f.e.nodes.find(n=>n.id===v.generatorId);assert.equal(smart?g.runSettings.videoModel:g.model,'');assert.equal(f.focused.length,1);
 });
 test(label+'整理镜头按镜号、去重并保留人工剪辑，禁止未结束任务与无结果',async()=>{
  const f=fixture(smart),ids=f.table.shotTableData.selectedRowIds;f.host.createRows(f.table.id,ids);f.host.createVideoRows(f.table.id,ids);
  await assert.rejects(f.host.organizeRows(f.table.id,ids),/还没有视频结果/);
  const maps=Object.values(f.table.shotTableData.generationMap);maps.forEach((map,i)=>{const out=f.e.nodes.find(n=>n.id===map.video.outputId);out.images=[{url:`/assets/v${i}.mp4`,kind:'video',durationSeconds:4}];});
  f.e.nodes.find(n=>n.id===maps[0].video.generatorId).running=true;await assert.rejects(f.host.organizeRows(f.table.id,ids),/未完成任务/);f.e.nodes.find(n=>n.id===maps[0].video.generatorId).running=false;
  await f.host.organizeRows(f.table.id,[...ids].reverse());const collection=f.e.nodes.find(n=>n.id===f.table.shotTableData.collectionNodeId),items=smart?collection.images:collection.clipData.clips;assert.equal(collection.type,smart?'smart-group':'clip');assert.equal(items.length,2);assert.match(items[0].name,/镜头 1/);assert.match(items[1].name,/镜头 2/);
  if(!smart)collection.clipData.clips[0].muted=true;await f.host.organizeRows(f.table.id,ids);assert.equal((smart?collection.images:collection.clipData.clips).length,2);if(!smart)assert.equal(collection.clipData.clips[0].muted,true);
 });
 test(label+'复制整条制作链重映视频与整理归属，单独复制不串旧图',()=>{
  const f=fixture(smart),ids=f.table.shotTableData.selectedRowIds;f.host.createRows(f.table.id,ids);f.host.createVideoRows(f.table.id,ids);
  const copies=structuredClone(f.e.nodes),idMap=Object.fromEntries(copies.map(n=>[n.id,'copy-'+n.id]));model.remapCopies(copies,idMap);const t=copies.find(n=>n.id===f.table.id),map=Object.values(t.shotTableData.generationMap)[0];assert.match(map.video.generatorId,/^copy-/);assert.match(copies.find(n=>n.id===Object.values(f.table.shotTableData.generationMap)[0].video.generatorId).shotTableOrigin.imageNodeId,/^copy-/);
 });
}

test('普通原生配置清理保留镜头空模型，运行前阻止隐式供应商调用',async()=>{
 const config=require('../static/js/canvas-provider-config.js'),runner=require('../static/js/canvas-media-runner.js');const g={id:'g',type:'generator',shotTableOrigin:{},apiProvider:'',model:''};
 config.sanitizeImageNodeProviderModel({},g);assert.equal(g.apiProvider,'');assert.equal(g.model,'');
 const messages=[];await runner.runGenerator({nodes:[g],canvasApiAudioMode:()=>false,showErrorModal:x=>messages.push(x)},'g');assert.match(messages[0],/选择生图平台和模型/);
});
test('智能原生工具栏保持待选模型，运行前阻止隐式供应商调用',async()=>{
 const view=require('../static/js/smart-param-view.js'),runner=require('../static/js/smart-generation-runner.js');const settings={engine:'api',provider_id:'',model:''};
 const d={settings,activeSettingsSubject:()=>({shotTableOrigin:{}}),smartHasAudioAnalysisInput:()=>false,imageProviders:()=>[{id:'p'}],providerImageModels:()=>[],filterJimengImageModels:x=>x,normalizeApiSizeSettings(){},dynamicParams:{},renderProviderControl:()=>'',renderModelControl:()=>'',renderSizePickerControl:()=>'',renderQualityControl:()=>'',renderCountVisualControl:()=>'',isJimengProviderId:()=>false};
 view.renderApiParams(d);assert.equal(settings.provider_id,'');assert.equal(settings.model,'');
 await assert.rejects(runner.generateUrlsForCurrentSettings({settings},{shotTableOrigin:{}},'prompt',[],settings),/选择生图平台和模型/);
});


test('普通视频空模型与无画面均在创建任务前阻止，表格来源线仅放行关联提示词',async()=>{
 const config=require('../static/js/canvas-provider-config.js'),runner=require('../static/js/canvas-media-runner.js'),graph=require('../static/js/canvas-graph-rules.js');
 const v={id:'v',type:'video',shotTableOrigin:{stage:'video'},apiProvider:'',model:''},messages=[];
 config.sanitizeVideoNodeProviderModel({},v);assert.equal(v.model,'');
 await runner.runVideoNode({nodes:[v],showErrorModal:x=>messages.push(x)},v.id);assert.match(messages.pop(),/选择视频平台和模型/);
 v.apiProvider='p';v.model='m';await runner.runVideoNode({nodes:[v],showErrorModal:x=>messages.push(x),cascadeTargetIdFromOptions(){},generatorSources:()=>[],orderedSources:(_,x)=>x,applyUploadedUrlToRefs:x=>x,imageRefsOnly:()=>[],videoRefsOnly:()=>[],audioRefsOnly:()=>[]},v.id);assert.match(messages.pop(),/先生成并连接本镜画面/);
 const t={id:'t',type:'shot-table',shotTableData:{generationMap:{r:{promptId:'p',video:{promptId:'vp'}}}}},deps={nodes:[t,{id:'p',type:'prompt'},{id:'vp',type:'prompt'},{id:'other',type:'prompt'}]};
 assert.equal(graph.validStoryConnection(deps,{from:'t',to:'p'}),true);assert.equal(graph.validStoryConnection(deps,{from:'t',to:'vp'}),true);assert.equal(graph.validStoryConnection(deps,{from:'t',to:'other'}),false);
});
test('智能视频未选模型、未生成画面不会进入原生任务提交',async()=>{
 const runner=require('../static/js/smart-generation-runner.js'),settings={engine:'api',apiKind:'video',videoProvider:'',videoModel:''},n={shotTableOrigin:{stage:'video'}};
 await assert.rejects(runner.generateUrlsForCurrentSettings({settings},n,'提示词',[],settings),/选择视频平台和模型/);
 Object.assign(settings,{videoProvider:'p',videoModel:'m'});await assert.rejects(runner.generateUrlsForCurrentSettings({settings},n,'提示词',[],settings),/先生成并连接本镜画面/);
});
test('整理期间切画布或视频结果变化，不能把旧片段落入当前画布',async()=>{
 const f=fixture(false),ids=f.table.shotTableData.selectedRowIds;f.host.createRows(f.table.id,ids);f.host.createVideoRows(f.table.id,ids);for(const map of Object.values(f.table.shotTableData.generationMap))f.e.nodes.find(n=>n.id===map.video.outputId).images=[{url:'/assets/v.mp4',kind:'video'}];
 let done;f.e.window.CanvasClipBridge.probeDuration=()=>new Promise(resolve=>done=resolve);
 const work=f.host.organizeRows(f.table.id,[ids[0]]);f.e.canvas.id='other';done(4);await assert.rejects(work,/已变化/);assert.ok(!f.e.nodes.some(n=>n.type==='clip'));
});


test('智能逐镜视频再次运行仅使用连接的本镜画面，不把上次视频当作参考视频',()=>{
 const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8'),start=source.indexOf('function defaultReferenceImagesFor('),e={smartLoopContext:null,selfReferenceImagesForNode:()=>[{url:'/assets/previous.mp4',kind:'video'}],inputImagesFor:()=>[{url:'/assets/current.png',kind:'image'}],manualReferenceImagesFor:()=>[],smartImageUsesWorkflowInput:()=>false,uniqueReferenceImages:x=>x};vm.createContext(e);vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),e);
 assert.equal(e.defaultReferenceImagesFor({shotTableOrigin:{stage:'video'}}).length,1);assert.equal(e.defaultReferenceImagesFor({shotTableOrigin:{stage:'video'}})[0].url,'/assets/current.png');assert.equal(e.defaultReferenceImagesFor({}).length,2);
});
test('上游画面仍在生成时，不用旧图片启动视频',async()=>{
 const classic=require('../static/js/canvas-media-runner.js'),smart=require('../static/js/smart-generation-runner.js'),n={id:'v',type:'video',apiProvider:'p',model:'m',shotTableOrigin:{stage:'video',imageNodeId:'image'}},image={id:'image',pending:1},messages=[];
 await classic.runVideoNode({nodes:[n,image],showErrorModal:x=>messages.push(x)},'v');assert.match(messages[0],/画面正在生成/);
 await assert.rejects(smart.generateUrlsForCurrentSettings({nodes:[n,image]},n,'prompt',[{url:'/assets/old.png',kind:'image'}],{engine:'api',apiKind:'video',videoProvider:'p',videoModel:'m'}),/画面正在生成/);
});

for(const smart of [false,true]){
 test((smart?'智能':'普通')+'旧提示词按画布策略处理，保留旧输出和手改结果',()=>{
  const f=fixture(smart),row=f.table.shotTableData.rows[0];row.motionPrompt='人物转身';f.host.createRows(f.table.id,[row.id]);
  const combined=row.imagePrompt+'\n\n【分镜提示词：动作与运镜】\n'+row.motionPrompt;
  const {map,p,g:image,edges}=legacyImagePrompt(f,smart,row,combined),g=f.e.nodes.find(n=>n.id===map.video.generatorId);
  map.promptFormat='image-motion-v1';const old={id:'old-video-prompt',type:smart?'smart-prompt':'prompt',text:combined,x:0,y:0};f.e.nodes.push(old);map.video.promptId=old.id;map.video.promptFormat='image-motion-v1';edges.push({from:old.id,to:g.id},{from:f.table.id,to:old.id,kind:'story'});
  const count=f.e.nodes.length;f.host.createRows(f.table.id,[row.id]);assert.equal(f.e.nodes.length,count-(smart?1:0));assert.equal(f.e.nodes.includes(p),!smart);assert.equal(imageText(smart?image:p,smart),smart?row.imagePrompt:combined);assert.equal(old.text,row.motionPrompt);
  old.text='用户修改视频提示词';f.host.editTable(f.table.id,d=>model.editCell(d,row.id,'motionPrompt','新动作'));assert.equal(old.text,'用户修改视频提示词');
 });
 test((smart?'智能':'普通')+'独立编辑两类提示词分别同步，未完成视频任务期间不改输入',()=>{
  const f=fixture(smart),row=f.table.shotTableData.rows[0];row.motionPrompt='视频动作';f.host.createRows(f.table.id,[row.id]);
  let map=Object.values(f.table.shotTableData.generationMap)[0];const p=f.e.nodes.find(n=>n.id===map.promptId),g=f.e.nodes.find(n=>n.id===map.video.generatorId),vp=f.e.nodes.find(n=>n.id===map.video.promptId);
  f.host.editTable(f.table.id,d=>model.editCell(d,row.id,'imagePrompt','新的静态画面'));assert.equal(imageText(p,smart),'新的静态画面');assert.equal(imageText(vp,smart),'视频动作');
  f.host.editTable(f.table.id,d=>model.editCell(d,row.id,'motionPrompt','新的运镜'));assert.equal(imageText(p,smart),'新的静态画面');assert.equal(imageText(vp,smart),'新的运镜');
  g._pending=[{canvasTaskId:'original-task'}];assert.throws(()=>f.host.editTable(f.table.id,d=>model.editCell(d,row.id,'motionPrompt','不能覆盖运行输入')),/正在运行/);assert.equal(imageText(vp,smart),'新的运镜');
  const html=ui.tableHtml(f.table.shotTableData);assert.match(html,/<th>分镜图片提示词<\/th><th>分镜视频提示词<\/th>/);assert.doesNotMatch(mounted(f).body.innerHTML,/create-video-rows|organize-rows/);
 });
}

test('普通内嵌视频结果保留原任务、刷新继续查询，完成后写回原节点且不新增输出节点',()=>{
 const results=require('../static/js/canvas-task-results.js'),runtime=require('../static/js/canvas-task-runtime.js');
 const pending={id:'p',canvasTaskId:'original',canvasTaskType:'video',run:{node:{id:'v'}},startedAt:1};
 const n={id:'v',type:'video',shotTableOrigin:{inlineOutput:true},_pending:[pending]},nodes=[n],queried=[];
 const deps={nodes,resumeCanvasDepthCaptureTasks(){},pollCanvasVideoTask:id=>queried.push(id)};
 runtime.resumeCanvasImageTasks(deps);assert.deepEqual(queried,['original']);assert.equal(results.findPendingTask(deps,'original').out,n);
 Object.assign(deps,{nowMs:()=>100,resultMediaUrls:x=>x.videos,outputUrlValue:x=>typeof x==='string'?x:x.url,requestMetaFromResult:()=>({}),CANVAS_MEDIA_OUTPUT_TYPES:['video'],outputNodesForSource:()=>[],addGenerationLog(){},refreshRunNodes(){},scheduleSave(){}});
 assert.equal(results.completeCanvasVideoTask(deps,'original',{videos:[{url:'/assets/result.mp4',kind:'video'}]}),true);assert.equal(nodes.length,1);assert.equal(n.images[0].url,'/assets/result.mp4');assert.equal(n.generatedOutputs[0].url,'/assets/result.mp4');assert.equal(n._pending.length,0);
});

test('智能原生视频请求仅用视频草稿，级联图片提示词不会混入',()=>{
 const request=require('../static/js/smart-prompt-request.js');const text={nodeType:3,textContent:'视频专用：镜头平移'};
 const deps={Node:{TEXT_NODE:3,ELEMENT_NODE:1},promptInput:{childNodes:[text]},blockedInputRefKeys:()=>new Set(),defaultReferenceImagesFor:()=>[{url:'/assets/image.png',kind:'image'}],uniqueReferenceImages:x=>x,inputRefKey:x=>x.url,isSmartGroupNode:()=>false,inputPromptTextFor:()=> '图片专用：静态构图',settings:{engine:'api'},mediaKindForItem:x=>x.kind};
 const out=request.buildPromptRequest(deps,{shotTableOrigin:{stage:'video',inlineOutput:true}});assert.equal(out.prompt,'视频专用：镜头平移');assert.equal(out.refs[0].url,'/assets/image.png');
});
test('普通图片节点的真实输入读取自身图片提示词，分镜来源线不混入请求',()=>{
 const input=require('../static/js/canvas-generator-input.js'),graph=require('../static/js/canvas-graph-rules.js');
 const n={id:'image',type:'generator',viewAdjustPrompt:'图片专用：静态构图',shotTableOrigin:{stage:'image'}},table={id:'t',type:'shot-table',shotTableData:{generationMap:{row:{promptId:'image',generatorId:'image',outputId:'image'}}}};
 const deps={nodes:[n,table],connections:[{from:'t',to:'image',kind:'story'}],CANVAS_MEDIA_OUTPUT_TYPES:['generator','video']};
 assert.deepEqual(input.generatorSources(deps,n).map(s=>s.prompt),['图片专用：静态构图']);
 assert.equal(graph.validStoryConnection(deps,deps.connections[0]),true);
});
for(const smart of [false,true])test((smart?'智能':'普通')+'保存重开保留对应画布的制作链结构',()=>{
 const f=fixture(smart),ids=f.table.shotTableData.selectedRowIds;f.host.createRows(f.table.id,ids);
 const snapshot=structuredClone(f.e.nodes),edges=structuredClone(smart?f.e.canvas.connections:f.e.connections),count=snapshot.length;
 f.e.nodes.splice(0,f.e.nodes.length,...snapshot);if(smart)f.e.canvas.connections=edges;else f.e.connections=edges;
 const table=f.e.nodes.find(n=>n.id===f.table.id),made=f.host.createRows(table.id,ids);
 assert.equal(made.createdIds.length,0);assert.equal(f.e.nodes.length,count);assert.equal(f.e.nodes.filter(n=>['prompt','smart-prompt'].includes(n.type)).length,smart?0:4);
 assert.ok(Object.values(table.shotTableData.generationMap).every(v=>(v.promptId===v.generatorId)===smart));
});

test('普通六节点链的真实输入与视频任务结果落到独立结果节点',async()=>{
 const f=fixture(false,{videoProvider:'vp',videoModel:'vm'}),row=f.table.shotTableData.rows[0];row.motionPrompt='视频专用：向右平移';f.host.createRows(f.table.id,[row.id]);
 const map=Object.values(f.table.shotTableData.generationMap)[0],get=id=>f.e.nodes.find(n=>n.id===id),image=get(map.outputId),video=get(map.video.generatorId),out=get(map.video.outputId),g=get(map.generatorId);
 const edges=f.e.connections,has=(from,to)=>edges.some(c=>c.from===from&&c.to===to);
 assert.equal(new Set([map.promptId,map.generatorId,map.outputId,map.video.promptId,map.video.generatorId,map.video.outputId]).size,6);
 for(const [from,to]of [[map.promptId,g.id],[g.id,image.id],[image.id,video.id],[map.video.promptId,video.id],[video.id,out.id]])assert.ok(has(from,to));
 image.images=[{url:'/assets/current.png',kind:'image'}];
 const input=require('../static/js/canvas-generator-input.js'),runner=require('../static/js/canvas-media-runner.js'),results=require('../static/js/canvas-task-results.js');
 let payload;const errors=[],deps={nodes:f.e.nodes,connections:edges,CANVAS_MEDIA_OUTPUT_TYPES:['generator','video'],outputUrlValue:x=>typeof x==='string'?x:x.url,outputImageName:x=>x,mediaKindForOutputItem:x=>x.kind||'image',mediaKindForRef:x=>x.kind,
  showErrorModal:x=>errors.push(x),alert:x=>errors.push(x),cascadeTargetIdFromOptions(){},applyUploadedUrlToRefs:x=>x,imageRefsOnly:x=>x.filter(r=>r.kind==='image'),videoRefsOnly:x=>x.filter(r=>r.kind==='video'),audioRefsOnly:x=>x.filter(r=>r.kind==='audio'),
  outputForNode:()=>out,uid:()=> 'pending',runSnapshot:(n,prompt,refs)=>({node:{id:n.id},prompt,refs}),makePendingForRun:(id,run)=>({id,run,startedAt:1}),canvasVideoTaskIdForPending:p=>p.canvasTaskId='task',refreshRunNodes(){},resolveVideoProviderId:x=>x,manualVideoUrlForNode:()=>'',saveCanvas:async()=>true,
  createCanvasVideoTask:async x=>{payload=x;assert.equal(out._pending.length,1);assert.equal(image._pending,undefined);return {task_id:'task'}},scheduleSave(){},waitCanvasVideoTaskResult:async()=>({videos:[{url:'/assets/result.mp4',kind:'video'}]}),nowMs:()=>20,requestMetaFromResult:()=>({}),resultMediaUrls:r=>r.videos,addGenerationLog(){},outputNodesForSource:id=>edges.filter(c=>c.from===id).map(c=>get(c.to)).filter(n=>n.type==='output')};
 deps.generatorSources=n=>input.generatorSources(deps,n);deps.orderedSources=(n,s)=>input.orderedSources(deps,n,s);deps.completeCanvasVideoTask=(...args)=>results.completeCanvasVideoTask(deps,...args);
 assert.deepEqual(deps.generatorSources(g).map(s=>s.prompt),[row.imagePrompt]);
 await runner.runVideoNode(deps,video.id);assert.deepEqual(errors,[]);assert.equal(payload.prompt,row.motionPrompt);assert.equal(payload.images[0].url,'/assets/current.png');assert.equal(out.images[0].url,'/assets/result.mp4');assert.equal(out._pending.length,0);assert.equal(image.images[0].url,'/assets/current.png');assert.equal(f.e.nodes.length,7);
});

test('普通独立图片结果的上游正在生成时，视频不会使用旧结果提交',async()=>{
 const f=fixture(false,{videoProvider:'vp',videoModel:'vm'}),row=f.table.shotTableData.rows[0];f.host.createRows(f.table.id,[row.id]);const map=Object.values(f.table.shotTableData.generationMap)[0],g=f.e.nodes.find(n=>n.id===map.generatorId),errors=[];g.pending=1;
 await require('../static/js/canvas-media-runner.js').runVideoNode({nodes:f.e.nodes,connections:f.e.connections,showErrorModal:x=>errors.push(x)},map.video.generatorId);assert.match(errors[0],/画面正在生成/);
});

test('普通独立结果节点有待查询任务时，不改写图片或视频提示词',()=>{
 const f=fixture(false),row=f.table.shotTableData.rows[0];row.motionPrompt='原动作';f.host.createRows(f.table.id,[row.id]);const map=Object.values(f.table.shotTableData.generationMap)[0];
 for(const [id,field] of [[map.outputId,'imagePrompt'],[map.video.outputId,'motionPrompt']]){
  const out=f.e.nodes.find(n=>n.id===id);out._pending=[{canvasTaskId:'pending'}];assert.throws(()=>f.host.editTable(f.table.id,d=>model.editCell(d,row.id,field,'新内容')),/正在运行/);delete out._pending;
 }
 assert.equal(f.e.nodes.find(n=>n.id===map.promptId).text,row.imagePrompt);assert.equal(f.e.nodes.find(n=>n.id===map.video.promptId).text,'原动作');
});

test('普通旧内嵌链重复创建保留任务与结果，新镜头使用六个独立节点',()=>{
 const f=fixture(false),row=f.table.shotTableData.rows[0];f.host.createRows(f.table.id,[row.id]);const map=Object.values(f.table.shotTableData.generationMap)[0],g=f.e.nodes.find(n=>n.id===map.generatorId),v=f.e.nodes.find(n=>n.id===map.video.generatorId);
 const removed=new Set([map.promptId,map.outputId,map.video.promptId,map.video.outputId]);for(let i=f.e.nodes.length-1;i>=0;i--)if(removed.has(f.e.nodes[i].id))f.e.nodes.splice(i,1);f.e.connections=f.e.connections.filter(c=>!removed.has(c.from)&&!removed.has(c.to));f.e.connections.push({from:f.table.id,to:g.id,kind:'story'},{from:g.id,to:v.id});
 map.promptId=map.outputId=g.id;map.video.promptId=map.video.outputId=v.id;g.viewAdjustPrompt='手写图片';v.viewAdjustPrompt='手写视频';g.shotTableOrigin.inlineOutput=true;v.shotTableOrigin.inlineOutput=true;v.shotTableOrigin.imageNodeId=g.id;v._pending=[{canvasTaskId:'old-task'}];v.images=[{url:'/assets/old.mp4',kind:'video'}];
 const made=f.host.createRows(f.table.id,[row.id]);assert.equal(made.createdIds.length,0);assert.equal(g.viewAdjustPrompt,'手写图片');assert.equal(v.viewAdjustPrompt,'手写视频');assert.equal(v._pending[0].canvasTaskId,'old-task');assert.equal(v.images[0].url,'/assets/old.mp4');
 const next=f.host.createRows(f.table.id,[f.table.shotTableData.rows[1].id]);assert.equal(next.createdIds.length,6);
});
