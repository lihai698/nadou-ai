const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const model=require('../static/js/canvas-video-deconstruction-model.js');
const hostLib=require('../static/js/canvas-video-deconstruction-host.js');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const smartSource=readFileSync(require('node:path').join(__dirname,'../static/js/smart-canvas.js'),'utf8');

function fixture(){
 const d=model.createTable({kind:'text',nodeId:'story',fingerprint:'original',sourceUrl:''});
 d.rows=model.buildShotRows([],6);d.rows[0].imagePrompt='蓝衣女孩读旧信';d.task={status:'ready'};
 d.productionData={sourceNodeId:'story',documentNodeIds:{characters:'chars',sounds:'sounds'}};
 d.generationMap={'original:shot-1':{promptId:'prompt',generatorId:'image',outputId:'image'}};
 return d;
}
test('文本分镜保存重开可编辑，并复用已经创建的配图节点',()=>{
 const d=JSON.parse(JSON.stringify(fixture()));const nodes=[{id:'table',type:'smart-shot-table',shotTableData:d},{id:'image',type:'smart-image',runSettings:{provider_id:'user',model:'user-model'}}];
 const host=hostLib.create({model,tableType:'smart-shot-table',getState:()=>({canvas:{id:'canvas'},nodes,connections:[],generation:1}),readSource:()=>null,pushUndo(){},save(){},render(){},select(){}});
 assert.ok(host.isCurrent(host.context(d.source,'table',{allowDetached:true})));
 host.editTable('table',raw=>model.editCell(raw,'shot-1','dialogue','爸爸，谢谢你。'));
 const r=host.materializeRows('table',['shot-1'],{providerId:'another-user',model:'another-model'});
 assert.deepEqual(r.generatorIds,['image']);assert.deepEqual(r.createdIds,[]);
 assert.equal(nodes[1].runSettings.model,'user-model');assert.equal(nodes[0].shotTableData.rows[0].cells.dialogue,'爸爸，谢谢你。');
});
test('复制整条文本工作流时重映故事、资产和镜头归属，独立节点不引用原工作流',()=>{
 const d=fixture();const nodes=[{id:'new-table',type:'smart-shot-table',shotTableData:d},{id:'new-chars',type:'smart-prompt',storyWorkflowOrigin:{tableId:'table',sourceNodeId:'story'}}];
 model.remapCopies(nodes,new Map([['story','new-story'],['table','new-table'],['chars','new-chars'],['sounds','new-sounds'],['prompt','new-prompt'],['image','new-image']]));
 assert.equal(d.source.kind,'text');assert.equal(nodes[0].shotTableData.productionData.sourceNodeId,'new-story');
 assert.equal(nodes[0].shotTableData.productionData.documentNodeIds.sounds,'new-sounds');assert.equal(nodes[1].storyWorkflowOrigin.tableId,'new-table');
 assert.equal(nodes[0].shotTableData.generationMap['original:shot-1'].generatorId,'new-image');
 const lone=[{id:'lone',type:'smart-prompt',storyWorkflowOrigin:{tableId:'table',sourceNodeId:'story'}}];model.remapCopies(lone,{});assert.equal(lone[0].storyWorkflowOrigin,undefined);
});

test('创作阶段连线保留可读依赖但不会将整篇小说和资产串入图片输入',()=>{
 const nodes=[{id:'story',type:'smart-prompt'},{id:'table',type:'smart-shot-table'},{id:'prompt',type:'smart-prompt'},{id:'image',type:'smart-image'}];
 const canvas={connections:[{from:'story',to:'table',kind:'story'},{from:'table',to:'prompt',kind:'story'},{from:'prompt',to:'image',kind:'input'}]};
 const code=smartSource.slice(smartSource.indexOf('function upstreamNodesForKinds('),smartSource.indexOf('function clearDetachedRunInputRefs('));
 const context=createTaskContext({nodes,canvas,canvasUsesConnections:true});
 vm.runInContext(code,context);
 assert.equal(vm.runInContext('inputNodesFor(nodes[2]).length',context),0);
 assert.equal(vm.runInContext('workflowInputNodesFor(nodes[2]).length',context),0);
 assert.equal(vm.runInContext('inputNodesFor(nodes[3])[0].id',context),'prompt');
 assert.equal(vm.runInContext('workflowInputNodesFor(nodes[3]).length',context),1);
});

test('长工作流最后几镜超出原4000高度时连线仍处于SVG绘制范围',()=>{
 const nodes=[{id:'table',x:100,y:100,w:1120,h:390},{id:'shot12',x:7000,y:5200,w:340,h:260}];
 const canvas={connections:[{from:'table',to:'shot12',kind:'story'}]};
 const context=createTaskContext({nodes,canvas,isSmartGroupNode:()=>false,cascadeConnectionKeys:()=>new Set(),smartCascadeRunPath:null,
 selectedNodeIds:()=>[],loopInsertPreview:null,smartCascadeEdgeState:()=>'',nodeRect:n=>({x:n.x,y:n.y,width:n.w,height:n.h})});
 const code=smartSource.slice(smartSource.indexOf('function renderConnections('),smartSource.indexOf('function refreshConnectionLayer('));
 vm.runInContext(code,context);
 const html=vm.runInContext('renderConnections()',context);
 assert.match(html,/width="7440" height="5560" viewBox="0 0 7440 5560"/);
 assert.match(html,/class="\s*conn-line"/);
 assert.match(html,/cx="7000" cy="5330"/);
});

test('连线绘图区由SVG尺寸确定，样式不能把长图再次缩成固定6000×4000',()=>{
 const css=readFileSync(require('node:path').join(__dirname,'../static/css/smart-canvas.css'),'utf8');
 const layer=css.match(/\.connection-layer\s*\{([^}]+)\}/)[1];
 assert.doesNotMatch(layer,/(?:^|;)\s*(?:width|height)\s*:/);
});
