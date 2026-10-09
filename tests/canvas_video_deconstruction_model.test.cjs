const {test}=require('node:test');
const assert=require('node:assert/strict');
let m;try{m=require('../static/js/canvas-video-deconstruction-model.js')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}
test('拆解模型真实入口存在',()=>assert.ok(m,'missing native deconstruction model'));
test('弱切点放宽和过滤保留联系表原索引',()=>{
 assert.equal(m.defaultSensitivity([{seconds:1,score:.161}]),.15);
 assert.deepEqual(m.filterCuts([{seconds:1,score:.4},{seconds:1.1,score:.7},{seconds:2,score:.2}],.3).map(x=>x.index),[1]);
});
test('一镜七帧避首尾且镜头时间量化不丢开场末尾',()=>{
 assert.deepEqual(m.evenFrameSeconds(18),[2.25,4.5,6.75,9,11.25,13.5,15.75]);
 const rows=m.buildShotRows([{seconds:0},{seconds:1.468126},{seconds:1.46},{seconds:3}],3);
 assert.deepEqual(rows.map(r=>[r.startSeconds,r.endSeconds,r.durationSeconds]),[[0,1.5,1.5],[1.5,3,1.5]]);
 assert.deepEqual(m.sampleSeconds({startSeconds:0,endSeconds:10}),[.8,5,9.2]);
});
test('跨镜整句不切碎，边界新句归后镜',()=>{
 const rows=m.buildShotRows([{seconds:1.5},{seconds:2}],3);
 const out=m.assignDialogue(rows,[{start:1,end:2,text:'跨镜整句'},{start:2,end:2.9,text:'边界新句'}]);
 assert.equal(out[0].cells.dialogue,'跨镜整句');assert.equal(out[1].carriedOver,true);assert.equal(out[2].cells.dialogue,'边界新句');
});
test('自定义列改名保留分析hint，删除列值，时间拒绝编辑',()=>{
 let d=m.createTable({nodeId:'v',fingerprint:'f'});d.rows=m.buildShotRows([],2);
 d=m.editColumn(d,'add',{id:'custom-a',label:'产品卖点'});
 d=m.editCell(d,d.rows[0].id,'custom-a','更香');
 d=m.editColumn(d,'rename',{id:'custom-a',label:'卖点'});
 assert.equal(d.columns.at(-1).hint,'产品卖点');assert.equal(d.rows[0].cells['custom-a'],'更香');
 assert.throws(()=>m.editCell(d,d.rows[0].id,'startSeconds','4'));
 d=m.editColumn(d,'delete',{id:'custom-a'});assert.equal(d.rows[0].cells['custom-a'],undefined);
 assert.throws(()=>m.editColumn(d,'add',{label:''}));
});
test('复制保留分析证据但不继承运行授权与外部生成归属',()=>{
 const d=m.createTable({nodeId:'v',fingerprint:'f'});d.rows=m.buildShotRows([],2);d.task={status:'running',taskId:'old',quote:{id:'grant'}};d.generationMap={one:{generatorId:'g'}};
 const copies=[{id:'copy',type:'shot-table',shotTableData:d}];m.remapCopies(copies,new Map([['v','new-v']]));
 assert.equal(copies[0].shotTableData.source.nodeId,'new-v');assert.equal(copies[0].shotTableData.task.status,'interrupted');assert.equal(copies[0].shotTableData.task.taskId,undefined);assert.deepEqual(copies[0].shotTableData.generationMap,{});
});
test('损坏数据拒绝，未知coverage不补成完整',()=>{
 const d=m.createTable({nodeId:'v'});d.rows=m.buildShotRows([],2);d.rows.push({...d.rows[0]});assert.throws(()=>m.normalizeTable(d));
 const valid=m.createTable({nodeId:'v'});assert.equal(m.normalizeTable(valid).task.coverage,undefined);
});
test('整链复制重映输出和生成归属，单独复制生成节点清除外部归属',()=>{const d=m.createTable({nodeId:'v'});d.generationMap={one:{promptId:'p',generatorId:'g',outputId:'o'}};const nodes=[{id:'t2',type:'shot-table',shotTableData:d},{id:'g2',type:'generator',shotTableOrigin:{tableId:'t',rowId:'shot-1'}}];m.remapCopies(nodes,new Map([['v','v2'],['t','t2'],['p','p2'],['g','g2'],['o','o2']]));assert.equal(nodes[0].shotTableData.generationMap.one.outputId,'o2');assert.equal(nodes[1].shotTableOrigin.tableId,'t2');const lone=[{type:'generator',shotTableOrigin:{tableId:'t'}}];m.remapCopies(lone,{});assert.equal(lone[0].shotTableOrigin,undefined)});
