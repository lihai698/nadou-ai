const test=require('node:test'),assert=require('node:assert/strict');
const workflow=require('../static/js/canvas-workflow-view.js'),generation=require('../static/js/canvas-generation-view.js');
const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
test('RH option fields escape labels and retain selected values and binding keys',()=>{
 const html=workflow.renderRhSettingField({escapeHtml:esc,escapeAttr:esc},{},{},'1::mode','text','<label>','b',['a','b']);
 assert.match(html,/&lt;label>/);assert.match(html,/data-rh-param="1::mode"/);assert.match(html,/value="b" selected/);
});
test('Comfy controls retain typed values and use the workflow parameter setter',()=>{
 const node={comfyParams:{enabled:false}},patches=[];let saves=0,renders=0;
 const d={comfyFields:()=>[{id:'enabled',type:'boolean',default:true},{id:'steps',type:'number'}],setCanvasWorkflowParameters:(n,p)=>{patches.push(p);Object.assign(n.comfyParams,p);},scheduleSave:()=>saves++,render:()=>renders++};
 workflow.updateComfyField(d,node,{dataset:{comfyParam:'enabled',comfyType:'boolean'},closest:()=>null},{stopPropagation(){}});
 workflow.updateComfyField(d,node,{dataset:{comfyParam:'steps',comfyType:'number'},value:'23',closest:()=>null},{stopPropagation(){}});
 assert.deepEqual(patches,[{enabled:true},{steps:23}]);assert.equal(node.comfyParams.steps,23);assert.equal(saves,2);assert.equal(renders,1);
});
test('changing Comfy workflow clears old parameter values and renders loaded configuration',async()=>{
 const node={comfyWorkflow:'old',comfyParams:{old:1}},calls=[];
 const d={validComfyWorkflowName:v=>v,ensureComfyWorkflow:async name=>calls.push(name),render:()=>calls.push('render'),scheduleSave:()=>calls.push('save')};
 workflow.updateComfyField(d,node,{dataset:{field:'comfyWorkflow'},value:'new.json'});await Promise.resolve();
 assert.equal(node.comfyWorkflow,'new.json');assert.deepEqual(node.comfyParams,{});assert.deepEqual(calls,['new.json','save','render']);
});
test('Midjourney continuation buttons preserve action availability by result state',()=>{
 assert.equal(generation.midjourneyContinuationHtml({},{}),'');
 assert.equal(generation.midjourneyContinuationHtml({},{lastTaskId:'t',lastAction:'edit'}),'');
 const grid=generation.midjourneyContinuationHtml({},{lastTaskId:'t',lastImageCount:4,lastAction:'imagine',version:'6.1'});assert.match(grid,/data-mj-action="upscale"/);assert.match(grid,/data-mj-action="variation"/);
 const single=generation.midjourneyContinuationHtml({},{lastTaskId:'t',lastImageCount:1,lastAction:'upscale'});assert.match(single,/data-mj-action="inpaint"/);assert.match(single,/data-zoom-ratio="1.5"/);
});
