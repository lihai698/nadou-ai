/* 普通画布音频适配；图片生成入口保持原分支。 */
function canvasApiAudioMode(node, sources=generatorSources(node)){
    return window.CanvasAudio.mode(node, sources);
}
function canvasAudioModelOptions(providerId){
    const provider=apiProviders.find(p=>p.id===providerId);
    const models=window.CanvasAudio.models(provider);
    return models.length ? `<optgroup label="音频识别／生成">${models.map(model=>`<option value="audio:${escapeAttr(model)}">${escapeHtml(window.CanvasAudio.modelName(provider,model))}</option>`).join('')}</optgroup>` : '';
}
function canvasAudioProviderOptions(selectedId){
    return window.CanvasAudio.providers(apiProviders).filter(p=>!imageApiProviders().some(image=>image.id===p.id))
        .map(p=>`<option value="${escapeAttr(p.id)}" ${selectedId===p.id?'selected':''}>${escapeHtml(p.name || p.id)}</option>`).join('');
}
function canvasAudioMaterialHost(){
    return {save:scheduleSave, download:item=>downloadUrl(item.url,item.name || outputImageName(item.url)),
        library:async item=>{if(!canvasAssetLibrary?.libraries?.length)await loadCanvasAssetLibrary({renderPanel:false});return addUrlToCanvasAssetLibrary(item.url,item.name);},error:message=>showErrorModal(message,'音频素材')};
}
function renderCanvasAudioMaterial(node){
    const wrap=document.createElement('div');
    wrap.innerHTML=window.CanvasAudio.mediaHtml(node);
    window.CanvasAudio.bindMedia(wrap,node,node,canvasAudioMaterialHost());
    wrap.ondragover=e=>allowImageNodeDropEvent(e,wrap);
    wrap.ondrop=e=>handleImageNodeDropEvent(e,node.id,wrap);
    return wrap;
}
function renderCanvasApiAudio(node, sources){
    const wrap=document.createElement('div');wrap.className='generator-body api-audio-body';
    const querying=window.CanvasAudio.isActive(node);
    const inputStatus=sources.some(src=>src.refs?.some(ref=>ref.kind==='audio'))?'音频已连接':'音频生成';
    wrap.innerHTML=`<div class="prompt-list"></div><div class="audio-input-caption">输入内容 <span>${inputStatus}</span></div><div class="input-list"></div><div class="gen-settings">${window.CanvasAudio.parameterHtml(node,apiProviders,{allowImageReturn:!sources.some(src=>src.refs?.some(ref=>ref.kind==='audio'))})}</div><div class="gen-run-row"><button class="gen-btn" ${node.running || !querying && !window.CanvasAudio.ready(node,apiProviders)?'disabled':''}><i data-lucide="${querying?'refresh-cw':'zap'}"></i>${querying?'查询原任务':tr('canvas.apiGenerate')}</button>${cascadeBtnHtml(node)}</div>${node.audioError?`<div class="audio-task-error">${escapeHtml(node.audioError)}</div>`:''}${node.audioOutputText?`<div class="audio-recognition-result">${escapeHtml(node.audioOutputText)}</div>`:''}`;
    renderPromptPreview(wrap.querySelector('.prompt-list'),sources.filter(s=>s.prompt));
    if(sources.some(s=>s.refs?.length))renderVideoImageInputs(wrap.querySelector('.input-list'),node,sources.filter(s=>s.refs?.length));
    else wrap.querySelector('.input-list').remove();
    window.CanvasAudio.bindParameters(wrap,node,rerender=>{if(rerender)refreshNodes([node.id]);scheduleSave();});
    wrap.querySelector('.gen-btn').onclick=()=>runCanvasApiAudio(node).catch(error=>showErrorModal(error.message,'音频处理失败'));
    bindCascadeButtons(wrap,node.id);
    return wrap;
}
function canvasAudioTaskHost(node, opts={}){
    const identity=node;
    return {providers:apiProviders,live:current=>nodes.includes(identity)&&current===identity,
        render:()=>refreshNodes([node.id,...outputNodesForSource(node.id).map(n=>n.id),...connections.filter(c=>c.from===node.id).map(c=>c.to)]),
        save:scheduleSave,persist:saveCanvas,
        done:item=>{
            if(item.kind==='text'){
                node.audioOutputText=item.text;
                outputNodesForSource(node.id).forEach(out=>{out.audioOutputText=item.text;});
            }else{
                delete node.audioOutputText;
                outputNodesForSource(node.id).forEach(out=>{delete out.audioOutputText;});
                const out=outputForNode(node,460);
                mergeGeneratedOutputs(node,[item],Boolean(opts.cascade));
                if(out)appendOutputImagesWithoutDuplicates(out,[item]);
                syncConnectedOutputsFromGenerated(node,[item]);
            }
            node.runStatus='done';node.runError='';
            const snapshot=node.audioRunSnapshot || {};
            addGenerationLog({run:{nodeType:'generator',node:{...node,apiProvider:snapshot.provider,model:snapshot.model},prompt:snapshot.prompt || '',taskLabel:snapshot.model || 'API Audio',request:{task_id:node.audioTaskId,provider_id:snapshot.provider,model:snapshot.model}},outputs:item.url?[item]:[],runMs:Math.max(0,Date.now()-(node.audioStartedAt || Date.now()))});
        }};
}
async function runCanvasApiAudio(node, opts={}){
    const host=canvasAudioTaskHost(node,opts);
    if(window.CanvasAudio.isActive(node))return window.CanvasAudio.poll(node,host);
    const sources=orderedSources(node,generatorSources(node));
    const prompt=sources.map(s=>s.prompt).filter(Boolean).join('\n\n');
    const refs=sources.flatMap(s=>s.refs || []);
    node.audioStartedAt=Date.now();
    try{return await window.CanvasAudio.submit(node,prompt,refs,{...node},host);}
    catch(error){node.runError=error.message;node.runStatus='failed';refreshNodes([node.id]);scheduleSave();throw error;}
}
function resumeCanvasAudioTasks(){
    nodes.filter(n=>n.type==='generator'&&window.CanvasAudio.isActive(n)).forEach(node=>{
        window.CanvasAudio.poll(node,canvasAudioTaskHost(node)).catch(()=>{});
    });
}

// 独立设置页关闭后回到普通画布，补齐未收到广播时的音频模型列表。
let canvasAudioConfigVersion='';
let canvasAudioConfigRefresh=null;
async function refreshCanvasAudioConfigOnReturn(){
    let version='';
    try{version=localStorage.getItem('studio-api-updated-at') || '';}catch(_){}
    if(!version || version===canvasAudioConfigVersion || canvasAudioConfigRefresh) return;
    canvasAudioConfigRefresh=refreshCanvasConfigFromSettings();
    try{await canvasAudioConfigRefresh;canvasAudioConfigVersion=version;}finally{canvasAudioConfigRefresh=null;}
}
window.addEventListener('focus',refreshCanvasAudioConfigOnReturn);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCanvasAudioConfigOnReturn();});
