/* 普通画布原生剪辑节点。运行状态仅存于 runtimes，不写入画布 JSON。 */
(function (root) {
  'use strict';
  const FPS = 30, PX_PER_SECOND = 24, PX_PER_FRAME = PX_PER_SECOND / FPS;
  const runtimes = new Map(), filmCache = new Map(), filmQueue = [];
  let filmActive = 0;
  const icon = name => `<i data-lucide="${name}"></i>`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const formatTime = frame => `${Math.floor(frame / FPS / 60).toString().padStart(2,'0')}:${Math.floor(frame / FPS % 60).toString().padStart(2,'0')}`;
  const frameFromClient = (x, axisLeft, scale = 1) => Math.max(0, Math.round((x - axisLeft) / Math.max(.01, scale) / PX_PER_FRAME));
  function frameAt(clips, frame) {
    const clip = clips.find(c => c.startFrame <= frame && frame < c.endFrame);
    return clip ? {clip, sourceSeconds: (clip.sourceOffsetFrames + frame - clip.startFrame) / FPS} : null;
  }
  const contextKey = (context, id) => JSON.stringify([context.canvasId, context.generation, id]);
  const model = () => root.CanvasClipModel;
  const total = data => Math.max(0, ...data.clips.map(c => c.endFrame));
  const alive = state => state.active && state.host.isCurrent(state.context, state.id);
  const editable = state => alive(state) && !state.host.readOnly() && !state.exportBusy && !state.uploadBusy;
  const viewOf = state => state.editor || state.el;
  const viewScale = state => state.editor ? 1 : (state.host.scale() || 1);
  const mobile = () => root.matchMedia?.('(max-width: 600px)').matches;
  const dataOf = state => (state.host.getNode?.(state.id) || state.node).clipData || model().createData();
  const selected = state => dataOf(state).clips.find(c => c.id === dataOf(state).selectedClipId);
  const refreshIcons = state => state.host.refreshIcons?.();
  function save(state, next) {
    if (!editable(state)) return;
    const restoreFocus=viewOf(state)?.contains(document.activeElement);
    state.host.commit(state.id, next);
    if(restoreFocus && viewOf(state)?.isConnected)viewOf(state).focus({preventScroll:true});
  }
  function status(state, message) {
    state.message = message;
    const el = state.panel?.querySelector('.clip-status') || state.el?.querySelector('.clip-node-hint');
    if (el) el.textContent = message;
  }
  function stop(state) {
    state.playing = false;
    if (state.playRaf) cancelAnimationFrame(state.playRaf);
    state.playRaf = 0;
    state.video?.pause();
    refreshPlayButton(state);
  }
  function destroyPanel(state, force = false) {
    if (state.uploadBusy && !force) return;
    stop(state);
    state.panelAbort?.abort();
    if (state.video) { state.video.removeAttribute('src'); state.video.load(); }
    state.panel?.remove();
    state.editorAbort?.abort();state.editor=null;
    state.panel = null; state.video = null; state.previewClip = null; state.panelType = null;
  }
  function closePanel(state) {
    if(state.uploadBusy)return;
    const returnToEditor=state.editorWanted && state.panelType!=='editor';
    if(!returnToEditor)state.editorWanted=false;
    destroyPanel(state);
    if(returnToEditor)openEditor(state);
  }
  function dispose(state) {
    state.active = false;
    cancelGesture(state);
    state.scrubAbort?.abort();
    destroyPanel(state, true);
    state.mountAbort?.abort(); state.globalAbort?.abort();
    clearTimeout(state.pollTimer);
    state.pollResolve?.(); state.pollResolve=null;
    state.pendingFile = null;
    runtimes.delete(state.key);
  }
  function reconcile(context, nodeIds) {
    const ids = new Set(nodeIds);
    for (const state of [...runtimes.values()]) {
      if (state.context.canvasId !== context.canvasId || state.context.generation !== context.generation || !ids.has(state.id)) dispose(state);
    }
  }
  function closeAll(exceptId) {
    for (const state of runtimes.values()) if (state.id !== exceptId) {state.editorWanted=false;cancelGesture(state); state.scrubAbort?.abort(); destroyPanel(state); }
  }
  function makePanel(state, title, html, type) {
    closeAll(state.id);
    destroyPanel(state);
    if (state.panel) return null;
    const panel = document.createElement('section');
    panel.className = 'clip-panel';
    panel.tabIndex = -1;
    panel.setAttribute('role','dialog'); panel.setAttribute('aria-label',title);
    panel.innerHTML = `<div class="clip-panel-head"><strong>${escape(title)}</strong><button class="tool-btn" data-action="close" aria-label="关闭">${icon('x')}</button></div>${html}<div class="clip-status" role="status" aria-live="polite"></div>`;
    document.body.appendChild(panel);
    state.panel = panel; state.panelType = type; state.panelAbort = new AbortController();
    const signal = state.panelAbort.signal;
    for (const event of ['pointerdown','mousedown','click','wheel']) panel.addEventListener(event, e => e.stopPropagation(), {signal});
    panel.addEventListener('keydown',e => shortcut(state,e), {signal,capture:true});
    panel.addEventListener('keydown',e=>e.stopPropagation(),{signal});
    const closeButton=panel.querySelector('[data-action="close"]');
    closeButton.addEventListener('pointerdown',e=>{if(closeButton.disabled)return;e.preventDefault();e.stopImmediatePropagation();closePanel(state);},{signal});
    closeButton.onclick = () => closePanel(state);
    panel.addEventListener('focusout', () => queueMicrotask(() => {
      if (state.panel === panel && !panel.contains(document.activeElement) && !state.el.contains(document.activeElement)) stop(state);
    }),{signal});
    refreshIcons(state); panel.focus({preventScroll:true});
    return panel;
  }
  function refreshHead(state) {
    const data = dataOf(state), clip = selected(state), ro = state.host.readOnly();
    const buttons = [...state.el.querySelectorAll('[data-action]'),...(state.editor?.querySelectorAll('[data-action]') || [])];
    for (const b of buttons) {
      const action = b.dataset.action;
      if (['split','duplicate','remove'].includes(action)) b.disabled = !editable(state) || !clip || (action === 'split' && !(state.frame > clip.startFrame && state.frame < clip.endFrame));
      if (action === 'export') b.disabled = !data.clips.length || state.exportBusy || state.uploadBusy;
      if (action === 'add' || action === 'delete-node') b.disabled = ro || state.exportBusy || state.uploadBusy;
    }
    const summary = state.el.querySelector('.clip-summary');
    if (summary) summary.textContent = `${data.clips.length} 个片段 · ${formatTime(total(data))}`;
    const editorSummary=state.editor?.querySelector('.clip-summary');if(editorSummary)editorSummary.textContent=summary.textContent;
  }
  function setFrame(state, frame, mediaUpdate = true) {
    state.frame = Math.max(0, Math.min(total(dataOf(state)), Math.round(frame)));
    for(const el of [state.el,state.editor]){const playhead=el?.querySelector('.clip-playhead');if(playhead)playhead.style.left=`${state.frame*PX_PER_FRAME}px`;}
    refreshHead(state);
    const range = state.panel?.querySelector('[data-preview-range]');
    if (range) { range.value = state.frame; range.max = total(dataOf(state)); }
    const time = state.panel?.querySelector('.clip-time');
    if (time) time.textContent = `${formatTime(state.frame)} / ${formatTime(total(dataOf(state)))}`;
    if (mediaUpdate && state.panelType === 'preview') updatePreview(state);
  }
  function updatePreview(state) {
    const hit = frameAt(dataOf(state).clips, state.frame), video = state.video;
    const image = state.panel.querySelector('.clip-preview-image');
    const caption = state.panel.querySelector('.clip-screen-caption');
    if (!hit) {
      video.pause(); video.hidden = true; image.hidden = true;
      caption.textContent = state.frame >= total(dataOf(state)) ? '成片结束' : '空隙 · 黑场';
      state.previewClip = null; return;
    }
    const clip = hit.clip;
    caption.textContent = `${clip.name || '素材'} · 源 ${formatTime(clip.sourceOffsetFrames + state.frame - clip.startFrame)}`;
    if (clip.kind === 'image') {
      video.pause(); video.hidden = true; image.hidden = false;
      if (image.dataset.url !== clip.url) { image.src = clip.url; image.dataset.url = clip.url; }
      state.previewClip = clip.id; return;
    }
    image.hidden = true; video.hidden = false;
    if (state.previewClip !== clip.id) {
      video.pause(); video.src = clip.url; video.muted = state.previewMuted;
      state.previewClip = clip.id;
      const seek = () => {
        if (state.video !== video || state.previewClip !== clip.id) return;
        const latest = frameAt(dataOf(state).clips,state.frame);
        if (latest?.clip.id === clip.id) {
          video.currentTime = latest.sourceSeconds;
          if (state.playing) video.play().catch(error => {stop(state); status(state,`视频播放失败：${error.message}`);});
        }
      };
      if (video.readyState >= 1) seek(); else video.addEventListener('loadedmetadata',seek,{once:true,signal:state.panelAbort.signal});
    } else if (!state.playing || Math.abs(video.currentTime - hit.sourceSeconds) > .3) {
      if (video.readyState >= 1) video.currentTime = hit.sourceSeconds;
    }
    if (state.playing && video.paused && video.readyState >= 1) video.play().catch(error => {stop(state);status(state,`视频播放失败：${error.message}`);});
  }
  function play(state) {
    if (state.playing) { stop(state); refreshPlayButton(state); return; }
    if (!dataOf(state).clips.length) return;
    if (state.frame >= total(dataOf(state))) setFrame(state,0);
    state.playing = true; state.clockStart = performance.now(); state.clockFrame = state.frame;
    refreshPlayButton(state); updatePreview(state);
    const tick = now => {
      if (!state.playing || !alive(state) || state.panelType !== 'preview') return;
      setFrame(state, state.clockFrame + Math.floor((now - state.clockStart) * FPS / 1000));
      if (state.frame >= total(dataOf(state))) { stop(state);refreshPlayButton(state);return; }
      state.playRaf = requestAnimationFrame(tick);
    };
    state.playRaf = requestAnimationFrame(tick);
  }
  function refreshPlayButton(state) {
    const b = state.panel?.querySelector('[data-action="play"]');
    if (b && b.dataset.playing!==String(state.playing)) {
      b.dataset.playing=String(state.playing);
      const definition=root.lucide?.icons?.[state.playing?'Pause':'Play'];
      if(definition && root.lucide.createElement)b.replaceChildren(root.lucide.createElement(definition));
      else b.textContent=state.playing?'Ⅱ':'▶';
      b.setAttribute('aria-label',state.playing?'暂停':'播放成片');
    }
  }
  function preview(state) {
    if (state.panelType === 'preview') { updatePreview(state);return; }
    const panel = makePanel(state,'成片预览',`<div class="clip-screen"><video class="clip-preview-video" playsinline preload="metadata" muted></video><img class="clip-preview-image" alt="当前图片片段" hidden><span class="clip-screen-caption"></span></div><div class="clip-preview-controls"><button class="tool-btn" data-action="play" aria-label="播放成片">${icon('play')}</button><input data-preview-range type="range" min="0" max="${total(dataOf(state))}" step="1" value="${state.frame}" aria-label="成片播放位置"><span class="clip-time"></span><button class="tool-btn" data-action="sound" aria-label="预览声音" aria-pressed="${!state.previewMuted}">${icon(state.previewMuted?'volume-x':'volume-2')}</button></div>`, 'preview');
    if (!panel) return;
    state.video = panel.querySelector('video');panel.querySelector('[data-action="play"]').dataset.playing='false';
    state.video.onerror = () => {stop(state);status(state,'视频无法解码或加载，请检查素材后重试。');refreshPlayButton(state);};
    panel.querySelector('img').onerror = () => status(state,'图片无法加载，请检查素材地址。');
    panel.querySelector('[data-action="play"]').onclick = () => play(state);
    panel.querySelector('[data-action="sound"]').onclick = e => {
      state.previewMuted = !state.previewMuted; state.video.muted = state.previewMuted;
      e.currentTarget.innerHTML = icon(state.previewMuted?'volume-x':'volume-2');
      e.currentTarget.setAttribute('aria-pressed',String(!state.previewMuted));refreshIcons(state);
    };
    panel.querySelector('input').oninput = e => {stop(state);setFrame(state,+e.target.value);refreshPlayButton(state);};
    setFrame(state,state.frame);
    status(state,'预览初始静音；导出声音由独立开关控制。');
  }
  function action(state, name) {
    if(name==='editor'){openEditor(state);return;}
    if (name === 'preview') { preview(state);return; }
    if (name === 'export') { exportPanel(state);return; }
    if (!editable(state)) return;
    const data = dataOf(state), clip = selected(state);
    stop(state);
    if (name === 'add') { picker(state);return; }
    if (name === 'delete-node') { destroyPanel(state,true);state.host.deleteNode?.(state.id);return; }
    if (!clip) return;
    if (name === 'split') save(state,model().split(data,clip.id,state.frame));
    if (name === 'duplicate') save(state,model().duplicate(data,clip.id));
    if (name === 'remove') save(state,model().remove(data,clip.id));
  }
  function shortcut(state, event) {
    if (event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    const key = event.key.toLowerCase(), command = event.ctrlKey || event.metaKey;
    if (key === 'escape') {event.preventDefault();event.stopImmediatePropagation();cancelGesture(state);closePanel(state);return;}
    if(event.altKey)return;
    const known = (command && ['z','d'].includes(key)) || (!command && (['arrowleft','arrowright','delete','backspace','s'].includes(key) || (event.shiftKey && ['<','>'].includes(key))));
    // 不使用的画布快捷键在冒泡阶段隔离，仍允许子元素自身的键盘操作。
    if (!known) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (command && key === 'z') {
      if(editable(state)){state.host[event.shiftKey?'redo':'undo']?.();viewOf(state)?.focus({preventScroll:true});}
      return;
    }
    if (key.startsWith('arrow')) {stop(state);setFrame(state,state.frame+(key==='arrowleft'?-1:1));return;}
    if (!editable(state)) return;
    if (command && key==='d') action(state,'duplicate');
    else if (['delete','backspace'].includes(key)) action(state,'remove');
    else if (key==='s') action(state,'split');
    else if (selected(state) && event.shiftKey && ['<','>'].includes(key)) save(state,model().move(dataOf(state), selected(state).id, selected(state).startFrame + (key==='<'?-1:1),{disableSnap:true}));
  }
  function cancelGesture(state) {
    const gesture = state.gesture;
    if (!gesture) return;
    state.gesture = null; gesture.abort.abort();
    if (gesture.raf) cancelAnimationFrame(gesture.raf);
    try { gesture.capture.releasePointerCapture(gesture.pointerId); } catch (_) { /* 捕获可因取消已释放。 */ }
    renderTimeline(state);
  }
  function beginGesture(state, event, clip, side) {
    if (event.button !== 0 || !editable(state)) return;
    event.stopPropagation();event.preventDefault();
    stop(state); closeAll(state.id);viewOf(state).focus({preventScroll:true});state.host.select?.(state.id);
    cancelGesture(state);
    const axis = viewOf(state).querySelector('.clip-axis'), original = structuredClone(dataOf(state));
    const gesture = {clip, side, original, preview:original, startX:event.clientX, lastX:event.clientX, shift:event.shiftKey, scale:viewScale(state), pointerId:event.pointerId, capture:event.currentTarget, abort:new AbortController(), moved:false};
    state.gesture = gesture;
    try {gesture.capture.setPointerCapture(event.pointerId);} catch (_) { /* window 监听仍覆盖手势结束。 */ }
    const apply = () => {
      if (state.gesture !== gesture) return;
      const delta = Math.round((gesture.lastX-gesture.startX)/gesture.scale/PX_PER_FRAME);
      gesture.moved = Math.abs(gesture.lastX-gesture.startX) > 3;
      gesture.preview = side ? model().trim(original,clip.id,side,(side==='left'?clip.startFrame:clip.endFrame)+delta) : model().move(original,clip.id,clip.startFrame+delta,{snapFrame:state.frame,thresholdFrames:Math.round(7/gesture.scale/PX_PER_FRAME),disableSnap:gesture.shift});
      const next = gesture.preview.clips.find(c=>c.id===clip.id), tile = viewOf(state).querySelector(`[data-clip-id="${CSS.escape(clip.id)}"]`);
      if (tile && next) {tile.style.left=`${next.startFrame*PX_PER_FRAME}px`;tile.style.width=`${(next.endFrame-next.startFrame)*PX_PER_FRAME}px`;}
      let hint = side ? `裁剪 ${((next.endFrame-next.startFrame)/FPS).toFixed(2)} 秒 · 源偏移 ${(next.sourceOffsetFrames/FPS).toFixed(2)} 秒` : `位置 ${(next.startFrame/FPS).toFixed(2)} 秒`;
      const guides = [0,state.frame,...original.clips.filter(c=>c.id!==clip.id).flatMap(c=>[c.startFrame,c.endFrame])];
      const snap = !side && !gesture.shift && guides.find(f=>f===next.startFrame || f===next.endFrame);
      const guide = viewOf(state).querySelector('.clip-snap-guide');
      guide.hidden = snap === undefined || snap === false;
      if (!guide.hidden) {guide.style.left=`${snap*PX_PER_FRAME}px`;guide.dataset.label=`吸附 ${formatTime(snap)}`;hint+=' · 已吸附';}
      viewOf(state).querySelector('.clip-node-hint').textContent = hint;
      const extent = Math.max(900,next.endFrame+120)*PX_PER_FRAME;
      axis.style.width=`${extent}px`;
    };
    const signal = gesture.abort.signal;
    window.addEventListener('pointermove', e=>{
      if (e.pointerId!==gesture.pointerId) return;
      gesture.lastX=e.clientX;gesture.shift=e.shiftKey;
      if (!gesture.raf) gesture.raf=requestAnimationFrame(()=>{gesture.raf=0;apply();});
    },{signal});
    window.addEventListener('pointerup',e=>{
      if(e.pointerId!==gesture.pointerId) return;
      gesture.lastX=e.clientX;gesture.shift=e.shiftKey;apply();
      const next=gesture.preview;next.selectedClipId=clip.id;
      const moved=gesture.moved;
      cancelGesture(state);
      if (moved) {state.suppressClickUntil=performance.now()+250;save(state,next);}
      else {state.frame=clip.startFrame;save(state,{...original,selectedClipId:clip.id});preview(state);}
    },{signal});
    window.addEventListener('pointercancel',()=>cancelGesture(state),{signal});
    gesture.capture.addEventListener('lostpointercapture',()=>cancelGesture(state),{signal});
  }
  function beginScrub(state,event) {
    if(event.button!==0 || event.target.closest('[data-clip-id],button')) return;
    event.stopPropagation();event.preventDefault();viewOf(state).focus({preventScroll:true});stop(state);
    const axis = viewOf(state).querySelector('.clip-axis'), abort = new AbortController();
    state.scrubAbort?.abort();state.scrubAbort=abort;
    const apply=e=>setFrame(state,frameFromClient(e.clientX,axis.getBoundingClientRect().left,viewScale(state)));
    apply(event);
    window.addEventListener('pointermove',apply,{signal:abort.signal});
    window.addEventListener('pointerup',e=>{apply(e);abort.abort();preview(state);},{once:true,signal:abort.signal});
    window.addEventListener('pointercancel',()=>abort.abort(),{once:true,signal:abort.signal});
  }
  function filmstrip(url) {
    if (filmCache.has(url)) return filmCache.get(url);
    const promise = new Promise(resolve=>filmQueue.push({url,resolve}));
    filmCache.set(url,promise);
    // 缓存只保留近期素材，避免长期驻留大画布造成内存增长。
    if(filmCache.size>48) filmCache.delete(filmCache.keys().next().value);
    drainFilmQueue(); return promise;
  }
  function drainFilmQueue() {
    while(filmActive<2 && filmQueue.length) {
      const job=filmQueue.shift();filmActive++;
      extractFilm(job.url).then(job.resolve,()=>job.resolve(null)).finally(()=>{filmActive--;drainFilmQueue();});
    }
  }
  async function extractFilm(url) {
    const video=document.createElement('video');video.preload='auto';video.muted=true;video.playsInline=true;video.crossOrigin='anonymous';
    const canvas=document.createElement('canvas');canvas.width=160*16;canvas.height=90;
    const ctx=canvas.getContext('2d');
    const eventOnce=(name,timeout=8000)=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>done(new Error('缩略图探测超时')),timeout);
      const onEvent=()=>done(), onError=()=>done(new Error('视频无法解码'));
      const done=error=>{clearTimeout(timer);video.removeEventListener(name,onEvent);video.removeEventListener('error',onError);error?reject(error):resolve();};
      video.addEventListener(name,onEvent,{once:true});video.addEventListener('error',onError,{once:true});
    });
    try {
      const ready=eventOnce('loadedmetadata');video.src=url;await ready;
      if(!Number.isFinite(video.duration)||video.duration<=0||!ctx) return null;
      for(let i=0;i<16;i++) {
        const seek=eventOnce('seeked');video.currentTime=Math.min(video.duration-.001,Math.max(.001,(i+.5)/16*video.duration));await seek;
        const ratio=Math.min(160/video.videoWidth,90/video.videoHeight),w=video.videoWidth*ratio,h=video.videoHeight*ratio;
        ctx.fillStyle='#000';ctx.fillRect(i*160,0,160,90);ctx.drawImage(video,i*160+(160-w)/2,(90-h)/2,w,h);
      }
      return {url:canvas.toDataURL('image/jpeg',.7),duration:video.duration};
    } finally {video.pause();video.removeAttribute('src');video.load();}
  }
  function renderTimeline(state, target=viewOf(state)) {
    if(!target || !alive(state)) return;
    const data=dataOf(state), body=target.querySelector('.node-body'), scroll=body.querySelector('.clip-axis-scroll')?.scrollLeft || state.scrollLeft || 0;
    const end=Math.max(900,total(data)+120), width=end*PX_PER_FRAME;
    body.innerHTML=`<div class="clip-axis-scroll"><div class="clip-axis" style="width:${width}px"><div class="clip-ruler">${Array.from({length:Math.floor(end/300)+1},(_,i)=>`<span style="left:${i*300*PX_PER_FRAME}px">${formatTime(i*300)}</span>`).join('')}</div><div class="clip-track">${data.clips.map(c=>`<div role="button" tabindex="0" aria-label="选择${escape(c.name || '片段')}" class="clip-piece ${c.id===data.selectedClipId?'selected':''}" data-clip-id="${escape(c.id)}" style="left:${c.startFrame*PX_PER_FRAME}px;width:${(c.endFrame-c.startFrame)*PX_PER_FRAME}px"><div class="clip-film"></div><div class="clip-piece-label">${icon(c.kind==='image'?'image':'video')}<span>${escape(c.name || '素材')}</span><small>${((c.endFrame-c.startFrame)/FPS).toFixed(1)}秒</small></div><span class="clip-trim left" data-side="left" aria-label="裁剪左端"></span><span class="clip-trim right" data-side="right" aria-label="裁剪右端"></span></div>`).join('')}<button class="tool-btn clip-add" data-action="add" style="left:${total(data)*PX_PER_FRAME+12}px" aria-label="添加图片或视频">${icon('plus')}</button>${data.clips.length?'':'<span class="clip-empty-hint">连接素材节点，或点 ＋ 添加图片 / 视频</span>'}</div><div class="clip-playhead" style="left:${state.frame*PX_PER_FRAME}px"></div><div class="clip-snap-guide" hidden></div></div></div><div class="clip-node-hint" role="status"></div>`;
    const signal=(target===state.editor?state.editorAbort:state.mountAbort).signal, axis=body.querySelector('.clip-axis');
    const scrollEl=body.querySelector('.clip-axis-scroll');scrollEl.scrollLeft=scroll;
    scrollEl.addEventListener('scroll',()=>{state.scrollLeft=scrollEl.scrollLeft;},{signal});
    axis.addEventListener('pointerdown',e=>beginScrub(state,e),{signal});
    body.querySelector('[data-action="add"]').onclick=()=>action(state,'add');
    for(const tile of body.querySelectorAll('[data-clip-id]')) {
      const clip=data.clips.find(c=>c.id===tile.dataset.clipId), film=tile.querySelector('.clip-film');
      const imageUrl=clip.posterUrl || (clip.kind==='image'?clip.url:null);
      if(imageUrl) {film.style.backgroundImage=`url(${JSON.stringify(imageUrl)})`;}
      else if(clip.kind==='video') filmstrip(clip.url).then(result=>{
        if(!result || !tile.isConnected || !alive(state)) return;
        film.style.backgroundImage=`url(${JSON.stringify(result.url)})`;film.style.backgroundSize='1600% 100%';
        const fraction=clip.sourceOffsetFrames/Math.max(1,clip.sourceDurationFrames);
        film.style.backgroundPosition=`${Math.min(100,fraction*100)}% center`;
      });
      tile.addEventListener('pointerdown',e=>beginGesture(state,e,clip,e.target.dataset.side || null),{signal});
      tile.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();e.stopPropagation();state.frame=clip.startFrame; if(editable(state)) save(state,{...dataOf(state),selectedClipId:clip.id});preview(state);}},{signal});
      tile.addEventListener('click',e=>{
        e.stopPropagation();if(performance.now()<(state.suppressClickUntil || 0)) return;
        if(state.host.readOnly()){setFrame(state,clip.startFrame);preview(state);}
      },{signal});
    }
    const clip=selected(state);
    body.querySelector('.clip-node-hint').textContent=clip ? `已选：${clip.name || '素材'} · 源 ${formatTime(clip.sourceOffsetFrames)}—${formatTime(clip.sourceOffsetFrames+clip.endFrame-clip.startFrame)}${clip.durationUnconfirmed?' · 时长未确认':''} · Shift 临时关闭吸附` : '支持图片、视频；不支持独立音频 · 时间线可横向滚动';
    refreshHead(state);refreshIcons(state);
  }
  async function probeMedia(media, signal) {
    if(media.kind!=='video' || (Number.isFinite(media.durationSeconds)&&media.durationSeconds>0)) return media;
    const video=document.createElement('video');video.preload='metadata';
    return new Promise(resolve=>{
      const timer=setTimeout(()=>done(),8000);
      function done(){clearTimeout(timer);signal?.removeEventListener('abort',done);const duration=video.duration;video.onloadedmetadata=null;video.onerror=null;video.removeAttribute('src');video.load();resolve({...media,...(Number.isFinite(duration)&&duration>0?{durationSeconds:duration}:{})});}
      signal?.addEventListener('abort',done,{once:true});
      video.onloadedmetadata=done;video.onerror=done;video.src=media.url;
    });
  }
  async function addMedia(state, media) {
    if(!editable(state)) return;
    if(!['image','video'].includes(media.kind)) {status(state,'此剪辑轴只支持图片和视频，不支持独立音频。');return;}
    const confirmed=await probeMedia(media,state.globalAbort.signal);
    if(!editable(state)) return;
    save(state,model().addMedia(dataOf(state),confirmed,{manual:true}));
  }
  async function picker(state) {
    if(!editable(state)) return;
    const panel=makePanel(state,'添加素材',`<div class="clip-picker-actions"><label class="tool-btn">${icon('upload')}本地上传<input type="file" accept="image/*,video/*" hidden></label><button class="tool-btn" data-retry hidden>重试上传</button></div><p class="clip-help">从现有资产库选择图片或视频，或上传本地文件。</p><div class="clip-picker-grid"></div>`, 'picker');
    if(!panel) return;
    const retry=panel.querySelector('[data-retry]');
    const upload=async file=>{
      if(!editable(state) || !file) return;
      if(!/^(image|video)\//.test(file.type)){status(state,'只支持图片或视频文件；独立音频不能添加。');return;}
      state.pendingFile=file;state.uploadBusy=true;refreshHead(state);
      panel.querySelector('[data-action="close"]').disabled=true;
      panel.querySelector('input').disabled=true;retry.disabled=true;
      status(state,`正在上传 ${file.name}…`);
      try {
        const media=await state.host.upload(file);
        if(!alive(state)) return;
        if(!['image','video'].includes(media.kind))throw new Error('上传结果不是图片或视频');
        const confirmed=await probeMedia(media,state.globalAbort.signal);
        if(!alive(state))return;
        state.uploadBusy=false;
        save(state,model().addMedia(dataOf(state),confirmed,{manual:true}));
        if(!alive(state)) return;
        state.pendingFile=null;retry.hidden=true;status(state,'上传完成，已加入剪辑轴。');
      } catch(error) {if(alive(state)){retry.hidden=false;status(state,`上传失败：${error.message}。可保留文件重试。`);}}
      finally {
        state.uploadBusy=false;
        if(alive(state)){refreshHead(state);panel.querySelector('[data-action="close"]').disabled=false;panel.querySelector('input').disabled=false;retry.disabled=false;}
      }
    };
    panel.querySelector('input').onchange=e=>upload(e.target.files[0]);retry.onclick=()=>upload(state.pendingFile);
    retry.hidden=!state.pendingFile;
    try {
      status(state,'正在读取素材库…');
      const media=await state.host.listMedia();
      if(!alive(state)||state.panel!==panel) return;
      const items=media.filter(m=>['image','video'].includes(m.kind));
      const grid=panel.querySelector('.clip-picker-grid');
      grid.innerHTML=items.map((m,i)=>`<button class="clip-picker-item" data-media-index="${i}">${m.posterUrl||m.kind==='image'?`<img src="${escape(m.posterUrl||m.url)}" alt="" loading="lazy">`:`<div class="clip-picker-placeholder">${icon('video')}</div>`}<span>${escape(m.name||'素材')}</span></button>`).join('');
      for(const b of grid.querySelectorAll('button')) b.onclick=async()=>{if(!editable(state))return;b.disabled=true;try{await addMedia(state,items[+b.dataset.mediaIndex]);if(alive(state))status(state,'已加入剪辑轴。');}catch(error){status(state,`添加失败：${error.message}`);}finally{b.disabled=false;}};
      status(state,items.length?'选择素材即可加入剪辑轴。':'资产库暂无图片或视频，可从本地上传。');refreshIcons(state);
    } catch(error) {if(alive(state)) status(state,`素材库读取失败：${error.message}。仍可本地上传。`);}
  }
  function exportPanel(state) {
    if(state.exportBusy || state.uploadBusy || !dataOf(state).clips.length) return;
    const panel=makePanel(state,'导出剪辑',`<p class="clip-help">导出范围</p><div class="clip-option-row"><button class="clip-option active" data-scope="full">完整成片<small>保留空隙，输出 1 个视频</small></button><button class="clip-option" data-scope="segments">逐段导出<small>每个片段单独生成文件</small></button></div><p class="clip-help">导出目标</p><div class="clip-option-row"><button class="clip-option active" data-destination="canvas">回到画布<small>创建或更新成片结果节点</small></button><button class="clip-option" data-destination="download">下载文件<small>完成后逐个点击下载</small></button></div><label class="clip-mute-row"><span>导出静音<small>默认保留原视频声音</small></span><input type="checkbox" data-export-muted ${dataOf(state).exportMuted?'checked':''} ${state.host.readOnly()?'disabled':''}></label><p class="clip-help">MP4 · H.264 · 1920×1080 · 30fps</p><button class="tool-btn clip-primary" data-confirm>导出 1 个视频到画布</button><div class="clip-export-results"></div>`, 'export');
    if(!panel) return;
    state.exportScope='full';state.exportDestination='canvas';state.retryExportData=null;
    const confirm=panel.querySelector('[data-confirm]');
    const label=()=>{confirm.textContent=state.retryExportData?`重试 ${state.retryExportData.clips.length} 个失败片段`:`导出 ${state.exportScope==='full'?1:dataOf(state).clips.length} 个视频${state.exportDestination==='canvas'?'到画布':'供下载'}`;confirm.disabled=state.exportBusy || (state.host.readOnly()&&state.exportDestination==='canvas');};
    for(const b of panel.querySelectorAll('[data-scope],[data-destination]')) b.onclick=()=>{
      if(state.exportBusy)return;
      const attr=b.dataset.scope?'scope':'destination';state[attr==='scope'?'exportScope':'exportDestination']=b.dataset[attr];
      if(attr==='scope')state.retryExportData=null;
      for(const option of panel.querySelectorAll(`[data-${attr}]`))option.classList.toggle('active',option===b);label();
    };
    panel.querySelector('[data-export-muted]').onchange=e=>{if(editable(state))save(state,{...dataOf(state),exportMuted:e.target.checked});};
    confirm.onclick=()=>runExport(state,panel,confirm,label);
    label();
    if(state.exportResults?.length) showExportResults(state,panel,state.exportResults);
  }
  function showExportResults(state,panel,results) {
    if(!panel?.isConnected) return;
    const list=panel.querySelector('.clip-export-results');
    if(!list)return;
    list.innerHTML=results.map((r,i)=>`<div class="clip-result-row"><span>${escape(r.name || `视频 ${i+1}`)} · ${Number(r.durationSeconds || 0).toFixed(1)}秒</span><button class="tool-btn" data-download="${i}">${icon('download')}下载</button></div>`).join('');
    for(const b of list.querySelectorAll('button'))b.onclick=async()=>{b.disabled=true;try{await state.host.download(results[+b.dataset.download].url,results[+b.dataset.download].name);status(state,'已请求下载，请查看浏览器下载记录。');}catch(error){status(state,`下载失败：${error.message}`);}finally{b.disabled=false;}};
    refreshIcons(state);
  }
  async function jsonResponse(response) {
    const body=await response.json();
    if(!response.ok)throw new Error(typeof body.detail==='string'?body.detail:(body.error||`请求失败 (${response.status})`));
    return body;
  }
  async function runExport(state,panel,confirm,label) {
    if(state.exportBusy || !alive(state) || (state.host.readOnly()&&state.exportDestination==='canvas'))return;
    const retrying=!!state.retryExportData;
    const data=structuredClone(state.retryExportData || dataOf(state)),scope=state.exportScope,destination=state.exportDestination,context={...state.context};
    state.retryExportData=null;
    data.exportMuted=panel.querySelector('[data-export-muted]').checked;
    state.exportBusy=true;refreshHead(state);confirm.disabled=true;
    const optionButtons=panel.querySelectorAll('[data-scope],[data-destination],[data-export-muted]');optionButtons.forEach(b=>b.disabled=true);
    status(state,'正在提交导出任务…');
    try {
      const task=await jsonResponse(await fetch('/api/canvas-clip/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({canvas_id:context.canvasId,node_id:state.id,clipData:data,scope,request_id:root.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`})}));
      let result=task;
      while(!['succeeded','failed'].includes(result.status)) {
        if(!alive(state))return;
        await new Promise(resolve=>{state.pollResolve=resolve;state.pollTimer=setTimeout(()=>{state.pollResolve=null;resolve();},800);});
        if(!alive(state))return;
        result=await jsonResponse(await fetch(`/api/canvas-clip/tasks/${encodeURIComponent(task.id)}`));
        status(state,`正在导出… ${Math.round((Number(result.progress)||0)* (Number(result.progress)<=1?100:1))}%`);
      }
      const results=Array.isArray(result.results)?result.results.filter(r=>r.url):[];
      state.exportResults=retrying?[...new Map([...(state.exportResults || []),...results].map(r=>[r.sourceClipId || r.url,r])).values()]:results;
      if(!alive(state))return;
      showExportResults(state,panel,state.exportResults);
      if(results.length && destination==='canvas' && !state.host.readOnly()) {
        const written=await state.host.output(state.id,results,context);
        if(written===false)throw new Error('当前画布状态已变更，成片未回写；已完成文件仍可下载');
      }
      if(!alive(state))return;
      if(result.status==='failed') {
        if(scope==='segments') {
          const done=new Set(results.map(r=>r.sourceClipId));
          const remaining=data.clips.filter(c=>!done.has(c.id));
          if(remaining.length)state.retryExportData={...data,clips:remaining};
        }
        throw new Error(`${result.error||'导出失败'}${state.exportResults.length?`；${state.exportResults.length} 个已成功文件仍可下载${state.retryExportData?'，可只重试失败片段':''}。`:''}`);
      }
      status(state,destination==='canvas'?`已生成 ${state.exportResults.length} 个视频并回到画布。`:`已生成 ${state.exportResults.length} 个视频，请逐个点击下载。`);
    } catch(error) {if(alive(state))status(state,`导出失败：${error.message}`);}
    finally {
      state.exportBusy=false;
      if(alive(state)){refreshHead(state);optionButtons.forEach(b=>b.disabled=false);panel.querySelector('[data-export-muted]').disabled=state.host.readOnly();label();}
    }
  }
  function renderEditor(state) {
    if(!state.editor || !alive(state))return;
    state.editorAbort?.abort();state.editorAbort=new AbortController();
    const editor=state.editor,signal=state.editorAbort.signal;
    editor.innerHTML=`<div class="node-head">${state.el.querySelector('.node-head').innerHTML}</div><div class="node-body"></div>`;
    editor.querySelector('[data-action="editor"]')?.remove();
    for(const b of editor.querySelectorAll('button')) {
      b.addEventListener('pointerdown',e=>e.stopPropagation(),{signal});
      b.addEventListener('click',e=>{e.stopPropagation();editor.focus({preventScroll:true});action(state,b.dataset.action);},{signal});
    }
    renderTimeline(state,editor);
  }
  function openEditor(state) {
    if(!alive(state))return;
    if(state.panelType==='editor'){state.editor.focus({preventScroll:true});return;}
    state.editorWanted=true;
    const panel=makePanel(state,'编辑剪辑',`<div class="clip-editor-node clip-node" tabindex="0"></div><p class="clip-help">单轨剪辑 · 左右滑动时间线 · 点选片段后可分割、复制、删除或裁剪</p>`, 'editor');
    if(!panel)return;
    panel.classList.add('clip-editor-panel');state.editor=panel.querySelector('.clip-editor-node');
    renderEditor(state);state.editor.focus({preventScroll:true});
  }
  function mount(el,node,host) {
    const context={...host.getContext()},key=contextKey(context,node.id);
    let state=runtimes.get(key);
    if(!state) {
      state={key,id:node.id,context,active:true,frame:0,previewMuted:true,playing:false,globalAbort:new AbortController()};
      runtimes.set(key,state);
      window.addEventListener('blur',()=>{cancelGesture(state);state.scrubAbort?.abort();stop(state);refreshPlayButton(state);},{signal:state.globalAbort.signal});
      document.addEventListener('visibilitychange',()=>{if(document.hidden){stop(state);refreshPlayButton(state);}},{signal:state.globalAbort.signal});
    }
    cancelGesture(state);state.scrubAbort?.abort();
    state.mountAbort?.abort();state.mountAbort=new AbortController();state.el=el;state.node=node;state.host=host;
    el.classList.add('clip-node');el.tabIndex=0;
    const head=el.querySelector('.node-head');
    head.innerHTML=`<div class="clip-title">${icon('film')}<span>剪辑轴</span><small class="clip-summary"></small></div><div class="clip-actions">${[['split','scissors','分割'],['duplicate','copy','复制'],['remove','trash-2','删除'],['preview','play','预览'],['export','download','导出']].map(([a,i,t])=>`<button class="tool-btn" data-action="${a}" title="${t}" aria-label="${t}">${icon(i)}<span>${t}</span></button>`).join('')}<button class="tool-btn clip-mobile-open" data-action="editor" title="展开清晰剪辑面板">${icon('maximize-2')}编辑</button><button class="tool-btn clip-delete-node" data-action="delete-node" title="删除剪辑节点" aria-label="删除剪辑节点">${icon('x')}</button></div>`;
    const signal=state.mountAbort.signal;
    for(const event of ['mousedown','click','wheel'])el.querySelector('.node-body').addEventListener(event,e=>e.stopPropagation(),{signal});
    el.querySelector('.node-body').addEventListener('pointerdown',e=>e.stopPropagation(),{signal});
    el.querySelector('.node-body').addEventListener('pointerdown',e=>{
      if(mobile()){e.preventDefault();e.stopImmediatePropagation();openEditor(state);}
    },{signal,capture:true});
    el.addEventListener('click',e=>{if(mobile() && !e.target.closest('button')){e.stopPropagation();openEditor(state);}},{signal});
    for(const b of head.querySelectorAll('button')) {
      b.addEventListener('pointerdown',e=>e.stopPropagation(),{signal});b.addEventListener('mousedown',e=>e.stopPropagation(),{signal});
      b.addEventListener('click',e=>{e.stopPropagation();el.focus({preventScroll:true});action(state,b.dataset.action);},{signal});
    }
    el.addEventListener('keydown',e=>shortcut(state,e),{signal,capture:true});
    el.addEventListener('keydown',e=>e.stopPropagation(),{signal});
    el.addEventListener('focusout',()=>queueMicrotask(()=>{if(state.el===el && !el.contains(document.activeElement) && !state.panel?.contains(document.activeElement)){cancelGesture(state);stop(state);refreshPlayButton(state);}}),{signal});
    state.frame=Math.min(state.frame,total(dataOf(state)));renderTimeline(state,el);
    if(state.panelType==='editor')renderEditor(state);
    if(state.panelType==='preview')setFrame(state,state.frame);
    return {dispose:()=>dispose(state),close:()=>destroyPanel(state),syncSources:media=>syncSources(state,media)};
  }
  function syncSources(state, media) {
    if(!editable(state))return;
    const before=dataOf(state), next=model().syncSources(before,media);
    if(JSON.stringify(next)!==JSON.stringify(before))save(state,next);
  }
  const api={mount,reconcile,closeAll,disposeAll:()=>{for(const s of [...runtimes.values()])dispose(s);},formatTime,frameFromClient,frameAt};
  root.CanvasClipNode=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
