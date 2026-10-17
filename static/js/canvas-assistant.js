/* 两种画布共用的助手界面；画布访问通过 mount 适配器注入。 */
(function(global){
    'use strict';
    function formalText(text){
        // 兼容旧回复的独立完成说明段；不按故事正文中的“建议”等词截断。
        let parts=String(text||'').replace(/\r\n/g,'\n').split(/\n\s*\n/);
        const footer=parts.findIndex(p=>/^\s*(?:故事|正文|文章|文本)已(?:按|按照)[\s\S]{0,60}?完成[。！]\s*接下来你可以(?:选择|选)?[：:]/.test(p));
        if(footer>=0){parts=parts.slice(0,footer);while(parts.length&&/^\s*[-*_]{3,}\s*$/.test(parts.at(-1)))parts.pop();}
        return parts.join('\n\n').trim();
    }
    function replyParagraphs(text){return formalText(text).split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);}
    function resultMedia(turn){
        const found=new Map();
        function add(item){const value=typeof item==='string'?{url:item}:item;if(!value||typeof value.url!=='string'||! /^(?:https?:\/\/|\/(?!\/))/.test(value.url))return;found.set(value.url,{...value,kind:value.kind==='video'||/\.(?:mp4|mov|webm)(?:[?#]|$)/i.test(value.url)?'video':'image'});}
        (turn.media||[]).forEach(add);
        for(const p of turn.nativeActions||[])if(p.state==='completed'&&p.action==='run'){
            for(const url of p.receipt?.result?.urls||[])add({url,kind:p.runSettings?.taskKind==='video'?'video':'image'});
            const tasks=p.runSettings?.taskKind==='comfy'?(p.receipt?.tasks||[]).slice(-1):p.receipt?.tasks||[];
            for(const task of tasks)for(const field of ['images','videos','outputs','image_items'])for(const item of (task.result||task)[field]||[])add(typeof item==='string'?{url:item,kind:p.runSettings?.taskKind==='video'?'video':'image'}:item);
        }
        return [...found.values()];
    }
    function resultWorking(turn,active=false){
        if(active||turn?.state==='running')return true;
        if(!['waiting_confirmation','waiting_result'].includes(turn?.state))return false;
        return (turn.nativeActions||[]).some(p=>['accepted','executing'].includes(p.state))||(turn.proposals||[]).some(p=>p.state==='submitted'&&!['failed','succeeded','cancelled','unknown'].includes(p.taskStatus));
    }
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
    function turnPresentation(state){
        const labels={completed:'创作完成',waiting_confirmation:'等待操作确认',waiting_result:'等待图片结果',running:'正在创作',interrupted:'执行已中断，可继续创作',paused:'创作暂未完成，可继续',cancelled:'已停止本轮',failed:'本轮未完成'};
        return {label:labels[state]||'状态未知',failed:['failed','interrupted'].includes(state),canContinue:['interrupted','waiting_result','paused'].includes(state),accepted:['completed','waiting_confirmation','waiting_result','paused'].includes(state)};
    }
    function composerLocked(session){ return !!session?.turns?.some(turn=>['waiting_confirmation','waiting_result'].includes(turn.state)); }
    function progressPresentation(turn){
        if(['failed','interrupted','paused','cancelled'].includes(turn.state))return '处理记录';
        if(turn.state==='completed'){
            const reviews=new Map();
            (turn.steps||[]).forEach((step,index)=>{const review=step.review||step.result?.review;if(!review)return;const urls=(review.images||review.videos||[]).map(item=>item.url).filter(Boolean).sort();reviews.set(review.proposalId||(urls.length?JSON.stringify(urls):`step-${index}`),review);});
            if([...reviews.values()].some(review=>review.status==='needs_changes'))return '作品检查发现待改进项';
            if([...reviews.values()].some(review=>review.status==='unknown'))return '作品质量尚未确认';
            return '处理记录';
        }
        if(turn.state==='waiting_result')return '等待生成结果';
        if(turn.state==='waiting_confirmation'){
            const native=turn.nativeActions||[],pending=native.some(p=>p.state==='pending');
            if(native.some(p=>p.state==='submission_unknown'))return '任务受理状态未知，请查看提示';
            if(native.some(p=>p.state==='failed'))return '操作未完成，请查看提示';
            if(!pending&&native.some(p=>['accepted','executing'].includes(p.state)))return '任务已登记，等待结果';
            if(!pending&&native.some(p=>p.state==='completed'))return '操作已保存，等待继续';
            return '等待你确认';
        }
        if(turn.state==='running'){
            const tool=turn.steps?.at(-1)?.tool;
            if(['read_canvas','read_node_state','read_project_knowledge','read_skill','list_skills','list_project_knowledge','list_reference_assets'].includes(tool))return '正在整理素材';
            if(['inspect_result','record_result_review'].includes(tool))return '正在检查结果';
            if(['apply_canvas_operations','create_story_workflow','create_story_analysis','import_story_analysis','create_shot_prompts','create_shot_images','legacy_operations'].includes(tool))return '正在保存到画布';
            return '正在创作';
        }
        return turnPresentation(turn.state).label;
    }
    function nativeActionAttention(turn,proposal,error=''){
        return !!error||['failed','submission_unknown'].includes(proposal.state)||proposal.state==='pending'&&turn.state!=='cancelled';
    }
    function automaticNative(proposal,turn){
        if(proposal.state!=='pending'||turn.state==='cancelled')return false;
        if(!proposal.chargeable)return ['create','update','connect','shot_edit','shot_select','shot_materialize','loop_prompts','shot_column'].includes(proposal.action)&&!(proposal.action==='shot_column'&&proposal.arguments?.columnAction==='delete');
        const grant=turn.authorization,run=proposal.runSettings||{};
        return !!grant&&grant.models.some(m=>m.provider===run.provider&&m.model===run.model)&&grant.used+run.maxCalls<=grant.limit;
    }
    function taskPresentation(turns,active=false){
        const turn=turns?.at(-1);
        if(active||turn?.state==='running')return '任务 · 创作中';
        if(!turn)return '任务';
        if(['failed','interrupted'].includes(turn.state)||(turn.nativeActions||[]).some(p=>['failed','submission_unknown'].includes(p.state))||(turn.proposals||[]).some(p=>p.taskStatus==='failed'))return '任务 · 待处理';
        if(turn.state==='waiting_confirmation')return '任务 · 待确认';
        if(turn.state==='waiting_result')return '任务 · 等待结果';
        if(turn.state==='paused')return '任务 · 已暂停';
        if(turn.state==='cancelled')return '任务 · 已停止';
        if(progressPresentation(turn)!=='处理记录')return '任务 · 待改进';
        return '任务 · 已完成';
    }
    function mount(adapter){
        if(global.canvasAssistantController) global.canvasAssistantController.destroy();
        const button = document.getElementById('canvasAssistantToggle');
        if(!button) return null;
        const panel = document.createElement('aside');
        panel.className = 'canvas-assistant'; panel.hidden = true; panel.setAttribute('aria-label','创作助手');
        panel.innerHTML = `<header class="canvas-assistant-head"><div class="canvas-assistant-heading">${icon('sparkles')}创作助手</div><div class="canvas-assistant-head-actions"><button type="button" data-action="appearance" aria-label="助手外观" aria-expanded="false" aria-controls="canvas-assistant-appearance" title="调节背景透明度">${icon('blend')}</button><button type="button" data-action="fold" aria-label="收起助手" title="收起">${icon('minus')}</button><button type="button" data-action="new" aria-label="新建对话" title="新建对话">${icon('plus')}</button><button type="button" data-action="history" aria-label="历史对话" title="历史对话">${icon('history')}</button><button type="button" data-action="close" aria-label="关闭助手" title="关闭">${icon('x')}</button></div></header><div class="canvas-assistant-appearance" id="canvas-assistant-appearance" role="group" aria-label="助手外观设置" hidden><label for="canvas-assistant-opacity">背景不透明度 <output for="canvas-assistant-opacity">80%</output></label><input id="canvas-assistant-opacity" type="range" min="0" max="100" step="1" value="80" aria-label="背景不透明度"><div class="canvas-assistant-opacity-hints"><span>完全透明</span><span>完全不透明</span></div></div><div class="canvas-assistant-subhead"></div><div class="canvas-assistant-messages" aria-live="polite"></div><div class="canvas-assistant-compose"><div class="canvas-assistant-context"><div class="canvas-assistant-context-chips"></div><button type="button" class="canvas-assistant-view" hidden>在画布上查看</button></div><div class="canvas-assistant-input"><span class="canvas-assistant-skill-prefix" aria-live="polite" hidden><span class="canvas-assistant-skill-chip"><span class="canvas-assistant-skill-name"></span><button type="button" aria-label="移除 Skill，恢复自动选择">${icon('x')}</button></span><span aria-hidden="true">/</span></span><textarea aria-label="给创作助手的消息" placeholder="描述想法，@ 选择图片或视频" maxlength="12000"></textarea></div><div class="canvas-assistant-send-row"><button type="button" class="canvas-assistant-template" data-action="templates" title="从模板库选择提示词">${icon('library')}<span>模板库</span></button><button type="button" class="canvas-assistant-model-toggle" data-action="models" aria-label="模型" aria-expanded="false" aria-controls="canvas-assistant-model-picker" title="选择聊天模型">${icon('boxes')}<span>模型</span></button><button type="button" class="canvas-assistant-skill-toggle" data-action="skills" aria-label="Skill" aria-expanded="false" aria-controls="canvas-assistant-skill-picker" title="选择创作 Skill">${icon('wand-sparkles')}<span>Skill</span></button><button type="button" class="canvas-assistant-send" data-action="send">发送</button></div><div class="canvas-assistant-model-picker" id="canvas-assistant-model-picker" role="group" aria-label="选择聊天模型" hidden><div class="canvas-assistant-model-category">文本模型</div><div class="canvas-assistant-model-row"><select class="select-lite canvas-assistant-model-provider" aria-label="聊天平台"><option value="">选择平台</option></select><select class="select-lite canvas-assistant-model-select" aria-label="聊天模型"><option value="">选择模型</option></select><input type="checkbox" class="canvas-assistant-model-confirm" aria-label="指定文本模型" title="勾选指定文本模型"></div><div class="canvas-assistant-model-category">图片模型</div><div class="canvas-assistant-model-row"><select class="select-lite canvas-assistant-image-provider" aria-label="图片平台"><option value="">选择平台</option></select><select class="select-lite canvas-assistant-image-select" aria-label="图片模型"><option value="">选择模型</option></select><input type="checkbox" class="canvas-assistant-image-confirm" aria-label="指定图片模型" title="勾选指定图片模型"></div></div><div class="canvas-assistant-skill-picker" id="canvas-assistant-skill-picker" role="dialog" aria-label="选择创作 Skill" hidden><header class="canvas-assistant-skill-head"><span>选择 Skill <small class="canvas-assistant-skill-count"></small></span><button type="button" aria-label="关闭 Skill 选择">${icon('x')}</button></header><input type="search" class="canvas-assistant-skill-search" aria-label="搜索 Skill" placeholder="搜索名称或用途"><div class="canvas-assistant-skill-categories" aria-label="Skill 分类"></div><div class="canvas-assistant-skill-list"></div></div><div class="canvas-assistant-status" role="status"></div></div><button type="button" class="canvas-assistant-height" aria-label="调整窗口高度" title="拖动调整高度，也可用上下方向键"></button>`;
        const dock = document.createElement('div'); dock.className='canvas-assistant-dock'; dock.hidden=true;
        dock.innerHTML=`<span class="canvas-assistant-dock-grip">${icon('grip-vertical')}</span><button type="button" aria-label="展开创作助手">${icon('sparkles')}创作助手</button>`;
        document.body.append(panel,dock);
        const subhead=panel.querySelector('.canvas-assistant-subhead'),canvasTitle=document.createElement('span'),taskToggle=document.createElement('button');
        canvasTitle.className='canvas-assistant-canvas-title';taskToggle.type='button';taskToggle.id='canvas-assistant-task-toggle';taskToggle.className='canvas-assistant-task-toggle';taskToggle.textContent='任务';taskToggle.setAttribute('aria-label','创作任务');taskToggle.setAttribute('aria-expanded','false');subhead.append(canvasTitle,taskToggle);
        const taskPanel=document.createElement('aside');taskPanel.className='canvas-assistant canvas-assistant-task-panel';taskPanel.hidden=true;taskPanel.setAttribute('aria-label','创作任务面板');
        taskPanel.innerHTML=`<header class="canvas-assistant-head"><div class="canvas-assistant-heading">${icon('list-checks')}创作任务</div><button type="button" aria-label="关闭任务面板">${icon('x')}</button></header><div class="canvas-assistant-task-list"></div>`;
        document.body.append(taskPanel);const taskList=taskPanel.querySelector('.canvas-assistant-task-list');
        const messages=panel.querySelector('.canvas-assistant-messages'), input=panel.querySelector('textarea'), models=panel.querySelector('.canvas-assistant-model-select'), status=panel.querySelector('.canvas-assistant-status'), sendButton=panel.querySelector('[data-action=send]'), viewButton=panel.querySelector('.canvas-assistant-view');
        taskPanel.insertBefore(status,taskList);
        const modelProvider=panel.querySelector('.canvas-assistant-model-provider'), modelPicker=panel.querySelector('.canvas-assistant-model-picker'), modelToggle=panel.querySelector('[data-action=models]');
        const imageProvider=panel.querySelector('.canvas-assistant-image-provider'), imageModels=panel.querySelector('.canvas-assistant-image-select'), textConfirm=panel.querySelector('.canvas-assistant-model-confirm'), imageConfirm=panel.querySelector('.canvas-assistant-image-confirm');
        const skillToggle=panel.querySelector('[data-action=skills]'), skillPicker=panel.querySelector('.canvas-assistant-skill-picker');
        const skillPrefix=panel.querySelector('.canvas-assistant-skill-prefix'), skillName=skillPrefix.querySelector('.canvas-assistant-skill-name'), skillRemove=skillPrefix.querySelector('button');
        const skillSearch=skillPicker.querySelector('input'), skillList=skillPicker.querySelector('.canvas-assistant-skill-list'), skillCategories=skillPicker.querySelector('.canvas-assistant-skill-categories');
        skillPicker.classList.add('canvas-assistant');document.body.append(skillPicker);
        let skillCategory='全部';
        const appearanceToggle=panel.querySelector('[data-action=appearance]'), appearancePicker=panel.querySelector('.canvas-assistant-appearance'), opacitySlider=appearancePicker.querySelector('input'), opacityOutput=appearancePicker.querySelector('output');
        let imageProviders=[], skillCatalog=[];
        const listeners=[], cleanups=[],turnProgress=new Map();
        const nativeExecutors=new Map(),imageExecutors=new Map(),autoAttempts=new Set(),autoErrors=new Map(),queryTimes=new Map();let autoRunning=false,autoQueued=false;
        let canvasId='', session=null, sessions=[], references=[], assetReferences=[], referenceItems=[], picker=null, pickerToken=0, request=null, busy=false, sessionLoading=false, providers=[], historyShown=false, destroyed=false, sequence=0, viewingChanges=false, mentionStart=-1;
        let user='';
        try { user=localStorage.getItem('gpt_chat_browser_user')||crypto.randomUUID(); localStorage.setItem('gpt_chat_browser_user',user); } catch(_) { user=crypto.randomUUID(); }
        const headers = {'Content-Type':'application/json','X-User-Id':user};
        const layoutKey=`canvas_assistant_layout_${adapter.kind}`;
        function listen(target,type,fn,options){ target.addEventListener(type,fn,options); listeners.push(()=>target.removeEventListener(type,fn,options)); }
        function icons(){ if(global.lucide) lucide.createIcons(); }
        function positionTasks(){
            if(taskPanel.hidden)return;const r=panel.getBoundingClientRect(),width=Math.min(360,innerWidth-24),height=Math.min(560,innerHeight-100);
            const left=r.left>=width+20?r.left-width-8:r.right+width+20<=innerWidth?r.right+8:Math.max(12,Math.min(r.left,innerWidth-width-12));
            Object.assign(taskPanel.style,{left:`${left}px`,top:`${Math.max(12,Math.min(r.top,innerHeight-height-12))}px`,right:'auto',bottom:'auto',width:`${width}px`,height:`${height}px`});
        }
        function closeTasks(){taskPanel.hidden=true;taskToggle.setAttribute('aria-expanded','false');}
        let workingIndicator=null;
        function refreshTasks(){
            taskToggle.textContent=autoErrors.has(session?.turns?.at(-1)?.id)?'任务 · 待处理':taskPresentation(session?.turns,!!request||autoRunning);taskToggle.setAttribute('aria-label',taskToggle.textContent);positionTasks();
            const latest=session?.turns?.at(-1),working=resultWorking(latest,!!request||autoRunning)&&!autoErrors.has(latest?.id);
            if(working){if(!workingIndicator?.isConnected){workingIndicator=document.createElement('div');workingIndicator.className='canvas-assistant-working';workingIndicator.setAttribute('role','status');workingIndicator.innerHTML='<span aria-hidden="true"></span>正在创作…';}messages.append(workingIndicator);}
            else{workingIndicator?.remove();workingIndicator=null;}
        }
        listen(taskToggle,'click',()=>{taskPanel.hidden=!taskPanel.hidden;taskToggle.setAttribute('aria-expanded',String(!taskPanel.hidden));positionTasks();});
        listen(taskPanel.querySelector('button'),'click',closeTasks);
        listen(document,'pointerdown',event=>{if(!taskPanel.hidden&&!taskPanel.contains(event.target)&&!taskToggle.contains(event.target))closeTasks();});
        function queueAutomatic(){
            if(autoQueued||autoRunning||destroyed||busy||sessionLoading||historyShown||!session)return;
            autoQueued=true;Promise.resolve().then(async()=>{
                autoQueued=false;if(autoRunning||destroyed||busy||historyShown||!session)return;
                const turn=session.turns?.at(-1),owner=canvasId,sid=session.id;
                if(!turn?.agent||!['waiting_confirmation','waiting_result'].includes(turn.state)||autoErrors.has(turn.id))return;
                if((turn.nativeActions||[]).some(p=>['failed','submission_unknown'].includes(p.state))||(turn.proposals||[]).some(p=>p.taskStatus==='failed'||p.state==='submission_unknown'))return;
                let changed=false;autoRunning=true;refreshTasks();
                try{
                    const pending=(turn.nativeActions||[]).find(p=>automaticNative(p,turn)&&!autoAttempts.has(p.id));
                    if(pending){autoAttempts.add(pending.id);await nativeExecutors.get(pending.id)?.('confirm',true);changed=pending.state==='completed';}
                    else{
                        const image=(turn.proposals||[]).find(p=>p.state==='pending'&&!p.retryProposalId&&!autoAttempts.has(p.id)&&turn.authorization?.models.some(m=>m.provider===p.provider&&m.model===p.model)&&turn.authorization.used<turn.authorization.limit);
                        if(image){autoAttempts.add(image.id);await imageExecutors.get(image.id)?.('confirm',true);return;}
                        const submitted=(turn.proposals||[]).find(p=>p.state==='submitted'&&!(turn.agent.consumedTasks||[]).includes(p.taskId));
                        if(submitted){if(Date.now()-(queryTimes.get(submitted.id)||0)<5000)return;queryTimes.set(submitted.id,Date.now());await imageExecutors.get(submitted.id)?.('query',true);return;}
                        const accepted=(turn.nativeActions||[]).find(p=>['accepted','executing'].includes(p.state));
                        if(accepted){if(Date.now()-(queryTimes.get(accepted.id)||0)<5000)return;queryTimes.set(accepted.id,Date.now());await nativeExecutors.get(accepted.id)?.('query',true);changed=accepted.state==='completed';}
                        else changed=(turn.nativeActions||[]).some(p=>p.state==='completed'&&!(turn.agent.consumedNativeActions||[]).includes(p.id))&&!(turn.nativeActions||[]).some(p=>!['completed'].includes(p.state)&&!(turn.agent.consumedNativeActions||[]).includes(p.id));
                    }
                    if(changed&&matches(owner)&&session?.id===sid&&session.turns.find(t=>t.id===turn.id)?.state!=='cancelled')await continueTurn(turn.id);
                }catch(err){autoErrors.set(turn.id,err.message||'自动执行已暂停，请查看任务');showStatus(autoErrors.get(turn.id));}
                finally{autoRunning=false;refreshTasks();if(changed&&matches(owner)&&session?.id===sid)queueAutomatic();}
            });
        }
        function showStatus(value){
            if(request?.progress){request.progress.label.textContent=value;status.textContent='';status.hidden=true;}
            else{status.textContent=value;status.hidden=!value;}
            refreshTasks();
        }
        function addProgress(turn){
            const activity=document.createElement('div');activity.className='canvas-assistant-activity';
            const details=document.createElement('details');details.className='canvas-assistant-progress'+(['completed','failed','interrupted','paused','cancelled'].includes(turn.state)?' is-finished':'');details.setAttribute('aria-label','处理记录');
            const summary=document.createElement('summary'),label=document.createElement('span'),hint=document.createElement('small'),body=document.createElement('div'),controls=document.createElement('div');
            label.className='canvas-assistant-progress-label';label.textContent=progressPresentation(turn);hint.textContent='详情';
            body.className='canvas-assistant-progress-body';controls.className='canvas-assistant-progress-controls';summary.append(label,hint);details.append(summary,body);activity.append(details,controls);taskList.append(activity);
            if(['failed','interrupted'].includes(turn.state)||autoErrors.has(turn.id)){const notice=document.createElement('div');notice.className='canvas-assistant-error canvas-assistant-task-notice';notice.textContent=autoErrors.get(turn.id)||turn.error||'本轮未完成，请检查后继续';activity.append(notice);}
            if(turn.agent&&['waiting_confirmation','waiting_result','paused','interrupted'].includes(turn.state)){
                const authorize=document.createElement('details'),heading=document.createElement('summary'),note=document.createElement('div'),limit=document.createElement('input'),start=document.createElement('button');
                authorize.className='canvas-assistant-authorization';heading.textContent=turn.authorization?`自动执行：已预留 ${turn.authorization.used}/${turn.authorization.limit} 次节点调用`:'授权本轮自动执行';
                const original=turn.agent.payload||{},settings=original.creationSettings||{},models=new Map();
                const add=(provider,model)=>{if(provider&&model&&provider!=='per-slot')models.set(JSON.stringify([provider,model]),{provider,model});};
                add(turn.provider,turn.model);if(original.imageModelConfirmed)add(settings.provider_id,settings.model);
                for(const p of turn.nativeActions||[])if(p.action==='run'&&p.state==='pending')add(p.runSettings?.provider,p.runSettings?.model);
                for(const p of turn.proposals||[])if(p.state==='pending')add(p.provider,p.model);
                note.textContent=`仅本轮，模型：${[...models.values()].map(m=>(providers.find(p=>p.id===m.provider)?.name||imageProviders.find(p=>p.id===m.provider)?.name||m.provider)+' / '+m.model).join('；')}。上限计算节点运行，不包含助手对话；不自动重试失败或受理不明任务。`;
                limit.type='number';limit.min=String(Math.max(1,turn.authorization?.used||0));limit.max='100';limit.value=String(turn.authorization?.limit||10);limit.setAttribute('aria-label','本轮节点运行上限');
                start.type='button';start.textContent='授权并继续';start.disabled=!models.size;
                start.onclick=async()=>{if(busy||autoRunning)return;start.disabled=true;try{const result=await api('authorization',{canvasId,sessionId:session.id,requestId:turn.id,total:Number(limit.value),models:[...models.values()]});turn.authorization=result.authorization;autoErrors.delete(turn.id);for(const p of [...turn.nativeActions||[],...turn.proposals||[]])if(p.state==='pending')autoAttempts.delete(p.id);drawHistory();closeTasks();queueAutomatic();}catch(err){showStatus(err.message);}finally{start.disabled=false;}};
                authorize.append(heading,note,limit,start);activity.append(authorize);
            }
            const steps=new Map();
            let planControls=null;
            function updatePlan(plan){
                if(!plan)return;
                if(planControls)planControls.remove();
                planControls=document.createElement('div');planControls.className='canvas-assistant-plan';body.append(planControls);
                const note=document.createElement('span');
                note.textContent=`计划进度 ${plan.steps.filter(s=>s.state==='completed').length}/${plan.steps.length}；已预留 ${plan.budget.used.serviceCalls} 个服务任务，上限 ${plan.budget.limit.serviceCalls}。`;
                planControls.append(note);
                if(['completed','cancelled'].includes(plan.state))return;
                const budgetLabel=document.createElement('label'),budgetInput=document.createElement('input'),saveBudget=document.createElement('button'),error=document.createElement('span');
                budgetLabel.textContent='累计服务任务上限 ';budgetInput.type='number';budgetInput.min=String(plan.budget.used.serviceCalls);budgetInput.max='100';budgetInput.step='1';budgetInput.value=String(plan.budget.limit.serviceCalls);budgetInput.setAttribute('aria-label','累计服务任务上限');budgetInput.style.width='64px';budgetLabel.append(budgetInput);
                saveBudget.type='button';saveBudget.textContent='设置任务额度';saveBudget.title='设置计划上限；本轮自动执行还需明确授权模型与额度';error.setAttribute('role','alert');
                const owner=canvasId,sessionId=session?.id;
                saveBudget.onclick=async()=>{
                    if(!matches(owner)||session?.id!==sessionId)return;
                    const total=Number(budgetInput.value);
                    if(!budgetInput.value||!Number.isInteger(total)||total<plan.budget.used.serviceCalls||total>100){error.textContent='请填写已预留数量至 100 之间的整数';return;}
                    saveBudget.disabled=true;error.textContent='';
                    try{const result=await api('plan/budget',{canvasId:owner,sessionId,requestId:turn.id,total});if(matches(owner)&&session?.id===sessionId)updatePlan(result.plan);}
                    catch(err){error.textContent=err.message;}
                    finally{saveBudget.disabled=false;}
                };
                planControls.append(budgetLabel,saveBudget,error);
            }
            function updateStep(step){
                if(!step)return;let item=steps.get(step.id);
                if(!item){item=document.createElement('div');item.className='canvas-assistant-progress-step';steps.set(step.id,item);body.append(item);}
                item.textContent=`${step.label||'处理步骤'}：${step.state==='succeeded'?'已完成':step.state==='failed'?'失败':'处理中'}`;
                const review=step.review||step.result?.review;
                if(review){
                    const report=document.createElement('div');
                    const names={passed:'通过',needs_changes:'需修改',unknown:'无法判断'};
                    const pixels=(review.images||[]).filter(image=>image.ok).map((image,i)=>`图片${i+1}：${image.width} × ${image.height} ${image.format||''}`).join('；');
                    report.textContent=`检查时结论：${names[review.status]||'无法判断'}。${(review.findings||[]).join('；')} ${(review.checks||[]).map(check=>`${check.label}：${names[check.status]||'无法判断'}${check.message?'（'+check.message+'）':''}`).join('；')}${review.limitations?.length?'。范围限制：'+review.limitations.join('；'):''}`;
                    if(pixels)report.append(document.createTextNode(`。实际文件：${pixels}`));
                    item.append(report);
                }
                updatePlan(step.plan||step.result?.plan);
            }
            (turn.steps||[]).forEach(updateStep);
            updatePlan(turn.agent?.plan);
            if(['running','waiting_confirmation','waiting_result'].includes(turn.state)){
                const owner=canvasId,sessionId=session.id,stop=document.createElement('button'),error=document.createElement('span');
                stop.type='button';stop.textContent='停止本轮';stop.title='停止助手续行，已受理的生成任务保留';error.setAttribute('role','alert');
                stop.onclick=async()=>{
                    if(!matches(owner)||session?.id!==sessionId)return;stop.disabled=true;error.textContent='';
                    try{
                        if(request?.id===turn.id){await cancel();return;}
                        await api('cancel',{canvasId:owner,sessionId,requestId:turn.id});
                        if(matches(owner)&&session?.id===sessionId)await selectSession(sessionId);
                    }catch(err){error.textContent=err.message||'停止尚未确认，请重试';}
                    finally{if(stop.isConnected)stop.disabled=false;}
                };
                controls.append(stop,error);
            }
            const progress={details,label,body,controls,updateStep};turnProgress.set(turn.id,progress);return progress;
        }
        function current(){ return adapter.getContext(); }
        function matches(id=canvasId){ return !destroyed && current()?.id===id; }
        async function api(path,body,signal){
            const response=await fetch(`/api/canvas-assistant/${path}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal});
            if(!response.ok){ const data=await response.json().catch(()=>({})); const error=new Error(typeof data.detail==='string'?data.detail:'助手请求失败，请检查连接');error.status=response.status;error.submissionKnownRejected=data.submissionKnownRejected===true;throw error; }
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
        const appearanceKey=`canvas_assistant_background_${adapter.kind}`;
        function applyOpacity(value){
            const amount=typeof value==='number' && Number.isFinite(value)?Math.round(Math.max(0,Math.min(100,value))):80;
            panel.style.setProperty('--assistant-bg-alpha',String(amount/100));
            taskPanel.style.setProperty('--assistant-bg-alpha',String(amount/100));
            opacitySlider.value=String(amount);opacityOutput.value=`${amount}%`;
            opacitySlider.setAttribute('aria-valuetext',`${amount}% 不透明`);
        }
        applyOpacity(read(appearanceKey));
        function closeAppearance(){ appearancePicker.hidden=true;appearanceToggle.setAttribute('aria-expanded','false'); }
        function closeModels(){ modelPicker.hidden=true;modelToggle.setAttribute('aria-expanded','false'); }
        function closeSkills(){ skillPicker.hidden=true;skillToggle.setAttribute('aria-expanded','false'); }
        function selectedSkill(){ return read(`canvas_assistant_skill_${user}_${canvasId}`)||'auto'; }
        function updateSkillPrefix(){
            const item=skillCatalog.find(item=>item.id===selectedSkill());
            skillPrefix.hidden=selectedSkill()==='auto';
            skillName.textContent=item?.name||'Skill 已不可用';skillName.title=skillName.textContent;
            skillToggle.classList.toggle('has-selection',!skillPrefix.hidden);
            input.style.textIndent=skillPrefix.hidden?'0px':`${skillPrefix.offsetWidth+6}px`;
            skillPrefix.style.transform=`translateY(${-input.scrollTop}px)`;
        }
        function chooseSkill(id){
            if(busy||sessionLoading)return;
            write(`canvas_assistant_skill_${user}_${canvasId}`,id);fillSkills();syncControls();closeSkills();input.focus();
        }
        function positionSkills(){
            if(skillPicker.hidden||panel.hidden)return;
            const rect=panel.getBoundingClientRect(),width=skillPicker.offsetWidth,gap=8;
            let left,top;
            if(innerWidth>650&&(rect.left>=width+gap+8||innerWidth-rect.right>=width+gap+8)){
                left=rect.left>=width+gap+8?rect.left-width-gap:rect.right+gap;
                top=Math.max(12,Math.min(rect.bottom-skillPicker.offsetHeight,innerHeight-skillPicker.offsetHeight-12));
            }else{left=Math.max(8,(innerWidth-width)/2);top=Math.max(12,innerHeight-skillPicker.offsetHeight-12);}
            skillPicker.style.left=`${left}px`;skillPicker.style.top=`${top}px`;
        }
        function fillSkills(){
            updateSkillPrefix();skillList.replaceChildren();skillCategories.replaceChildren();
            const categories=['全部',...new Set(skillCatalog.map(item=>item.category||'创作'))];
            if(!categories.includes(skillCategory))skillCategory='全部';
            for(const category of categories){const button=document.createElement('button');button.type='button';button.textContent=category;button.setAttribute('aria-pressed',String(category===skillCategory));button.onclick=()=>{skillCategory=category;fillSkills();};skillCategories.append(button);}
            skillPicker.querySelector('.canvas-assistant-skill-count').textContent=`${skillCatalog.length} 项`;
            const query=skillSearch.value.trim().toLocaleLowerCase();
            const items=[{id:'auto',name:'自动选择',description:'根据创作需求智能选择',category:'自动'},...skillCatalog].filter(item=>(item.id==='auto'?skillCategory==='全部':skillCategory==='全部'||(item.category||'创作')===skillCategory)&&(!query||`${item.name} ${item.description||''}`.toLocaleLowerCase().includes(query)));
            for(const item of items){
                const button=document.createElement('button');button.type='button';button.className='canvas-assistant-skill-option';button.dataset.skillId=item.id;button.setAttribute('aria-pressed',String(selectedSkill()===item.id));
                const name=document.createElement('span'),description=document.createElement('small');name.textContent=`${selectedSkill()===item.id?'✓ ':''}${item.name}`;description.textContent=item.description||'';button.append(name,description);
                button.disabled=busy||sessionLoading;button.onclick=()=>chooseSkill(item.id);skillList.append(button);
            }
            if(!items.length){const empty=document.createElement('div');empty.className='canvas-assistant-note';empty.textContent='没有找到匹配的 Skill';skillList.append(empty);}
            positionSkills();
        }
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
            const locked=composerLocked(session)||sessionLoading;
            const unavailable=selectedSkill()!=='auto'&&!skillCatalog.some(item=>item.id===selectedSkill());
            sendButton.textContent=busy?'停止':'发送';sendButton.disabled=!busy&&(!models.value||!textConfirm.checked||!input.value.trim()||!session||locked||unavailable);
            updateSkillPrefix();
            skillToggle.disabled=busy||sessionLoading;skillRemove.disabled=busy||sessionLoading;if(busy||sessionLoading)closeSkills();
            viewButton.disabled=busy||viewingChanges; models.disabled=busy||!modelProvider.value; modelProvider.disabled=busy; imageProvider.disabled=busy; imageModels.disabled=busy||!imageProvider.value; textConfirm.disabled=busy||!models.value; imageConfirm.disabled=busy||!imageModels.value; modelToggle.disabled=busy||(!providers.length&&!imageProviders.length); if(busy)closeModels(); panel.querySelector('[data-action=new]').disabled=busy||locked;panel.querySelector('[data-action=history]').disabled=busy;panel.querySelector('[data-action=templates]').disabled=busy||locked;
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
            return [...(session?.turns||[])].reverse().find(turn=>turn.change?.affectedNodeIds?.length)?.change;
        }
        viewButton.onclick=async()=>{
            const owner=canvasId,change=latestChange();if(!change||!matches(owner))return;
            viewingChanges=true;syncControls();
            try{if(!await adapter.viewChanges?.(change.affectedNodeIds))showStatus('节点正在同步，请稍后再试');}
            catch(err){showStatus(err.message||'画布同步失败，请刷新后查看');}
            finally{viewingChanges=false;contextChips();syncControls();}
        };
        function addReplyActions(container, text, media=[]){
            text=formalText(text);container.replaceChildren();
            const button=(area,label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{try{await fn();}catch(err){showStatus(err.message||'操作失败');}};area.append(b);return b;};
            if(text){
                const card=document.createElement('section'),body=document.createElement('div'),actions=document.createElement('div');card.className='canvas-assistant-result';body.className='canvas-assistant-result-text';actions.className='canvas-assistant-reply-actions';
                const paragraphs=replyParagraphs(text),hasTitle=/^(?:#{1,6}\s|\*\*[^*]+\*\*(?:\s*[（(][^\n]+[）)])?\s*$)/.test(paragraphs[0]||'');
                const nodes=paragraphs.map((paragraph,i)=>{const p=document.createElement(hasTitle&&i===0?'h4':'p');p.textContent=paragraph.replace(/^#{1,6}\s+/,'').replace(/\*\*([^*]+)\*\*/g,'$1');body.append(p);return p;});
                const previewCount=3+(hasTitle?1:0);let expanded=false;
                const update=()=>nodes.forEach((p,i)=>p.hidden=!expanded&&i>=previewCount);update();
                if(nodes.length>previewCount){const expand=button(actions,'展开全文',()=>{expanded=!expanded;expand.textContent=expanded?'收起全文':'展开全文';expand.setAttribute('aria-expanded',String(expanded));update();});expand.setAttribute('aria-expanded','false');}
                button(actions,'复制全文',async()=>{await navigator.clipboard.writeText(text);showStatus('已复制完整正文');});
                button(actions,'放到画布',async()=>{if(!await adapter.addTextNode?.(text))throw Error('当前画布暂不支持创建文本节点');showStatus('完整正文已放到画布');});
                card.append(body,actions);container.append(card);
            }
            for(const item of media){
                const card=document.createElement('section'),preview=document.createElement(item.kind==='video'?'video':'img'),actions=document.createElement('div');card.className='canvas-assistant-result';actions.className='canvas-assistant-reply-actions';preview.src=item.url;preview.className='canvas-assistant-result-media';if(item.kind==='video'){preview.controls=true;preview.preload='metadata';}else preview.alt=item.name||'生成图片';
                button(actions,item.kind==='video'?'复制视频地址':'复制图片地址',async()=>{await navigator.clipboard.writeText(item.url);showStatus('已复制结果地址');});
                button(actions,'放到画布',async()=>{if(!await adapter.addImageNode?.(item.url,item.name||(item.kind==='video'?'助手视频':'助手图片'),item.kind))throw Error('当前画布暂不支持放入该媒体');showStatus('结果已放到画布');});
                card.append(preview,actions);container.append(card);
            }
            icons();
        }
        function addNativeActionCard(turn,proposal,progress){
            const owner=canvasId,sessionId=session.id;
            const card=document.createElement('section');card.className='canvas-assistant-proposal';card.setAttribute('aria-label','原生操作方案');
            const title=document.createElement('strong'),meta=document.createElement('div'),status=document.createElement('div'),actions=document.createElement('div');
            const labels={run:'生成图片',connect:'连接节点',create:'创建节点',update:'修改节点',group_members:'调整分组成员',workflow_parameters:'修改工作流参数',lora_parameters:'修改 LoRA 参数',loop_prompts:'修改循环提示词',shot_edit:'修改镜头正文',shot_column:'修改镜头自定义列',shot_select:'选择镜头',shot_materialize:'创建镜头配图节点',clip_edit:'编辑剪辑片段',export:'导出工作流',task_refresh:'查询任务进度',task_cancel:'停止原任务',query:'查询节点状态',preview:'查看节点预览'};
            title.textContent=proposal.action==='run'&&proposal.runSettings?.taskKind==='llm'?'处理文本':proposal.action==='run'&&proposal.runSettings?.taskKind==='video'?'生成视频':proposal.action==='run'&&proposal.nodeType==='comfy'?'运行 ComfyUI 工作流':labels[proposal.action]||'画布操作';meta.className='canvas-assistant-proposal-meta';
            if(proposal.action==='media_export')title.textContent='导出媒体成片';
            const node=current()?.nodes?.find(n=>n.id===proposal.nodeId);
            meta.textContent=`节点：${node?.title||node?.name||proposal.nodeId||proposal.nodeType}${proposal.chargeable?`\n${proposal.runSettings?.model||'原模型'} · 最多 ${proposal.runSettings?.maxCalls||1} 次服务调用`:''}`;
            if(proposal.loopPlan){title.textContent='运行智能循环';meta.textContent+=`\n${proposal.loopPlan.rounds} 轮 · ${proposal.loopPlan.mode==='parallel'?'并行':'顺序'} · ${proposal.loopPlan.steps.length} 个结果轮槽\n${[...new Set(proposal.loopPlan.steps.filter(s=>s.kind==='generate').map(s=>s.provider+' · '+s.model))].join('；')}`;}
            if(proposal.action==='export')meta.textContent+=`\n${proposal.arguments.includeResources?'ZIP（含本地资源）':'JSON（保留资源引用）'} · ${proposal.arguments.nodeIds.length} 个节点 · ${proposal.arguments.connectionCount??proposal.arguments.connectionIds.length} 条内部连线`;
            if(proposal.action==='media_export'){
                const s=proposal.mediaExportSummary,scope={full:'完整成片',segments:'逐段文件',selected:'选定片段'},audio={original:'保留原文件声音',muted:'静音','preserve-all':'保留全部源音轨','silence-all':'存在无音轨素材，整条成片静音','preserve-with-silence':'保留已有声音，无音轨片段补静音'};
                meta.textContent+=`\n${scope[proposal.arguments.scope]} · ${s.fileCount} 个文件 · ${s.durationSeconds.toFixed(2)} 秒\n${proposal.arguments.destination==='canvas'?'保存到画布':'浏览器下载'} · ${audio[s.audioPolicy]||'按原入口声音设置'}`;
            }
            const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');summary.textContent='查看操作内容';
            body.textContent=proposal.action==='loop_prompts'?proposal.arguments.values.map((v,i)=>`字段 ${i+1}：${v||'（空字段）'}`).join('\n\n'):JSON.stringify(proposal.arguments,null,2);
            details.append(summary,body);status.className='canvas-assistant-proposal-state';status.setAttribute('role','status');actions.className='canvas-assistant-proposal-actions';
            card.append(title,meta,details,status,actions);
            const continuation=document.createElement('div');progress.controls.append(continuation);
            let flight=false,error='';const alive=()=>matches(owner)&&session?.id===sessionId&&card.isConnected;
            function button(label,fn,host=actions){const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=busy||flight;b.onclick=fn;host.append(b);}
            function render(){
                (nativeActionAttention(turn,proposal,error)?taskList:progress.body).append(card);
                refreshTasks();
                progress.label.textContent=flight?'正在处理':error?'操作未完成，请查看提示':progressPresentation(turn);
                continuation.replaceChildren();
                actions.replaceChildren();status.textContent=error||(flight?'正在处理，请勿重复操作…':turn.state==='cancelled'&&proposal.state==='pending'?'本轮已停止，方案未执行':proposal.state==='pending'?'等待确认，尚未执行':proposal.state==='completed'?(proposal.serverAction?`原任务状态：${proposal.receipt?.task?.status||'已查询'}`:'已核对保存结果'):proposal.state==='dismissed'?'已放弃本方案':proposal.state==='failed'||proposal.state==='submission_unknown'?proposal.receipt?.error||'原生操作未完成，已保存内容保留，可重读状态继续':'执行已登记；可查询已保存结果，不会重复执行');
                if(!error&&!flight&&proposal.action==='media_export'&&proposal.state==='completed')status.textContent=proposal.receipt?.exportReceipt?.status==='download_started'?'已发起浏览器下载，请在下载记录确认文件':'已保存成片到画布';
                if(proposal.action==='media_export'&&proposal.arguments.destination==='download'&&['succeeded','available'].includes(proposal.receipt?.mediaExport?.status)){
                    const files=proposal.receipt.mediaExport.results||[];
                    files.forEach((file,index)=>{
                        if(typeof file.url!=='string'||!/^\/(?:output|assets|api\/storage-files)\//.test(file.url))return;
                        button(files.length>1?`下载第 ${index+1} 个文件`:'下载已生成文件',async()=>{
                            try{
                                const response=await fetch(`/api/download-output?url=${encodeURIComponent(file.url)}&name=${encodeURIComponent(file.name||'export.mp4')}`);
                                if(!response.ok)throw new Error('原导出文件下载失败');
                                const link=document.createElement('a'),url=URL.createObjectURL(await response.blob());
                                link.href=url;link.download=file.name||'export.mp4';
                                document.body.append(link);link.click();link.remove();
                                setTimeout(()=>URL.revokeObjectURL(url),1000);
                            }catch(err){showStatus(err.message||'下载失败，请检查原文件');}
                        });
                    });
                }
                if(proposal.state==='pending'&&turn.state!=='cancelled'){button('确认操作',()=>act('confirm'));button('先不用',()=>act('dismiss'));}
                else if(['executing','accepted','submission_unknown'].includes(proposal.state)){button(proposal.serverAction?'查询原任务':'查询保存结果',()=>act('query'));if(!proposal.chargeable)button('结束此动作并重规划',()=>act('abandon'));}
                if(proposal.nodeType==='smart-loop'&&['executing','accepted'].includes(proposal.state)&&proposal.receipt?.pendingSlots>0&&turn.state!=='cancelled')button('继续未完成轮次',()=>act('resume'));
                if(proposal.serverAction&&proposal.receipt?.task||proposal.action==='run'&&(proposal.runSettings?.taskKind==='video'||['msgen','midjourney'].includes(proposal.nodeType))&&proposal.receipt?.tasks?.length)button('同步原任务到画布',()=>syncTask());
                if(proposal.action==='export'&&proposal.state==='completed'){const file=proposal.receipt?.exportReceipt;status.textContent=`已发起 ${file?.format?.toUpperCase()||''} 下载${file?.filename?'：'+file.filename:''}；请在浏览器下载列表查看文件`;}
                if(!error&&proposal.action==='run'&&proposal.state==='failed'&&!proposal.retryProposalId&&turn.state!=='cancelled')button('重试',()=>act('retry'));
                if(!error&&['completed','dismissed','failed'].includes(proposal.state)&&turn.state!=='cancelled'&&!(turn.agent?.consumedNativeActions||[]).includes(proposal.id))button('继续创作',()=>continueTurn(turn.id),continuation);
                button('查看画布',()=>adapter.viewChanges?.(proposal.receipt?.nodeIds||[proposal.nodeId]));
            }
            async function syncTask(){
                if(busy||flight||!alive())return;flight=true;error='';render();
                try{if(!adapter.syncNativeTask)throw new Error('原任务回填入口不可用');const synced=await adapter.syncNativeTask(proposal);if(synced&&proposal.action==='run'){const saved=await api('native/action',{canvasId:owner,sessionId,turnId:turn.id,actionId:proposal.id,action:'finish'});if(alive())Object.assign(proposal,saved.proposal);}}
                catch(err){error=err.message||'回填尚未保存，可重试同步原任务';}
                finally{flight=false;if(alive())render();}
                if(!error&&proposal.state==='completed'&&alive()){autoErrors.delete(turn.id);closeTasks();queueAutomatic();}
            }
            async function act(action,automatic=false){
                if(busy||flight||!alive())return;flight=true;error='';render();
                const payload={canvasId:owner,sessionId,turnId:turn.id,actionId:proposal.id,action,automatic};
                try{
                    let localSignature;
                    if(action==='confirm'){
                        if(!await adapter.save())throw new Error('画布尚未保存，请先完成保存');
                        if(!alive())throw new Error('画布或对话已切换');
                        localSignature=adapter.nativeSnapshot();
                        payload.expectedUpdatedAt=current().updatedAt;
                    }
                    if(action==='query'&&proposal.action==='run'&&!await adapter.save())throw new Error('原任务编号尚未保存，请保留页面并重试保存；不会重新提交');
                    const result=await api('native/action',payload);if(!alive())return;
                    if(action==='retry'){
                        if(!turn.nativeActions.some(item=>item.id===result.proposal.id)){turn.nativeActions.push(result.proposal);addNativeActionCard(turn,result.proposal,progress);}
                        error='已创建新的待确认方案，请再次确认操作。';return;
                    }
                    Object.assign(proposal,result.proposal);
                    if(proposal.serverAction&&proposal.receipt?.task){if(!adapter.syncNativeTask)throw new Error('原任务回填入口不可用');await adapter.syncNativeTask(proposal);}
                    if(action==='query'&&proposal.action==='run'&&(proposal.runSettings?.taskKind==='video'||[].includes(proposal.nodeType))&&proposal.receipt?.tasks?.length){if(!adapter.syncNativeTask)throw new Error('原视频回填入口不可用');if(await adapter.syncNativeTask(proposal)){const saved=await api('native/action',{...payload,action:'finish'});if(!alive())return;Object.assign(proposal,saved.proposal);}}
                    if(result.canExecute&&(['confirm','resume'].includes(action)||proposal.action==='media_export'&&action==='query')){
                        if(proposal.action==='media_export')localSignature=adapter.nativeSnapshot();
                        const execute=action==='resume'?adapter.resumeNativeLoop:adapter.executeNativeAction;
                        if(!execute)throw new Error('原生画布适配器不可用');
                        await execute({...proposal,localSignature,check:async()=>{if(!alive())return false;const checked=await api('native/action',{...payload,action:'check'});return !!checked.canExecute&&alive();}});
                        const saved=await api('native/action',{...payload,action:'finish'});if(!alive())return;Object.assign(proposal,saved.proposal);
                    }
                }catch(err){error=err.message||'原生操作未完成；请查询保存结果';if(automatic)autoErrors.set(turn.id,error);}
                finally{flight=false;if(alive())render();}
                if(!error&&['confirm','dismiss','query'].includes(action)){autoErrors.delete(turn.id);closeTasks();queueAutomatic();}
            }
            nativeExecutors.set(proposal.id,act);
            render();
        }
        function addProposalCard(turn, proposal,progress){
            const owner=canvasId,sessionId=session.id;
            const card=document.createElement('section');card.className='canvas-assistant-proposal';card.setAttribute('aria-label','图片生成方案');
            const title=document.createElement('strong');title.textContent=proposal.title||'图片生成方案';
            const ratios={square:'1:1',portrait:'2:3',landscape:'3:2',portrait43:'3:4',landscape43:'4:3',story:'9:16',wide:'16:9',ultrawide:'21:9',ultratall:'9:21',source:'适配参考图',custom:'自定义'};
            const meta=document.createElement('div');meta.className='canvas-assistant-proposal-meta';meta.textContent=`${proposal.providerName||proposal.provider} · ${proposal.model}\n比例 ${ratios[proposal.ratio]||proposal.ratio} · 分辨率 ${proposal.resolution==='auto'?'自动':proposal.resolution.toUpperCase()} · 1 张 · 参考图 ${proposal.referenceImages.length} 张`;
            const details=document.createElement('details'),summary=document.createElement('summary'),prompt=document.createElement('div');summary.textContent='查看生成提示词';prompt.textContent=proposal.prompt;details.append(summary,prompt);
            const note=document.createElement('div');note.className='canvas-assistant-note';note.textContent='点击生成后使用所选平台额度，实际消耗以平台为准。';
            const state=document.createElement('div');state.className='canvas-assistant-proposal-state';state.setAttribute('role','status');
            const actions=document.createElement('div');actions.className='canvas-assistant-proposal-actions';
            card.append(title,meta,details,note,state,actions);taskList.append(card);
            const continuation=document.createElement('div');progress.controls.append(continuation);
            if(proposal.referenceImages.length){const refs=document.createElement('div');refs.className='canvas-assistant-proposal-refs';for(const url of proposal.referenceImages){const image=document.createElement('img');image.src=url;image.alt='生成参考图';image.loading='lazy';refs.append(image);}card.insertBefore(refs,details);}
            let flight=false,uncertain=false,task=null,error='';
            const alive=()=>matches(owner)&&session?.id===sessionId&&card.isConnected;
            const actionButton=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=flight||busy;b.onclick=()=>operate(action);actions.append(b);};
            function render(){
                if(!alive())return;
                ((!error&&!uncertain&&(proposal.state==='dismissed'||task?.status==='succeeded'||turn.state==='cancelled'&&proposal.state==='pending'))?progress.body:taskList).append(card);
                refreshTasks();
                continuation.replaceChildren();
                actions.replaceChildren();state.classList.toggle('canvas-assistant-error',!!error);
                const cancelledUnsubmitted=turn.state==='cancelled'&&proposal.state==='pending'&&!proposal.taskId;
                state.textContent=error||(flight?'正在处理，请勿重复提交…':cancelledUnsubmitted?'本轮已停止，方案未执行':proposal.state==='dismissed'?'已放弃本方案':proposal.state==='pending'&&!uncertain?'等待确认，尚未提交生成':task?.status==='succeeded'?'生成完成，可在画布查看':task?.status==='failed'?task.error||'图片生成失败':'任务已记录，可查询原任务并恢复到画布');
                if(proposal.state==='pending'&&!uncertain&&turn.state!=='cancelled'){actionButton('生成','confirm');actionButton('先不用','dismiss');}
                else if(proposal.state!=='dismissed'&&!cancelledUnsubmitted){actionButton('查询原任务','query');if(task?.status==='failed'&&!proposal.retryProposalId)actionButton('重试','retry');}
                if(turn.agent&&task?.status==='succeeded'&&!(turn.agent.consumedTasks||[]).includes(proposal.taskId)&&turn.state!=='cancelled'){const next=document.createElement('button');next.type='button';next.textContent='继续创作';next.disabled=busy||flight;next.onclick=()=>continueTurn(turn.id);continuation.append(next);}
                const view=document.createElement('button');view.type='button';view.textContent='查看画布';view.disabled=flight;view.onclick=async()=>{try{await adapter.viewChanges?.(proposal.nodeIds);}catch(err){error=err.message;render();}};actions.append(view);
            }
            async function operate(action,automatic=false){
                if(flight||busy||!alive())return;
                flight=true;error='';
                // 此时回合已经保存；即便图片确认请求尚未完成，停止也必须停止这个回合。
                const active=action==='confirm'?{canvasId:owner,sessionId,id:turn.id,controller:new AbortController(),submitted:true}:null;
                if(active){request=active;busy=true;}
                syncControls();render();
                let attempted=false;
                try{
                    const body={canvasId:owner,sessionId,turnId:turn.id,proposalId:proposal.id,action,automatic};
                    if(action==='confirm'){
                        if(!imageConfirm.checked||imageModels.value!==JSON.stringify([proposal.provider,proposal.model]))throw new Error('请勾选方案对应的图片模型；修改模型后需要重新提出方案');
                        body.imageRequest=await adapter.prepareImageRequest(proposal);
                        if(!await adapter.save())throw new Error('画布尚未保存，请保存后再确认');
                        if(!alive())return;
                        Object.assign(body,{expectedUpdatedAt:current().updatedAt,imageProvider:proposal.provider,imageModel:proposal.model});
                    }
                    attempted=true;
                    const result=await api('proposals/action',body,active?.controller.signal);
                    if(!alive())return;
                    if(action==='retry'){
                        proposal.retryProposalId=result.proposal.id;
                        if(!turn.proposals.some(p=>p.id===result.proposal.id)){turn.proposals.push(result.proposal);addProposalCard(turn,result.proposal,progress);}
                        error='已创建重试方案，请再次点击生成确认。';return;
                    }
                    Object.assign(proposal,result.proposal);task=result.task||null;proposal.taskStatus=task?.status;uncertain=false;
                    if(action==='confirm')turn.state='waiting_result';
                    if(task&&task.status!=='failed'){
                        state.textContent='任务已受理，正在同步画布…';
                        if(active)active.submitted=true;
                        await adapter.generateImage(proposal,task);
                        if(!alive()||active?.controller.signal.aborted)return;
                        const latest=await api('proposals/action',{...body,action:'query'},active?.controller.signal);
                        if(alive()){Object.assign(proposal,latest.proposal);task=latest.task;proposal.taskStatus=task?.status;}
                        if((action==='confirm'||automatic&&action==='query')&&alive()&&turn.agent&&turn.state!=='cancelled'&&!(turn.agent.consumedTasks||[]).includes(proposal.taskId)){
                            if(request===active){request=null;busy=false;syncControls();}
                            flight=false;render();await continueTurn(turn.id,true);return;
                        }
                    }
                }catch(err){
                    if(alive()){error=err.message||'操作失败，请查询原任务';if(automatic)autoErrors.set(turn.id,error);if(action==='confirm'&&attempted&&!err.submissionKnownRejected&&(!err.status||err.status>=500||err.message.includes('查询原任务')))uncertain=true;}
                }finally{
                    flight=false;
                    if(active&&request===active){request=null;busy=false;syncControls();if(alive())selectSession(sessionId).catch(err=>showStatus(err.message));}
                    render();
                }
            }
            render();
            imageExecutors.set(proposal.id,operate);
            // 重开只读取原编号状态，不触发新的图片请求。
            if(['submitted','submitting'].includes(proposal.state))api('proposals/action',{canvasId:owner,sessionId,turnId:turn.id,proposalId:proposal.id,action:'query'}).then(result=>{if(alive()&&!flight){Object.assign(proposal,result.proposal);task=result.task;render();}}).catch(err=>{if(alive()&&!flight){error=err.message;render();}});
        }
        function drawHistory(){
            messages.replaceChildren();taskList.replaceChildren();turnProgress.clear();nativeExecutors.clear();imageExecutors.clear();status.textContent='';status.hidden=true;
            if(!session?.turns?.length){ messages.textContent='选中节点，或引用画布素材，告诉我你的创作想法。';taskList.textContent='创作开始后，可在这里查看任务、授权和结果。';refreshTasks();return; }
            for(const turn of session.turns){
                const userBubble=document.createElement('div');userBubble.className='canvas-assistant-message canvas-assistant-user';userBubble.textContent=turn.message;messages.append(userBubble);
                const used=turn.skillsUsed||[];
                const progress=turn.steps?.length||turn.nativeActions?.length||turn.proposals?.length||turn.change||used.length||turn.state!=='completed'?addProgress(turn):null;
                if(used.length){const note=document.createElement('div');note.className='canvas-assistant-note canvas-assistant-turn-skills';note.textContent=`使用的 Skill：${used.map(item=>item.name).join('、')}`;progress.body.append(note);}
                const reply=document.createElement('div');reply.className='canvas-assistant-message canvas-assistant-reply';reply.textContent=turn.reply||'';
                if(turn.state==='running'){reply.textContent=turn.reply||'';}
                else if(['failed','interrupted'].includes(turn.state)){reply.classList.add('canvas-assistant-error');reply.textContent=turn.error||'这一轮没有完成';if(turn.state==='interrupted'){const retry=document.createElement('button');retry.type='button';retry.textContent='重新发送';retry.onclick=()=>{input.value=turn.message;syncControls();input.focus();};reply.append(retry);}}
                else if(turn.state==='paused'){reply.textContent=turn.reply||'创作进度已保存，可以继续完成剩余步骤。';}
                else if(turn.state==='cancelled'){reply.textContent=turn.error||'已停止本轮；已保存的操作仍保留。';}
                else if(turn.state!=='completed'){reply.textContent=turn.reply||(progress?'':turnPresentation(turn.state).label);}
                if(turn.state==='completed')addReplyActions(reply,turn.reply||'',resultMedia(turn));
                if(['interrupted','paused'].includes(turn.state)||turn.state==='failed'&&turn.agent){const button=document.createElement('button');button.type='button';button.textContent='继续创作';button.onclick=()=>{autoErrors.delete(turn.id);continueTurn(turn.id);};progress?.controls.append(button);}
                if(turn.state!=='completed'){if(turn.reply&&progress){const explanation=document.createElement('div');explanation.className='canvas-assistant-task-notice';explanation.textContent=turn.reply;progress.body.append(explanation);}reply.replaceChildren();reply.textContent='';}
                reply.hidden=!reply.textContent;messages.append(reply);
                for(const proposal of turn.proposals||[])addProposalCard(turn,proposal,progress);
                for(const proposal of turn.nativeActions||[])addNativeActionCard(turn,proposal,progress);
                const change=turn.change;
                if(change && (change.createdNodeIds?.length||change.updatedNodeIds?.length||change.createdEdgeIds?.length)){
                    const card=document.createElement('div');card.className='canvas-assistant-change';
                    const note=document.createElement('div');note.textContent=`已保存：新建 ${change.createdNodeIds?.length||0} 个节点，修改 ${change.updatedNodeIds?.length||0} 个节点，连线 ${change.createdEdgeIds?.length||0} 条`;
                    card.append(note);progress.body.append(card);
                }
            }
            messages.scrollTop=messages.scrollHeight;refreshTasks();queueAutomatic();
        }
        async function selectSession(id){
            const owner=canvasId, token=++sequence;
            const data=await api(`history?canvasId=${encodeURIComponent(owner)}&sessionId=${encodeURIComponent(id)}`);
            if(!matches(owner)||token!==sequence)return;
            session=data.session;closeReference();historyShown=false;drawHistory();syncControls();
        }
        async function newSession(){
            if(busy||sessionLoading)return;
            const owner=canvasId,token=++sequence;
            sessionLoading=true;syncControls();
            try{
                const data=await api('sessions',{canvasId:owner});
                if(!matches(owner)||token!==sequence)return;
                session=data.session;references=[];assetReferences=[];closeReference();historyShown=false;drawHistory();contextChips();
            }finally{sessionLoading=false;syncControls();}
        }
        async function load(){
            const value=current();if(!value?.id)throw new Error('请先打开画布');
            const owner=value.id,token=++sequence;canvasId=owner;
            closeSkills();skillSearch.value='';skillCategory='全部';
            const [configuration,history]=await Promise.all([api('status'),api(`sessions?canvasId=${encodeURIComponent(owner)}`)]);
            if(!matches(owner)||token!==sequence)return;
            providers=configuration.providers;imageProviders=configuration.image_providers||[];skillCatalog=configuration.skills||[];sessions=history.sessions;
            canvasTitle.textContent=value.title||'当前画布';
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
            fillSkills();
            rememberModel();rememberImageModel();
            showStatus(providers.length?'':'请先在 API 设置中配置聊天模型');
            if(history.activeSessionId)await selectSession(history.activeSessionId);else if(sessions.length)await selectSession(sessions[0].id);else await newSession();
            contextChips();syncControls();
        }
        async function open(){ panel.hidden=false;dock.hidden=true;button.classList.add('active');button.setAttribute('aria-expanded','true');clampPanel();if(canvasId!==current()?.id||!session)await load();contextChips();icons(); }
        async function cancel(){
            if(!request)return;
            const active=request;showStatus('正在停止…');
            if(!active.submitted){active.cancelled=true;active.controller.abort();showStatus('已停止本轮回复');return;}
            try{const result=await api('cancel',{canvasId:active.canvasId,sessionId:active.sessionId,requestId:active.id});if(result.state==='completed'){showStatus('这一轮已完成，请查看回复与画布');return;}active.cancelled=true;active.controller.abort();showStatus('已停止；上游可能仍在处理');}
            catch(err){showStatus(err.message);}
        }
        async function send(){
            if(busy){await cancel();return;}
            if(sessionLoading||!session||!models.value||!textConfirm.checked||!input.value.trim())return;
            if(selectedSkill()!=='auto'&&!skillCatalog.some(item=>item.id===selectedSkill())){showStatus('已选 Skill 已不可用，请重新选择或移除');return;}
            const owner=canvasId,sessionId=session.id,text=input.value.trim(),[provider,model]=JSON.parse(models.value);
            closeReference();
            const selection=[...(current()?.selectedNodeIds||[])],refs=[...references],assetRefs=assetReferences.map(item=>item.id);
            const imageModelConfirmed=!!imageConfirm.checked;
            const creationSettings=buildCreationSettings(current()?.creationSettings,imageModelConfirmed?imageModels.value:'');
            const active={canvasId:owner,sessionId,id:crypto.randomUUID(),controller:new AbortController()};request=active;busy=true;syncControls();showStatus('正在保存画布…');
            let ended=false,reply=null;
            try{
                if(!await adapter.save())throw new Error('画布尚未保存，请重试保存后再发送');
                if(active.controller.signal.aborted)throw new DOMException('已停止','AbortError');
                if(!matches(owner)||session?.id!==sessionId)throw new Error('画布或对话已切换');
                const value=current();
                const response=await fetch('/api/canvas-assistant/chat',{method:'POST',headers,signal:active.controller.signal,body:JSON.stringify({canvasId:owner,sessionId,requestId:active.id,message:text,provider,model,skillId:selectedSkill(),selectedNodeIds:selection,referencedNodeIds:refs,referencedAssetIds:assetRefs,expectedUpdatedAt:value.updatedAt,creationSettings,imageModelConfirmed})});
                if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(typeof data.detail==='string'?data.detail:'发送失败');}
                active.submitted=true;
                const userBubble=document.createElement('div');userBubble.className='canvas-assistant-message canvas-assistant-user';userBubble.textContent=text;messages.append(userBubble);active.progress=addProgress({id:active.id,state:'running'});reply=document.createElement('div');reply.className='canvas-assistant-message canvas-assistant-reply';reply.hidden=true;messages.append(reply);input.value='';let output='';
                await consumeStream(response,event=>{
                    if(!matches(owner)||session?.id!==sessionId)throw new Error('画布或对话已切换');
                    if(event.type==='text_delta'){output+=event.text||'';reply.textContent=output;reply.hidden=false;}
                    if(event.type==='lifecycle')showStatus('正在创作');
                    if(event.type==='agent_step'){showStatus(progressPresentation({state:'running',steps:event.step?[event.step]:[]}));active.progress.updateStep(event.step);}
                    if(event.type==='turn_end'){ended=true;reply.hidden=false;const display=turnPresentation(event.state);if(display.failed){reply.classList.add('canvas-assistant-error');reply.textContent=event.error||display.label;input.value=text;}else {reply.textContent=output||event.reply||display.label;if(event.state==='completed')addReplyActions(reply,output,event.media||[]);references=[];assetReferences=[];contextChips();}showStatus(event.error||display.label);}
                    messages.scrollTop=messages.scrollHeight;
                });
            }catch(err){if(matches(owner)){input.value=text;showStatus(err.name==='AbortError'?'已停止；上游可能仍在处理':err.message);if(reply&&!ended){reply.hidden=false;reply.textContent=err.name==='AbortError'?'已停止本轮回复':'回复没有完整结束，请查看历史后重试';}}}
            finally{
                if(request===active){request=null;busy=false;syncControls();if(matches(owner)&&session?.id===sessionId){try{await adapter.refresh?.();if(matches(owner))await selectSession(sessionId);}catch(err){showStatus(err.message);}}}
            }
        }
        async function continueTurn(turnId,wait=false){
            if(busy||!session)return;autoErrors.delete(turnId);closeTasks();const owner=canvasId,sessionId=session.id,active={canvasId:owner,sessionId,id:turnId,controller:new AbortController()};request=active;busy=true;syncControls();showStatus(wait?'等待图片完成后继续创作…':'正在继续创作…');
            active.progress=turnProgress.get(turnId)||addProgress({id:turnId,state:'running'});active.progress.label.textContent=wait?'等待原任务完成':'正在继续创作';
            const reply=document.createElement('div');reply.className='canvas-assistant-message canvas-assistant-reply';reply.hidden=true;messages.append(reply);let output='';
            try{
                const response=await fetch('/api/canvas-assistant/continue',{method:'POST',headers,signal:active.controller.signal,body:JSON.stringify({canvasId:owner,sessionId,requestId:turnId,wait})});
                if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.detail||'暂时不能继续');}active.submitted=true;
                await consumeStream(response,event=>{if(!matches(owner)||session?.id!==sessionId)throw new Error('画布或对话已切换');if(event.type==='agent_step'){showStatus(progressPresentation({state:'running',steps:event.step?[event.step]:[]}));active.progress.updateStep(event.step);}if(event.type==='text_delta'){output+=event.text||'';reply.textContent=output;reply.hidden=false;}if(event.type==='turn_end')showStatus(event.error||turnPresentation(event.state).label);});
            }catch(err){if(matches(owner)){autoErrors.set(turnId,err.name==='AbortError'?'已停止继续创作':err.message||'继续失败');showStatus(autoErrors.get(turnId));}}
            finally{if(request===active){request=null;busy=false;syncControls();if(matches(owner)&&session?.id===sessionId){try{await adapter.refresh?.();await selectSession(sessionId);}catch(err){showStatus(err.message);}}}}
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
        listen(button,'click',()=>{if(panel.hidden)open().catch(err=>showStatus(err.message));else{closeSkills();closeAppearance();closeModels();closeTasks();panel.hidden=true;dock.hidden=true;button.classList.remove('active');button.setAttribute('aria-expanded','false');}});
        listen(panel,'click',event=>{
            const action=event.target.closest('[data-action]')?.dataset.action;
            if(action==='close'){closeSkills();closeAppearance();closeModels();closeTasks();panel.hidden=true;dock.hidden=true;button.classList.remove('active');button.setAttribute('aria-expanded','false');}
            if(action==='fold'){const rect=panel.getBoundingClientRect();closeSkills();closeAppearance();closeModels();closeTasks();panel.hidden=true;dock.hidden=false;dock.style.left=`${Math.min(innerWidth-dock.offsetWidth-8,rect.left)}px`;dock.style.top=`${Math.min(innerHeight-dock.offsetHeight-8,rect.bottom-dock.offsetHeight)}px`;dock.style.right='auto';dock.style.bottom='auto';}
            if(action==='new')newSession().catch(err=>showStatus(err.message));
            if(action==='history'){closeTasks();}if(action==='history')listSessions().catch(err=>showStatus(err.message));
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
        listen(modelToggle,'click',()=>{if(modelToggle.disabled)return;const opening=modelPicker.hidden;closeSkills();closeAppearance();modelPicker.hidden=!opening;modelToggle.setAttribute('aria-expanded',String(opening));if(opening)modelProvider.focus();});
        listen(skillToggle,'click',()=>{if(skillToggle.disabled)return;const opening=skillPicker.hidden;closeModels();closeAppearance();skillPicker.hidden=!opening;skillToggle.setAttribute('aria-expanded',String(opening));if(opening){fillSkills();skillSearch.focus();}});
        listen(skillRemove,'click',()=>chooseSkill('auto'));
        listen(skillSearch,'input',fillSkills);
        listen(skillPicker.querySelector('header button'),'click',()=>{closeSkills();skillToggle.focus();});
        listen(input,'scroll',updateSkillPrefix);
        if(global.ResizeObserver){const observer=new global.ResizeObserver(()=>{updateSkillPrefix();positionSkills();});observer.observe(panel);observer.observe(skillPrefix);cleanups.push(()=>observer.disconnect());}
        listen(skillPicker,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeSkills();skillToggle.focus();}});
        listen(appearanceToggle,'click',()=>{const opening=appearancePicker.hidden;closeSkills();closeModels();appearancePicker.hidden=!opening;appearanceToggle.setAttribute('aria-expanded',String(opening));if(opening)opacitySlider.focus();});
        listen(opacitySlider,'input',()=>{applyOpacity(Number(opacitySlider.value));write(appearanceKey,Number(opacitySlider.value));});
        listen(modelProvider,'change',()=>{fillModels();if(modelProvider.value && models.options.length>1)models.selectedIndex=1;textConfirm.checked=false;rememberModel();});
        listen(models,'change',()=>{textConfirm.checked=false;rememberModel();});
        listen(textConfirm,'change',rememberModel);
        listen(imageProvider,'change',()=>{fillImageModels();if(imageProvider.value && imageModels.options.length>1)imageModels.selectedIndex=1;imageConfirm.checked=false;rememberImageModel();});
        listen(imageModels,'change',()=>{imageConfirm.checked=false;rememberImageModel();});
        listen(imageConfirm,'change',rememberImageModel);
        listen(document,'pointerdown',event=>{if(!modelPicker.contains(event.target)&&!modelToggle.contains(event.target))closeModels();if(!skillPicker.contains(event.target)&&!skillToggle.contains(event.target))closeSkills();if(!appearancePicker.contains(event.target)&&!appearanceToggle.contains(event.target))closeAppearance();},true);
        listen(panel,'keydown',event=>{if(event.key==='Escape'&&!appearancePicker.hidden){event.preventDefault();closeAppearance();appearanceToggle.focus();}if(event.key==='Escape'&&!modelPicker.hidden){event.preventDefault();closeModels();modelToggle.focus();}});
        for(const target of [panel,dock,skillPicker])for(const type of ['pointerdown','mousedown','dblclick','wheel','keydown'])listen(target,type,event=>event.stopPropagation());
        function bindMove(handle,target){
            let drag=null;
            listen(handle,'pointerdown',event=>{if(event.button!==0||event.target.closest('button'))return;const rect=target.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};handle.setPointerCapture(event.pointerId);event.preventDefault();});
            listen(handle,'pointermove',event=>{if(drag?.id!==event.pointerId)return;target.style.left=`${Math.max(8,Math.min(innerWidth-target.offsetWidth-8,drag.left+event.clientX-drag.x))}px`;target.style.top=`${Math.max(limits().top,Math.min(innerHeight-target.offsetHeight-8,drag.top+event.clientY-drag.y))}px`;target.style.right='auto';target.style.bottom='auto';});
            const end=event=>{if(drag?.id!==event.pointerId)return;drag=null;if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);if(target===panel){rememberLayout();positionTasks();}};
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
        listen(window,'resize',()=>{clampPanel();positionSkills();positionTasks();});
        const timer=setInterval(()=>{if(panel.hidden){closeTasks();closeSkills();if(picker)closeReference();return;}if(canvasId&&canvasId!==current()?.id){request?.controller.abort();sequence++;closeTasks();taskList.replaceChildren();session=null;references=[];assetReferences=[];closeReference();canvasId='';messages.replaceChildren();load().catch(err=>showStatus(err.message));}else{contextChips();positionSkills();positionTasks();queueAutomatic();}},800);
        cleanups.push(()=>clearInterval(timer));
        icons();button.setAttribute('aria-expanded','false');syncControls();
        const controller={destroy(){destroyed=true;sequence++;closeReference();if(request){api('cancel',{canvasId:request.canvasId,sessionId:request.sessionId,requestId:request.id}).catch(()=>{});request.controller.abort();}listeners.forEach(fn=>fn());cleanups.forEach(fn=>fn());panel.remove();dock.remove();skillPicker.remove();taskPanel.remove();},open};
        global.canvasAssistantController=controller;return controller;
    }
    global.CanvasAssistant={mount,consumeStream,creationSettings:buildCreationSettings,turnPresentation,composerLocked,progressPresentation,nativeActionAttention,automaticNative,taskPresentation,formalText,replyParagraphs,resultMedia,resultWorking};
})(window);
