const {test}=require('node:test'),assert=require('node:assert/strict');
let ui;try{ui=require('../static/js/canvas-video-deconstruction-ui.js')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}
test('拆解界面API完整',()=>{assert.ok(ui);for(const name of ['openCuts','openTable','mount','reconcile','closeAll'])assert.equal(typeof ui[name],'function')});

test('两种画布点击创建空白镜头时，节点内显示原因且可重试',async()=>{
 const model=require('../static/js/canvas-video-deconstruction-model.js'),Host=require('../static/js/canvas-video-deconstruction-host.js');
 for(const type of ['shot-table','smart-shot-table']){
  const table={id:'t',type,shotTableData:model.createManualTable('t')};
  table.shotTableData.rows=model.buildShotRows([],3);table.shotTableData.selectedRowIds=['shot-1'];
  const nodes=[table],connections=[],reported=[],listeners={},status={textContent:'',hidden:true};
  const host=Host.create({tableType:type,getState:()=>({canvas:{id:'c'},nodes,connections,scale:1}),createVideoChain(){},onError(){}});
  host.onError=e=>reported.push(e.message);
  const body={classList:{add(){}},addEventListener:(name,fn)=>listeners[name]=fn,querySelector:()=>status};
  ui.mount({dataset:{},querySelector:()=>body},table,host);
  const button={dataset:{vdAction:'create-rows'},disabled:false};
  const event={stopPropagation(){},target:{closest:()=>button}};
  await listeners.click(event);
  assert.match(status.textContent,/镜头 1 缺少画面或生图提示词/);assert.equal(status.hidden,false);
  assert.equal(reported.length,1);assert.equal(button.disabled,false);assert.equal(nodes.length,1);assert.equal(connections.length,0);
  host.createRows=()=>({createdIds:[],generatorIds:[],reusedIds:[],nodeIds:[],warnings:[]});
  await listeners.click(event);assert.equal(status.hidden,true);assert.equal(status.textContent,'');
 }
});

test('空表和未选镜头时创建按钮仍可点击，并明确指出下一步',async()=>{
 const model=require('../static/js/canvas-video-deconstruction-model.js');
 for(const type of ['shot-table','smart-shot-table']) for(const empty of [true,false]){
  const table={id:'t',type,shotTableData:model.createManualTable('t')};
  if(!empty)table.shotTableData.rows=model.buildShotRows([],3);
  const listeners={},status={hidden:true,textContent:''},errors=[];
  const body={classList:{add(){}},addEventListener:(name,fn)=>listeners[name]=fn,querySelector:()=>status};
  const host={node:()=>table,readonly:()=>false,scale:()=>1,onError:e=>errors.push(e.message)};
  ui.mount({dataset:{},querySelector:()=>body},table,host);
  assert.match(body.innerHTML,/data-vd-action="create-rows"/);
  assert.doesNotMatch(body.innerHTML,/data-vd-action="create-rows"[^>]*disabled/);
  const button={dataset:{vdAction:'create-rows'},disabled:false};
  await listeners.click({stopPropagation(){},target:{closest:()=>button}});
  assert.match(status.textContent,empty?/分镜表为空.*新增镜头/:/请先勾选要创建的镜头/);
  assert.equal(status.hidden,false);assert.deepEqual(errors,[status.textContent]);
 }
});
test('帧选择保留检测索引，过滤不重新编号',()=>{const cuts=[{index:2,seconds:1,score:.12},{index:6,seconds:2,score:.4}];assert.deepEqual(ui.cutView(cuts,.3,new Set([6])).map(x=>[x.index,x.selected]),[[6,true]]);assert.equal(ui.cutView(cuts,.7,new Set()).length,0)});
test('表格内容和自定义列安全显示，内置列六项齐全',()=>{const m=require('../static/js/canvas-video-deconstruction-model.js');let d=m.createTable({sourceUrl:'/assets/a.mp4'});d.rows=m.buildShotRows([],3);d.rows[0].cells.visual='<img src=x onerror=evil()>';d=m.editColumn(d,'add',{label:'<script>自定义</script>',id:'custom-a'});const html=ui.tableHtml(d);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));for(const [,label] of m.builtin)assert.ok(html.includes(label));assert.ok(html.includes('imagePrompt'));assert.ok(html.includes('motionPrompt'))});
test('手机卡片可单独选镜、编辑全部字段和自定义列',()=>{const m=require('../static/js/canvas-video-deconstruction-model.js');let d=m.createTable({});d.rows=m.buildShotRows([],3);d=m.editColumn(d,'add',{id:'custom-a',label:'服装'});d.selectedRowIds=['shot-1'];const html=ui.editorHtml(d,'shot-1');assert.ok(html.includes('data-vd-select="shot-1"'));assert.ok(html.includes('checked'));for(const key of ['visual','dialogue','custom-a','imagePrompt','motionPrompt'])assert.ok(html.includes(`data-vd-edit="${key}"`))});
test('只读表与手机自定义列修改入口明确禁用',()=>{const m=require('../static/js/canvas-video-deconstruction-model.js');let d=m.createTable({});d.rows=m.buildShotRows([],3);d=m.editColumn(d,'add',{id:'custom-a',label:'服装'});const html=ui.tableHtml(d,true);assert.match(html,/data-vd-select="shot-1"[^>]*disabled/);assert.match(html,/data-vd-action="column"[^>]*disabled/);assert.match(ui.mobileColumnsHtml(d,true),/data-vd-action="column"[^>]*disabled/)});
test('两种宿主从视频直接请求本地分析，不创建配置弹窗',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),model=require('../static/js/canvas-video-deconstruction-model.js');
 for(const type of ['shot-table','smart-shot-table']){
  const requests=[],source={nodeId:'v',sourceUrl:'/assets/v.mp4'},table={id:'t',type,shotTableData:model.createTable(source)};
  const context={source,tableId:'t',canvasId:'c',tableNode:table};
  const host={ensureTable:()=>table,node:()=>table,readonly:()=>false,editTable:(id,fn)=>{table.shotTableData=fn(table.shotTableData)},context:()=>context,isCurrent:()=>true,saveNow:async()=>true,applyTask(){}};
  const runtime={CanvasVideoDeconstructionModel:model,document:{createElement(){throw Error('unexpected modal')}},setTimeout(){},fetch:async(url,options)=>{requests.push({url,body:options.body&&JSON.parse(options.body)});return {ok:true,json:async()=>url.endsWith('/models')?{localAnalysis:true}:{id:'local-task',status:'running'}}}};
  runtime.window=runtime;vm.createContext(runtime);vm.runInContext(fs.readFileSync(require.resolve('../static/js/canvas-video-deconstruction-ui.js'),'utf8'),runtime);
  await runtime.CanvasVideoDeconstructionUI.openTable(source,host);
  assert.equal(requests.find(r=>r.url.endsWith('/prepare')).body.options.localAnalysis,true);assert.equal(requests.filter(r=>r.url.endsWith('/models')).length,1);
 }
});
test('表头允许拖动，按钮与单元格保持独立交互',()=>{
 const model=require('../static/js/canvas-video-deconstruction-model.js'),listeners={},body={classList:{add(){}},addEventListener:(name,fn)=>{listeners[name]=fn}};
 const element={dataset:{},querySelector:()=>body},host={scale:()=>1,readonly:()=>false},node={id:'t',shotTableData:model.createTable({})};
 ui.mount(element,node,host);assert.ok(!body.innerHTML.includes('展开编辑'));
 function stopped(summary,control){let stop=false;listeners.mousedown({target:{closest:selector=>selector==='.shot-table-summary'?summary:control},stopPropagation(){stop=true}});return stop;}
 assert.equal(stopped(true,false),false);assert.equal(stopped(true,true),true);assert.equal(stopped(false,false),true);
});
test('旧后台缺少本地能力时，两种画布明确报错且不提交空转任务',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),model=require('../static/js/canvas-video-deconstruction-model.js');
 for(const type of ['shot-table','smart-shot-table']){
  const requests=[],source={nodeId:'v',sourceUrl:'/assets/v.mp4'},table={id:'t',type,shotTableData:model.createTable(source)};
  const context={source,tableId:'t',canvasId:'c',tableNode:table};
  const host={ensureTable:()=>table,node:()=>table,readonly:()=>false,editTable:(id,fn)=>{table.shotTableData=fn(table.shotTableData)},context:()=>context,isCurrent:()=>true,saveNow:async()=>true,applyTask(){}};
  const runtime={CanvasVideoDeconstructionModel:model,document:{createElement(){throw Error('unexpected modal')}},fetch:async url=>{requests.push(url);return {ok:true,json:async()=>({providers:[]})}}};
  runtime.window=runtime;vm.createContext(runtime);vm.runInContext(fs.readFileSync(require.resolve('../static/js/canvas-video-deconstruction-ui.js'),'utf8'),runtime);
  await assert.rejects(runtime.CanvasVideoDeconstructionUI.openTable(source,host),/run\.bat/);
  assert.equal(table.shotTableData.task.status,'failed');assert.match(table.shotTableData.task.error,/仅刷新浏览器不会更新后台/);
  assert.equal(requests.length,1);assert.ok(requests[0].endsWith('/models'));
 }
});
test('轮询遇到遗留确认状态时显示重启说明，不静默留下空表',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),model=require('../static/js/canvas-video-deconstruction-model.js');
 const received=[],source={nodeId:'v',sourceUrl:'/assets/v.mp4'},table={id:'t',shotTableData:model.createTable(source)};
 const context={source,tableId:'t',canvasId:'c',tableNode:table};
 const host={ensureTable:()=>table,node:()=>table,readonly:()=>false,editTable:(id,fn)=>{table.shotTableData=fn(table.shotTableData)},context:()=>context,isCurrent:()=>true,saveNow:async()=>true,applyTask:(ctx,task)=>received.push(task)};
 const runtime={CanvasVideoDeconstructionModel:model,setTimeout(){throw Error('terminal task must stop polling')},fetch:async(url,options)=>({ok:true,json:async()=>url.endsWith('/models')?{localAnalysis:true}:{id:'old-task',status:options.method?'queued':'awaiting-confirmation'}})};
 runtime.window=runtime;vm.createContext(runtime);vm.runInContext(fs.readFileSync(require.resolve('../static/js/canvas-video-deconstruction-ui.js'),'utf8'),runtime);
 await runtime.CanvasVideoDeconstructionUI.openTable(source,host);await new Promise(setImmediate);
 assert.equal(received.at(-1).status,'interrupted');assert.match(received.at(-1).error,/run\.bat/);
});
