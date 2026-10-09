/* 智能画布音频：沿用既有媒体容器、API面板和LLM输入。 */
function smartAudioSources(node){
    if(!node)return [];
    const refs=inputNodesFor(node).flatMap(n=>imagesForNode(n));
    return refs.map(ref=>({...ref,kind:mediaKindForItem(ref)}));
}
function smartApiAudioMode(node,value=settings,refs=null){
    return value?.engine==='api' && value.apiKind!=='video'
        && (!!node && window.CanvasAudio.isActive(node) || window.CanvasAudio.mode(value,[{refs:refs || smartAudioSources(node)}]));
}
function renderSmartApiAudioParams(){
    dynamicParams.innerHTML=window.CanvasAudio.parameterHtml(settings,apiProviders,{smart:true,allowImageReturn:!smartAudioSources(activeSettingsSubject()).some(ref=>ref.kind==='audio')});
    dynamicParams.querySelectorAll('select[data-audio-param]').forEach(select=>{
        const control=document.createElement('div');control.className='smart-control';
        const current=select.selectedOptions[0]?.textContent || select.getAttribute('aria-label');
        control.innerHTML=`<button class="smart-pill" type="button"><span>${escapeHtml(current)}</span><i data-lucide="chevron-down" class="pill-caret"></i></button><div class="smart-popover compact-popover"><div class="smart-popover-title">${escapeHtml(select.getAttribute('aria-label'))}</div><div class="model-list">${[...select.options].map(option=>`<button type="button" class="direct-option ${option.selected?'active':''}" data-smart-param="${escapeAttr(select.dataset.audioParam)}" data-smart-value="${escapeAttr(option.value)}">${escapeHtml(option.textContent)}</button>`).join('')}</div></div>`;
        select.replaceWith(control);
    });
    window.CanvasAudio.bindParameters(dynamicParams,settings,rerender=>{persistActiveSmartSettings();scheduleSave();if(rerender)renderDynamicParams();});
    apiKindToggle.style.display='none';
}
function smartAudioTaskHost(node){
    return {providers:apiProviders,live:current=>nodes.includes(node)&&current===node,
        render:()=>render(),save:scheduleSave,persist:saveCanvas,
        done:item=>{
            node.pending=0;node.running=false;
            if(item.kind==='text')node.audioOutputText=item.text;
            else {delete node.audioOutputText;replaceOutputsToNodeWithHistory(node,[{...item,generatedResult:true}],'audio',null);}
            node.runFinishedAt=Date.now();
            const snapshot=node.audioRunSnapshot || {};
            addSmartGenerationLog({run:{...smartRunSnapshot(node,snapshot.prompt || '',[],item.kind==='text'?'text':'audio'),settings:{engine:'api',provider_id:snapshot.provider,model:snapshot.model},audioRequest:{task_id:node.audioTaskId,provider_id:snapshot.provider,model:snapshot.model,operation:snapshot.operation}},outputs:item.url?[item]:[],runMs:Math.max(0,Date.now()-(node.audioStartedAt || Date.now()))});
        }};
}
async function runSmartApiAudio(node,prompt,refs,value){
    const host=smartAudioTaskHost(node);
    if(window.CanvasAudio.isActive(node))return window.CanvasAudio.poll(node,host);
    const clean=(refs || []).map(ref=>({...ref,kind:mediaKindForItem(ref)}));
    node.audioStartedAt=Date.now();
    return window.CanvasAudio.submit(node,prompt,clean,{...value},host);
}
function resumeSmartAudioTasks(){
    nodes.filter(n=>window.CanvasAudio.isActive(n)).forEach(node=>window.CanvasAudio.poll(node,smartAudioTaskHost(node)).catch(()=>{}));
}
function smartAudioBodyHtml(node){
    const items=node.images || [];
    if(node.audioOutputText){
        const media=items.length===1 && mediaKindForItem(items[0])==='audio'
            ? window.CanvasAudio.mediaHtml(items[0],node) : '';
        return `<div class="audio-smart-node">${media}<div class="audio-recognition-result">${escapeHtml(node.audioOutputText)}</div></div>`;
    }
    if(items.length===1 && mediaKindForItem(items[0])==='audio'){
        return `<div class="audio-smart-node">${window.CanvasAudio.mediaHtml(items[0],node)}</div>`;
    }
    if(node.audioOutputText || node.audioTaskId && node.audioStatus!=='done')return `<div class="audio-smart-node">${node.audioOutputText?`<div class="audio-recognition-result">${escapeHtml(node.audioOutputText)}</div>`:''}${node.audioTaskId && node.audioStatus!=='done'?window.CanvasAudio.mediaHtml({},node):''}</div>`;
    return '';
}
function bindSmartAudioMedia(el,node){
    const item=node.images?.[0] || {};if(!el.querySelector('[data-audio-card]'))return;
    window.CanvasAudio.bindMedia(el,item,node,{save:scheduleSave,query:()=>window.CanvasAudio.poll(node,smartAudioTaskHost(node)).catch(error=>toast(error.message)),
        download:async audio=>{const response=await fetch(audio.url);if(!response.ok)throw new Error('下载失败');const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=audio.name || 'audio';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);},
        library:audio=>addUrlToAssetLibrary(audio.url,audio.name),error:message=>toast(message)});
}
