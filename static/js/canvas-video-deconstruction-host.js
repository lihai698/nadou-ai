(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CanvasVideoDeconstructionHost=api;})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 function create(adapter){
  const m=adapter.model||(typeof window!=='undefined'?window.CanvasVideoDeconstructionModel:require('./canvas-video-deconstruction-model.js'));
  const tableType=adapter.tableType||'shot-table';
  let epoch=0;const state=()=>adapter.getState(),node=id=>state().nodes.find(n=>n.id===id),readonly=()=>!!(state().canvas?.readOnly||state().canvas?.readonly);
  const legacyPrompt=row=>{const image=m.rowPrompt(row),motion=m.videoPrompt(row);return motion?`${image}${image?'\n\n':''}【分镜提示词：动作与运镜】\n${motion}`:image;};
  const videoText=(map,g)=>map.promptId===map.generatorId?(g?.type==='smart-image'?g.promptDraftText:g?.viewAdjustPrompt):node(map.promptId)?.text;
  function setVideoText(map,g,text){if(map.promptId!==map.generatorId){node(map.promptId).text=text;return;}if(adapter.setVideoPrompt)adapter.setVideoPrompt(g,text);else g.viewAdjustPrompt=text;}
  const imageText=(map,g)=>map.promptId===map.generatorId?(g?.type==='smart-image'?g.promptDraftText:g?.viewAdjustPrompt):node(map.promptId)?.text;
  function setImageText(map,g,text){if(map.promptId!==map.generatorId){node(map.promptId).text=text;return;}if(adapter.setImagePrompt)adapter.setImagePrompt(g,text);else g.viewAdjustPrompt=text;}
  function assertWrite(){if(readonly())throw new Error('只读画布不能修改');}
  function context(source,tableId,options={}){return {source:m.clone(source),canvasId:state().canvas?.id,generation:state().generation,epoch,allowDetached:!!options.allowDetached,sourceNode:node(source.nodeId),tableId,tableNode:node(tableId),rowSnapshots:Object.fromEntries((node(tableId)?.shotTableData?.rows||[]).map(r=>[r.id,JSON.stringify(r)]))};}
  function isCurrent(ctx){return (!readonly()||ctx.allowDetached)&&ctx.canvasId===state().canvas?.id&&ctx.generation===state().generation&&ctx.epoch===epoch&&(ctx.allowDetached&&ctx.tableNode?.shotTableData&&(ctx.tableNode.shotTableData.source.kind==='manual'||ctx.tableNode.shotTableData.rows.length)||ctx.sourceNode===node(ctx.source.nodeId)&&!!adapter.readSource(ctx.source))&&(!ctx.tableId||ctx.tableNode===node(ctx.tableId));}
  function save(){adapter.save();adapter.render();}
  function begin(){epoch++;}
  function landFrames(ctx,result){if(!isCurrent(ctx))return false;if(adapter.landFrames)return adapter.landFrames(ctx,result);const source=ctx.sourceNode,operation=result.operationId||result.id;const created=[];const width=260,height=190;const valid=(result.frames||[]).filter(f=>f.url);
   const fresh=valid.filter(f=>!state().nodes.some(n=>n.frameOperationId===operation&&n.frameIndex===f.index));if(!fresh.length)return [];
   adapter.pushUndo();fresh.forEach(f=>{const i=f.index??created.length,n={id:adapter.uid('img'),type:'image',mediaKind:'image',url:f.url,name:`${ctx.source.title||'视频'}·${m.formatTime(f.seconds||0)}`,x:source.x+(source.w||260)+96+(i%4)*(width+32),y:source.y+Math.floor(i/4)*(height+32),w:width,h:height,frameOperationId:operation,frameIndex:i};state().nodes.push(n);created.push(n);});
   const all=state().nodes.filter(n=>n.frameOperationId===operation);let g=state().nodes.find(n=>n.frameGroupOperationId===operation);const y2=Math.max(...all.map(n=>n.y+(n.h||height))),x2=Math.max(...all.map(n=>n.x+(n.w||width)));
   if(!g){g={id:adapter.uid('grp'),type:'group',name:`拆自${ctx.source.title||'视频'}`,frameGroupOperationId:operation};state().nodes.push(g);}Object.assign(g,{x:all[0].x-24,y:source.y-58,w:x2-all[0].x+48,h:y2-source.y+90,items:all.map(n=>n.id)});
   adapter.select(all.map(n=>n.id));save();return created;
  }
  function createBlankTable(point){assertWrite();const id=adapter.uid(tableType),n={id,type:tableType,name:'分镜表',title:'分镜表',x:point.x,y:point.y,w:1120,h:390,shotTableData:m.createManualTable(id)};adapter.pushUndo();state().nodes.push(n);adapter.select([id]);save();return n;}
  function ensureTable(source){assertWrite();let existing=state().nodes.find(n=>n.type===tableType&&n.shotTableData?.source.nodeId===source.nodeId&&n.shotTableData?.source.resultId===source.resultId&&n.shotTableData?.source.sourceUrl===source.sourceUrl);if(existing){adapter.select([existing.id]);return existing;}
   if(!adapter.readSource(source))throw new Error('原视频已经改变，请重新打开');const n=node(source.nodeId);adapter.pushUndo();existing={id:adapter.uid(tableType),type:tableType,name:`${source.title||'视频'}·分镜表`,title:'分镜表',x:n.x+(n.w||260)+96,y:n.y,w:1120,h:390,shotTableData:m.createTable(source)};state().nodes.push(existing);state().connections.push({id:adapter.uid('c'),from:n.id,to:existing.id});adapter.select([existing.id]);save();return existing;
  }
  function editTable(id,change,options={}){assertWrite();const n=node(id);if(n?.type!==tableType)throw new Error('分镜表已不存在');const old=n.shotTableData,next=m.normalizeTable(typeof change==='function'?change(old):change),patches=[];
   for(const row of next.rows){const previous=old.rows.find(r=>r.id===row.id),map=old.shotPromptMap?.[row.id];if(!map||!previous||JSON.stringify(m.shotInput(old,previous))===JSON.stringify(m.shotInput(next,row)))continue;const p=node(map.sourceNodeId),processor=node(map.processorId),genMap=Object.values(old.generationMap||{}).find(v=>v.promptProcessorId===map.processorId),g=node(genMap?.generatorId);if(!p||!processor)throw new Error('该镜处理节点已丢失，请先核对');if([p,processor,g].some(v=>v&&(v.running||v.pendingTasks?.length||v.submissionUnknown)))throw new Error('本镜仍有运行中或受理未知任务，请先查询原任务');patches.push(()=>{p.text=JSON.stringify(m.shotInput(next,row),null,2);});if(next.productionData)delete next.productionData.workflowHash;}
   for(const row of next.rows){const previous=old.rows.find(r=>r.id===row.id),map=old.generationMap[`${old.source.fingerprint||old.source.sourceUrl}:${row.id}`];if(!previous||!map||!(['manual','text'].includes(old.source.kind)||map.promptFormat)||map.promptProcessorId||JSON.stringify(previous)===JSON.stringify(row))continue;const p=node(map.promptId),g=node(map.generatorId);if(g&&(g.running||g.pending||g.pendingTasks?.length||g._pending?.length||g._directPending?.length||g.submissionUnknown||g.taskId&&g.status==='running'))throw new Error('对应配图正在运行，请结束后再编辑本镜');const before=map.promptFormat==='image-motion-v1'?legacyPrompt(previous):m.rowPrompt(previous),after=m.rowPrompt(row);if(old.source.kind==='text'&&after!==before&&(!g||imageText(map,g)!==before))throw new Error('镜头配图链已改变，请先核对提示词');if(imageText(map,g)===before)patches.push(()=>{setImageText(map,g,after);if(map.promptFormat)next.generationMap[`${old.source.fingerprint||old.source.sourceUrl}:${row.id}`].promptFormat='image-v1';if(g?.type==='smart-image'&&!map.promptFormat){g.promptDraftText=after;g.promptDraftTouched=true;g.promptDraftHtml=after.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}});if(next.productionData){delete next.productionData.workflowHash;const shot=next.productionData.shots?.find(s=>s.id===row.id);if(shot)shot.imagePrompt=after;}if(g?.shotTableOrigin?.tableId===id)patches.push(()=>{g.shotTableOrigin={...g.shotTableOrigin,durationSeconds:row.durationSeconds,motionPrompt:row.motionPrompt||row.cells.motion||''};});}
   for(const row of next.rows){
    const previous=old.rows.find(r=>r.id===row.id),v=old.generationMap[`${old.source.fingerprint||old.source.sourceUrl}:${row.id}`]?.video;
    if(!previous||!v||JSON.stringify(previous)===JSON.stringify(row))continue;
    const p=node(v.promptId),g=node(v.generatorId);
    if(g&&(g.running||g.pending||g.pendingTasks?.length||g._pending?.length||g._directPending?.length||g.submissionUnknown))throw new Error('对应视频正在运行，请结束后再编辑本镜');
    const before=v.promptFormat==='image-motion-v1'?legacyPrompt(previous):m.videoPrompt(previous);
    if(videoText(v,g)===before)patches.push(()=>{setVideoText(v,g,m.videoPrompt(row));next.generationMap[`${old.source.fingerprint||old.source.sourceUrl}:${row.id}`].video.promptFormat='video-v1';});
    if(g?.shotTableOrigin)patches.push(()=>{Object.assign(g.shotTableOrigin,{durationSeconds:row.durationSeconds,startSeconds:row.startSeconds,endSeconds:row.endSeconds});});
   }
   adapter.pushUndo();n.shotTableData=next;patches.forEach(fn=>fn());if(!options.deferSave)save();return n.shotTableData;}
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
  function materializeRows(id,selectedIds,settings,options={}){assertWrite();if(!settings?.providerId||!settings?.model)throw new Error('请手动选择图片平台和模型');if(adapter.validateImageSettings&&!adapter.validateImageSettings(settings))throw new Error('图片平台或模型已经停用，请重新选择');return buildRows(id,selectedIds,settings,options);}
  function createRows(id,selectedIds){assertWrite();const table=node(id);if(!table?.shotTableData)throw new Error('镜头表已删除');if(table.shotTableData.task.status==='running')throw new Error('镜头仍在分析，请结束后创建节点');if(!table.shotTableData.rows.some(r=>selectedIds.includes(r.id)))throw new Error('请先选择镜头');let settings=adapter.defaultImageSettings?.(table)||{};if(!settings.providerId||!settings.model||adapter.validateImageSettings&&!adapter.validateImageSettings(settings))settings={};if(!adapter.createVideoChain)throw new Error('当前画布不支持视频节点');checkVideoChains(table,table.shotTableData.rows.filter(r=>selectedIds.includes(r.id)));const result=buildRows(id,selectedIds,settings,{deferSave:true,creationOnly:true});const videos=createVideoRows(id,selectedIds,{deferUndo:true});result.createdIds.push(...videos.createdIds);result.nodeIds.push(...videos.nodeIds);result.warnings.push(...videos.warnings);adapter.select(result.generatorIds);adapter.render();return result;}
  function buildRows(id,selectedIds,settings,options={}){assertWrite();const table=node(id);if(!table)throw new Error('镜头表已删除');const d=m.normalizeTable(table.shotTableData),rows=d.rows.filter(r=>selectedIds.includes(r.id));const result={generatorIds:[],createdIds:[],reusedIds:[],nodeIds:[],warnings:[]};if(!rows.length)return result;
   if(rows.some(r=>d.shotPromptMap?.[r.id]))throw new Error('这些镜头使用LLM提示词处理，请让创作助手创建逐镜配图节点，再运行对应图片节点');
   const empty=d.source.kind==='manual'&&rows.find(r=>!String(r.imagePrompt||r.cells.visual||'').trim());if(empty)throw new Error(`镜头 ${empty.index} 缺少画面或生图提示词，请先填写`);
   if(!options.creationOnly&&(d.source.kind==='manual'||d.source.kind==='text'&&tableType==='shot-table'))for(const r of rows){const prior=d.generationMap[`${d.source.fingerprint}:${r.id}`],g=prior&&node(prior.generatorId),p=prior&&node(prior.promptId);if(g&&(!p||p.text!==(r.imagePrompt||r.cells.visual||'')))throw new Error(`镜头 ${r.index} 的配图提示词已在节点中单独修改，请先核对两处内容再生成`);}
   // 部分删除的制作链需要用户核对，不能悄悄创建第二套或覆盖手工编辑。
   if(options.creationOnly)for(const r of rows){const prior=d.generationMap[`${d.source.fingerprint||d.source.sourceUrl}:${r.id}`];if(!prior)continue;const ids=[...new Set([prior.promptId,prior.generatorId,prior.outputId].filter(Boolean))],present=ids.filter(id=>node(id));const linked=(prior.promptId===prior.generatorId||state().connections.some(c=>c.from===prior.promptId&&c.to===prior.generatorId))&&(prior.outputId===prior.generatorId||state().connections.some(c=>c.from===prior.generatorId&&c.to===prior.outputId));if(!present.length&&prior.video&&[prior.video.promptId,prior.video.generatorId,prior.video.outputId].some(id=>node(id)))throw new Error(`镜头 ${r.index} 的配图链已删除，但视频链仍在，请恢复配图链或核对剩余视频节点后重建`);if(present.length&&(present.length!==ids.length||!linked))throw new Error(`镜头 ${r.index} 的制作链已部分删除或断开，请先恢复连线或删除剩余制作节点后重建`);}
   adapter.pushUndo();rows.forEach((r,i)=>{const key=`${d.source.fingerprint||d.source.sourceUrl}:${r.id}`,prior=d.generationMap[key],g=prior&&node(prior.generatorId);if(g){result.generatorIds.push(g.id);result.reusedIds.push(g.id);if(options.creationOnly)completeRowChain(id,r,prior,result);result.nodeIds.push(...new Set([prior.promptId,g.id,prior.outputId].filter(id=>node(id))));return;}
    const x=table.x+(table.w||1120)+96,y=table.y+(options.creationOnly?d.rows.indexOf(r)*(adapter.rowSpacing||430):i*430);
    const chain=adapter.createGenerationChain ? adapter.createGenerationChain({row:r,promptText:options.creationOnly?m.rowPrompt(r):r.imagePrompt||r.cells.visual||'',table,id,settings,x,y,uid:adapter.uid,creationOnly:!!options.creationOnly}) : (()=>{const gen={id:adapter.uid('gen'),type:'generator',x:options.creationOnly?x:x+350,y,apiProvider:settings.providerId||'',model:settings.model||'',count:1,ratio:settings.ratio||'square',resolution:settings.resolution||'1k',quality:settings.quality||'auto',inputs:[],shotTableOrigin:{tableId:id,rowId:r.id,sourceFingerprint:d.source.fingerprint,durationSeconds:r.durationSeconds,motionPrompt:r.motionPrompt||r.cells.motion||''}};if(options.creationOnly){gen.viewAdjustPrompt=m.rowPrompt(r);Object.assign(gen.shotTableOrigin,{stage:'image',inlineOutput:true});return {nodes:[gen],connections:[],promptId:gen.id,generatorId:gen.id,outputId:gen.id};}const p={id:adapter.uid('prompt'),type:'prompt',x,y,text:r.imagePrompt||r.cells.visual||''},out={id:adapter.uid('out'),type:'output',x:x+810,y,images:[]};return {nodes:[p,gen,out],connections:[{id:adapter.uid('c'),from:p.id,to:gen.id},{id:adapter.uid('c'),from:gen.id,to:out.id}],promptId:p.id,generatorId:gen.id,outputId:out.id};})();
    const generator=chain.nodes.find(n=>n.id===chain.generatorId);if(generator?.type==='generator')for(const k of ['customRatio','customSize','customRatioWidth','customRatioHeight','customWidth','customHeight'])if(settings[k]!==undefined)generator[k]=settings[k];
    state().nodes.push(...chain.nodes);state().connections.push(...chain.connections);d.generationMap[key]={promptId:chain.promptId,generatorId:chain.generatorId,outputId:chain.outputId,...(options.creationOnly?{promptFormat:'image-v1'}:{})};if(options.creationOnly)completeRowChain(id,r,d.generationMap[key],result);result.generatorIds.push(chain.generatorId);result.createdIds.push(...chain.nodes.map(n=>n.id));result.nodeIds.push(...chain.nodes.map(n=>n.id));
   });table.shotTableData=d;adapter.select(result.generatorIds);if(!options.deferSave)save();return result;
  }
  function completeRowChain(tableId,row,map,result){
   const p=node(map.promptId),g=node(map.generatorId),image=m.rowPrompt(row);
   if(map.promptId!==map.generatorId&&p&&g&&!map.promptProcessorId){
    const text=map.promptFormat==='image-motion-v1'&&p.text===legacyPrompt(row)?image:p.text;
    const draft=g.type==='smart-image'?g.promptDraftText:g.viewAdjustPrompt;
    const busy=[p,g].some(n=>n.running||n.pending||n.pendingTasks?.length||n._pending?.length||n._directPending?.length||n.submissionUnknown);
    const shared=state().connections.some(c=>c.from===p.id&&c.to!==g.id||c.to===p.id&&c.from!==tableId)||state().nodes.some(n=>Object.values(n.shotTableData?.generationMap||{}).some(v=>v.generatorId!==g.id&&(v.promptId===p.id||v.video?.promptId===p.id)));
    if(typeof text==='string'&&!busy&&!shared&&!p.llmEnabled&&!p.promptSplitEnabled&&(!draft||draft===text||draft===image)){
     const oldId=p.id;map.promptId=g.id;map.promptFormat='image-v1';setImageText(map,g,text);g.shotTableOrigin={...g.shotTableOrigin,stage:'image'};
     for(let i=state().connections.length-1;i>=0;i--)if(state().connections[i].from===oldId||state().connections[i].to===oldId)state().connections.splice(i,1);
     state().nodes.splice(state().nodes.findIndex(n=>n.id===oldId),1);
    }else result.warnings.push(`镜头 ${row.index} 的旧提示词节点仍有其他连接、独立编辑或任务，已保留，请核对后再合并`);
   }
   if(!state().connections.some(c=>c.from===tableId&&c.to===map.promptId))state().connections.push({id:adapter.uid('c'),from:tableId,to:map.promptId,kind:'story'});
  }
  function checkVideoChains(table,rows){
   const d=table.shotTableData;
   return rows.map(row=>{
    const map=d.generationMap[`${d.source.fingerprint||d.source.sourceUrl}:${row.id}`];
    if(!map||!node(map.outputId))return {row,map,reuse:false};
    const v=map.video,ids=v?[...new Set([v.promptId,v.generatorId,v.outputId].filter(Boolean))]:[],present=ids.filter(id=>node(id));
    if(present.length&&(present.length!==ids.length||(v.promptId!==v.generatorId&&!state().connections.some(c=>c.from===v.promptId&&c.to===v.generatorId))||!state().connections.some(c=>c.from===map.outputId&&c.to===v.generatorId)||(v.outputId!==v.generatorId&&!state().connections.some(c=>c.from===v.generatorId&&c.to===v.outputId))))throw new Error(`镜头 ${row.index} 的视频链已部分删除或断开，请恢复后再创建`);
    return {row,map,reuse:present.length>0};
   });
  }
  function createVideoRows(id,selectedIds,options={}){
   assertWrite();const table=node(id);if(!table?.shotTableData)throw new Error('镜头表已删除');
   const d=m.normalizeTable(table.shotTableData),rows=d.rows.filter(r=>selectedIds.includes(r.id));
   if(d.task.status==='running')throw new Error('镜头仍在分析，请结束后创建节点');if(!rows.length)throw new Error('请先选择镜头');
   if(!adapter.createVideoChain)throw new Error('当前画布不支持视频节点');
   const plans=checkVideoChains({...table,shotTableData:d},rows);
   if(plans.some(p=>!p.map||!node(p.map.outputId)))throw new Error('请先创建画面节点');
   let settings=adapter.defaultVideoSettings?.()||{};if(!settings.videoProvider||!settings.videoModel||!adapter.validateVideoSettings?.(settings))settings={};
   const result={generatorIds:[],createdIds:[],reusedIds:[],nodeIds:[],warnings:[]};if(!options.deferUndo)adapter.pushUndo();
   for(const {row,map,reuse} of plans){
    let v=map.video;
    if(!reuse){
     const base=node(map.outputId),chain=adapter.createVideoChain({row,promptText:m.videoPrompt(row),table,id,settings,x:base.x+(adapter.nodeWidth?.(base)||base.w||360)+96,y:Math.max(base.y,table.y+d.rows.indexOf(row)*(adapter.rowSpacing||430)),uid:adapter.uid,imageNodeId:map.outputId});
     state().nodes.push(...chain.nodes);state().connections.push(...chain.connections);v=map.video={promptId:chain.promptId,generatorId:chain.generatorId,outputId:chain.outputId,promptFormat:'video-v1'};
     result.createdIds.push(...chain.nodes.map(n=>n.id));
    }else result.reusedIds.push(v.generatorId);
    const g=node(v.generatorId);if(reuse&&v.promptFormat==='image-motion-v1'&&videoText(v,g)===legacyPrompt(row)&&![g,node(v.outputId)].some(n=>n&&(n.running||n.pending||n.pendingTasks?.length||n._pending?.length||n._directPending?.length||n.submissionUnknown))){setVideoText(v,g,m.videoPrompt(row));v.promptFormat='video-v1';}
    if(v.promptId!==v.generatorId&&!state().connections.some(c=>c.from===id&&c.to===v.promptId))state().connections.push({id:adapter.uid('c'),from:id,to:v.promptId,kind:'story'});
    result.generatorIds.push(v.generatorId);result.nodeIds.push(...new Set([v.promptId,v.generatorId,v.outputId]));
   }
   table.shotTableData=d;adapter.select(result.generatorIds);adapter.render();return result;
  }
  async function organizeRows(id,selectedIds){
   assertWrite();const table=node(id);if(!table?.shotTableData)throw new Error('镜头表已删除');
   const d=table.shotTableData,rows=d.rows.filter(r=>selectedIds.includes(r.id));if(!rows.length)throw new Error('请先选择镜头');
   if(d.task.status==='running')throw new Error('镜头仍在分析，请结束后整理');
   const snapshot=JSON.stringify(d),ctx=context(d.source,id,{allowDetached:true});
   const gather=()=>rows.map(row=>{
    const v=table.shotTableData.generationMap[`${d.source.fingerprint||d.source.sourceUrl}:${row.id}`]?.video,g=node(v?.generatorId),out=node(v?.outputId);
    if(!g||!out)throw new Error(`镜头 ${row.index} 请先创建并运行视频节点`);
    if([g,out].some(n=>n.running||n.pending||n.pendingTasks?.length||n._pending?.length||n._directPending?.length||n.submissionUnknown||n._pending?.some(p=>!p.failed)))throw new Error(`镜头 ${row.index} 仍有未完成任务，请结束后整理`);
    const media=adapter.videoMedia?.(out)?.filter(m=>m.kind==='video'&&m.url).at(-1);
    if(!media)throw new Error(`镜头 ${row.index} 还没有视频结果，请先运行`);
    return {...media,name:`镜头 ${row.index} · ${media.name||'视频'}`,rowId:row.id,shotIndex:row.index};
   });
   const media=gather(),identity=JSON.stringify(media),prepared=adapter.prepareShotMedia?await adapter.prepareShotMedia(media):media;
   if(!isCurrent(ctx)||JSON.stringify(table.shotTableData)!==snapshot||JSON.stringify(gather())!==identity)throw new Error('画布、镜头或视频结果已变化，请重新整理');
   assertWrite();adapter.pushUndo();const collection=adapter.addShotCollection({table,media:prepared,existing:node(d.collectionNodeId)});
   table.shotTableData.collectionNodeId=collection.id;adapter.select([collection.id]);adapter.render();
   return {nodeIds:[collection.id],generatorIds:[],createdIds:[],reusedIds:[],notice:adapter.collectionNotice||'已整理所选镜头'};
  }
  function collectUrls(n){const d=n?.shotTableData;return d?[...new Set([d.source.sourceUrl,...d.rows.map(r=>r.keyframeUrl)].filter(v=>typeof v==='string'&&v.startsWith('/')))]:[];}
  return {begin,context,isCurrent,landFrames,createBlankTable,ensureTable,editTable,applyTask,materializeRows,createRows,createVideoRows,organizeRows,focus:ids=>adapter.focus?.(ids),node,readonly,scale:()=>state().scale||1,runGenerators:ids=>adapter.runGenerators(ids),collectUrls};
 }
 return {create};
});
