const {test}=require('node:test'),assert=require('node:assert/strict');
const model=require('../static/js/canvas-video-deconstruction-model.js');let lib;try{lib=require('../static/js/canvas-video-deconstruction-host.js')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}
function setup(){let generation=1,undo=0;const canvas={id:'A'},nodes=[{id:'v',type:'image',url:'/assets/v.mp4',x:10,y:20,w:260}],connections=[];const source={canvasId:'A',nodeId:'v',resultId:'primary',sourceUrl:'/assets/v.mp4',title:'原视频',fingerprint:'v-primary-/assets/v.mp4'};
 const host=lib.create({model,getState:()=>({canvas,nodes,connections,generation,scale:1}),readSource:s=>nodes.find(n=>n.id===s.nodeId)?.url===s.sourceUrl?s:null,uid:p=>p+'-'+model.uid(),pushUndo:()=>undo++,save(){},render(){},select(){},runGenerators:async()=>{}});
 return {host,canvas,nodes,connections,source,next(){generation++},counts:()=>undo};}
test('真实画布桥存在',()=>assert.ok(lib));
test('折叠保留镜头与原始尺寸，重复折叠不覆盖恢复尺寸，展开不改变内容',()=>{
 const e=setup(),t=e.host.createBlankTable({x:0,y:0});t.w=1480;t.h=820;
 const data=JSON.stringify(t.shotTableData),revision=t.shotTableData.revision;
 e.host.setCollapsed(t.id,true);assert.equal(t.w,320);assert.equal(t.h,160);assert.equal(t.shotTableCollapsed,true);
 e.host.setCollapsed(t.id,true);assert.deepEqual(t.shotTableExpandedSize,{w:1480,h:820});
 assert.equal(t.shotTableData.revision,revision);assert.equal(JSON.stringify(t.shotTableData),data);
 e.host.setCollapsed(t.id,false);assert.equal(t.w,1480);assert.equal(t.h,820);assert.equal(t.shotTableCollapsed,undefined);assert.equal(t.shotTableExpandedSize,undefined);
 e.canvas.readOnly=true;assert.throws(()=>e.host.setCollapsed(t.id,true),/只读/);
});
test('上游输入使用当前连线、LLM结果和媒体，去重并防止循环',()=>{
 const nodes=[{id:'t'}, {id:'p',type:'prompt',text:'上游提示词'}, {id:'l',type:'llm',text:'输入不当输出',outputText:'分析结果'}, {id:'i',media:[{url:'/ref.png',kind:'image'}]}];
 const connections=[{from:'p',to:'l'},{from:'l',to:'t'},{from:'i',to:'t'},{from:'i',to:'t'},{from:'t',to:'p'}];
 const host=lib.create({model,getState:()=>({nodes,connections}),inputMedia:n=>n.media||[]});
 assert.deepEqual(host.inputs('t').map(v=>v.text||v.url),['分析结果','/ref.png']);
 nodes[2].outputText='新输出';assert.equal(host.inputs('t')[0].text,'新输出');
 nodes[2].outputText='';assert.deepEqual(host.inputs('t').map(v=>v.url),['/ref.png']);
 connections.length=0;assert.deepEqual(host.inputs('t'),[]);
});
test('复制逐镜完整链重映射来源，单独复制不继承原表映射',()=>{
 const d=model.createManualTable('table');d.rows=model.buildShotRows([],2);d.shotPromptMap={'shot-1':{sourceNodeId:'source',processorId:'processor'}};d.generationMap[`${d.source.fingerprint}:shot-1`]={promptId:'source',promptProcessorId:'processor',generatorId:'gen',outputId:'out'};
 const nodes=[{id:'table',type:'shot-table',shotTableData:d},{id:'source',type:'prompt'},{id:'processor',type:'llm',shotPromptOrigin:{tableId:'table',rowId:'shot-1',sourceNodeId:'source'},shotPromptResult:{sourceText:'实际输入'}},{id:'gen',type:'generator',shotPromptOrigin:{tableId:'table',rowId:'shot-1',sourceNodeId:'source',processorId:'processor',outputText:'结果'}}];
 const copied=model.clone(nodes);model.remapCopies(copied,{table:'t2',source:'s2',processor:'p2',gen:'g2',out:'o2'});
 assert.deepEqual(copied[0].shotTableData.shotPromptMap['shot-1'],{sourceNodeId:'s2',processorId:'p2'});
 assert.equal(Object.values(copied[0].shotTableData.generationMap)[0].promptProcessorId,'p2');
 assert.equal(copied[2].shotPromptOrigin.tableId,'t2');assert.equal(copied[3].shotPromptOrigin.processorId,'p2');
 const detached=model.clone([nodes[2]]);model.remapCopies(detached,{processor:'p3'});assert.equal(detached[0].shotPromptOrigin,undefined);assert.equal(detached[0].shotPromptResult,undefined);
});
test('逐镜LLM素材随表格单镜编辑同步，其他镜头和旧图保留',()=>{
 const e=setup(),t=e.host.createBlankTable({x:0,y:0}),d=t.shotTableData;
 d.rows=model.buildShotRows([1],2);d.productionData={style:'电影',shots:[{id:'shot-1',sceneId:'shop'}],scenes:[{id:'shop',name:'书店'}]};d.shotPromptMap={};
 for(const row of d.rows){const sid='source-'+row.id,pid='llm-'+row.id;d.shotPromptMap[row.id]={sourceNodeId:sid,processorId:pid};e.nodes.push({id:sid,type:'prompt',text:JSON.stringify(model.shotInput(d,row))},{id:pid,type:'llm',outputText:'已处理提示词',llmProvider:'p',model:'m'});}
 const row=d.rows[0],map=d.shotPromptMap[row.id],source=e.nodes.find(n=>n.id===map.sourceNodeId),processor=e.nodes.find(n=>n.id===map.processorId);
 assert.deepEqual(JSON.parse(source.text).assets.scenes,[{id:'shop',name:'书店'}]);
 processor.shotPromptResult={sourceText:source.text,outputText:processor.outputText,provider:'p',model:'m'};
 const gen={id:'g',type:'generator',images:[{url:'/old.png'}],shotPromptOrigin:{tableId:t.id,rowId:row.id,sourceNodeId:source.id,processorId:processor.id,outputText:processor.outputText}};
 e.nodes.push(gen);e.connections.push({from:source.id,to:processor.id,kind:'input'},{from:processor.id,to:gen.id,kind:'input'});
 d.generationMap[`${d.source.fingerprint}:${row.id}`]={promptId:source.id,promptProcessorId:processor.id,generatorId:'g',outputId:'out'};
 model.validateShotImage(e.nodes,e.connections,gen);
 const other=JSON.stringify(e.nodes.find(n=>n.id==='source-shot-2'));
 e.host.editTable(t.id,v=>model.editCell(v,row.id,'visual','单镜新画面'));
 assert.equal(JSON.parse(source.text).cells.visual,'单镜新画面');
 assert.equal(JSON.stringify(e.nodes.find(n=>n.id==='source-shot-2')),other);
 assert.deepEqual(gen.images,[{url:'/old.png'}]);
 assert.throws(()=>model.validateShotImage(e.nodes,e.connections,gen),/本镜/);
 assert.throws(()=>e.host.materializeRows(t.id,[row.id],{providerId:'p',model:'image'}),/LLM/);
});
test('文本故事分镜编辑同步原生配图链并失效旧工作流摘要',()=>{
 const e=setup(),t=e.host.createBlankTable({x:0,y:0});
 t.shotTableData.rows=model.buildShotRows([],2);t.shotTableData.rows[0].imagePrompt='旧提示词';
 const row=t.shotTableData.rows[0],chain=e.host.materializeRows(t.id,[row.id],{providerId:'chosen',model:'chosen-image'});
 t.shotTableData.source.kind='text';t.shotTableData.productionData={workflowHash:'old',shots:[{id:row.id,imagePrompt:'旧提示词'}]};
 e.host.editTable(t.id,d=>model.editCell(d,row.id,'imagePrompt','本镜新提示词'));
 const map=Object.values(t.shotTableData.generationMap)[0];
 assert.equal(e.nodes.find(n=>n.id===map.promptId).text,'本镜新提示词');
 assert.equal(t.shotTableData.productionData.shots[0].imagePrompt,'本镜新提示词');
 assert.equal(t.shotTableData.productionData.workflowHash,undefined);
 assert.equal(e.nodes.find(n=>n.id===map.generatorId).model,'chosen-image');
});
test('落图四列网格、包含全部成功图且重复响应不增节点',()=>{const e=setup(),ctx=e.host.context(e.source),r={operationId:'o',frames:Array.from({length:5},(_,i)=>({index:i,seconds:i,url:`/output/${i}.jpg`}))};e.host.landFrames(ctx,r);const out=e.nodes.filter(n=>n.frameOperationId==='o');assert.equal(out.length,5);assert.equal(out[0].x,366);assert.equal(out[4].x,366);assert.ok(out[4].y>out[0].y);assert.equal(e.nodes.find(n=>n.type==='group').items.length,5);e.host.landFrames(ctx,r);assert.equal(e.nodes.filter(n=>n.frameOperationId==='o').length,5)});
test('同源复用镜头表、切画布返回仍拒旧结果',()=>{const e=setup(),a=e.host.ensureTable(e.source),b=e.host.ensureTable(e.source);assert.equal(a.id,b.id);const ctx=e.host.context(e.source);e.next();e.canvas.id='B';e.next();e.canvas.id='A';assert.equal(e.host.landFrames(ctx,{frames:[{index:0,url:'/output/a.jpg'}]}),false)});
test('只读不改表，撤销重建同ID不能接收旧结果',()=>{const e=setup(),table=e.host.ensureTable(e.source);const ctx=e.host.context(e.source,table.id);e.nodes[e.nodes.indexOf(table)]={...table};assert.equal(e.host.applyTask(ctx,{id:'t',status:'ready',rows:model.buildShotRows([],2)}),false);e.canvas.readOnly=true;assert.throws(()=>e.host.ensureTable({...e.source,resultId:'other'}));});
test('单镜重试保留其他手工编辑，迟到任务不覆盖新任务',()=>{const e=setup(),t=e.host.ensureTable(e.source);t.shotTableData.rows=model.buildShotRows([{seconds:1}],2);t.shotTableData.rows[1].cells.visual='手工内容';const ctx=e.host.context(e.source,t.id);t.shotTableData.task={taskId:'active',status:'running'};assert.equal(e.host.applyTask(ctx,{id:'old',status:'ready',rows:model.buildShotRows([],3)}),false);e.host.applyTask(ctx,{id:'active',status:'ready',retryRowIds:['shot-1'],rows:[{...t.shotTableData.rows[0],cells:{visual:'分析'}}]});assert.equal(t.shotTableData.rows[1].cells.visual,'手工内容');});
test('生成映射稳定，复用原生generator且原片帧不连生图',()=>{const e=setup(),t=e.host.ensureTable(e.source);t.shotTableData.rows=model.buildShotRows([],2);t.shotTableData.rows[0].imagePrompt='画面提示';const settings={providerId:'user',model:'image-user'};const a=e.host.materializeRows(t.id,['shot-1'],settings);const g=e.nodes.find(n=>n.id===a.generatorIds[0]);assert.equal(g.type,'generator');const p=e.nodes.find(n=>n.type==='prompt');p.text='手工改后';const b=e.host.materializeRows(t.id,['shot-1'],settings);assert.equal(b.createdIds.length,0);assert.equal(p.text,'手工改后');assert.equal(e.connections.some(c=>c.from==='v'&&c.to===g.id),false);});
test('分析期间只保留改过的字段，其他画面字段和对白仍可接收',()=>{const e=setup(),t=e.host.ensureTable(e.source);t.shotTableData.rows=model.buildShotRows([],2);const ctx=e.host.context(e.source,t.id);t.shotTableData.rows[0].cells.visual='手工画面';const incoming=model.buildShotRows([],2);incoming[0].cells.visual='模型画面';incoming[0].cells.dialogue='真实对白';e.host.applyTask(ctx,{id:'active',status:'ready',rows:incoming});assert.equal(t.shotTableData.rows[0].cells.visual,'手工画面');assert.equal(t.shotTableData.rows[0].cells.dialogue,'真实对白')});
test('重试对白只合并对白且保留重试前手工字段，失败保留原对白',()=>{const e=setup(),t=e.host.ensureTable(e.source);t.shotTableData.rows=model.buildShotRows([],2);const r=t.shotTableData.rows[0];Object.assign(r,{imagePrompt:'手工提示'});Object.assign(r.cells,{visual:'手工画面',dialogue:'旧对白','custom-a':'手工服装'});const ctx=e.host.context(e.source,t.id),incoming=model.buildShotRows([],2);incoming[0].cells.dialogue='新对白';e.host.applyTask(ctx,{id:'active',status:'ready',speechOnly:true,speech:{status:'ready'},rows:incoming});assert.equal(t.shotTableData.rows[0].cells.visual,'手工画面');assert.equal(t.shotTableData.rows[0].imagePrompt,'手工提示');assert.equal(t.shotTableData.rows[0].cells['custom-a'],'手工服装');assert.equal(t.shotTableData.rows[0].cells.dialogue,'新对白');e.host.applyTask(ctx,{id:'active',status:'ready',speechOnly:true,speech:{status:'failed'},rows:model.buildShotRows([],2)});assert.equal(t.shotTableData.rows[0].cells.dialogue,'新对白')});
test('重试视觉保留手改对白和未参与返回的自定义字段',()=>{const e=setup(),t=e.host.ensureTable(e.source);t.shotTableData.rows=model.buildShotRows([],2);Object.assign(t.shotTableData.rows[0].cells,{dialogue:'手工对白','custom-a':'手工服装'});t.shotTableData.rows[0].carriedOver=true;const ctx=e.host.context(e.source,t.id),incoming=model.buildShotRows([],2);incoming[0].cells.visual='重新分析';e.host.applyTask(ctx,{id:'active',status:'ready',retryRowIds:['shot-1'],rows:incoming});const r=t.shotTableData.rows[0];assert.equal(r.cells.visual,'重新分析');assert.equal(r.cells.dialogue,'手工对白');assert.equal(r.cells['custom-a'],'手工服装');assert.equal(r.carriedOver,true)});
test('运行基线随画布保存，重开后的迟到结果保留手改字段',()=>{const e=setup(),t=e.host.ensureTable(e.source);t.shotTableData.rows=model.buildShotRows([],2);e.host.applyTask(e.host.context(e.source,t.id),{id:'active',status:'running'});t.shotTableData.rows[0].cells.visual='处理中保存的手工画面';t.shotTableData=model.clone(t.shotTableData);const resumed=e.host.context(e.source,t.id),incoming=model.buildShotRows([],2);incoming[0].cells.visual='模型迟到结果';incoming[0].cells.mood='温暖';e.host.applyTask(resumed,{id:'active',status:'ready',rows:incoming});assert.equal(t.shotTableData.rows[0].cells.visual,'处理中保存的手工画面');assert.equal(t.shotTableData.rows[0].cells.mood,'温暖')});
test('独立复制的完成表可编辑生成，拆解结果仍需原素材身份',()=>{const e=setup(),t=e.host.ensureTable(e.source);t.shotTableData.rows=model.buildShotRows([],2);const strict=e.host.context(e.source,t.id),view=e.host.context(e.source,t.id,{allowDetached:true});e.nodes.splice(e.nodes.findIndex(n=>n.id==='v'),1);assert.equal(e.host.isCurrent(strict),false);assert.equal(Boolean(e.host.isCurrent(view)),true);assert.equal(e.host.materializeRows(t.id,['shot-1'],{providerId:'p',model:'image'}).generatorIds.length,1)});
