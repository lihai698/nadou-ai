const test=require('node:test'),assert=require('node:assert/strict');
const body=require('../static/js/smart-node-body.js'),bindings=require('../static/js/smart-node-bindings.js');
const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
test('recovery view blocks lost local tasks but enables explicit remote refresh',()=>{
 const deps={escapeHtml:esc,escapeAttr:esc,smartPendingTasks:()=>[]};const node={id:'n'},layout={width:240,height:180};
 const lost=body.imageTaskRecoverBodyHtml(deps,node,{taskId:'t',taskLost:true,error:'<lost>'},layout);assert.match(lost,/请勿重新提交/);assert.match(lost,/disabled/);assert.match(lost,/&lt;lost>/);
 const remote=body.imageTaskRecoverBodyHtml(deps,node,{taskId:'t',taskLost:true,remoteRefreshable:true},layout);assert.match(remote,/刷新远端结果/);assert.doesNotMatch(remote,/disabled/);assert.match(remote,/data-task-id="t"/);
});
test('depth view retains bounded progress and escaped failure message',()=>{
 const d={isSmartImageNode:()=>false,escapeHtml:esc};
 const html=body.nodeBodyHtml(d,{depthCapture:{role:'depth',status:'failed',progress:150,stage:'<stage>',error:'<error>',sourceId:'source'}},{width:200,height:100});
 assert.match(html,/aria-valuenow="100"/);assert.match(html,/&lt;stage>/);assert.match(html,/data-depth-action="retry"/);
});
test('prompt control edits original text, updates split height and requests save',()=>{
 const text={},separator={};const controls={'.prompt-node-text':text,'.prompt-node-separator':separator};let saves=0,heights=0;
 const el={querySelectorAll:()=>[],querySelector:s=>controls[s]||null};const node={text:'old',promptSplitEnabled:true};
 const d={bindScrollableText(){},promptNodeSplitExtraHeight:()=>4,promptNodePromptItems:n=>n.text.split(n.promptSeparator||';'),syncPromptNodeHeightForSplit:()=>heights++,updateNodeElementDuringResize(){},scheduleSave:()=>saves++};
 bindings.bindPromptNodeControls(d,el,node);text.oninput({target:{value:'first;second'}});separator.oninput({target:{value:'|'}});
 assert.equal(node.text,'first;second');assert.equal(node.promptSeparator,'|');assert.equal(saves,2);assert.equal(heights,2);
});
test('render keeps the focused composer attached and restores captured media state',()=>{
 const view=require('../static/js/smart-node-view.js');
 for(const focused of [true,false]){
  const composer={},prompt={},appends=[],events=[],media={position:42};let removed=0;
  const world={classList:{toggle(){}},childNodes:[composer,{remove(){removed++;}}],querySelectorAll:()=>[],appendChild:el=>appends.push(el),insertAdjacentHTML(){}};
  const d={window:{},smartWorkflowTransferModal:null,world,nodes:[],composer,promptInput:prompt,document:{activeElement:focused?prompt:null,createElement:()=>({content:{children:[]}})},selectedNodeIds:()=>[],captureMediaPlaybackStates:()=>media,restoreMediaPlaybackStates:value=>{assert.equal(value,media);events.push('restore');},renderConnections:()=>'',bindNodeEvents:()=>events.push('bind'),bindConnectionEvents(){},updateComposer(){},renderMinimap(){},bindSmartPreviewImageFallbacks(){},syncSmartSelectedImageResolution(){},refreshRunTimerPills(){},measureSmartNodeImages(){}};
  view.render(d);assert.equal(removed,1);assert.equal(appends.includes(composer),!focused);assert.deepEqual(events,['restore','bind']);
 }
});
test('real view host preserves the image adjustment module object and toolbar methods',()=>{
 const vm=require('node:vm'),{createTaskContext}=require('./canvas_task_test_helpers.cjs');const adjust={menuHtml:()=>'<button>fixture-adjust</button>'};
 const ctx=createTaskContext({CanvasViewAdjust:adjust,imageForDisplay:x=>x,smartNodeToolbarImageIndex:()=>0,mediaKindForItem:()=> 'image',jimengImageProviderId:()=>'',escapeAttr:esc,escapeHtml:esc,node:{id:'im',type:'smart-image',images:[{url:'/static/fixture.png'}]}});
 assert.equal(vm.runInContext('smartNodeViewHost().CanvasViewAdjust',ctx),adjust);
 const html=vm.runInContext('SmartNodeBody.smartNodeToolbarHtml(smartNodeViewHost(), node)',ctx);assert.match(html,/fixture-adjust/);assert.match(html,/data-smart-node-action="crop"/);
});
