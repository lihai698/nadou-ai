/* 音频素材与 API 音频任务共用契约。素材卡片不包含模型设置。 */
(function(root){
    'use strict';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const voices = ['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse','marin','cedar'];
    const active = new WeakMap();
    const waveforms = new Map();
    function capabilities(provider={}){
        const protocol = provider.audio_generation_protocol || 'openai-speech';
        const minimax = protocol === 'minimax-speech', music = protocol === 'minimax-music';
        return {protocol, music, speed:!music, pitch:minimax, volume:minimax,
            instructions:!!provider.audio_generation_instructions && !minimax && !music,
            voices:provider.audio_generation_voices?.length ? provider.audio_generation_voices : music ? [] : minimax ? ['male-qn-qingse'] : voices,
            formats:minimax || music ? ['mp3','wav','flac'] : ['mp3','wav','opus','aac','flac'], minSpeed:minimax ? .5 : .25, maxSpeed:minimax ? 2 : 4};
    }
    function providers(items=[]){ return items.filter(p=>p.enabled!==false && (p.audio_generation_models?.length || (p.protocol || 'openai')==='openai' && p.audio_models?.length)); }
    function models(provider={}){return [...new Set([...(provider.audio_generation_models || []),...((provider.protocol || 'openai')==='openai' ? provider.audio_models || [] : [])])];}
    function ready(value,items=[]){return providers(items).some(p=>p.id===value.audioProvider && models(p).includes(value.audioModel));}
    function modelName(provider,model){return provider?.model_names?.[model] || model;}
    function operation(value,items=[]){const p=items.find(p=>p.id===value.audioProvider);return p?.audio_models?.includes(value.audioModel) && !p?.audio_generation_models?.includes(value.audioModel) ? 'recognition' : 'generation';}
    // 上游有音频时仍保留下游节点的通用模型选择；只有用户明确选了音频模型，
    // 或者节点仍在音频任务中，才切换到音频生成/识别参数面板。
    function mode(value,sources=[]){return isActive(value) || !!value.audioManualSelection || (!!value.audioModel && sources.some(src=>(src.refs || []).some(ref=>ref.kind==='audio')));}
    function detachTask(value){['audioTaskId','audioStatus','audioError','audioTaskOperation','audioRunSnapshot'].forEach(key=>delete value[key]);value.running=false;}
    function migrate(node){
        if(node?.type === 'image' && (node.mediaKind === 'audio' || /\.(mp3|wav|m4a|aac|ogg|flac|opus)(?:[?#]|$)/i.test(node.url || ''))){
            node.type='audio';delete node.mediaKind;if(node.h===336)delete node.h;
        }
        return node;
    }
    function parameterHtml(value, items, {smart=false,allowImageReturn=false}={}){
        const list=providers(items), provider=list.find(p=>p.id===value.audioProvider), cap=capabilities(provider);
        const valid=ready(value,items), more=cap.pitch || cap.volume || cap.instructions || cap.music;
        const recognition=operation(value,items)==='recognition';
        const options=(values, selected)=>values.map(item=>`<option value="${escape(typeof item==='object'?item.id:item)}" ${typeof item==='object' && item.title?`title="${escape(item.title)}"`:''} ${selected===(typeof item==='object'?item.id:item)?'selected':''}>${escape(typeof item==='object'?item.name || item.id:item)}</option>`).join('');
        const select=(label,key,values,current)=>`<select aria-label="${label}" class="select-lite" data-audio-param="${key}">${options(values,current)}</select>`;
        const number=(label,key,min,max,step,defaultValue)=>`<label class="audio-field"><span>${label}</span><input class="setting-input" type="number" min="${min}" max="${max}" step="${step}" data-audio-param="${key}" value="${escape(value[key]??defaultValue)}"></label>`;
        return `<div class="api-audio-params ${smart?'smart-api-audio-params':''}"><div class="gen-settings-row">
            ${select('音频平台','audioProvider',[{id:'',name:'选择音频平台'},...list],value.audioProvider || '')}
            ${select('音频模型','audioModel',[{id:'',name:'选择音频模型'},...models(provider).map(id=>({id,name:modelName(provider,id)})),...(!valid && value.audioModel?[{id:value.audioModel,name:`已失效：${value.audioModel}`}]:[]),...(allowImageReturn?[{id:'__image__',name:'返回原图片模型选择'}]:[])],value.audioModel || '')}</div>
            ${!valid?`<div class="audio-capability-note">${value.audioModel?'已选音频模型不可用，请重新选择平台和模型。':'请选择音频平台和模型。'}</div><a class="audio-config-link" href="/static/api-settings.html" target="_blank">在 API 设置中拉取并选择音频模型</a>`:''}
            ${!valid ? '' : recognition ? `<div class="gen-settings-row">${select('识别语言','audioLanguage',[{id:'',name:'语言：自动检测'},{id:'zh',name:'中文'},{id:'en',name:'英语'},{id:'ja',name:'日语'},{id:'ko',name:'韩语'}],value.audioLanguage || '')}</div><div class="audio-capability-note">识别结果为文本，可连接到现有 LLM；点击 API生成才执行。</div>` : `<div class="gen-settings-row">${!cap.music ? select('音色','audioVoice',cap.voices.map((id,index)=>({id,name:index===0?`音色：默认`:`音色：${id}`,title:index===0?`默认音色（${id}）`:id})),value.audioVoice || cap.voices[0]) : ''}${select('格式','audioFormat',cap.formats.map(id=>({id,name:`格式：${id.toUpperCase()}`})),value.audioFormat || 'mp3')}${cap.speed ? select('语速','audioSpeed',['0.5','0.75','1','1.25','1.5','2'].map(id=>({id,name:`语速：${id}倍`})),String(value.audioSpeed || '1')) : ''}${more?'<button class="select-lite audio-advanced-toggle" type="button" title="更多参数"><i data-lucide="sliders-horizontal"></i><span>更多参数</span></button>':''}</div><div class="audio-capability-note">当前生成协议不支持参考音频。</div>${more?`<div class="audio-advanced-params" ${value.audioShowAdvanced?'':'hidden'}>
            ${cap.pitch ? number('音调','audioPitch',-12,12,1,0) : ''}${cap.volume ? number('音量','audioVolume',0,10,.1,1) : ''}
            ${cap.instructions?`<label class="audio-field audio-field-wide"><span>声音指令</span><textarea data-audio-param="audioInstructions" rows="2" maxlength="2000">${escape(value.audioInstructions || '')}</textarea></label>`:''}
            ${cap.music?`<label class="audio-field audio-field-wide"><span>歌词</span><textarea data-audio-param="audioLyrics" rows="3" maxlength="3500">${escape(value.audioLyrics || '')}</textarea></label>`:''}
            <button class="secondary-btn audio-reset" type="button" data-audio-reset>重置参数</button></div>`:''}`}
        </div>`;
    }
    function bindParameters(element, value, changed){
        element.querySelectorAll('[data-audio-param]').forEach(input=>{
            const key=input.dataset.audioParam;
            input.addEventListener(input.tagName==='SELECT'?'change':'input',event=>{
                event.stopPropagation();
                if(key==='audioModel' && input.value==='__image__'){value.audioManualSelection=false;changed(true);return;}
                value[key]=input.value;
                if(key==='audioProvider'){ value.audioModel=''; value.audioVoice=''; }
                changed(key==='audioProvider' || key==='audioModel');
            });
        });
        element.querySelector('.audio-advanced-toggle')?.addEventListener('click',event=>{event.stopPropagation();value.audioShowAdvanced=!value.audioShowAdvanced;changed(true);});
        element.querySelector('[data-audio-reset]')?.addEventListener('click',event=>{
            event.stopPropagation(); ['audioVoice','audioFormat','audioSpeed','audioPitch','audioVolume','audioInstructions','audioLyrics'].forEach(key=>delete value[key]); changed(true);
        });
    }
    function time(seconds){ const n=Math.max(0,Number(seconds)||0); return `${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`; }
    function mediaHtml(item={}, state={}){
        const url=item.url || '', fmt=(item.mime || '').replace('audio/','').toUpperCase() || (url.split(/[?#]/)[0].split('.').pop() || 'AUDIO').toUpperCase();
        const labels={queued:'排队中',running:'处理中',done:'完成',failed:'处理失败','query-paused':'查询暂停',unknown:'提交状态未知'};
        return `<div class="canvas-audio-card" data-audio-card>
            <div class="audio-file-heading"><i data-lucide="file-audio"></i><div><strong>${escape(item.name || '音频素材')}</strong><span data-audio-info>${escape(fmt)}${item.durationSeconds?' · '+time(item.durationSeconds):''}${item.sizeBytes?' · '+(Number(item.sizeBytes)/1048576).toFixed(2)+' MB':''}</span></div></div>
            ${url?`<canvas class="audio-waveform" width="600" height="80" aria-label="音频波形"></canvas><audio controls preload="metadata" src="${escape(url)}" data-url="${escape(url)}"></audio>
            <div class="audio-card-actions"><button type="button" class="secondary-btn" data-audio-download><i data-lucide="download"></i>下载</button><button type="button" class="secondary-btn" data-audio-library><i data-lucide="library"></i>存入素材库</button><span class="audio-drag-handle" draggable="true" data-audio-drag title="拖出音频到画布或素材库"><i data-lucide="grip-vertical"></i>拖出</span></div>`:
            state.audioTaskId?'<div class="audio-empty-task"><i data-lucide="audio-lines"></i>等待音频结果</div>':'<button type="button" class="blank-image" data-audio-upload><i data-lucide="upload-cloud"></i>拖入或点击上传音频</button>'}
            ${state.audioStatus?`<div class="audio-task-state" data-state="${escape(state.audioStatus)}">${escape(labels[state.audioStatus] || state.audioStatus)}</div>`:''}
            ${state.audioError?`<div class="audio-task-error">${escape(state.audioError)}</div>`:''}
            ${state.audioTaskId && ['query-paused','unknown'].includes(state.audioStatus)?'<button type="button" class="secondary-btn" data-audio-query>查询原任务</button>':''}
        </div>`;
    }
    async function bindMedia(element, item, state, host){
        const card=element.querySelector('[data-audio-card]'); if(!card) return;
        card.addEventListener('mousedown',event=>{ if(event.target.closest('audio,button,a,[data-audio-drag]'))event.stopPropagation(); });
        card.querySelector('[data-audio-upload]')?.addEventListener('click',()=>host.upload?.());
        card.querySelector('[data-audio-download]')?.addEventListener('click',()=>Promise.resolve(host.download(item)).catch(error=>host.error(error.message)));
        card.querySelector('[data-audio-library]')?.addEventListener('click',async event=>{
            const btn=event.currentTarget;btn.disabled=true;
            try { await host.library(item); } catch(error){host.error(error.message);} finally{btn.disabled=false;}
        });
        card.querySelector('[data-audio-query]')?.addEventListener('click',()=>host.query());
        const handle=card.querySelector('[data-audio-drag]');
        handle?.addEventListener('dragstart',event=>{
            event.stopPropagation();event.dataTransfer.effectAllowed='copy';
            event.dataTransfer.setData('application/x-canvas-output-image',item.url);
            event.dataTransfer.setData('application/x-smart-asset',JSON.stringify({...item,kind:'audio'}));
            event.dataTransfer.setData('text/uri-list',item.url);
            event.dataTransfer.setData('text/plain',item.url);
        });
        const audio=card.querySelector('audio'); if(!audio) return;
        audio.addEventListener('loadedmetadata',()=>{
            if(Number.isFinite(audio.duration) && audio.duration>0){item.durationSeconds=audio.duration;host.save();}
            const info=card.querySelector('[data-audio-info]'); if(info) info.textContent=`${(item.mime || 'audio').replace('audio/','').toUpperCase()} · ${time(audio.duration)}${item.sizeBytes?' · '+(item.sizeBytes/1048576).toFixed(2)+' MB':''}`;
        });
        audio.addEventListener('error',()=>{card.querySelector('[data-audio-info]').textContent='音频无法播放，请检查文件或下载后播放';});
        drawWaveform(card.querySelector('canvas'),item.url);
    }
    async function drawWaveform(canvas,url){
        if(!canvas || !url) return;
        const paint=peaks=>{
            if(!canvas.isConnected) return;
            const ctx=canvas.getContext('2d'), h=canvas.height, w=canvas.width;
            ctx.clearRect(0,0,w,h);ctx.fillStyle=getComputedStyle(canvas).color;
            peaks.forEach((peak,i)=>{const height=Math.max(2,peak*(h-12));ctx.fillRect(i*w/peaks.length,(h-height)/2,Math.max(1,w/peaks.length-2),height);});
        };
        try{
            if(waveforms.has(url)){paint(await waveforms.get(url));return;}
            const pending=(async()=>{
                const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
                if(!response.ok) throw new Error('waveform');
                const data=await response.arrayBuffer();
                if(data.byteLength>20*1048576) throw new Error('large waveform');
                const Context=root.AudioContext || root.webkitAudioContext; if(!Context) throw new Error('decoder');
                const context=new Context();
                try{
                    const buffer=await context.decodeAudioData(data), samples=buffer.getChannelData(0), count=120, peaks=[];
                    for(let i=0;i<count;i++){let peak=0;const from=Math.floor(i*samples.length/count),to=Math.floor((i+1)*samples.length/count),step=Math.max(1,Math.floor((to-from)/400));for(let n=from;n<to;n+=step)peak=Math.max(peak,Math.abs(samples[n]));peaks.push(peak);}
                    const max=Math.max(...peaks,.01);return peaks.map(p=>p/max);
                }finally{await context.close();}
            })();
            if(waveforms.size>=50) waveforms.delete(waveforms.keys().next().value);
            waveforms.set(url,pending);paint(await pending);
        }catch(error){waveforms.delete(url);canvas.title='波形暂不可用，仍可使用播放器';canvas.style.display='none';}
    }
    async function request(url,options={}){
        const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});
        const body=await response.json().catch(()=>({}));
        if(!response.ok){const error=new Error(typeof body.detail==='string'?body.detail:`音频请求失败（${response.status}）`);error.rejected=response.status>=400 && response.status<500 && ![408,429].includes(response.status);throw error;}
        return body;
    }
    function isActive(node){return !!node.audioTaskId && ['queued','running','query-paused','unknown'].includes(node.audioStatus);}
    async function poll(node, host){
        const id=node.audioTaskId;if(!id)return null;
        if(active.has(node))return active.get(node);
        const job=(async()=>{
            try{
                while(host.live(node) && node.audioTaskId===id){
                    const task=await request(`/api/canvas-audio-tasks/${encodeURIComponent(id)}`);
                    if(!host.live(node) || node.audioTaskId!==id)return null;
                    if(task.status==='succeeded'){
                        const item=task.result?.kind==='text' ? task.result : task.result?.audios?.[0]; if(!item?.url && !item?.text) throw new Error('任务没有返回有效结果');
                        node.audioStatus='done';node.audioError='';node.running=false;await host.done(item);host.render();host.save();return item;
                    }
                    if(task.status==='failed'){node.audioStatus='failed';node.running=false;node.audioError=task.error || '音频生成失败';host.render();host.save();throw Object.assign(new Error(node.audioError),{terminal:true});}
                    if(task.status==='unknown'){node.audioStatus='unknown';node.running=false;node.audioError=task.error || '提交状态未知，请勿重复生成';host.render();host.save();throw Object.assign(new Error(node.audioError),{terminal:true});}
                    if(node.audioStatus!==task.status){node.audioStatus=task.status;host.render();host.save();}
                    await new Promise(resolve=>setTimeout(resolve,1800));
                }
                return null;
            }catch(error){
                if(host.live(node) && !error.terminal){node.audioStatus='query-paused';node.audioError=error.message;node.running=false;host.render();host.save();}
                throw error;
            }
        })();active.set(node,job);
        try{return await job;}finally{active.delete(node);}
    }
    async function submit(node,prompt,refs,value,host){
        if(isActive(node))throw new Error('原音频任务尚未确认结束，请先查询原任务');
        if(!value.audioProvider || !value.audioModel)throw new Error('请在 API 面板选择音频平台和模型');
        if(host.providers && !ready(value,host.providers))throw new Error('已选音频模型不可用，请重新选择平台和模型');
        const recognition=operation(value,host.providers || [])==='recognition';
        if(!recognition && !String(prompt || '').trim())throw new Error('请填写台词或音乐描述，或连接提示词节点');
        if(recognition && (refs?.length!==1 || refs[0].kind!=='audio'))throw new Error('识别需要连接一个音频素材；其他素材请在下游继续使用');
        if(!recognition && refs?.length)throw new Error('当前音频生成模型不支持参考音频，请选择识别模型或断开参考素材');
        const id='canvas_audio_'+crypto.randomUUID().replaceAll('-','');
        node.audioTaskOperation=recognition?'recognition':'generation';node.audioRunSnapshot={prompt,provider:value.audioProvider,model:value.audioModel};
        node.audioTaskId=id;node.audioStatus='queued';node.audioError='';node.running=true;
        host.render();
        // POST 前必须把编号保存到真实画布，响应丢失仍可按原编号查询。
        let persisted=false;
        try{persisted=await host.persist();}catch(error){persisted=false;}
        if(!persisted){node.audioStatus='failed';node.audioError='画布保存失败，本次音频请求未提交';node.running=false;host.render();host.save();throw new Error(node.audioError);}
        try{
            const result=await request('/api/canvas-audio-tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_task_id:id,provider_id:value.audioProvider,model:value.audioModel,prompt,settings:value,references:refs || [],operation:node.audioTaskOperation})});
            if(result.task_id!==id)throw new Error('音频提交未返回原任务编号');
        }catch(error){node.audioStatus=error.rejected?'failed':'query-paused';node.audioError=error.message;node.running=false;host.render();host.save();throw error;}
        return poll(node,host);
    }
    root.CanvasAudio={capabilities,providers,models,ready,modelName,operation,mode,detachTask,migrate,parameterHtml,bindParameters,mediaHtml,bindMedia,submit,poll,isActive};
    if(typeof module!=='undefined')module.exports=root.CanvasAudio;
})(typeof window!=='undefined'?window:globalThis);
