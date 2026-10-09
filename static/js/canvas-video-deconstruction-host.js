(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CanvasVideoDeconstructionHost=api;})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 function create(adapter){
  const m=adapter.model||(typeof window!=='undefined'?window.CanvasVideoDeconstructionModel:require('./canvas-video-deconstruction-model.js'));
  const tableType=adapter.tableType||'shot-table';
  let epoch=0;const state=()=>adapter.getState(),node=id=>state().nodes.find(n=>n.id===id),readonly=()=>!!(state().canvas?.readOnly||state().canvas?.readonly);
  function assertWrite(){if(readonly())throw new Error('只读画布不能修改');}
  function context(source,tableId,options={}){return {source:m.clone(source),canvasId:state().canvas?.id,generation:state().generation,epoch,allowDetached:!!options.allowDetached,sourceNode:node(source.nodeId),tableId,tableNode:node(tableId),rowSnapshots:Object.fromEntries((node(tableId)?.shotTableData?.rows||[]).map(r=>[r.id,JSON.stringify(r)]))};}
  function isCurrent(ctx){return (!readonly()||ctx.allowDetached)&&ctx.canvasId===state().canvas?.id&&ctx.generation===state().generation&&ctx.epoch===epoch&&(ctx.allowDetached&&ctx.tableNode?.shotTableData?.rows.length||ctx.sourceNode===node(ctx.source.nodeId)&&!!adapter.readSource(ctx.source))&&(!ctx.tableId||ctx.tableNode===node(ctx.tableId));}
  function save(){adapter.save();adapter.render();}
  function begin(){epoch++;}
  function landFrames(ctx,result){if(!isCurrent(ctx))return false;if(adapter.landFrames)return adapter.landFrames(ctx,result);const source=ctx.sourceNode,operation=result.operationId||result.id;const created=[];const width=260,height=190;const valid=(result.frames||[]).filter(f=>f.url);
   const fresh=valid.filter(f=>!state().nodes.some(n=>n.frameOperationId===operation&&n.frameIndex===f.index));if(!fresh.length)return [];
   adapter.pushUndo();fresh.forEach(f=>{const i=f.index??created.length,n={id:adapter.uid('img'),type:'image',mediaKind:'image',url:f.url,name:`${ctx.source.title||'视频'}·${m.formatTime(f.seconds||0)}`,x:source.x+(source.w||260)+96+(i%4)*(width+32),y:source.y+Math.floor(i/4)*(height+32),w:width,h:height,frameOperationId:operation,frameIndex:i};state().nodes.push(n);created.push(n);});
   const all=state().nodes.filter(n=>n.frameOperationId===operation);let g=state().nodes.find(n=>n.frameGroupOperationId===operation);const y2=Math.max(...all.map(n=>n.y+(n.h||height))),x2=Math.max(...all.map(n=>n.x+(n.w||width)));
   if(!g){g={id:adapter.uid('grp'),type:'group',name:`拆自${ctx.source.title||'视频'}`,frameGroupOperationId:operation};state().nodes.push(g);}Object.assign(g,{x:all[0].x-24,y:source.y-58,w:x2-all[0].x+48,h:y2-source.y+90,items:all.map(n=>n.id)});
   adapter.select(all.map(n=>n.id));save();return created;
  }
  function ensureTable(source){assertWrite();let existing=state().nodes.find(n=>n.type===tableType&&n.shotTableData?.source.nodeId===source.nodeId&&n.shotTableData?.source.resultId===source.resultId&&n.shotTableData?.source.sourceUrl===source.sourceUrl);if(existing){adapter.select([existing.id]);return existing;}
   if(!adapter.readSource(source))throw new Error('原视频已经改变，请重新打开');const n=node(source.nodeId);adapter.pushUndo();existing={id:adapter.uid(tableType),type:tableType,name:`${source.title||'视频'}·镜头表`,title:'镜头表',x:n.x+(n.w||260)+96,y:n.y,w:1120,h:390,shotTableData:m.createTable(source)};state().nodes.push(existing);state().connections.push({id:adapter.uid('c'),from:n.id,to:existing.id});adapter.select([existing.id]);save();return existing;
  }
  function editTable(id,change,options={}){assertWrite();const n=node(id);if(n?.type!==tableType)throw new Error('镜头表已不存在');const next=typeof change==='function'?change(n.shotTableData):change;adapter.pushUndo();n.shotTableData=m.normalizeTable(next);if(!options.deferSave)save();return n.shotTableData;}
  function applyTask(ctx,task){if(!isCurrent(ctx))return false;const n=node(ctx.tableId);if(!n)return false;const d=m.normalizeTable(n.shotTableData);if(d.task.taskId&&d.task.taskId!==task.id)return false;if(d.task.status==='cancelled'&&task.status!=='cancelled')return false;
   const statuses={queued:'running','awaiting-confirmation':'idle',succeeded:'ready'};d.task={...d.task,rowSnapshots:d.task.rowSnapshots||m.clone(ctx.rowSnapshots),taskId:task.id,status:statuses[task.status]||task.status,phase:task.phase,progressDetail:task.progressDetail||'',progress:task.progress||0,error:task.error||'',failureKind:task.failureKind,coverage:task.detected?.coverage||d.task.coverage,quote:task.quote};
   if(Array.isArray(task.rows)&&['ready','succeeded','cancelled'].includes(task.status)){
    const only=task.retryRowIds?.length?new Set(task.retryRowIds):null;
    const incoming=new Map(task.rows.map(r=>[r.id,r]));const merge=r=>{const fresh=incoming.get(r.id);if(!fresh||only&&!only.has(r.id))return r;
     const baseline=d.task.rowSnapshots[r.id],snapshot=baseline&&JSON.parse(baseline);let combined;
     if(task.speechOnly){if(!['ready','no-speech'].includes(task.speech?.status))return r;combined={...m.clone(r),cells:{...r.cells,dialogue:fresh.cells.dialogue||''},carriedOver:!!fresh.carriedOver};}
     else {combined={...m.clone(fresh),cells:{...r.cells,...fresh.cells}};if(only){combined.cells.dialogue=r.cells.dialogue;combined.carriedOver=r.carriedOver;}}
     if(snapshot&&JSON.stringify(r)!==baseline){Object.keys(r.cells).forEach(k=>{if(r.cells[k]!==snapshot.cells[k])combined.cells[k]=r.cells[k];});for(const k of ['imagePrompt','motionPrompt'])if(r[k]!==snapshot[k])combined[k]=r[k];d.task.error=[d.task.error,'分析期间有手工编辑，已保留编辑内容。'].filter(Boolean).join(' ');}return combined;};
    d.rows=d.rows.length?d.rows.map(merge):m.clone(task.rows);if(!d.selectedRowIds.length&&ctx.tableNode.shotTableData.rows.length===0)d.selectedRowIds=d.rows.map(r=>r.id);
   }
   if(task.detected)d.source.durationSeconds=m.quantize(task.detected.durationSeconds);if(task.context?.source_fingerprint)d.source.fingerprint=task.context.source_fingerprint;if(task.speech)d.speech=m.clone(task.speech);n.shotTableData=m.normalizeTable(d);adapter.save();adapter.render();return true;
  }
  function materializeRows(id,selectedIds,settings){assertWrite();if(!settings?.providerId||!settings?.model)throw new Error('请手动选择图片平台和模型');if(adapter.validateImageSettings&&!adapter.validateImageSettings(settings))throw new Error('图片平台或模型已经停用，请重新选择');const table=node(id);if(!table)throw new Error('镜头表已删除');const d=m.normalizeTable(table.shotTableData),rows=d.rows.filter(r=>selectedIds.includes(r.id));const result={generatorIds:[],createdIds:[],reusedIds:[]};if(!rows.length)return result;
   adapter.pushUndo();rows.forEach((r,i)=>{const key=`${d.source.fingerprint||d.source.sourceUrl}:${r.id}`,prior=d.generationMap[key],g=prior&&node(prior.generatorId);if(g){result.generatorIds.push(g.id);result.reusedIds.push(g.id);return;}
    const x=table.x+(table.w||1120)+96,y=table.y+i*430;
    const chain=adapter.createGenerationChain ? adapter.createGenerationChain({row:r,table,id,settings,x,y,uid:adapter.uid}) : (()=>{const p={id:adapter.uid('prompt'),type:'prompt',x,y,text:r.imagePrompt||r.cells.visual||''},gen={id:adapter.uid('gen'),type:'generator',x:x+350,y,apiProvider:settings.providerId,model:settings.model,count:1,ratio:settings.ratio||'square',resolution:settings.resolution||'1k',quality:settings.quality||'auto',inputs:[],shotTableOrigin:{tableId:id,rowId:r.id,sourceFingerprint:d.source.fingerprint,durationSeconds:r.durationSeconds,motionPrompt:r.motionPrompt||r.cells.motion||''}},out={id:adapter.uid('out'),type:'output',x:x+810,y,images:[]};return {nodes:[p,gen,out],connections:[{id:adapter.uid('c'),from:p.id,to:gen.id},{id:adapter.uid('c'),from:gen.id,to:out.id}],promptId:p.id,generatorId:gen.id,outputId:out.id};})();
    state().nodes.push(...chain.nodes);state().connections.push(...chain.connections);d.generationMap[key]={promptId:chain.promptId,generatorId:chain.generatorId,outputId:chain.outputId};result.generatorIds.push(chain.generatorId);result.createdIds.push(...chain.nodes.map(n=>n.id));
   });table.shotTableData=d;adapter.select(result.generatorIds);save();return result;
  }
  function collectUrls(n){const d=n?.shotTableData;return d?[...new Set([d.source.sourceUrl,...d.rows.map(r=>r.keyframeUrl)].filter(v=>typeof v==='string'&&v.startsWith('/')))]:[];}
  return {begin,context,isCurrent,landFrames,ensureTable,editTable,applyTask,materializeRows,node,readonly,scale:()=>state().scale||1,runGenerators:ids=>adapter.runGenerators(ids),collectUrls};
 }
 return {create};
});
