(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./canvas-video-deconstruction-model.js'):root.CanvasVideoDeconstructionModel);if(typeof module==='object'&&module.exports)module.exports=api;else root.CanvasVideoDeconstructionUI=api;})(typeof window!=='undefined'?window:globalThis,function(m){
 'use strict';
 const endpoint='/api/canvas-video-deconstruction',active=new Map();let panel=null,current=null;const creating=new WeakMap();
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const safeUrl=v=>typeof v==='string'&&/^(\/assets\/|\/output\/|\/api\/storage-files\/|https?:\/\/)/.test(v)?v:'';
 const localBackendMessage='旧分析任务尚未完成确认，请在设置中重新选择平台和模型，再点击分析。';
 const icon=n=>`<i data-lucide="${n}"></i>`;
 const button=(action,label,disabled=false,extra='')=>`<button type="button" data-vd-action="${action}" ${disabled?'disabled':''} ${extra}>${label}</button>`;
 function cutView(cuts,threshold,selected){return m.filterCuts(cuts,threshold).map(c=>({...c,selected:selected.has(c.index)}));}
 function tableHtml(d,readonly=false){const ui=typeof module==='object'&&module.exports?require('./canvas-storyboard-workbench.js'):window.CanvasStoryboardWorkbench;return ui.grid(d,readonly,d.analysisSettings?.creationScope||'checked',false);}
 async function request(path,body,signal){const res=await fetch(endpoint+path,body===undefined?{signal}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});const value=await res.json().catch(()=>({}));if(!res.ok)throw new Error(res.status===404&&path==='/storyboard/analyze'?'后台尚未加载智能分镜分析接口，请保存画布并重启 Nadou 主程序后重试。':value.detail||`请求失败（${res.status}）`);return value;}
 function refreshIcons(){window.lucide?.createIcons?.({nodes:[panel]});}
 function ensurePanel(){
  if(panel)return;
  panel=document.createElement('div');panel.className='depth-capture-modal video-deconstruction-modal';
  panel.innerHTML=`<section class="depth-capture-panel" role="dialog" aria-modal="true" aria-label="分镜表与视频拆解"><header class="depth-capture-head"><div><strong data-vd-title></strong><span data-vd-subtitle></span></div>${button('close',icon('x'),false,'aria-label="关闭"')}</header><div class="video-deconstruction-status" role="status"></div><div class="depth-capture-body video-deconstruction-body"></div><footer class="video-deconstruction-actions"></footer></section>`;
  document.body.append(panel);
  panel.addEventListener('click',event=>{
   if(event.target===panel){closeAll();return;}
   const target=event.target.closest('[data-vd-action]');if(!target||!current)return;
   event.stopPropagation();const session=current;
   Promise.resolve(action(target.dataset.vdAction,target,session)).catch(error=>{if(current===session)message(error.message,true);if(['create-rows','organize-rows'].includes(target.dataset.vdAction))session.host.onError?.(error);});
  });
  panel.addEventListener('input',event=>{if(event.target.matches('[data-vd-threshold]')){current.threshold=Number(event.target.value);current.selected=new Set(cutView(current.detected.cuts,current.threshold,new Set()).map(c=>c.index));renderCuts();}});
  for(const name of ['mousedown','pointerdown','keydown','wheel'])panel.addEventListener(name,event=>{event.stopPropagation();if(name==='keydown'&&event.key==='Escape')closeAll();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&current)closeAll();});window.addEventListener('resize',()=>{if(current?.type==='table'&&!panel.querySelector('textarea:focus,input:focus'))renderTable();});
 }
 function message(text,error=false){if(!panel)return;const el=panel.querySelector('.video-deconstruction-status');el.textContent=text||'';el.classList.toggle('video-deconstruction-error',error);}
 function show(type,host,props){ensurePanel();if(!closeAll())throw new Error('请先保存当前编辑或停止抽图');current={type,host,...props};if(type==='table')current.ctx=host.context(props.source,props.tableId,{allowDetached:true});panel.classList.add('open');panel.querySelector('[data-vd-title]').textContent=type==='cuts'?'按镜头拆':'智能分镜表';panel.querySelector('[data-vd-subtitle]').textContent=props.source?.title||host.node(props.tableId)?.name||'';return current;}
 function closeAll(force=false){if(!current)return true;if(current.type==='cuts'&&current.submitting&&!force){message('正在抽图，请使用「取消抽图」停止后续处理。');return false;}if(!force&&current.type==='table'){try{saveEditorDraft(current);if(current.draft&&current.draft.revision!==current.host.node(current.tableId)?.shotTableData.revision&&!window.confirm('放弃尚未确定的分镜编辑？'))return false;}catch(e){message(e.message,true);return false;}}if(current.type==='cuts'){current.stopped=true;if(current.task&&!current.finished)request(`/tasks/${current.task.id}/cancel`,{}).catch(()=>{});}panel?.classList.remove('open');panel?.querySelector('video')?.pause();current=null;return true;}
 function contextPayload(ctx,operationId){const d=ctx.tableNode?.shotTableData;return {canvas_id:ctx.canvasId,node_id:ctx.source.nodeId,result_id:ctx.source.resultId,source_url:ctx.source.sourceUrl,operation_id:operationId,table_id:ctx.tableId,table_revision:d?.revision||0};}
 async function prepare(ctx,mode,options,host){if(!host.isCurrent(ctx))throw new Error('画布或原视频已变化，请重新打开');if(host.saveNow&&!await host.saveNow())throw new Error('画布尚未保存成功，请保存后重试');if(!host.isCurrent(ctx))throw new Error('画布已切换');return request('/prepare',{context:contextPayload(ctx,m.uid()),mode,options});}
 async function openCuts(source,host){
  if(host.readonly())throw new Error('只读画布不能拆解');
  const s=show('cuts',host,{source,ctx:host.context(source),selected:new Set()});message('正在本地检测切点，不调用模型…');panel.querySelector('.video-deconstruction-body').innerHTML='<p class="video-deconstruction-note">检测后可调整灵敏度，再选择图片加入画布。</p>';panel.querySelector('footer').innerHTML=button('close','关闭');
  try{s.task=await prepare(s.ctx,'detect',{},host);if(current!==s){request(`/tasks/${s.task.id}/cancel`,{}).catch(()=>{});return;}await pollCuts(s);}catch(e){if(current===s){message(e.message,true);panel.querySelector('footer').innerHTML=button('detect-again','重新检测')+button('close','关闭');}}
 }
 async function pollCuts(s){
  while(!s.stopped&&current===s&&s.host.isCurrent(s.ctx)){
   const task=await request(`/tasks/${s.task.id}`);s.task=task;
   if(current!==s||!s.host.isCurrent(s.ctx))return;
   message(`${task.phase||'处理中'}${task.progressDetail?' · '+task.progressDetail:''}${task.error?' · '+task.error:''}`,!!task.error);
   if(task.status==='ready'||task.status==='cancelled'&&s.submitting&&task.extractionSettled){
    s.finished=true;
    if(s.submitting){s.submitting=false;s.host.landFrames(s.ctx,{...task,operationId:task.context.operation_id});if(task.status==='ready'&&!task.failures?.length){closeAll();return;}renderCuts();message(`已加入 ${task.frames?.length||0} 张图片。${task.failures?.map(x=>x.error).join('；')||task.error||''}`,true);}
    else {s.detected=task.detected;s.detectionTaskId=task.id;s.threshold=m.defaultSensitivity(s.detected.cuts);s.selected=new Set(cutView(s.detected.cuts,s.threshold,new Set()).map(c=>c.index));renderCuts();}
    return;
   }
   if(['failed','interrupted','cancelled'].includes(task.status)&&!(s.submitting&&task.status==='cancelled')){s.submitting=false;message(task.error||'任务中断',true);panel.querySelector('footer').innerHTML=button('detect-again','重新检测')+button('close','关闭');return;}
   await new Promise(resolve=>setTimeout(resolve,700));
  }
 }
 function renderCuts(){const s=current;if(s?.type!=='cuts'||!s.detected)return;const d=s.detected,cuts=cutView(d.cuts,s.threshold,s.selected),coverage=d.coverage;
  panel.querySelector('.video-deconstruction-body').innerHTML=`<video class="video-deconstruction-preview" src="${esc(safeUrl(s.source.sourceUrl))}" controls playsinline preload="metadata"></video><div class="video-deconstruction-toolbar">${d.cuts.length?`<label>灵敏度 ${s.threshold.toFixed(2)}<input data-vd-threshold type="range" min="0.1" max="0.7" step="0.05" value="${s.threshold}"></label>${button('select-cuts','全选')}${button('deselect-cuts','全不选')}`:`<p>一镜到底，均匀抽取 ${m.evenFrameSeconds(d.durationSeconds).length} 张图片。</p>`}</div>${coverage?.capped?`<p class="video-deconstruction-note">检测 ${coverage.detectedCuts} 个切点，保留 ${coverage.keptCuts} 个，压缩阈值 ${Number(coverage.appliedThreshold||0).toFixed(2)}，末切点覆盖至 ${m.formatTime(coverage.coveredSeconds||0)}。切点已简化；镜头表仍含完整视频首尾。</p>`:''}${d.cuts.length&&!cuts.length?`<p>当前灵敏度没有可见切点。${button('relax-cuts',`放宽到 ${d.cuts.length} 个`)}</p>`:''}<div class="video-deconstruction-cuts">${cuts.map(c=>{const col=c.index%(d.sheetColumns||8),row=Math.floor(c.index/(d.sheetColumns||8));return `<button type="button" data-vd-action="cut" data-index="${c.index}" aria-pressed="${c.selected}" class="${c.selected?'selected':''}">${safeUrl(d.sheetUrl)?`<div class="video-deconstruction-cut-image" style="aspect-ratio:${Number(d.displayWidth||d.width)||16}/${Number(d.displayHeight||d.height)||9};background-image:url(&quot;${esc(safeUrl(d.sheetUrl))}&quot;);background-size:${(d.sheetColumns||8)*100}% ${(d.sheetRows||1)*100}%;background-position:${(d.sheetColumns||8)>1?col/((d.sheetColumns||8)-1)*100:0}% ${(d.sheetRows||1)>1?row/(d.sheetRows-1)*100:0}%"></div>`:'<span>按时间抽图</span>'}<span>${m.formatTime(c.seconds)} · ${c.selected?'已选':'未选'}</span></button>`;}).join('')}</div>`;
  const count=d.cuts.length?cuts.filter(c=>c.selected).length:m.evenFrameSeconds(d.durationSeconds).length;
  panel.querySelector('footer').innerHTML=`<span>已选 ${count} 张</span>${button('close','关闭',s.submitting)}${button('land',s.submitting?'正在抽图':'加入画布',!count||s.submitting,'class="primary"')}${s.submitting?button('cancel-cuts','取消抽图'):''}`;refreshIcons();
 }
 async function openTable(tableOrSource,host){
  const direct=typeof tableOrSource!=='string',node=direct?host.ensureTable(tableOrSource):host.node(tableOrSource);
  if(!node)throw new Error('镜头表已不存在');
  const d=node.shotTableData;
  if(direct){if(host.readonly())throw new Error('只读画布不能拆解');return node;}
  const s=show('table',host,{tableId:node.id,source:d.source,editRow:null});message('');renderTable();
 }
 const planning=new WeakMap();
 async function analyzeStoryboard(s){
  const {host,tableId}=s,table=host.node(tableId),d=table?.shotTableData;if(!d)throw new Error('分镜表已删除');if(host.readonly()||d.task.status==='running')return;
  const fields=m.enabledFields(d).map(c=>c.id),settings=d.analysisSettings||{};
  if(!fields.length)throw new Error('请在设置中勾选至少一个分析字段');
  if(!settings.providerId||!settings.model)throw new Error('请在设置中选择分析平台和模型');
  if(d.rows.length&&!window.confirm('重新分析将重新规划镜头数量并更新启用字段。未勾选字段按镜头顺序保留，已创建节点保留。继续？'))return;
  const original=m.clone(d),source=host.analysisSource?.(tableId)||d.source,ctx=host.context(source,tableId,{allowDetached:true});
    const inputs=host.inputs?.(tableId)||[];
    if(inputs.filter(v=>v.kind==='video').length>1)throw new Error('当前每次分析支持一个上游视频，请分开分析');
  let entries=planning.get(host);if(!entries){entries=new Map();planning.set(host,entries);}const controller=new AbortController();entries.set(tableId,controller);
  host.editTable(tableId,raw=>({...raw,task:{status:'running',transient:true,phase:'正在准备分析'}}));
  const options={columns:d.columns,enabledFields:fields,providerId:settings.providerId,model:settings.model,skillId:settings.skillId||''};
  try{
   if(host.saveNow&&!await host.saveNow())throw new Error('画布尚未保存成功，请保存后重试');
   if(!host.isCurrent(ctx)||controller.signal.aborted)return;
     if(!['text','manual'].includes(source.kind)&&source.sourceUrl&&(!inputs.length||inputs.some(v=>v.kind==='video'))){
    const task=await request('/prepare',{context:contextPayload(ctx,m.uid()),mode:'table',options},controller.signal);
    if(!host.isCurrent(ctx)||controller.signal.aborted){request(`/tasks/${task.id}/cancel`,{}).catch(()=>{});return;}
    host.applyTask(ctx,task);watchTable(tableId,host,ctx,task);return;
   }
   const result=await request('/storyboard/analyze',{context:contextPayload(ctx,m.uid()),options},controller.signal);
   if(!host.isCurrent(ctx)||controller.signal.aborted)return;
   const latest=host.node(tableId).shotTableData;
   if(latest.revision!==original.revision)throw new Error('分析期间分镜表已修改，已保留当前内容，请重新分析');
   host.editTable(tableId,raw=>({...raw,revision:raw.revision+1,rows:result.rows.map((r,i)=>{
    const old=original.rows[i];if(!old)return r;const next={...r,id:old.id,cells:{...old.cells,...r.cells}};
    for(const key of ['imagePrompt','motionPrompt'])if(!fields.includes(key))next[key]=old[key]||'';return next;
   }),selectedRowIds:[],task:{status:'ready',phase:'分镜规划完成'}}));
  }catch(error){if(host.isCurrent(ctx)&&!controller.signal.aborted)host.editTable(tableId,raw=>({...raw,task:{status:'failed',error:error.message}}));if(!controller.signal.aborted)throw error;}
  finally{if(entries.get(tableId)===controller)entries.delete(tableId);}
 }
 function watchTable(id,host,ctx,initial){if(active.has(id))return;const watch={host,ctx,task:initial,stopped:false};active.set(id,watch);
  const tick=async()=>{if(watch.stopped||!host.isCurrent(ctx)){active.delete(id);return;}try{let task=await request(`/tasks/${watch.task.id}`);if(watch.stopped||!host.isCurrent(ctx))return;if(task.status==='awaiting-confirmation')task={...task,status:'interrupted',phase:'本地分析未启动',error:localBackendMessage};watch.task=task;host.applyTask(ctx,task);if(current?.tableId===id&&current.host===host&&!panel.querySelector('[data-vd-editor] textarea:focus'))renderTable();if(['ready','failed','interrupted','cancelled','awaiting-confirmation'].includes(task.status)){active.delete(id);return;}}
   catch(e){if(!watch.stopped&&host.isCurrent(ctx)){message('查询任务失败：'+e.message,true);host.node(id).shotTableData.task={...host.node(id).shotTableData.task,status:'interrupted',error:e.message};host.saveNow?.();active.delete(id);if(current?.tableId===id)renderTable();return;}}
   if(!watch.stopped)watch.timer=setTimeout(tick,900);
  };tick();
 }
 function saveEditorDraft(s){
  if(s?.type!=='table'||s.host.readonly()||!s.host.isCurrent(s.ctx))return;
  const editor=panel?.querySelector('[data-vd-editor]'),d=s.draft||s.host.node(s.tableId)?.shotTableData;
  if(!editor||!d||d.task.status==='running')return;const row=d.rows.find(r=>r.id===editor.dataset.row);if(!row)return;
  let next=m.clone(d);for(const input of editor.querySelectorAll('[data-vd-edit]')){const key=input.dataset.vdEdit,previous=['imagePrompt','motionPrompt'].includes(key)?row[key]:row.cells[key]||'';if(previous!==input.value)next=m.editCell(next,row.id,key,input.value);}
  const duration=editor.querySelector('[data-vd-duration]');if(duration&&Number(duration.value)!==row.durationSeconds)next=m.editManualRow(next,'duration',row.id,Number(duration.value));
  if(next.revision!==d.revision)s.draft=next;
 }
 function editorHtml(d,rowId){const r=d.rows.find(r=>r.id===rowId)||d.rows[0];if(!r)return '';return `<section class="video-deconstruction-editor" data-vd-editor data-row="${esc(r.id)}"><div class="video-deconstruction-toolbar"><strong>镜头 ${r.index}</strong><span>确定后同步到画布</span><label>时长（秒）<input data-vd-duration type="number" min="0.1" step="0.1" value="${r.durationSeconds}" ${current?.host.readonly()||d.task.status==='running'?'readonly':''}></label></div>${m.enabledFields(d).map(c=>`<label>${esc(c.label)}<textarea data-vd-edit="${esc(c.id)}" ${current?.host.readonly()||d.task.status==='running'?'readonly':''}>${esc(['imagePrompt','motionPrompt'].includes(c.id)?r[c.id]||'':r.cells[c.id]||'')}</textarea></label>`).join('')}</section>`;}
 function renderTable(){const s=current;if(s?.type!=='table')return;saveEditorDraft(s);const n=s.host.node(s.tableId);if(!n){closeAll(true);return;}const d=s.draft||n.shotTableData;message('');panel.querySelector('.video-deconstruction-body').innerHTML=editorHtml(d,s.editRow);panel.querySelector('footer').innerHTML=button('cancel-edit','取消')+button('confirm-edit','确定',s.host.readonly()||d.task.status==='running','class="primary"');refreshIcons();}
 async function action(a,buttonEl,s){const host=s.host;if(a==='cancel-edit'){closeAll(true);return;}if(a==='confirm-edit'){saveEditorDraft(s);if(s.baseRevision!==undefined&&host.node(s.tableId).shotTableData.revision!==s.baseRevision)throw new Error('分镜表已变化，请取消后重新打开编辑');if(s.draft)host.editTable(s.tableId,s.draft);closeAll(true);return;}if(a!=='close'&&s.type==='table')saveEditorDraft(s);const d=s.tableId&&host.node(s.tableId)?.shotTableData;
  if(a==='close'){closeAll();return;}
  if(a==='detect-again'){return openCuts(s.source,host);}
  if(a==='cut'){const i=Number(buttonEl.dataset.index);s.selected.has(i)?s.selected.delete(i):s.selected.add(i);renderCuts();return;}
  if(a==='select-cuts'||a==='deselect-cuts'){s.selected=a==='select-cuts'?new Set(cutView(s.detected.cuts,s.threshold,new Set()).map(c=>c.index)):new Set();renderCuts();return;}
  if(a==='relax-cuts'){s.threshold=.1;s.selected=new Set(cutView(s.detected.cuts,.1,new Set()).map(c=>c.index));renderCuts();return;}
  if(a==='land'){s.submitting=true;s.finished=false;renderCuts();try{s.task=await prepare(s.ctx,'frames',{detectionTaskId:s.detectionTaskId,indices:cutView(s.detected.cuts,s.threshold,s.selected).filter(c=>c.selected).map(c=>c.index)},host);await pollCuts(s);}catch(e){s.submitting=false;s.finished=true;renderCuts();throw e;}return;}
  if(a==='cancel-cuts'){await request(`/tasks/${s.task.id}/cancel`,{});return;}
  if(a==='create-rows')return createSelectedRows(s,buttonEl);
  if(!d)return;
  if(a==='cancel-table'){const controller=planning.get(host)?.get(s.tableId);if(controller){controller.abort();host.editTable(s.tableId,raw=>({...raw,task:{status:'cancelled',phase:'已停止接收分析结果',error:'已发出的模型请求可能仍计费'}}));return;}if(d.task.taskId){const ctx=host.context(s.source,s.tableId,{allowDetached:true});const result=await request(`/tasks/${d.task.taskId}/cancel`,{});host.applyTask(ctx,result);renderTable();}return;}

 }
 async function createSelectedRows(s,buttonEl){
  const host=s.host;let pending=creating.get(host);if(!pending){pending=new Set();creating.set(host,pending);}if(pending.has(s.tableId))return;
  const table=host.node(s.tableId);if(!table)throw new Error('镜头表已删除');
  if(!table.shotTableData.rows.length)throw new Error('分镜表为空，请先新增镜头并填写画面或生图提示词，再创建节点。');
  if(!(s.rowIds||table.shotTableData.selectedRowIds).length)throw new Error('请先勾选要创建的镜头，再点击「创建所选镜头节点」。');
  const ctx=host.context(table.shotTableData.source,s.tableId,{allowDetached:true});if(!host.isCurrent(ctx))throw new Error('画布或镜头表已变化，请重新打开');
  pending.add(s.tableId);buttonEl.disabled=true;
  try{
   const result=host.createRows(s.tableId,[...(s.rowIds||table.shotTableData.selectedRowIds)]);
   if(host.saveNow&&!await host.saveNow())throw new Error('镜头节点已建在当前画布，但尚未保存成功。请重试保存或再次点击创建，已有节点会复用。');
   if(!host.isCurrent(ctx))throw new Error('画布或镜头表已变化，请返回原画布核对镜头节点');
   if(current===s&&!closeAll())throw new Error('请先保存分镜编辑，再查看已创建的节点');
   host.focus?.(result.nodeIds);
   host.onNotice?.(result.notice||`已创建 ${result.createdIds.length?result.generatorIds.length-result.reusedIds.length:0} 镜，复用 ${result.reusedIds.length} 镜。${result.warnings?.length?result.warnings.join('；'):'已连接分镜表 → 图片 → 视频。请先选择图片模型生成画面，再选择视频模型运行；两类提示词分别保留在对应节点。'}`);
   return result;
  }finally{pending.delete(s.tableId);buttonEl.disabled=false;}
 }
 function mount(element,node,host){const ui=typeof module==='object'&&module.exports?require('./canvas-storyboard-workbench.js'):window.CanvasStoryboardWorkbench;ui.mount(element,node,host,{create:createSelectedRows,analyze:analyzeStoryboard,cancel:s=>action('cancel-table',null,s),edit:async(id,rowId,host)=>{await openTable(id,host);current.editRow=rowId;current.draft=m.clone(host.node(id).shotTableData);current.baseRevision=current.draft.revision;renderTable();}});}
 function updateScale(host){if(typeof document==='undefined')return;document.querySelectorAll('.shot-table-node,.smart-shot-table-node').forEach(el=>el.dataset.shotMode='full');}
 function reconcile(host,visibleIds){const visible=new Set(visibleIds);for(const [id,w] of active)if(w.host!==host||!visible.has(id)||!host.isCurrent(w.ctx)){w.stopped=true;clearTimeout(w.timer);active.delete(id);}if(current&&(!host.isCurrent(current.ctx||host.context(current.source,current.tableId))||current.tableId&&!visible.has(current.tableId)))closeAll(true);for(const id of visible){const n=host.node(id),d=n.shotTableData;if(d.task.status==='running'&&d.task.transient&&!planning.get(host)?.has(id)&&!active.has(id)){d.task={status:'interrupted',error:'页面已刷新，请重新点击分析；原表内容已保留。'};host.saveNow?.();}if((d.task.status==='running'||d.task.status==='idle'&&!d.task.quote)&&d.task.taskId&&!active.has(id)){watchTable(id,host,host.context(d.source,id),{id:d.task.taskId});}}}
 return {openCuts,openTable,mount,reconcile,closeAll,updateScale,cutView,tableHtml,editorHtml,analyzeStoryboard};
});
