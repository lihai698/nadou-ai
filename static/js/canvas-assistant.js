/* 两种画布共用的助手界面；画布访问通过 mount 适配器注入。 */
(function(global){
    'use strict';
    const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
    const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch(_) { return null; } };
    const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch(_) {} };
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
        panel.innerHTML = `<header class="canvas-assistant-head"><div class="canvas-assistant-heading">${icon('sparkles')}创作助手</div><div class="canvas-assistant-head-actions"><button type="button" data-action="fold" aria-label="收起助手" title="收起">${icon('minus')}</button><button type="button" data-action="new" aria-label="新建对话" title="新建对话">${icon('plus')}</button><button type="button" data-action="history" aria-label="历史对话" title="历史对话">${icon('history')}</button><button type="button" data-action="close" aria-label="关闭助手" title="关闭">${icon('x')}</button></div></header><div class="canvas-assistant-subhead"></div><div class="canvas-assistant-messages" aria-live="polite"></div><div class="canvas-assistant-compose"><div class="canvas-assistant-context"></div><div class="canvas-assistant-input"><textarea aria-label="给创作助手的消息" placeholder="描述想法，@ 引用画布素材" maxlength="12000"></textarea></div><div class="canvas-assistant-send-row"><select aria-label="聊天模型"><option value="">请选择聊天模型</option></select><button type="button" class="canvas-assistant-send" data-action="send">发送</button></div><div class="canvas-assistant-status" role="status"></div></div><button type="button" class="canvas-assistant-height" aria-label="调整窗口高度" title="拖动调整高度，也可用上下方向键"></button>`;
        const dock = document.createElement('div'); dock.className='canvas-assistant-dock'; dock.hidden=true;
        dock.innerHTML=`<span class="canvas-assistant-dock-grip">${icon('grip-vertical')}</span><button type="button" aria-label="展开创作助手">${icon('sparkles')}创作助手</button>`;
        document.body.append(panel,dock);
        const messages=panel.querySelector('.canvas-assistant-messages'), input=panel.querySelector('textarea'), models=panel.querySelector('select'), status=panel.querySelector('.canvas-assistant-status'), sendButton=panel.querySelector('[data-action=send]');
        const listeners=[], cleanups=[];
        let canvasId='', session=null, sessions=[], references=[], request=null, busy=false, providers=[], historyShown=false, destroyed=false, sequence=0;
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
        function syncControls(){
            sendButton.textContent=busy?'停止':'发送';sendButton.disabled=!busy&&(!models.value||!input.value.trim()||!session);
            models.disabled=busy; panel.querySelector('[data-action=new]').disabled=busy;panel.querySelector('[data-action=history]').disabled=busy;
        }
        function contextChips(){
            const value=current(); if(!value)return;
            const area=panel.querySelector('.canvas-assistant-context');
            area.innerHTML=`<span class="canvas-assistant-chip">当前画布</span><span class="canvas-assistant-chip">选中 ${(value.selectedNodeIds||[]).length} 个节点</span>`;
            for(const id of references){ const node=value.nodes.find(n=>n.id===id);if(!node)continue;const remove=document.createElement('button');remove.type='button';remove.className='canvas-assistant-chip';remove.textContent=`@ ${node.title||node.name||'素材'} ×`;remove.setAttribute('aria-label','移除引用素材');remove.onclick=()=>{references=references.filter(ref=>ref!==id);contextChips();};area.append(remove); }
        }
        function drawHistory(){
            messages.replaceChildren();
            if(!session?.turns?.length){ messages.textContent='选中节点，或引用画布素材，告诉我你的创作想法。';return; }
            for(const turn of session.turns){
                const userBubble=document.createElement('div');userBubble.className='canvas-assistant-message canvas-assistant-user';userBubble.textContent=turn.message;messages.append(userBubble);
                const reply=document.createElement('div');reply.className='canvas-assistant-message canvas-assistant-reply';reply.textContent=turn.reply||'';
                if(turn.state==='running'){reply.textContent='这一轮仍在处理…';const stop=document.createElement('button');stop.type='button';stop.textContent='停止这一轮';stop.onclick=()=>{ stop.disabled=true;api('cancel',{canvasId,sessionId:session.id,requestId:turn.id}).then(()=>selectSession(session.id)).catch(err=>showStatus(err.message));};reply.append(stop);}
                else if(turn.state!=='completed'){reply.classList.add('canvas-assistant-error');reply.textContent=turn.error||'这一轮没有完成';if(['failed','interrupted'].includes(turn.state)){const retry=document.createElement('button');retry.type='button';retry.textContent='重试';retry.onclick=()=>{input.value=turn.message;syncControls();input.focus();};reply.append(retry);}}
                messages.append(reply);
            }
            messages.scrollTop=messages.scrollHeight;
        }
        async function selectSession(id){
            const owner=canvasId, token=++sequence;
            const data=await api(`history?canvasId=${encodeURIComponent(owner)}&sessionId=${encodeURIComponent(id)}`);
            if(!matches(owner)||token!==sequence)return;
            session=data.session;historyShown=false;drawHistory();syncControls();
        }
        async function newSession(){
            if(busy)return;
            const owner=canvasId,token=++sequence;
            const data=await api('sessions',{canvasId:owner});
            if(!matches(owner)||token!==sequence)return;
            session=data.session;references=[];historyShown=false;drawHistory();contextChips();syncControls();
        }
        async function load(){
            const value=current();if(!value?.id)throw new Error('请先打开画布');
            const owner=value.id,token=++sequence;canvasId=owner;
            const [configuration,history]=await Promise.all([api('status'),api(`sessions?canvasId=${encodeURIComponent(owner)}`)]);
            if(!matches(owner)||token!==sequence)return;
            providers=configuration.providers;sessions=history.sessions;
            panel.querySelector('.canvas-assistant-subhead').textContent=value.title||'当前画布';
            const previous=read(`canvas_assistant_model_${owner}`);
            models.innerHTML='<option value="">请选择聊天模型</option>';
            providers.forEach(provider=>{const group=document.createElement('optgroup');group.label=provider.name+(provider.ready?'':'（未配置密钥）');provider.models.forEach(model=>{const option=document.createElement('option');option.value=JSON.stringify([provider.id,model]);option.textContent=model;group.append(option);});models.append(group);});
            if(previous && [...models.options].some(o=>o.value===previous))models.value=previous;
            showStatus(providers.length?'当前阶段：对话与创作建议':'请先在 API 设置中配置聊天模型');
            if(history.activeSessionId)await selectSession(history.activeSessionId);else if(sessions.length)await selectSession(sessions[0].id);else await newSession();
            contextChips();syncControls();
        }
        async function open(){ panel.hidden=false;dock.hidden=true;button.classList.add('active');button.setAttribute('aria-expanded','true');clampPanel();if(canvasId!==current()?.id||!session)await load();contextChips();icons(); }
        async function cancel(){
            if(!request)return;
            const active=request;showStatus('正在停止…');
            if(!active.submitted){active.controller.abort();showStatus('已停止本轮回复');return;}
            try{await api('cancel',{canvasId:active.canvasId,sessionId:active.sessionId,requestId:active.id});active.controller.abort();showStatus('已停止；上游可能仍在处理');}
            catch(err){showStatus(err.message);}
        }
        async function send(){
            if(busy){await cancel();return;}
            if(!session||!models.value||!input.value.trim())return;
            const owner=canvasId,sessionId=session.id,text=input.value.trim(),[provider,model]=JSON.parse(models.value);
            const selection=[...(current()?.selectedNodeIds||[])],refs=[...references];
            const active={canvasId:owner,sessionId,id:crypto.randomUUID(),controller:new AbortController()};request=active;busy=true;syncControls();showStatus('正在保存画布…');
            let ended=false,reply=null;
            try{
                if(!await adapter.save())throw new Error('画布尚未保存，请重试保存后再发送');
                if(active.controller.signal.aborted)throw new DOMException('已停止','AbortError');
                if(!matches(owner)||session?.id!==sessionId)throw new Error('画布或对话已切换');
                const value=current();
                const response=await fetch('/api/canvas-assistant/chat',{method:'POST',headers,signal:active.controller.signal,body:JSON.stringify({canvasId:owner,sessionId,requestId:active.id,message:text,provider,model,selectedNodeIds:selection,referencedNodeIds:refs,expectedUpdatedAt:value.updatedAt})});
                if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(typeof data.detail==='string'?data.detail:'发送失败');}
                active.submitted=true;
                const userBubble=document.createElement('div');userBubble.className='canvas-assistant-message canvas-assistant-user';userBubble.textContent=text;reply=document.createElement('div');reply.className='canvas-assistant-message canvas-assistant-reply';reply.textContent='正在分析画布…';messages.append(userBubble,reply);input.value='';let output='';
                await consumeStream(response,event=>{
                    if(!matches(owner)||session?.id!==sessionId)throw new Error('画布或对话已切换');
                    if(event.type==='text_delta'){output+=event.text||'';reply.textContent=output;}
                    if(event.type==='lifecycle')showStatus('正在分析画布…');
                    if(event.type==='turn_end'){ended=true;if(event.state!=='completed'){reply.classList.add('canvas-assistant-error');reply.textContent=event.error||'这一轮没有完成';}showStatus(event.state==='completed'?'回复完成':event.error||'这一轮没有完成');}
                    messages.scrollTop=messages.scrollHeight;
                });
            }catch(err){if(matches(owner)){showStatus(err.name==='AbortError'?'已停止；上游可能仍在处理':err.message);if(reply&&!ended)reply.textContent=err.name==='AbortError'?'已停止本轮回复':'回复没有完整结束，请查看历史后重试';}}
            finally{
                if(request===active){request=null;busy=false;syncControls();if(matches(owner)&&session?.id===sessionId){try{await selectSession(sessionId);}catch(err){showStatus(err.message);}}}
            }
        }
        function chooseReference(){
            if(busy)return;historyShown=true;messages.replaceChildren();
            const back=document.createElement('button');back.type='button';back.textContent='返回对话';back.onclick=()=>{historyShown=false;drawHistory();};messages.append(back);
            const list=document.createElement('div');list.className='canvas-assistant-list';messages.append(list);
            const candidates=(current()?.nodes||[]).filter(n=>n.url||n.images?.length);
            if(!candidates.length)list.textContent='当前画布还没有可引用的素材节点';
            for(const node of candidates){const item=document.createElement('button');item.type='button';item.textContent=node.title||node.name||'画布素材';item.disabled=references.includes(node.id);item.onclick=()=>{if(references.length>=20){showStatus('最多引用 20 个素材节点');return;}references.push(node.id);if(input.value.endsWith('@'))input.value=input.value.slice(0,-1);historyShown=false;drawHistory();contextChips();input.focus();};list.append(item);}
        }
        async function listSessions(){
            const owner=canvasId;const data=await api(`sessions?canvasId=${encodeURIComponent(owner)}`);if(!matches(owner))return;
            sessions=data.sessions;historyShown=true;messages.innerHTML='<div class="canvas-assistant-note">当前画布的历史对话</div>';
            const back=document.createElement('button');back.type='button';back.textContent='返回对话';back.onclick=()=>{historyShown=false;drawHistory();};messages.append(back);
            for(const record of sessions){const item=document.createElement('button');item.type='button';item.textContent=record.title;item.onclick=()=>selectSession(record.id).catch(err=>showStatus(err.message));messages.append(item);}
        }
        listen(button,'click',()=>{if(panel.hidden)open().catch(err=>showStatus(err.message));else{panel.hidden=true;dock.hidden=true;button.classList.remove('active');button.setAttribute('aria-expanded','false');}});
        listen(panel,'click',event=>{
            const action=event.target.closest('[data-action]')?.dataset.action;
            if(action==='close'){panel.hidden=true;dock.hidden=true;button.classList.remove('active');button.setAttribute('aria-expanded','false');}
            if(action==='fold'){const rect=panel.getBoundingClientRect();panel.hidden=true;dock.hidden=false;dock.style.left=`${Math.min(innerWidth-dock.offsetWidth-8,rect.left)}px`;dock.style.top=`${Math.min(innerHeight-dock.offsetHeight-8,rect.bottom-dock.offsetHeight)}px`;dock.style.right='auto';dock.style.bottom='auto';}
            if(action==='new')newSession().catch(err=>showStatus(err.message));
            if(action==='history')listSessions().catch(err=>showStatus(err.message));
            if(action==='send')send();
        });
        listen(dock.querySelector('button'),'click',()=>open().catch(err=>showStatus(err.message)));
        listen(input,'input',()=>{syncControls();if(input.value.endsWith('@'))chooseReference();});
        listen(input,'keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!busy)send();}});
        listen(models,'change',()=>{write(`canvas_assistant_model_${canvasId}`,models.value);syncControls();});
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
        const timer=setInterval(()=>{if(panel.hidden)return;if(canvasId&&canvasId!==current()?.id){request?.controller.abort();sequence++;session=null;references=[];canvasId='';messages.replaceChildren();load().catch(err=>showStatus(err.message));}else contextChips();},800);
        cleanups.push(()=>clearInterval(timer));
        icons();button.setAttribute('aria-expanded','false');syncControls();
        const controller={destroy(){destroyed=true;sequence++;if(request){api('cancel',{canvasId:request.canvasId,sessionId:request.sessionId,requestId:request.id}).catch(()=>{});request.controller.abort();}listeners.forEach(fn=>fn());cleanups.forEach(fn=>fn());panel.remove();dock.remove();},open};
        global.canvasAssistantController=controller;return controller;
    }
    global.CanvasAssistant={mount,consumeStream};
})(window);
