const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const m=require('../static/js/canvas-video-deconstruction-model.js'),workbench=require('../static/js/canvas-storyboard-workbench.js');

test('启用字段同时限定展示和分析配置，关闭字段不删除旧内容',()=>{
 let d=m.editManualRow(m.createManualTable('t'),'add');d=m.editCell(d,d.rows[0].id,'props','雨伞');
 d=m.configure(d,{enabledFields:['visual','imagePrompt','invalid','visual']});assert.deepEqual(d.analysisSettings.enabledFields,['visual','imagePrompt']);
 const html=workbench.grid(d,false,'all',false);assert.ok(!html.includes('data-sb-cell="props"'));assert.ok(!html.includes('data-sb-select'));assert.equal(d.rows[0].cells.props,'雨伞');
 d=m.configure(d,{enabledFields:['props']});assert.ok(workbench.grid(d,false,'checked',false).includes('雨伞'));
});

test('新增镜头空白，选中镜头高亮；点选模式支持独立高亮',()=>{
 const d=m.editManualRow(m.createManualTable('t'),'add'),r=d.rows[0];assert.equal(r.imagePrompt,'');assert.equal(r.motionPrompt,'');assert.ok(Object.values(r.cells).every(v=>v===''));
 assert.match(workbench.grid(d,false,'checked',false),/storyboard-selected/);
 assert.match(workbench.grid(d,false,'single',false,r.id),/storyboard-selected/);
 assert.ok(!workbench.grid(d,false,'all',false).includes('storyboard-selected'));
});

test('分析前字段和模型校验不调用接口，失败保留原表，结果按镜头序号保留未选字段',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas-video-deconstruction-ui.js'),'utf8');
 let d=m.editManualRow(m.createManualTable('t'),'add');d=m.editCell(d,d.rows[0].id,'props','手工道具');const table={id:'t',shotTableData:d},calls=[];
 const host={readonly:()=>false,node:()=>table,context:()=>({tableNode:table,source:d.source,canvasId:'c',tableId:'t'}),isCurrent:()=>true,saveNow:async()=>true,editTable:(id,change)=>table.shotTableData=typeof change==='function'?change(table.shotTableData):change};
 let fail=false;
 const runtime={CanvasVideoDeconstructionModel:m,AbortController,console,fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:!fail,status:fail?409:200,json:async()=>fail?{detail:'模拟分析失败'}:{rows:[{...m.clone(d.rows[0]),id:'planned',cells:{visual:'新分析画面'}}]}}},confirm:()=>true};runtime.window=runtime;vm.createContext(runtime);vm.runInContext(source,runtime);
 const ui=runtime.CanvasVideoDeconstructionUI,s={host,tableId:'t'};
 await assert.rejects(ui.analyzeStoryboard(s),/选择分析平台和模型/);assert.equal(calls.length,0);
 table.shotTableData=m.configure(d,{providerId:'p',model:'m',enabledFields:[]});await assert.rejects(ui.analyzeStoryboard(s),/勾选至少一个/);assert.equal(calls.length,0);
 table.shotTableData=m.configure(table.shotTableData,{enabledFields:['visual']});fail=true;await assert.rejects(ui.analyzeStoryboard(s),/模拟分析失败/);assert.equal(table.shotTableData.rows[0].cells.props,'手工道具');assert.equal(table.shotTableData.task.status,'failed');
 fail=false;await ui.analyzeStoryboard(s);assert.equal(table.shotTableData.rows[0].cells.props,'手工道具');assert.equal(table.shotTableData.rows[0].cells.visual,'新分析画面');assert.equal(table.shotTableData.rows[0].id,d.rows[0].id);assert.deepEqual(calls[1].options.enabledFields,['visual']);
});

test('视频建表和文本建表均可手动增删镜头',()=>{
 for(const kind of ['text','video']){let d=m.createTable({kind});d=m.editManualRow(d,'add');assert.equal(d.rows.length,1);const deleted=m.editManualRow(d,'delete',d.rows[0].id);assert.equal(deleted.rows.length,0);}
});
