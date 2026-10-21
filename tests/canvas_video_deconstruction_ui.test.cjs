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
  const button={dataset:{sbAction:'create'},disabled:false};
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
  assert.match(body.innerHTML,/data-sb-action="create"/);
  assert.doesNotMatch(body.innerHTML,/data-sb-action="create"[^>]*disabled/);
  const button={dataset:{sbAction:'create'},disabled:false};
  await listeners.click({stopPropagation(){},target:{closest:()=>button}});
  assert.match(status.textContent,empty?/分镜表为空.*新增镜头/:/请先勾选要创建的镜头/);
  assert.equal(status.hidden,false);assert.deepEqual(errors,[status.textContent]);
 }
});
test('帧选择保留检测索引，过滤不重新编号',()=>{const cuts=[{index:2,seconds:1,score:.12},{index:6,seconds:2,score:.4}];assert.deepEqual(ui.cutView(cuts,.3,new Set([6])).map(x=>[x.index,x.selected]),[[6,true]]);assert.equal(ui.cutView(cuts,.7,new Set()).length,0)});
test('表格内容和自定义列安全显示，内置列六项齐全',()=>{const m=require('../static/js/canvas-video-deconstruction-model.js');let d=m.createTable({sourceUrl:'/assets/a.mp4'});d.rows=m.buildShotRows([],3);d.rows[0].cells.visual='<img src=x onerror=evil()>';d=m.editColumn(d,'add',{label:'<script>自定义</script>',id:'custom-a'});const html=ui.tableHtml(d);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));for(const [,label] of m.builtin)assert.ok(html.includes(label));assert.ok(html.includes('imagePrompt'));assert.ok(html.includes('motionPrompt'))});
test('编辑面板支持启用字段和自定义列',()=>{const m=require('../static/js/canvas-video-deconstruction-model.js');let d=m.createTable({});d.rows=m.buildShotRows([],3);d=m.editColumn(d,'add',{id:'custom-a',label:'服装'});d.selectedRowIds=['shot-1'];const html=ui.editorHtml(d,'shot-1');for(const key of ['visual','dialogue','custom-a','imagePrompt','motionPrompt'])assert.ok(html.includes(`data-vd-edit="${key}"`))});
test('只读表禁用选择，自定义列使用右键入口',()=>{const m=require('../static/js/canvas-video-deconstruction-model.js');let d=m.createTable({});d.rows=m.buildShotRows([],3);d=m.editColumn(d,'add',{id:'custom-a',label:'服装'});const html=ui.tableHtml(d,true);assert.match(html,/data-sb-select="shot-1"[^>]*disabled/);assert.ok(html.includes('data-sb-column="custom-a"'));});
test('两种画布从视频建表不自动调用模型，等待用户选择分析范围',async()=>{const m=require('../static/js/canvas-video-deconstruction-model.js');for(const type of ['shot-table','smart-shot-table']){const source={nodeId:'v',sourceUrl:'/assets/v.mp4'},table={id:'t',type,shotTableData:m.createTable(source)};const host={ensureTable:()=>table,node:()=>table,readonly:()=>false};assert.equal(await ui.openTable(source,host),table);assert.equal(table.shotTableData.task.status,'idle');}});
test('表头允许拖动，按钮与单元格保持独立交互',()=>{
 const model=require('../static/js/canvas-video-deconstruction-model.js'),listeners={},body={classList:{add(){}},addEventListener:(name,fn)=>{listeners[name]=fn}};
 const element={dataset:{},querySelector:()=>body},host={scale:()=>1,readonly:()=>false},node={id:'t',shotTableData:model.createTable({})};
 ui.mount(element,node,host);assert.ok(!body.innerHTML.includes('展开编辑'));
 function stopped(summary,control){let stop=false;listeners.mousedown({target:{closest:selector=>selector==='.shot-table-summary'?summary:control},stopPropagation(){stop=true}});return stop;}
 assert.equal(stopped(true,false),false);assert.equal(stopped(true,true),true);assert.equal(stopped(false,false),true);
});
