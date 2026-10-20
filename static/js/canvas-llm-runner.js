/* Classic generation llm. Host supplies instance state and effects. */
(function(root){
    'use strict';

    async function callCanvasLLM(deps, node, message, messages=[], options={}){
        const llmProv = deps.resolveChatProviderId(node.llmProvider || 'comfly');
        const model = deps.resolveChatModel(node.model || node.llmMsModel, llmProv);
        options.onModelSelected?.({provider:llmProv,model});
        const images = deps.llmInputImages(node);
        const videos = deps.llmInputVideos(node);
        const audios = deps.llmInputAudios(node);
        const result = await deps.cascadeFetch('/api/canvas-llm', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                message,
                model,
                ms_model: llmProv === 'modelscope' ? model : '',
                provider: llmProv,
                // The System switch controls whether any system message is sent.
                // Keep the default only when the user explicitly enables it.
                system_prompt:node.showSystem ? ((node.systemPrompt || '').trim() || 'You are a helpful assistant.') : '',
                messages,
                images,
                videos,
                audios,
            })
        }, options).then(async r => {
            if(!r.ok){
                throw new Error(await deps.responseErrorMessage(r, 'LLM 运行失败'));
            }
            return r.json();
        });
        return result.text || '';
    }

    async function runAudioAnalysisGenerator(deps, node, prompt, audios, opts={}){
        const message = String(prompt || '').trim() || '请分析这段音频，概括主要内容、说话人和关键信息。';
        if(!audios.length) throw new Error('请先连接音频素材');
        if(!opts.cascade){ node.running = true; deps.refreshNodes([node.id]); }
        try{
            node.audioOutputText = await callCanvasLLM(deps, node, message, [], {cascadeTargetId:deps.cascadeTargetIdFromOptions(opts), audios});
            deps.outputNodesForSource(node.id).forEach(out => { out.audioOutputText = node.audioOutputText; });
            node.running = false; node.runStatus = 'done'; node.runError = '';
            deps.refreshNodes([node.id, ...deps.outputNodesForSource(node.id).map(out => out.id)]);
            deps.scheduleSave();
            return node.audioOutputText;
        }catch(error){
            node.running = false; node.runStatus = 'failed'; node.runError = error.message || String(error);
            deps.refreshNodes([node.id]);
            if(opts.cascade) throw error;
            deps.alert(error.message || '音频分析失败');
            return '';
        }
    }

    async function runLLMNode(deps, nodeId, opts={}){
        const node = deps.nodes.find(n => n.id === nodeId);
        if(!node || (node.running && !opts.cascade)) return;
        const cascadeTargetId = deps.cascadeTargetIdFromOptions(opts);
        const input = deps.llmInputText(node) || node.userInput || '';
        const storyOrigin=node.storyAnalysisOrigin || node.shotPromptOrigin;
        const storyResultField=node.shotPromptOrigin ? "shotPromptResult" : "storyAnalysisResult";
        const storySourceText=storyOrigin ? deps.nodes.find(n=>n.id===storyOrigin.sourceNodeId)?.text : undefined;
        const audios = deps.llmInputAudios(node);
        if(!input && !audios.length){
            if(opts.cascade) throw new Error('LLM 缺少提示词输入');
            deps.alert(deps.tr('canvas.needPromptToLLM')); return;
        }
        if(!opts.cascade){ node.running = true; deps.refreshNodes([node.id]); }
        try {
            if(opts.beforeSubmit) await opts.beforeSubmit();
            if(storyOrigin) delete node[storyResultField];
            if(opts.assistantNativeActionId){
                node.assistantNativeRun = {actionId:String(opts.assistantNativeActionId), taskKind:'llm', taskIds:[], submissionStarted:true};
            }
            let storyModel={provider:node.llmProvider,model:node.model};
            const outputText = await callCanvasLLM(deps, node, input || '请分析这段音频，概括主要内容、说话人和关键信息。', [], {cascadeTargetId,onModelSelected:value=>{storyModel=value;}});
            if(opts.assistantNativeActionId && !String(outputText || '').trim()) throw new Error('LLM 返回空文本，未取得可保存结果');
            node.outputText = outputText;
            if(storyOrigin) node[storyResultField]={sourceText:storySourceText,outputText,...storyModel};
            if(!opts.cascade) node.running = false;
            node.runStatus = 'done'; node.runError = '';
            if(opts.assistantNativeActionId){
                node.assistantNativeRun.status='succeeded';
                node.assistantNativeRun.outputText=node.outputText;
            }
            deps.refreshNodes([node.id]);
            deps.scheduleGeneratorInputSync();
            deps.scheduleSave();
        } catch(err) {
            if(!opts.cascade) node.running = false;
            if(deps.isCascadeAbortError(err)){
                deps.refreshNodes([node.id]);
                if(opts.cascade) throw err;
                return;
            }
            node.runStatus = 'failed'; node.runError = err.message || String(err);
            if(opts.assistantNativeActionId){
                node.assistantNativeRun = node.assistantNativeRun || {actionId:String(opts.assistantNativeActionId),taskKind:'llm',taskIds:[]};
                node.assistantNativeRun.status='failed';
                node.assistantNativeRun.error=node.runError;
                node.assistantNativeRun.knownRejected=!!err.submissionKnownRejected;
            }
            deps.refreshNodes([node.id]);
            if(opts.cascade) throw err;
            deps.alert(err.message || 'LLM 运行失败');
        }
    }

    async function runLLMChat(deps, nodeId){
        const node = deps.nodes.find(n => n.id === nodeId);
        if(!node || node.running) return;
        const message = (node.chatInput || '').trim();
        if(!message) return;
        node.messages = node.messages || [];
        const history = node.messages.slice();
        node.messages.push({role:'user', content:message});
        node.chatInput = '';
        node.running = true;
        deps.refreshNodes([node.id]);
        try {
            const text = await callCanvasLLM(deps, node, message, history);
            node.messages.push({role:'assistant', content:text});
            node.outputText = text;
            node.running = false;
            deps.refreshNodes([node.id]);
            deps.scheduleSave();
        } catch(err) {
            node.running = false;
            deps.refreshNodes([node.id]);
            deps.alert(err.message || 'LLM 运行失败');
        }
    }

    const api={callCanvasLLM, runAudioAnalysisGenerator, runLLMNode, runLLMChat};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasLLMRunner=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
