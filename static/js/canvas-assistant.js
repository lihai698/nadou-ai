/* 两种画布共用的助手界面；画布访问通过 mount 适配器注入。 */
(function(global){
    'use strict';
    const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
    const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch(_) { return null; } };
    const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch(_) {} };
    function buildCreationSettings(inherited, imageChoice){
        const settings={...(inherited||{})};
        if(imageChoice){
            const [provider,model]=JSON.parse(imageChoice);
            Object.assign(settings,{engine:'api',provider_id:provider,model});
        }
        return settings;
    }
    async function consumeStream(response, onEvent){
        if(!response.body) throw new Error('回复连接不可用');
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '', ended = false;
        try {
            while(true){
                const {done, value} = await reader.read();
                buffer += decoder.decode(value || new Uint8Array(), {stream:!done});
                const lines = buffer.split('\n'); buffer = lines.pop();
                if(done && buffer.trim()){ lines.push(buffer); buffer=''; }
                for(const line of lines){
                    if(!line.trim()) continue;
                    const event = JSON.parse(line);
                    if(ended) throw new Error('回复结束后仍收到内容');
                    onEvent(event);
                    if(event.type === 'turn_end') ended = true;
                }
                if(done) break;
            }
            if(!ended) throw new Error('回复没有完整结束，请查看历史后重试');
        } finally { reader.releaseLock(); }
    }
    function mount(adapter){
        if(global.canvasAssistantController) global.canvasAssistantController.destroy();
        const button = document.getElementById('canvasAssistantToggle');
        if(!button) return null;
        const panel = document.createElement('aside');
        panel.className = 'canvas-assistant'; panel.hidden = true; panel.setAttribute('aria-label','创作助手');
        panel.innerHTML = `<header class="canvas-assistant-head"><div class="canvas-assistant-heading">${icon('sparkles')}创作助手</div><div class="canvas-assistant-head-actions"><button type="button" data-action="fold" aria-label="收起助手" title="收起">${icon('minus')}</button><button type="button" data-action="new" aria-label="新建对话" title="新建对话">${icon('plus')}</button><button type="button" data-action="history" aria-label="历史对话" title="历史对话">${icon('history')}</button><button type="button" data-action="close" aria-label="关闭助手" title="关闭">${icon('x')}</button></div></header><div class="canvas-assistant-subhead"></div><div class="canvas-assistant-messages" aria-live="polite"></div><div class="canvas-assistant-compose"><div class="canvas-assistant-context"><div class="canvas-assistant-context-chips"></div><button type="button" class="canvas-assistant-view" hidden>在画布上查看</button></div><div class="canvas-assistant-input"><textarea aria-label="给创作助手的消息" placeholder="描述想法，@ 选择图片或视频" maxlength="12000"></textarea></div><div class="canvas-assistant-send-row"><button type="button" class="canvas-assistant-template" data-action="templates" title="从模板库选择提示词">${icon('library')}<span>模板库</span></button><button type="button" class="canvas-assistant-model-toggle" data-action="models" aria-label="模型" aria-expanded="false" aria-controls="canvas-assistant-model-picker" title="选择聊天模型">${icon('boxes')}<span>模型</span></button><button type="button" class="canvas-assistant-send" data-action="send">发送</button></div><div class="canvas-assistant-model-picker" id="canvas-assistant-model-picker" role="group" aria-label="选择聊天模型" hidden><div class="canvas-assistant-model-category">文本模型</div><div class="canvas-assistant-model-row"><select class="select-lite canvas-assistant-model-provider" aria-label="聊天平台"><option value="">选择平台</option></select><select class="select-lite canvas-assistant-model-select" aria-label="聊天模型"><option value="">选择模型</option></select><input type="checkbox" class="canvas-assistant-model-confirm" aria-label="指定文本模型" title="勾选指定文本模型"></div><div class="canvas-assistant-model-category">图片模型</div><div class="canvas-assistant-model-row"><select class="select-lite canvas-assistant-image-provider" aria-label="图片平台"><option value="">选择平台</option></select><select class="select-lite canvas-assistant-image-select" aria-label="图片模型"><option value="">选择模型</option></select><input type="checkbox" class="canvas-assistant-image-confirm" aria-label="指定图片模型" title="勾选指定图片模型"></div></div><div class="canvas-assistant-status" role="status"></div></div><button type="button" class="canvas-assistant-height" aria-label="调整窗口高度" title="拖动调整高度，也可用上下方向键"></button>`;
        const dock = document.createElement('div'); dock.className='canvas-assistant-dock'; dock.hidden=true;
        dock.innerHTML=`<span class="canvas-assistant-dock-grip">${icon('grip-vertical')}</span><button type="button" aria-label="展开创作助手">${icon('sparkles')}创作助手</button>`;
        document.body.append(panel,dock);
        const messages=panel.querySelector('.canvas-assistant-messages'), input=panel.querySelector('textarea'), models=panel.querySelector('.canvas-assistant-model-select'), status=panel.querySelector('.canvas-assistant-status'), sendButton=panel.querySelector('[data-action=send]'), viewButton=panel.querySelector('.canvas-assistant-view');
        const modelProvider=panel.querySelector('.canvas-assistant-model-provider'), modelPicker=panel.querySelector('.canvas-assistant-model-picker'), modelToggle=panel.querySelector('[data-action=models]');
        const imageProvider=panel.querySelector('.canvas-assistant-image-provider'), imageModels=panel.querySelector('.canvas-assistant-image-select'), textConfirm=panel.querySelector('.canvas-assistant-model-confirm'), imageConfirm=panel.querySelector('.canvas-assistant-image-confirm');
        let imageProviders=[];
        const listeners=[], cleanups=[];
        let canvasId='', session=null, sessions=[], references=[], assetReferences=[], referenceItems=[], picker=null, pickerToken=0, request=null, busy=false, providers=[], historyShown=false, destroyed=false, sequence=0, viewingChanges=false, mentionStart=-1;
        let user='';
        try { user=localStorage.getItem('gpt_chat_browser_user')||crypto.randomUUID(); localStorage.setItem('gpt_chat_browser_user',user); } catch(_) { user=crypto.randomUUID(); }
        const headers = {'Content-Type':'application/json','X-User-Id':user};
        const layoutKey=`canvas_assistant_layout_${adapter.kind}`;
        function listen(target,type,fn,options){ target.addEventListener(type,fn,options); listeners.push(()=>target.removeEventListener(type,fn,options)); }
        function icons(){ if(global.lucide) lucide.createIcons(); }
        function showStatus(value){ status.textContent=value; }
        function current(){ return adapter.getContext(); }
        function matches(id=canvasId){ return !destroyed && current()?.id===id; }
        async function api(path,body,signal){
            const response=await fetch(`/api/canvas-assistant/${path}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal});
            if(!response.ok){ const data=await response.json().catch(()=>({})); throw new Error(typeof data.detail==='string'?data.detail:'助手请求失败，请检查连接'); }
            return response.json();
        }
        function rememberLayout(){ const rect=panel.getBoundingClientRect(); write(layoutKey,{left:rect.left,top:rect.top,height:rect.height}); }
        function limits(){ const top=innerWidth<500?124:78; return {top,height:Math.max(180,innerHeight-top-12)}; }
        function clampPanel(){
            const limit=limits(); panel.style.height=`${Math.min(limit.height,Math.max(300,parseFloat(panel.style.height)||360))}px`;
            if(panel.style.left){ panel.style.left=`${Math.max(8,Math.min(innerWidth-panel.offsetWidth-8,parseFloat(panel.style.left)))}px`; panel.style.top=`${Math.max(limit.top,Math.min(innerHeight-panel.offsetHeight-8,parseFloat(panel.style.top)||limit.top))}px`; }
        }
        const layout=read(layoutKey);
        if(layout && [layout.left,layout.top,layout.height].every(Number.isFinite)){ panel.style.left=`${layout.left}px`;panel.style.top=`${layout.top}px`;panel.style.height=`${layout.height}px`;panel.style.right='auto';panel.style.bottom='auto'; }
        function closeModels(){ modelPicker.hidden=true;modelToggle.setAttribute('aria-expanded','false'); }
        function fillModels(previous=''){
            const provider=providers.find(item=>item.id===modelProvider.value);
            models.replaceChildren(new Option(provider?'选择模型':'请先选择平台',''));
            for(const model of provider?.models||[])models.add(new Option(model,JSON.stringify([provider.id,model])));
            if(previous && [...models.options].some(option=>option.value===previous))models.value=previous;
            syncControls();
        }
        function fillImageModels(previous=''){
            const provider=imageProviders.find(item=>item.id===imageProvider.value);
            imageModels.replaceChildren(new Option(provider?'选择模型':'请先选择平台',''));
            for(const model of provider?.models||[])imageModels.add(new Option(model,JSON.stringify([provider.id,model])));
            if(previous && [...imageModels.options].some(option=>option.value===previous))imageModels.value=previous;
        }
        function modelTitle(){
            const choices=[];
            if(textConfirm.checked&&models.value)choices.push(`文本：${modelProvider.selectedOptions[0].textContent} · ${models.selectedOptions[0].textContent}`);
            if(imageConfirm.checked&&imageModels.value)choices.push(`图片：${imageProvider.selectedOptions[0].textContent} · ${imageModels.selectedOptions[0].textContent}`);
            modelToggle.title=choices.join('；')||'选择并勾选文本、图片模型';
        }
        function rememberImageModel(){
            write(`canvas_assistant_image_model_${canvasId}`,imageConfirm.checked?imageModels.value:'');
            modelTitle();syncControls();
        }
        function rememberModel(){
            write(`canvas_assistant_model_${canvasId}`,textConfirm.checked?models.value:'');
            modelTitle();
            syncControls();
        }
        function syncControls(){
            sendButton.textContent=busy?'停止':'发送';sendButton.disabled=!busy&&(!models.value||!textConfirm.checked||!input.value.trim()||!session);
            viewButton.disabled=busy||viewingChanges; models.disabled=busy||!modelProvider.value; modelProvider.disabled=busy; imageProvider.disabled=busy; imageModels.disabled=busy||!imageProvider.value; textConfirm.disabled=busy||!models.value; imageConfirm.disabled=busy||!imageModels.value; modelToggle.disabled=busy||(!providers.length&&!imageProviders.length); if(busy)closeModels(); panel.querySelector('[data-action=new]').disabled=busy;panel.querySelector('[data-action=history]').disabled=busy;panel.querySelector('[data-action=templates]').disabled=busy;
        }
        function contextChips(){
            const value=current(); if(!value)return;
            const area=panel.querySelector('.canvas-assistant-context-chips');
            viewButton.hidden=!latestChange();viewButton.disabled=busy||viewingChanges;
            area.innerHTML=`<span class="canvas-assistant-chip">当前画布</span><span class="canvas-assistant-chip">选中 ${(value.selectedNodeIds||[]).length} 个节点</span>`;
            for(const id of references){ const node=value.nodes.find(n=>n.id===id);if(!node)continue;const remove=document.createElement('button');remove.type='button';remove.className='canvas-assistant-chip';remove.textContent=`@ ${node.title||node.name||'素材'} ×`;remove.setAttribute('aria-label','移除引用素材');remove.onclick=()=>{references=references.filter(ref=>ref!==id);contextChips();};area.append(remove); }
            assetReferences.forEach(item=>{const remove=document.createElement('button');remove.type='button';remove.className='canvas-assistant-chip canvas-assistant-reference-chip';const thumb=document.createElement('span');thumb.className='canvas-assistant-chip-thumb';thumb.innerHTML=adapter.referencePreview?.(item,64)||icon(item.kind==='video'?'video':'image');const label=document.createElement('span');label.textContent=`@${item.number} ${item.name} ×`;remove.append(thumb,label);remove.title=`${item.libraryName} / ${item.categoryName||item.name}`;remove.setAttribute('aria-label',`移除引用 ${item.name}`);remove.disabled=busy;remove.onclick=()=>{assetReferences=assetReferences.filter(ref=>ref.id!==item.id);contextChips();};area.append(remove);});
            adapter.bindReferencePreviews?.(area);
        }
        function latestChange(){
            return [...(session?.turns||[])].reverse().find(turn=>turn.state==='completed' && turn.change?.affectedNodeIds?.length)?.change;
        }
        viewButton.onclick=async()=>{
            const owner=canvasId,change=latestChange();if(!change||!matches(owner))return;
            viewingChanges=true;syncControls();
            try{if(!await adapter.viewChanges?.(change.affectedNodeIds))showStatus('节点正在同步，请稍后再试');}
            catch(err){showStatus(err.message||'画布同步失败，请刷新后查看');}
            finally{viewingChanges=false;contextChips();syncControls();}
        };
        function addReplyActions(container, text, media=[]){
            if(!text && !media.length)return;
            const actions=document.createElement('div');actions.className='canvas-assistant-reply-actions';
            if(text){const copy=document.createElement('button');copy.type='button';copy.title='复制回复';copy.innerHTML=`${icon('copy')}<span>复制</span>`;copy.onclick=async()=>{try{await navigator.clipboard.writeText(text);showStatus('已复制回复');}catch(_){showStatus('复制失败，请手动选择文字');}};actions.append(copy);const put=document.createElement('button');put.type='button';put.title='放到画布';put.innerHTML=`${icon('square-plus')}<span>放到画布</span>`;put.onclick=async()=>{try{if(await adapter.addTextNode?.(text))showStatus('已放到画布');else showStatus('当前画布暂不支持创建文本节点');}catch(err){showStatus(err.message||'放到画布失败');}};actions.append(put);}
            for(const item of media){const add=document.createElement('button');add.type='button';add.title='引用到画布';add.innerHTML=`${icon('image-plus')}<span>引用到画布</span>`;add.onclick=async()=>{try{if(await adapter.addImageNode?.(item.url,item.name||'助手图片'))showStatus('已引用到画布');else showStatus('当前画布暂不支持图片节点');}catch(err){showStatus(err.message||'引用图片失败');}};actions.append(add);}
            container.append(actions);icons();
        }
        function drawHistory(){
            messages.replaceChildren();
            if(!session?.turns?.length){ messages.textContent='选中节点，或引用画布素材，告诉我你的创作想法。';return; }
            for(const turn of session.turns){
                const userBubble=document.createElement('div');userBubble.className='canvas-assistant-message canvas-assistant-user';userBubble.textContent=turn.message;messages.append(userBubble);
                const reply=document.createElement('div');reply.className='canvas-assistant-message canvas-assistant-reply';reply.textContent=turn.reply||'';
                if(turn.state==='running'){reply.textContent='这一轮仍在处理…';const stop=document.createElement('button');stop.type='button';stop.textContent='停止这一轮';stop.onclick=()=>{ stop.disabled=true;api('cancel',{canvasId,sessionId:session.id,requestId:turn.id}).then(()=>selectSession(session.id)).catch(err=>showStatus(err.message));};reply.append(stop);}
                else if(turn.state!=='completed'){reply.classList.add('canvas-assistant-error');reply.textContent=turn.error||'这一轮没有完成';if(['failed','interrupted'].includes(turn.state)){const retry=document.createElement('button');retry.type='button';retry.textContent='重试';retry.onclick=()=>{input.value=turn.message;syncControls();input.focus();};reply.append(retry);}}
                if(turn.state==='completed')addReplyActions(reply,turn.reply||'',Array.isArray(turn.media)?turn.media:[]);
                messages.append(reply);
                const change=turn.change;
                if(change && (change.createdNodeIds?.length||change.updatedNodeIds?.length||change.createdEdgeIds?.length)){
                    const card=document.createElement('div');card.className='canvas-assistant-change';
                    const note=document.createElement('div');note.textContent=`已保存：新建 ${change.createdNodeIds?.length||0} 个节点，修改 ${change.updatedNodeIds?.length||0} 个节点，连线 ${change.createdEdgeIds?.length||0} 条`;
                    card.append(note);messages.append(card);
                }
            }
            messages.scrollTop=messages.scrollHeight;
        }
        async function selectSession(id){
            const owner=canvasId, token=++sequence;
            const data=await api(`history?canvasId=${encodeURIComponent(owner)}&sessionId=${encodeURIComponent(id)}`);
            if(!matches(owner)||token!==sequence)return;
            session=data.session;closeReference();historyShown=false;drawHistory();syncControls();
        }
        async function newSession(){
            if(busy)return;
            const owner=canvasId,token=++sequence;
            const data=await api('sessions',{canvasId:owner});
            if(!matches(owner)||token!==sequence)return;
            session=data.session;references=[];assetReferences=[];closeReference();historyShown=false;drawHistory();contextChips();syncControls();
        }
        async function load(){
            const value=current();if(!value?.id)throw new Error('请先打开画布');
            const owner=value.id,token=++sequence;canvasId=owner;
            const [configuration,history]=await Promise.all([api('status'),api(`sessions?canvasId=${encodeURIComponent(owner)}`)]);
            if(!matches(owner)||token!==sequence)return;
            providers=configuration.providers;imageProviders=configuration.image_providers||[];sessions=history.sessions;
            panel.querySelector('.canvas-assistant-subhead').textContent=value.title||'当前画布';
            const previous=read(`canvas_assistant_model_${owner}`);
            closeModels();modelProvider.replaceChildren(new Option('选择平台',''));
            providers.forEach(provider=>modelProvider.add(new Option(provider.name+(provider.ready?'':'（未配置密钥）'),provider.id)));
            let previousPair=[];try{previousPair=JSON.parse(previous||'[]');}catch(_){}
            if(Array.isArray(previousPair) && providers.some(provider=>provider.id===previousPair[0] && provider.models.includes(previousPair[1])))modelProvider.value=previousPair[0];
            fillModels(previous);textConfirm.checked=!!models.value;
            const previousImage=read(`canvas_assistant_image_model_${owner}`);
            imageProvider.replaceChildren(new Option('选择平台',''));
            imageProviders.forEach(provider=>imageProvider.add(new Option(provider.name+(provider.ready?'':'（未配置密钥）'),provider.id)));
            let previousImagePair=[];try{previousImagePair=JSON.parse(previousImage||'[]');}catch(_){}
            if(Array.isArray(previousImagePair) && imageProviders.some(provider=>provider.id===previousImagePair[0] && provider.models.includes(previousImagePair[1])))imageProvider.value=previousImagePair[0];
            fillImageModels(previousImage);imageConfirm.checked=!!imageModels.value;
            rememberModel();rememberImageModel();
            showStatus(providers.length?(configuration.stage==='operations'?'可创建、修改节点与连线':'当前阶段：对话与创作建议'):'请先在 API 设置中配置聊天模型');
            if(history.activeSessionId)await selectSession(history.activeSessionId);else if(sessions.length)await selectSession(sessions[0].id);else await newSession();
            contextChips();syncControls();
        }
        async function open(){ panel.hidden=false;dock.hidden=true;button.classList.add('active');button.setAttribute('aria-expanded','true');clampPanel();if(canvasId!==current()?.id||!session)await load();contextChips();icons(); }
        async function cancel(){
            if(!request)return;
            const active=request;showStatus('正在停止…');
            if(!active.submitted){active.controller.abort();showStatus('已停止本轮回复');return;}
            try{const result=await api('cancel',{canvasId:active.canvasId,sessionId:active.sessionId,requestId:active.id});if(result.state==='completed'){showStatus('这一轮已完成，请查看回复与画布');return;}active.controller.abort();showStatus('已停止；上游可能仍在处理');}
            catch(err){showStatus(err.message);}
        }
        async function send(){
            if(busy){await cancel();return;}
            if(!session||!models.value||!textConfirm.checked||!input.value.trim())return;
            const owner=canvasId,sessionId=session.id,text=input.value.trim(),[provider,model]=JSON.parse(models.value);
            closeReference();
            const selection=[...(current()?.selectedNodeIds||[])],refs=[...references],assetRefs=assetReferences.map(item=>item.id);
            const creationSettings=buildCreationSettings(current()?.creationSettings,imageConfirm.checked?imageModels.value:'');
            const active={canvasId:owner,sessionId,id:crypto.randomUUID(),controller:new AbortController()};request=active;busy=true;syncControls();showStatus('正在保存画布…');
            let ended=false,reply=null;
            try{
                if(!await adapter.save())throw new Error('画布尚未保存，请重试保存后再发送');
                if(active.controller.signal.aborted)throw new DOMException('已停止','AbortError');
                if(!matches(owner)||session?.id!==sessionId)throw new Error('画布或对话已切换');
                const value=current();
                const response=await fetch('/api/canvas-assistant/chat',{method:'POST',headers,signal:active.controller.signal,body:JSON.stringify({canvasId:owner,sessionId,requestId:active.id,message:text,provider,model,selectedNodeIds:selection,referencedNodeIds:refs,referencedAssetIds:assetRefs,expectedUpdatedAt:value.updatedAt,creationSettings})});
                if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(typeof data.detail==='string'?data.detail:'发送失败');}
                active.submitted=true;
                const userBubble=document.createElement('div');userBubble.className='canvas-assistant-message canvas-assistant-user';userBubble.textContent=text;reply=document.createElement('div');reply.className='canvas-assistant-message canvas-assistant-reply';reply.textContent='正在分析画布…';messages.append(userBubble,reply);input.value='';let output='';
                await consumeStream(response,event=>{
                    if(!matches(owner)||session?.id!==sessionId)throw new Error('画布或对话已切换');
                    if(event.type==='text_delta'){output+=event.text||'';reply.textContent=output;}
                    if(event.type==='lifecycle')showStatus('正在分析画布…');
                    if(event.type==='turn_end'){ended=true;if(event.state!=='completed'){reply.classList.add('canvas-assistant-error');reply.textContent=event.error||'这一轮没有完成';input.value=text;}else {addReplyActions(reply,output,event.media||[]);references=[];assetReferences=[];contextChips();}showStatus(event.state==='completed'?'回复完成':event.error||'这一轮没有完成');}
                    messages.scrollTop=messages.scrollHeight;
                });
            }catch(err){if(matches(owner)){input.value=text;showStatus(err.name==='AbortError'?'已停止；上游可能仍在处理':err.message);if(reply&&!ended)reply.textContent=err.name==='AbortError'?'已停止本轮回复':'回复没有完整结束，请查看历史后重试';}}
            finally{
                if(request===active){request=null;busy=false;syncControls();if(matches(owner)&&session?.id===sessionId){try{await adapter.refresh?.();if(matches(owner))await selectSession(sessionId);}catch(err){showStatus(err.message);}}}
            }
        }
        function closeReference(){pickerToken++;picker?.remove();picker=null;mentionStart=-1;}
        function addReference(item){
            if(assetReferences.some(ref=>ref.id===item.id))return false;
            const limit=item.kind==='video'?3:8;
            if(assetReferences.filter(ref=>ref.kind===item.kind).length>=limit){showStatus(`一轮最多引用 ${limit} ${item.kind==='video'?'个视频':'张图片'}`);return false;}
            assetReferences.push(item);contextChips();return true;
        }
        async function chooseReference(){
            if(busy||picker)return;
            const owner=canvasId,token=++pickerToken;
            picker=document.createElement('section');picker.className='canvas-assistant canvas-assistant-reference-picker';picker.setAttribute('role','dialog');picker.setAttribute('aria-label','选择引用素材');
            picker.innerHTML=`<header class="canvas-assistant-head"><div class="canvas-assistant-heading">${icon('images')}选择引用素材</div><button type="button" aria-label="关闭素材选择">${icon('x')}</button></header><div class="canvas-assistant-reference-tabs" role="tablist"></div><div class="canvas-assistant-reference-filters"><select aria-label="素材分类"></select><input type="search" aria-label="搜索引用素材" placeholder="搜索名称或编号"></div><div class="canvas-assistant-reference-grid"></div><div class="canvas-assistant-reference-note">选择后引用到本轮消息；最多 8 张图片、3 个视频</div>`;
            document.body.append(picker);
            const rect=panel.getBoundingClientRect();picker.style.left=`${Math.max(8,Math.min(innerWidth-picker.offsetWidth-8,rect.right-picker.offsetWidth))}px`;picker.style.top=`${Math.max(12,Math.min(innerHeight-picker.offsetHeight-12,rect.top))}px`;picker.style.right='auto';picker.style.bottom='auto';
            const ownPicker=picker,grid=picker.querySelector('.canvas-assistant-reference-grid'),tabs=picker.querySelector('[role=tablist]'),search=picker.querySelector('input'),filter=picker.querySelector('select');let source='canvas';
            ownPicker.querySelector('header button').onclick=()=>{closeReference();input.focus();};
            for(const type of ['pointerdown','mousedown','dblclick','wheel','keydown'])ownPicker.addEventListener(type,event=>event.stopPropagation());
            ownPicker.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeReference();input.focus();}});
            grid.textContent='正在读取素材…';icons();
            const render=()=>{
                const items=referenceItems.filter(item=>item.source===source),query=search.value.trim().toLowerCase();
                const visible=items.filter(item=>(!filter.value||`${item.libraryName} / ${item.categoryName}`===filter.value)&&(!query||`${item.name} ${item.number} ${item.categoryName}`.toLowerCase().includes(query)));
                grid.replaceChildren();
                if(!visible.length){const empty=document.createElement('div');empty.className='canvas-assistant-reference-empty';empty.textContent=items.length?'没有匹配的素材':source==='canvas'?'当前画布还没有图片或视频':source==='asset'?'图片资产库暂无图片或视频，请先在素材库中添加':'本地素材暂无图片或视频，请先在素材库中上传';grid.append(empty);return;}
                for(const item of visible){const card=document.createElement('button');card.type='button';card.className='canvas-assistant-reference-card';card.disabled=assetReferences.some(ref=>ref.id===item.id);card.title=`${item.libraryName} / ${item.categoryName||item.name}`;card.setAttribute('aria-label',`引用 ${item.number} ${item.name}`);const thumb=document.createElement('span');thumb.className='canvas-assistant-reference-thumb';thumb.innerHTML=adapter.referencePreview?.(item,256)||icon(item.kind==='video'?'video':'image');const number=document.createElement('span');number.className='canvas-assistant-reference-number';number.textContent=`#${item.number}`;const title=document.createElement('span');title.className='canvas-assistant-reference-name';title.textContent=item.name;const meta=document.createElement('span');meta.className='canvas-assistant-reference-meta';meta.textContent=`${item.kind==='video'?'视频':'图片'} · ${item.categoryName||item.libraryName}`;card.append(thumb,number,title,meta);card.onclick=()=>{if(!addReference(item))return;if(mentionStart>=0&&input.value[mentionStart]==='@'){input.value=input.value.slice(0,mentionStart)+input.value.slice(mentionStart+1);input.selectionStart=input.selectionEnd=mentionStart;}closeReference();syncControls();input.focus();};grid.append(card);}
                adapter.bindReferencePreviews?.(grid);icons();
            };
            const setSource=value=>{source=value;for(const button of tabs.children){button.setAttribute('aria-selected',String(button.dataset.source===source));}filter.replaceChildren();const all=document.createElement('option');all.value='';all.textContent='全部分类';filter.append(all);for(const group of new Set(referenceItems.filter(item=>item.source===source).map(item=>`${item.libraryName} / ${item.categoryName}`))){const option=document.createElement('option');option.value=group;option.textContent=group;filter.append(option);}search.value='';render();};
            for(const [value,label] of [['canvas','当前画布'],['asset','图片资产'],['local','本地素材']]){const button=document.createElement('button');button.type='button';button.setAttribute('role','tab');button.textContent=label;button.dataset.source=value;button.onclick=()=>setSource(value);tabs.append(button);}
            search.oninput=render;filter.onchange=render;
            try{if(!await adapter.save())throw new Error('请先保存画布后再引用素材');const result=await api(`reference-assets?canvasId=${encodeURIComponent(owner)}`);if(!matches(owner)||picker!==ownPicker||token!==pickerToken)return;referenceItems=(result.items||[]).map((item,index)=>({...item,number:index+1}));setSource('canvas');}
            catch(err){if(picker===ownPicker){grid.textContent=err.message||'素材读取失败';const retry=document.createElement('button');retry.type='button';retry.textContent='重试';retry.onclick=()=>{const start=mentionStart;closeReference();mentionStart=start;chooseReference();};grid.append(retry);}}
        }
        function openTemplates(){ if(busy)return; adapter.openPromptTemplates?.(text=>{input.value=String(text||'');syncControls();input.focus();}); }
        async function listSessions(){
            const owner=canvasId;const data=await api(`sessions?canvasId=${encodeURIComponent(owner)}`);if(!matches(owner))return;
            sessions=data.sessions;historyShown=true;messages.innerHTML='<div class="canvas-assistant-note">当前画布的历史对话</div>';
            const back=document.createElement('button');back.type='button';back.textContent='返回对话';back.onclick=()=>{historyShown=false;drawHistory();};messages.append(back);
            for(const record of sessions){const item=document.createElement('button');item.type='button';item.textContent=record.title;item.onclick=()=>selectSession(record.id).catch(err=>showStatus(err.message));messages.append(item);}
        }
        listen(button,'click',()=>{if(panel.hidden)open().catch(err=>showStatus(err.message));else{closeModels();panel.hidden=true;dock.hidden=true;button.classList.remove('active');button.setAttribute('aria-expanded','false');}});
        listen(panel,'click',event=>{
            const action=event.target.closest('[data-action]')?.dataset.action;
            if(action==='close'){closeModels();panel.hidden=true;dock.hidden=true;button.classList.remove('active');button.setAttribute('aria-expanded','false');}
            if(action==='fold'){const rect=panel.getBoundingClientRect();closeModels();panel.hidden=true;dock.hidden=false;dock.style.left=`${Math.min(innerWidth-dock.offsetWidth-8,rect.left)}px`;dock.style.top=`${Math.min(innerHeight-dock.offsetHeight-8,rect.bottom-dock.offsetHeight)}px`;dock.style.right='auto';dock.style.bottom='auto';}
            if(action==='new')newSession().catch(err=>showStatus(err.message));
            if(action==='history')listSessions().catch(err=>showStatus(err.message));
            if(action==='templates')openTemplates();
            if(action==='send')send();
        });
        listen(dock.querySelector('button'),'click',()=>open().catch(err=>showStatus(err.message)));
        listen(input,'input',event=>{syncControls();if(event.isComposing)return;const pos=input.selectionStart??input.value.length;const before=input.value.slice(0,pos);if(/@$/.test(before)&&!picker){mentionStart=pos-1;chooseReference();}});
        listen(panel,'dragover',event=>{if(event.dataTransfer?.types?.length){event.preventDefault();event.dataTransfer.dropEffect='copy';panel.classList.add('canvas-assistant-dragover');}});
        listen(panel,'dragleave',event=>{if(!panel.contains(event.relatedTarget))panel.classList.remove('canvas-assistant-dragover');});
        listen(panel,'drop',async event=>{
            event.preventDefault();event.stopPropagation();panel.classList.remove('canvas-assistant-dragover');if(busy)return;
            const types=[...(event.dataTransfer?.types||[])];let raw='';
            for(const type of ['application/x-canvas-output-image','application/x-canvas-asset','application/x-smart-asset','text/uri-list','text/plain']){if(types.includes(type)){raw=event.dataTransfer.getData(type);if(raw)break;}}
            let url=raw;try{const parsed=JSON.parse(raw);url=parsed.url||parsed.image?.url||'';}catch(_){}
            if(!url)return;const owner=canvasId;
            try{if(!await adapter.save())throw new Error('请先保存画布后再引用素材');const result=await api(`reference-assets?canvasId=${encodeURIComponent(owner)}`);if(!matches(owner)||busy)return;referenceItems=(result.items||[]).map((item,index)=>({...item,number:index+1}));const item=referenceItems.find(item=>item.url===url);if(!item){showStatus('请从当前画布、图片资产或本地素材选择图片或视频');return;}if(addReference(item))showStatus(`已引用：${item.name}`);}
            catch(err){showStatus(err.message||'引用素材失败');}
        });
        listen(input,'keydown',event=>{if(picker&&event.key==='Escape'){event.preventDefault();closeReference();return;}if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!busy&&!picker)send();}});
        listen(modelToggle,'click',()=>{if(modelToggle.disabled)return;const opening=modelPicker.hidden;modelPicker.hidden=!opening;modelToggle.setAttribute('aria-expanded',String(opening));if(opening)modelProvider.focus();});
        listen(modelProvider,'change',()=>{fillModels();if(modelProvider.value && models.options.length>1)models.selectedIndex=1;textConfirm.checked=false;rememberModel();});
        listen(models,'change',()=>{textConfirm.checked=false;rememberModel();});
        listen(textConfirm,'change',rememberModel);
        listen(imageProvider,'change',()=>{fillImageModels();if(imageProvider.value && imageModels.options.length>1)imageModels.selectedIndex=1;imageConfirm.checked=false;rememberImageModel();});
        listen(imageModels,'change',()=>{imageConfirm.checked=false;rememberImageModel();});
        listen(imageConfirm,'change',rememberImageModel);
        listen(document,'pointerdown',event=>{if(!modelPicker.contains(event.target)&&!modelToggle.contains(event.target))closeModels();},true);
        listen(panel,'keydown',event=>{if(event.key==='Escape'&&!modelPicker.hidden){event.preventDefault();closeModels();modelToggle.focus();}});
        for(const target of [panel,dock])for(const type of ['pointerdown','mousedown','dblclick','wheel','keydown'])listen(target,type,event=>event.stopPropagation());
        function bindMove(handle,target){
            let drag=null;
            listen(handle,'pointerdown',event=>{if(event.button!==0||event.target.closest('button'))return;const rect=target.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};handle.setPointerCapture(event.pointerId);event.preventDefault();});
            listen(handle,'pointermove',event=>{if(drag?.id!==event.pointerId)return;target.style.left=`${Math.max(8,Math.min(innerWidth-target.offsetWidth-8,drag.left+event.clientX-drag.x))}px`;target.style.top=`${Math.max(limits().top,Math.min(innerHeight-target.offsetHeight-8,drag.top+event.clientY-drag.y))}px`;target.style.right='auto';target.style.bottom='auto';});
            const end=event=>{if(drag?.id!==event.pointerId)return;drag=null;if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);if(target===panel)rememberLayout();};
            listen(handle,'pointerup',end);listen(handle,'pointercancel',end);
        }
        bindMove(panel.querySelector('header'),panel);bindMove(dock.querySelector('.canvas-assistant-dock-grip'),dock);
        const resize=panel.querySelector('.canvas-assistant-height');let resizing=null;
        function changeHeight(value){ const limit=limits(),rect=panel.getBoundingClientRect(),height=Math.min(limit.height,Math.max(300,value));panel.style.height=`${height}px`;panel.style.top=`${Math.max(limit.top,Math.min(rect.top,innerHeight-height-12))}px`;panel.style.bottom='auto'; }
        listen(resize,'pointerdown',event=>{if(event.button!==0)return;resizing={id:event.pointerId,y:event.clientY,height:panel.offsetHeight};resize.setPointerCapture(event.pointerId);event.preventDefault();});
        listen(resize,'pointermove',event=>{if(resizing?.id===event.pointerId)changeHeight(resizing.height+event.clientY-resizing.y);});
        const endResize=event=>{if(resizing?.id!==event.pointerId)return;resizing=null;if(resize.hasPointerCapture(event.pointerId))resize.releasePointerCapture(event.pointerId);rememberLayout();};listen(resize,'pointerup',endResize);listen(resize,'pointercancel',endResize);
        listen(resize,'keydown',event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();changeHeight(panel.offsetHeight+(event.key==='ArrowUp'?-20:20));rememberLayout();}});
        listen(panel.querySelector('header'),'dblclick',event=>{if(event.target.closest('button'))return;panel.style.left='';panel.style.top='';panel.style.right='';panel.style.bottom='';rememberLayout();});
        listen(window,'resize',clampPanel);
        const timer=setInterval(()=>{if(panel.hidden){if(picker)closeReference();return;}if(canvasId&&canvasId!==current()?.id){request?.controller.abort();sequence++;session=null;references=[];assetReferences=[];closeReference();canvasId='';messages.replaceChildren();load().catch(err=>showStatus(err.message));}else contextChips();},800);
        cleanups.push(()=>clearInterval(timer));
        icons();button.setAttribute('aria-expanded','false');syncControls();
        const controller={destroy(){destroyed=true;sequence++;closeReference();if(request){api('cancel',{canvasId:request.canvasId,sessionId:request.sessionId,requestId:request.id}).catch(()=>{});request.controller.abort();}listeners.forEach(fn=>fn());cleanups.forEach(fn=>fn());panel.remove();dock.remove();},open};
        global.canvasAssistantController=controller;return controller;
    }
    global.CanvasAssistant={mount,consumeStream,creationSettings:buildCreationSettings};
})(window);
