(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./canvas-video-deconstruction-model.js'):root.CanvasVideoDeconstructionModel);if(typeof module==='object'&&module.exports)module.exports=api;else root.CanvasVideoDeconstructionUI=api;})(typeof window!=='undefined'?window:globalThis,function(m){
 'use strict';
 const endpoint='/api/canvas-video-deconstruction',active=new Map();let panel=null,current=null;const creating=new WeakMap();
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const safeUrl=v=>typeof v==='string'&&/^(\/assets\/|\/output\/|\/api\/storage-files\/|https?:\/\/)/.test(v)?v:'';
 const statusLabels={idle:'等待确认',running:'处理中',ready:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
 const localBackendMessage='当前后台尚未加载本地分析功能。请保存画布，关闭 Nadou 主程序，重新运行 run.bat，然后点击「本地分析」重试。仅刷新浏览器不会更新后台。';
 function mobileColumnsHtml(d,disabled=false){return `<div class="video-deconstruction-mobile-columns">${d.columns.filter(c=>c.kind==='custom').map(c=>button('column',esc(c.label)+' ⋯',disabled,`data-column="${esc(c.id)}" title="改名或删除自定义列"`)).join('')}</div>`;}
 const icon=n=>`<i data-lucide="${n}"></i>`;
 const button=(action,label,disabled=false,extra='')=>`<button type="button" data-vd-action="${action}" ${disabled?'disabled':''} ${extra}>${label}</button>`;
 function cutView(cuts,threshold,selected){return m.filterCuts(cuts,threshold).map(c=>({...c,selected:selected.has(c.index)}));}
 function tableHtml(d,readonly=false){
  return `<table class="shot-table-grid"><thead><tr><th>选行</th><th>镜号 / 时间</th><th>${d.source.kind==='manual'?'手工分镜':d.source.kind==='text'?'文本分镜':'只读原片'}</th>${d.columns.map(c=>`<th>${esc(c.label)}${c.kind==='custom'?button('column','⋯',readonly||d.task.status==='running',`data-column="${esc(c.id)}" title="改名或删除自定义列"`):''}</th>`).join('')}<th>分镜图片提示词</th><th>分镜视频提示词</th><th>状态</th></tr></thead><tbody>${d.rows.map(r=>`<tr data-row="${esc(r.id)}"><td><input type="checkbox" data-vd-select="${esc(r.id)}" ${d.selectedRowIds.includes(r.id)?'checked':''} ${readonly?'disabled':''} aria-label="选择镜头 ${r.index}"></td><td><strong>镜头 ${r.index}</strong><span>${r.startSeconds.toFixed(1)}–${r.endSeconds.toFixed(1)}s · ${r.durationSeconds.toFixed(1)}s</span>${button('edit-row','编辑',false,`data-row="${esc(r.id)}"`)}</td><td>${safeUrl(r.keyframeUrl)?`<img src="${esc(safeUrl(r.keyframeUrl))}" alt="镜头 ${r.index} 原片对照" loading="lazy">`:d.source.kind==='manual'?'手工编排':d.source.kind==='text'?'来自故事文本':'待抽帧'}</td>${d.columns.map(c=>`<td data-vd-cell="${esc(c.id)}" data-row="${esc(r.id)}" title="双击编辑">${esc(r.cells[c.id]||'')}${c.id==='dialogue'&&r.carriedOver?'<span class="video-deconstruction-note">承接上镜</span>':''}</td>`).join('')}<td data-vd-cell="imagePrompt" data-row="${esc(r.id)}" title="双击编辑">${esc(r.imagePrompt||r.cells.visual||'')}</td><td data-vd-cell="motionPrompt" data-row="${esc(r.id)}" title="双击编辑">${esc(r.motionPrompt||r.cells.motion||'')}</td><td>${r.visionFailed?`<span title="${esc(r.failureReason)}">未读出</span>${button('retry-shot','重试本镜',readonly||d.task.status==='running',`data-row="${esc(r.id)}"`)}`:d.source.kind==='manual'?'草稿':d.source.kind==='text'?'已编排':'已读出'}</td></tr>`).join('')}</tbody></table>`;
 }
 async function request(path,body){const res=await fetch(endpoint+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await res.json().catch(()=>({}));if(!res.ok)throw new Error(value.detail||`请求失败（${res.status}）`);return value;}
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
   Promise.resolve(action(target.dataset.vdAction,target,session)).catch(error=>{if(current===session)message(error.message,true);});
  });
  panel.addEventListener('change',event=>{if(!current)return;event.stopPropagation();
   const row=event.target.dataset.vdSelect;if(row){const host=current.host,id=current.tableId;if(host.readonly())return;try{saveEditorDraft(current);}catch(e){message(e.message,true);return;}host.editTable(id,d=>({...d,revision:d.revision+1,selectedRowIds:event.target.checked?[...d.selectedRowIds,row]:d.selectedRowIds.filter(x=>x!==row)}));renderTable();}
  });
  panel.addEventListener('input',event=>{if(event.target.matches('[data-vd-threshold]')){current.threshold=Number(event.target.value);current.selected=new Set(cutView(current.detected.cuts,current.threshold,new Set()).map(c=>c.index));renderCuts();}});
  panel.addEventListener('contextmenu',event=>{const target=event.target.closest('[data-column]');if(target&&current?.type==='table'){event.preventDefault();event.stopPropagation();action('column',target,current).catch(e=>message(e.message,true));}});
  panel.addEventListener('dblclick',event=>{const target=event.target.closest('[data-vd-cell]');if(target&&current?.type==='table'){try{saveEditorDraft(current);}catch(e){message(e.message,true);return;}current.editRow=target.dataset.row;renderTable();panel.querySelector(`[data-vd-edit="${CSS.escape(target.dataset.vdCell)}"]`)?.focus();}});
  for(const name of ['mousedown','pointerdown','keydown','wheel'])panel.addEventListener(name,event=>{event.stopPropagation();if(name==='keydown'&&event.key==='Escape')closeAll();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&current)closeAll();});window.addEventListener('resize',()=>{if(current?.type==='table'&&!panel.querySelector('textarea:focus,input:focus'))renderTable();});
 }
 function message(text,error=false){if(!panel)return;const el=panel.querySelector('.video-deconstruction-status');el.textContent=text||'';el.classList.toggle('video-deconstruction-error',error);}
 function show(type,host,props){ensurePanel();if(!closeAll())throw new Error('请先保存当前编辑或停止抽图');current={type,host,...props};if(type==='table')current.ctx=host.context(props.source,props.tableId,{allowDetached:true});panel.classList.add('open');panel.querySelector('[data-vd-title]').textContent=type==='cuts'?'按镜头拆':'分镜表';panel.querySelector('[data-vd-subtitle]').textContent=props.source?.title||host.node(props.tableId)?.name||'';return current;}
 function closeAll(force=false){if(!current)return true;if(current.type==='cuts'&&current.submitting&&!force){message('正在抽图，请使用「取消抽图」停止后续处理。');return false;}if(!force&&current.type==='table'){try{saveEditorDraft(current);}catch(e){message(e.message,true);return false;}}if(current.type==='cuts'){current.stopped=true;if(current.task&&!current.finished)request(`/tasks/${current.task.id}/cancel`,{}).catch(()=>{});}panel?.classList.remove('open');panel?.querySelector('video')?.pause();current=null;return true;}
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
  if(direct){
   if(host.readonly())throw new Error('只读画布不能拆解');
   if(d.task.status==='running'||d.rows.length)return;
   return startTable({host,tableId:node.id,source:d.source},'table');
  }
  const s=show('table',host,{tableId:node.id,source:d.source,editRow:null});message('');renderTable();
 }
 async function startTable(s,mode,rowId){
  if(s.source.kind==='manual')throw new Error('手工分镜表无需视频分析，请直接新增和编辑镜头。');
  if(s.source.kind==='text')throw new Error('文本分镜来自故事创作，不使用视频抽帧或转写；请让创作助手修改分镜。');
  if(!s.host.node(s.tableId))return;const d=s.host.node(s.tableId).shotTableData,prior=d.task.taskId;
  const starting=s.host.context(s.source,s.tableId);
  try{const capabilities=await request('/models');if(!s.host.isCurrent(starting))return;if(capabilities.localAnalysis!==true)throw new Error(localBackendMessage);}
  catch(error){if(s.host.isCurrent(starting))s.host.editTable(s.tableId,raw=>({...raw,task:{...raw.task,status:'failed',phase:'本地分析未启动',error:error.message}}));throw error;}
  s.host.editTable(s.tableId,raw=>({...raw,revision:raw.revision+1,task:{status:'running'},...(mode==='table'?{rows:[],selectedRowIds:[]}:{} )}));
  const previous=active.get(s.tableId);if(previous){previous.stopped=true;clearTimeout(previous.timer);active.delete(s.tableId);}const ctx=s.host.context(s.source,s.tableId);let task;
  try{task=await prepare(ctx,mode,{localAnalysis:true,columns:s.host.node(s.tableId).shotTableData.columns,priorTaskId:prior,rowIds:rowId?[rowId]:[]},s.host);if(!s.host.isCurrent(ctx))return;s.host.applyTask(ctx,task);watchTable(s.tableId,s.host,ctx,task);renderTable();}
  catch(e){if(s.host.isCurrent(ctx)){s.host.editTable(s.tableId,raw=>({...raw,task:{status:'failed',error:e.message}}));}throw e;}
 }
 function watchTable(id,host,ctx,initial){if(active.has(id))return;const watch={host,ctx,task:initial,stopped:false};active.set(id,watch);
  const tick=async()=>{if(watch.stopped||!host.isCurrent(ctx)){active.delete(id);return;}try{let task=await request(`/tasks/${watch.task.id}`);if(watch.stopped||!host.isCurrent(ctx))return;if(task.status==='awaiting-confirmation')task={...task,status:'interrupted',phase:'本地分析未启动',error:localBackendMessage};watch.task=task;host.applyTask(ctx,task);if(current?.tableId===id&&current.host===host&&!panel.querySelector('[data-vd-editor] textarea:focus'))renderTable();if(['ready','failed','interrupted','cancelled','awaiting-confirmation'].includes(task.status)){active.delete(id);return;}}
   catch(e){if(!watch.stopped&&host.isCurrent(ctx)){message('查询任务失败：'+e.message,true);host.node(id).shotTableData.task={...host.node(id).shotTableData.task,status:'interrupted',error:e.message};host.saveNow?.();active.delete(id);if(current?.tableId===id)renderTable();return;}}
   if(!watch.stopped)watch.timer=setTimeout(tick,900);
  };tick();
 }
 function saveEditorDraft(s){
  if(s?.type!=='table'||s.host.readonly()||!s.host.isCurrent(s.ctx))return;
  const editor=panel?.querySelector('[data-vd-editor]'),d=s.host.node(s.tableId)?.shotTableData;
  if(!editor||!d||d.task.status==='running')return;const row=d.rows.find(r=>r.id===editor.dataset.row);if(!row)return;
  let next=m.clone(d);for(const input of editor.querySelectorAll('[data-vd-edit]')){const key=input.dataset.vdEdit,previous=['imagePrompt','motionPrompt'].includes(key)?row[key]:row.cells[key]||'';if(previous!==input.value)next=m.editCell(next,row.id,key,input.value);}
  const duration=editor.querySelector('[data-vd-duration]');if(duration&&Number(duration.value)!==row.durationSeconds)next=m.editManualRow(next,'duration',row.id,Number(duration.value));
  if(next.revision!==d.revision)s.host.editTable(s.tableId,next);
 }
 function editorHtml(d,rowId){const r=d.rows.find(r=>r.id===rowId)||d.rows[0];if(!r)return '';const all=[...d.columns,{id:'imagePrompt',label:'分镜图片提示词'},{id:'motionPrompt',label:'分镜视频提示词'}];return `<section class="video-deconstruction-editor" data-vd-editor data-row="${esc(r.id)}"><div class="video-deconstruction-toolbar">${button('previous-row','上一镜') }<strong>镜头 ${r.index} / ${d.rows.length}</strong><label class="video-deconstruction-row-select"><input type="checkbox" data-vd-select="${esc(r.id)}" ${d.selectedRowIds.includes(r.id)?'checked':''} ${current?.host.readonly()?'disabled':''}>选择本镜</label>${button('next-row','下一镜')}${d.source.kind==='manual'?`${button('duplicate-row','复制本镜',current?.host.readonly())}${button('up-row','上移',current?.host.readonly()||r.index===1)}${button('down-row','下移',current?.host.readonly()||r.index===d.rows.length)}${button('delete-row','删除本镜',current?.host.readonly())}`:''}</div><div class="video-deconstruction-row-preview">${safeUrl(r.keyframeUrl)?`<img src="${esc(safeUrl(r.keyframeUrl))}" alt="原片对照">`:''}<span>${r.startSeconds.toFixed(1)}–${r.endSeconds.toFixed(1)} 秒 · 时长 ${r.durationSeconds.toFixed(1)} 秒${r.carriedOver?' · 承接上镜':''}</span>${d.source.kind==='manual'?`<label>时长（秒）<input data-vd-duration type="number" min="0.1" step="0.1" value="${r.durationSeconds}" ${current?.host.readonly()?'readonly':''}></label>`:''}</div>${all.map(c=>`<label>${esc(c.label)}<textarea data-vd-edit="${esc(c.id)}" ${current?.host.readonly()||d.task.status==='running'?'readonly':''}>${esc(['imagePrompt','motionPrompt'].includes(c.id)?r[c.id]:r.cells[c.id]||'')}</textarea></label>`).join('')}<div class="video-deconstruction-toolbar">${button('save-row','保存编辑',current?.host.readonly(),'class="primary"')}${button('retry-shot','重新分析本镜',current?.host.readonly()||d.task.status==='running'||['text','manual'].includes(d.source.kind),`data-row="${esc(r.id)}"`)}</div></section>`;}
 function renderTable(){const s=current;if(s?.type!=='table')return;try{saveEditorDraft(s);}catch(e){message(e.message,true);return;}const n=s.host.node(s.tableId);if(!n){closeAll(true);return;}const d=n.shotTableData,task=d.task,ro=s.host.readonly(),busy=task.status==='running';
  if(!s.editRow&&window.innerWidth<=600&&d.rows.length)s.editRow=d.rows[0].id;
  message(`${d.source.kind==='manual'?'手工编排':statusLabels[task.status]||task.status} ${task.phase||''}${task.progressDetail?' · '+task.progressDetail:''}${task.error?' · '+task.error:''}`,!!task.error);
  panel.querySelector('.video-deconstruction-body').innerHTML=`${task.coverage?.capped?`<p class="video-deconstruction-note">切点简化：${task.coverage.detectedCuts} → ${task.coverage.keptCuts}，镜头表含完整首尾。</p>`:''}${d.speech?`<p class="video-deconstruction-note">对白：${({ready:'转写完成','no-audio':'无音轨','no-speech':'无人声',failed:'转写失败',cancelled:'已取消'})[d.speech.status]||d.speech.status}${d.speech.error?' · '+esc(d.speech.error):''}${d.speech.status==='failed'?button('install-speech','修复本地语音组件',ro||busy):''}</p>`:''}<div class="video-deconstruction-toolbar">${d.source.kind==='manual'?button('add-row','新增镜头',ro||busy):''}${button('select-rows','全选',ro||!d.rows.length)}${button('deselect-rows','全不选',ro||!d.rows.length)}${button('add-column','增加列',ro||busy)}${button('retry-speech','重试本地对白',ro||busy||['text','manual'].includes(d.source.kind)||!task.taskId||!d.rows.length)}<span>已选 ${d.selectedRowIds.length} / ${d.rows.length} 镜 · 总时长 ${d.rows.reduce((sum,r)=>sum+r.durationSeconds,0).toFixed(1)} 秒</span></div>${mobileColumnsHtml(d,ro||busy)}${d.rows.length?`${s.editRow?editorHtml(d,s.editRow):''}<div class="shot-table-scroll">${tableHtml(d,ro)}</div>`:d.source.kind==='manual'?'<p class="video-deconstruction-note">这是空白分镜表。点击「新增镜头」，填写画面、角色、声音和提示词；建表与编辑无需调用模型。</p>':'<p class="video-deconstruction-note">检测切点后自动调用本地模型，分析结果显示在画布。</p>'}<div data-vd-extra></div>`;
  panel.querySelector('footer').innerHTML=button('close','关闭面板')+(['text','manual'].includes(d.source.kind)?'':button('table-again',d.rows.length?'重新拆解':'重新准备',ro||busy))+ (busy?button('cancel-table','取消本批',ro):'')+button('create-rows','创建所选镜头节点',ro||busy||!d.selectedRowIds.length,'class="primary"')+button('organize-rows','整理所选视频',ro||busy||!d.selectedRowIds.length);

  refreshIcons();
 }
 async function action(a,buttonEl,s){const host=s.host;if(a!=='close'&&s.type==='table')saveEditorDraft(s);const d=s.tableId&&host.node(s.tableId)?.shotTableData;
  if(a==='close'){closeAll();return;}
  if(a==='detect-again'){return openCuts(s.source,host);}
  if(a==='cut'){const i=Number(buttonEl.dataset.index);s.selected.has(i)?s.selected.delete(i):s.selected.add(i);renderCuts();return;}
  if(a==='select-cuts'||a==='deselect-cuts'){s.selected=a==='select-cuts'?new Set(cutView(s.detected.cuts,s.threshold,new Set()).map(c=>c.index)):new Set();renderCuts();return;}
  if(a==='relax-cuts'){s.threshold=.1;s.selected=new Set(cutView(s.detected.cuts,.1,new Set()).map(c=>c.index));renderCuts();return;}
  if(a==='land'){s.submitting=true;s.finished=false;renderCuts();try{s.task=await prepare(s.ctx,'frames',{detectionTaskId:s.detectionTaskId,indices:cutView(s.detected.cuts,s.threshold,s.selected).filter(c=>c.selected).map(c=>c.index)},host);await pollCuts(s);}catch(e){s.submitting=false;s.finished=true;renderCuts();throw e;}return;}
  if(a==='cancel-cuts'){await request(`/tasks/${s.task.id}/cancel`,{});return;}
  if(a==='create-rows')return createSelectedRows(s,buttonEl);
  if(a==='organize-rows')return createSelectedRows(s,buttonEl,true);
  if(!d)return;
  if(a==='table-again'){if(!d.rows.length)return startTable(s,'table');panel.querySelector('[data-vd-extra]').innerHTML=`<section class="video-deconstruction-confirm"><p>重新拆解会替换这张表的分析结果和手工编辑。</p>${button('confirm-table-again','确认重新拆解',host.readonly())}</section>`;return;}
  if(a==='confirm-table-again')return startTable(s,'table');
  if(a==='retry-shot')return startTable(s,'retry-shot',buttonEl.dataset.row||panel.querySelector('[data-vd-editor]')?.dataset.row);
  if(a==='retry-speech')return startTable(s,'retry-speech');
  if(a==='cancel-table'){if(d.task.taskId){const ctx=host.context(s.source,s.tableId);const result=await request(`/tasks/${d.task.taskId}/cancel`,{});host.applyTask(ctx,result);renderTable();}return;}
  if(a==='install-speech'){
   buttonEl.disabled=true;await request('/speech/install',{});
   const check=async()=>{const status=await request('/speech/install');if(current!==s)return;message(status.installed?'语音组件已就绪，请点击「重试本地对白」。':`${(status.downloadedBytes/1e6).toFixed(1)} / ${(status.totalBytes/1e6).toFixed(1)} MB · ${status.error||status.status}`,!!status.error);if(status.status==='installing')setTimeout(()=>check().catch(e=>message(e.message,true)),1000);else buttonEl.disabled=false;};await check();return;
  }
  if(a==='select-rows'||a==='deselect-rows'){host.editTable(s.tableId,raw=>({...raw,revision:raw.revision+1,selectedRowIds:a==='select-rows'?raw.rows.map(r=>r.id):[]}));renderTable();return;}
  if(a==='edit-row'){s.editRow=buttonEl.dataset.row;renderTable();return;}
  if(a==='previous-row'||a==='next-row'){const editor=panel.querySelector('[data-vd-editor]');await action('save-row',buttonEl,s);const index=d.rows.findIndex(r=>r.id===editor?.dataset.row);s.editRow=d.rows[Math.max(0,Math.min(d.rows.length-1,index+(a==='next-row'?1:-1)))].id;renderTable();return;}
  if(a==='save-row'){saveEditorDraft(s);renderTable();message('编辑已保存');return;}
  if(['add-row','duplicate-row','up-row','down-row','confirm-delete-row'].includes(a)){
   const rowId=panel.querySelector('[data-vd-editor]')?.dataset.row;
   const commands={'add-row':'add','duplicate-row':'duplicate','up-row':'up','down-row':'down','confirm-delete-row':'delete'};
   const next=m.editManualRow(d,commands[a],rowId);host.editTable(s.tableId,next);
   s.editRow=a==='add-row'?next.rows.at(-1).id:a==='duplicate-row'?next.rows[next.rows.findIndex(r=>r.id===rowId)+1].id:a==='confirm-delete-row'?(next.rows[0]?.id||null):rowId;renderTable();return;
  }
  if(a==='delete-row'){if(host.readonly())return;panel.querySelector('[data-vd-extra]').innerHTML=`<section class="video-deconstruction-confirm"><p>删除当前镜头及表内内容？已创建的配图节点和图片会保留。</p>${button('confirm-delete-row','确认删除本镜',host.readonly())}</section>`;return;}
  if(a==='add-column'||a==='column'){if(host.readonly()||d.task.status==='running')return;const c=d.columns.find(c=>c.id===buttonEl.dataset.column);s.columnId=c?.id;panel.querySelector('[data-vd-extra]').innerHTML=`<section class="video-deconstruction-confirm"><label>列名<input data-vd-column-name maxlength="60" value="${esc(c?.label||'')}"></label><p class="video-deconstruction-note">${c?'改名只改变表头，分析说明仍为：'+esc(c.hint):'列名作为本列的分析说明；下次分析或单镜重试生效。'}</p>${button('save-column',c?'保存列名':'添加列',host.readonly())}${c?button('delete-column','删除本列',host.readonly()):''}</section>`;return;}
  if(a==='delete-column'){panel.querySelector('[data-vd-extra]').innerHTML=`<section class="video-deconstruction-confirm"><p>删除本列及各镜头对应内容？</p>${button('confirm-delete-column','确认删除本列',host.readonly())}</section>`;return;}
  if(a==='save-column'||a==='confirm-delete-column'){host.editTable(s.tableId,raw=>m.editColumn(raw,a==='confirm-delete-column'?'delete':s.columnId?'rename':'add',{id:s.columnId,label:panel.querySelector('[data-vd-column-name]')?.value||''}));s.columnId=null;renderTable();return;}
 }
 async function createSelectedRows(s,buttonEl,organize=false){
  const host=s.host;let pending=creating.get(host);if(!pending){pending=new Set();creating.set(host,pending);}if(pending.has(s.tableId))return;
  const table=host.node(s.tableId);if(!table)throw new Error('镜头表已删除');
  const ctx=host.context(table.shotTableData.source,s.tableId,{allowDetached:true});if(!host.isCurrent(ctx))throw new Error('画布或镜头表已变化，请重新打开');
  pending.add(s.tableId);buttonEl.disabled=true;
  try{
   const result=organize?await host.organizeRows(s.tableId,[...table.shotTableData.selectedRowIds]):host.createRows(s.tableId,[...table.shotTableData.selectedRowIds]);
   if(host.saveNow&&!await host.saveNow())throw new Error('镜头节点已建在当前画布，但尚未保存成功。请重试保存或再次点击创建，已有节点会复用。');
   if(!host.isCurrent(ctx))throw new Error('画布或镜头表已变化，请返回原画布核对镜头节点');
   if(current===s&&!closeAll())throw new Error('请先保存分镜编辑，再查看已创建的节点');
   host.focus?.(result.nodeIds);
   host.onNotice?.(result.notice||`已创建 ${result.createdIds.length?result.generatorIds.length-result.reusedIds.length:0} 镜，复用 ${result.reusedIds.length} 镜。${result.warnings?.length?result.warnings.join('；'):'已连接分镜表 → 图片 → 视频。请先选择图片模型生成画面，再选择视频模型运行；两类提示词分别保留在对应节点。'}`);
   return result;
  }finally{pending.delete(s.tableId);buttonEl.disabled=false;}
 }
 function mount(element,node,host){const body=element.querySelector('.node-body');body.classList.add('shot-table-body');element.dataset.shotMode=host.scale()>=.8?'full':host.scale()>=.4?'compact':'card';const d=node.shotTableData,ro=host.readonly();body.innerHTML=`<div class="shot-table-summary"><strong>${d.rows.length} 镜 · 已选 ${d.selectedRowIds.length}</strong><span>${esc(d.source.kind==='manual'?'手工编排':statusLabels[d.task.status]||d.task.status)} · ${esc([d.task.phase,d.task.progressDetail].filter(Boolean).join(' · '))}</span>${d.task.error?`<span>${esc(d.task.error)}</span>`:''}${d.task.status==='running'?button('cancel-table','取消分析',ro):d.source.kind==='manual'?button('add-row','新增镜头',ro):!['text','manual'].includes(d.source.kind)&&!d.rows.length?button('start-local','本地分析',ro):''}${d.rows.length?button('create-rows','创建所选镜头节点',ro||d.task.status==='running'||!d.selectedRowIds.length):''}</div><div class="shot-table-scroll">${d.rows.length?tableHtml(d,ro):d.source.kind==='manual'?'<p class="video-deconstruction-note">空白分镜表 · 点击「新增镜头」开始编排</p>':'<p class="video-deconstruction-note">本地检测与分析进度显示在这里</p>'}</div>`;
  body.addEventListener('click',async event=>{event.stopPropagation();const b=event.target.closest('[data-vd-action]');if(!b)return;const session={host,tableId:node.id,source:host.node(node.id)?.shotTableData?.source};if(['create-rows','organize-rows'].includes(b.dataset.vdAction)){try{return await createSelectedRows(session,b,b.dataset.vdAction==='organize-rows');}catch(e){host.onError?.(e);return;}}if(b.dataset.vdAction==='start-local'){startTable(session,'table').catch(e=>host.onError?.(e));return;}if(b.dataset.vdAction==='cancel-table'){action('cancel-table',b,session).catch(e=>host.onError?.(e));return;}openTable(node.id,host).then(()=>action(b.dataset.vdAction,b,current)).catch(e=>host.onError?.(e));});
  body.addEventListener('change',event=>{event.stopPropagation();if(ro)return;const row=event.target.dataset.vdSelect;if(row)host.editTable(node.id,raw=>({...raw,revision:raw.revision+1,selectedRowIds:event.target.checked?[...raw.selectedRowIds,row]:raw.selectedRowIds.filter(x=>x!==row)}));});
  body.addEventListener('dblclick',event=>{event.stopPropagation();const cell=event.target.closest('[data-vd-cell]');if(cell)openTable(node.id,host).then(()=>{current.editRow=cell.dataset.row;renderTable();});});
  body.addEventListener('contextmenu',event=>{const c=event.target.closest('[data-column]');if(c){event.preventDefault();event.stopPropagation();openTable(node.id,host).then(()=>action('column',c,current));}});
  for(const name of ['mousedown','pointerdown','wheel','keydown'])body.addEventListener(name,event=>{const handle=event.target===body||event.target.closest('.shot-table-summary');const drag=['mousedown','pointerdown'].includes(name)&&handle&&!event.target.closest('button,input,select,textarea,a');if(!drag)event.stopPropagation();});updateScale(host);
 }
 function updateScale(host){if(typeof document==='undefined')return;const scale=host.scale(),mode=scale>=.8?'full':scale>=.4?'compact':'card';document.querySelectorAll('.shot-table-node,.smart-shot-table-node').forEach(el=>el.dataset.shotMode=mode);}
 function reconcile(host,visibleIds){const visible=new Set(visibleIds);for(const [id,w] of active)if(w.host!==host||!visible.has(id)||!host.isCurrent(w.ctx)){w.stopped=true;clearTimeout(w.timer);active.delete(id);}if(current&&(!host.isCurrent(current.ctx||host.context(current.source,current.tableId))||current.tableId&&!visible.has(current.tableId)))closeAll(true);for(const id of visible){const n=host.node(id),d=n.shotTableData;if((d.task.status==='running'||d.task.status==='idle'&&!d.task.quote)&&d.task.taskId&&!active.has(id)){watchTable(id,host,host.context(d.source,id),{id:d.task.taskId});}}}
 return {openCuts,openTable,mount,reconcile,closeAll,updateScale,cutView,tableHtml,editorHtml,mobileColumnsHtml};
});
