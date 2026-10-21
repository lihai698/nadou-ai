/* Workflow import/export responsibility: smart-workflow-transfer. Host supplies live state and effects. */
(function(root){
    'use strict';

    async function smartCanvasAssistantExportWorkflow(deps, {actionId,nodeId,nodeIds,connectionIds,includeResources,scopeHash,beforeDownload}){
        if(!deps.canvas || !Array.isArray(nodeIds) || !nodeIds.length) throw new Error('没有可导出的节点范围');
        const idSet=new Set(nodeIds);
        const storage=deps.canvasForStorage();
        const selectedNodes=nodeIds.map(id=>(storage.nodes||[]).find(node=>node.id===id)).filter(Boolean).map(node=>{const item={...node};delete item.assistantExportReceipts;return item;});
        const selectedConnections=(storage.connections||[]).filter(edge=>idSet.has(edge.from)&&idSet.has(edge.to));
        if(selectedNodes.length!==nodeIds.length) throw new Error('导出节点范围已变化，请重新读取画布');
        const expectedConnectionIds=selectedConnections.map(edge=>edge.id).filter(Boolean);
        if(JSON.stringify(expectedConnectionIds)!==JSON.stringify(connectionIds||expectedConnectionIds)) throw new Error('导出连线范围已变化，请重新读取画布');
        const format=includeResources?'zip':'json';
        const filename=smartWorkflowFilename(deps, format);
        let blob,contentType='application/json';
        if(includeResources){
            const res=await deps.fetch('/api/canvas-workflows/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nodes:selectedNodes,connections:selectedConnections,include_resources:true,filename})});
            if(!res.ok) throw new Error(await deps.responseErrorMessage(res,'导出包含资源的工作流失败'));
            blob=await res.blob();contentType=res.headers.get('content-type')||'application/zip';
            const bytes=new Uint8Array(await blob.slice(0,2).arrayBuffer());
            if(blob.size<=0||bytes[0]!==0x50||bytes[1]!==0x4b) throw new Error('服务返回的 ZIP 文件无效');
        }else{
            blob=new Blob([JSON.stringify({format:'infinite-canvas-workflow',version:1,exported_at:Date.now(),nodes:selectedNodes,connections:selectedConnections},null,2)],{type:'application/json'});
            if(blob.size<=0) throw new Error('工作流 JSON 为空');
        }
        if(typeof beforeDownload!=='function')throw new Error('缺少导出内容复核，未发起下载');
        await beforeDownload();
        deps.downloadBlob(blob,filename);
        return {receipt:{actionId:String(actionId),status:'download_started',format,filename,nodeId:String(nodeId||''),nodeIds:[...nodeIds],connectionIds:expectedConnectionIds,includeResources:!!includeResources,scopeHash:String(scopeHash||''),bytes:blob.size,contentType,archiveMagic:includeResources?'PK':'',downloadedAt:Date.now()}};
    }

    function smartWorkflowFilename(deps, ext='json'){
        const title = (deps.canvas?.title || deps.document.getElementById('smartTitle')?.textContent || 'smart-canvas').trim();
        const safe = title.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '-').slice(0, 48) || 'smart-canvas';
        const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
        return `${safe}-workflow-${stamp}.${ext}`;
    }

    function selectedSmartWorkflowPayload(deps){
        const ids = deps.selectedNodeIds();
        const idSet = new Set(deps.smartNodesWithGroupMembers(ids).map(node => node.id));
        const selectedNodes = deps.nodes.filter(node => idSet.has(node.id)).map(deps.serializableSmartNode);
        const selectedSet = new Set(selectedNodes.map(node => node.id));
        const selectedConnections = (deps.canvas?.connections || [])
            .filter(conn => selectedSet.has(conn.from) && selectedSet.has(conn.to))
            .map(conn => JSON.parse(JSON.stringify(conn)));
        return {
            format:'infinite-smart-canvas-workflow',
            version:1,
            canvas_type:'smart',
            exported_at:Date.now(),
            nodes:selectedNodes,
            connections:selectedConnections
        };
    }

    function normalizeImportedSmartWorkflow(deps, data){
        if(Array.isArray(data)) return {nodes:data, connections:[]};
        if(Array.isArray(data?.nodes)) return {nodes:data.nodes, connections:Array.isArray(data.connections) ? data.connections : []};
        if(Array.isArray(data?.workflow?.nodes)) return {nodes:data.workflow.nodes, connections:Array.isArray(data.workflow.connections) ? data.workflow.connections : []};
        return {nodes:[], connections:[]};
    }

    function importedSmartLocalAssetUrls(deps, value, urls=new Set()){
        if(typeof value === 'string'){
            if(value.startsWith('/assets/') || value.startsWith('/output/')) urls.add(value);
        } else if(Array.isArray(value)){
            value.forEach(item => importedSmartLocalAssetUrls(deps, item, urls));
        } else if(value && typeof value === 'object'){
            Object.values(value).forEach(item => importedSmartLocalAssetUrls(deps, item, urls));
        }
        return [...urls];
    }

    function openSmartWorkflowTransferModal(deps){
        if(!deps.canvas){ deps.toast('请先打开画布'); return; }
        deps.toggleAssetLibrary(false);
        updateSmartWorkflowTransferMeta(deps);
        deps.smartWorkflowTransferModal?.classList.add('open');
        deps.smartWorkflowToggle?.classList.add('active');
        deps.refreshIcons();
    }

    function closeSmartWorkflowTransferModal(deps){
        deps.smartWorkflowTransferModal?.classList.remove('open');
        deps.smartWorkflowToggle?.classList.remove('active');
        deps.smartWorkflowImportDropZone?.classList.remove('drag-over');
    }

    function updateSmartWorkflowTransferMeta(deps){
        const payload = selectedSmartWorkflowPayload(deps);
        const nodeCount = payload.nodes.length;
        const connCount = payload.connections.length;
        deps.smartWorkflowExportMeta?.classList.remove('busy', 'success');
        if(deps.smartWorkflowExportMeta) deps.smartWorkflowExportMeta.textContent = nodeCount ? `已选择 ${nodeCount} 个节点，${connCount} 条连线` : '未选择节点，请先选中要导出的组件';
        if(deps.smartWorkflowTransferSub) deps.smartWorkflowTransferSub.textContent = nodeCount ? '导出当前选中内容，或把工作流导入到当前画布' : '请先选中节点再导出；导入会追加到当前画布';
    }

    async function exportSelectedSmartWorkflow(deps, includeResources=false){
        if(!deps.canvas) return;
        const payload = selectedSmartWorkflowPayload(deps);
        if(!payload.nodes.length){
            updateSmartWorkflowTransferMeta(deps);
            deps.toast('未选择节点，请先选中要导出的组件');
            return;
        }
        try {
            if(!includeResources){
                deps.downloadBlob(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}), smartWorkflowFilename(deps, 'json'));
                deps.toast('已导出智能画布工作流 JSON');
                return;
            }
            if(deps.smartWorkflowExportMeta){
                deps.smartWorkflowExportMeta.classList.add('busy');
                deps.smartWorkflowExportMeta.textContent = '正在打包资源...';
            }
            const filename = smartWorkflowFilename(deps, 'zip');
            const res = await deps.fetch('/api/canvas-workflows/export', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({...payload, include_resources:true, filename})
            });
            if(!res.ok) throw new Error(await deps.responseErrorMessage(res, '导出工作流失败'));
            deps.downloadBlob(await res.blob(), filename);
            if(deps.smartWorkflowExportMeta){
                deps.smartWorkflowExportMeta.classList.remove('busy');
                deps.smartWorkflowExportMeta.classList.add('success');
                deps.smartWorkflowExportMeta.textContent = `已导出 ${payload.nodes.length} 个节点，包含可找到的本地资源`;
            }
            deps.toast('已导出包含资源的智能画布工作流包');
            deps.setTimeout(() => {
                if(deps.smartWorkflowTransferModal?.classList.contains('open')) updateSmartWorkflowTransferMeta(deps);
            }, 1600);
        } catch(err) {
            updateSmartWorkflowTransferMeta(deps);
            deps.toast(err.message || '导出工作流失败');
        }
    }

    function insertSmartWorkflowIntoCanvas(deps, imported, point){
        const srcNodes = (imported.nodes || []).filter(Boolean);
        const srcConnections = (imported.connections || []).filter(Boolean);
        if(!deps.canvas || !srcNodes.length) throw new Error('工作流中没有可导入的节点');
        deps.pushUndo();
        const minX = Math.min(...srcNodes.map(n => Number(n.x || 0)));
        const minY = Math.min(...srcNodes.map(n => Number(n.y || 0)));
        const target = point || deps.viewportCenter();
        const dx = target.x - minX;
        const dy = target.y - minY;
        const idMap = new Map();
        const newNodes = srcNodes.map(source => {
            const copy = deps.serializableSmartNode(source);
            const oldId = copy.id || deps.uid(copy.type || 'smart');
            copy.id = deps.uid(copy.type || 'smart');
            copy.x = Number(copy.x || 0) + dx;
            copy.y = Number(copy.y || 0) + dy;
            copy.created_at = copy.created_at || Date.now();
            idMap.set(oldId, copy.id);
            return deps.normalizeLegacySmartNode(copy);
        }).filter(Boolean);
        newNodes.forEach(copy => {
            if(copy.type === 'smart-group' && Array.isArray(copy.items)){
                copy.items = copy.items.map(id => idMap.get(id)).filter(Boolean);
            }
            if(Array.isArray(copy.inputNodeIds))copy.inputNodeIds=copy.inputNodeIds.map(id=>idMap.get(id)).filter(Boolean);
            deps.remapSmartViewAdjustRefs(copy, idMap);
        });
        deps.remapSmartDepthCopies(newNodes, idMap);
        const newConnections = srcConnections
            .map(conn => ({...JSON.parse(JSON.stringify(conn)), id:deps.uid('c'), from:idMap.get(conn.from), to:idMap.get(conn.to)}))
            .filter(conn => conn.from && conn.to);
        deps.nodes.push(...newNodes);
        deps.canvas.connections = [...(deps.canvas.connections || []), ...newConnections];
        deps.selectedIds = newNodes.length > 1 ? newNodes.map(node => node.id) : [];
        deps.selectedId = newNodes.length === 1 ? newNodes[0].id : '';
        deps.selectedImage = {nodeId:'', index:-1};
        deps.activeComposerSubject = null;
        deps.render();
        deps.scheduleSave();
        deps.toast(`已导入 ${newNodes.length} 个节点`);
    }

    async function importSmartWorkflowFile(deps, file, point){
        if(!deps.canvas || !file) return;
        const isCurrent=deps.captureMediaInputContext();
        if(!isCurrent())return;
        try {
            if(deps.smartWorkflowTransferSub) deps.smartWorkflowTransferSub.textContent = '正在导入工作流...';
            const form = new FormData();
            form.append('file', file);
            const res = await deps.fetch('/api/canvas-workflows/import', {method:'POST', body:form});
            if(!res.ok) throw new Error(await deps.responseErrorMessage(res, '导入工作流失败'));
            const data = await res.json();
            if(!isCurrent())return;
            const imported = normalizeImportedSmartWorkflow(deps, data);
            const importedUrls = importedSmartLocalAssetUrls(deps, imported.nodes);
            insertSmartWorkflowIntoCanvas(deps, imported, point);
            closeSmartWorkflowTransferModal(deps);
            if(importedUrls.length){
                try {
                    const check = await deps.fetch('/api/canvas-assets/check', {
                        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({urls:importedUrls})
                    });
                    if(!check.ok) throw new Error('资源检查失败');
                    const exists = (await check.json()).exists || {};
                    if(!isCurrent())return;
                    const missing = importedUrls.filter(url => exists[url] === false);
                    if(missing.length) deps.toast(`工作流已导入，但有 ${missing.length} 个本地素材文件缺失；请重新指定素材，或导入包含资源的 ZIP。`);
                } catch(err) {
                    if(!isCurrent())return;
                    deps.toast('工作流已导入，但暂时无法检查本地素材是否完整。');
                }
            }
        } catch(err) {
            if(!isCurrent())return;
            if(deps.smartWorkflowTransferModal?.classList.contains('open')) updateSmartWorkflowTransferMeta(deps);
            deps.toast(err.message || '导入工作流失败');
        }
    }

    async function importSmartWorkflowAssetUrl(deps, url, name='workflow', point){
        if(!deps.canvas || !url)return;
        const isCurrent=deps.captureMediaInputContext();if(!isCurrent())return;
        try{
            const response=await deps.fetch(url,{cache:'no-store'});
            if(!response.ok)throw new Error('读取工作流资产失败');
            const blob=await response.blob();if(!isCurrent())return;
            const fileName=/\.(json|zip)$/i.test(name)?name:(url.split('/').pop()?.split('?')[0]||name+'.zip');
            await importSmartWorkflowFile(deps,new File([blob],fileName,{type:blob.type||'application/octet-stream'}),point);
        }catch(error){if(isCurrent())deps.toast(error.message||'导入工作流资产失败');}
    }

    const api={importSmartWorkflowAssetUrl, smartCanvasAssistantExportWorkflow, smartWorkflowFilename, selectedSmartWorkflowPayload, normalizeImportedSmartWorkflow, importedSmartLocalAssetUrls, openSmartWorkflowTransferModal, closeSmartWorkflowTransferModal, updateSmartWorkflowTransferMeta, exportSelectedSmartWorkflow, insertSmartWorkflowIntoCanvas, importSmartWorkflowFile};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartWorkflowTransfer=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
