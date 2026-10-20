/* Workflow import/export responsibility: canvas-workflow-transfer. Host supplies live state and effects. */
(function(root){
    'use strict';

    function selectedWorkflowPayload(deps){
        const ids = new Set(deps.canvasNodesWithGroupMembers([...deps.selected]).map(node => node.id));
        const pickedNodes = [...ids].map(id => deps.nodes.find(n => n.id === id)).filter(Boolean);
        const pickedConnections = deps.connections.filter(c => ids.has(c.from) && ids.has(c.to)).map(c => ({...c}));
        return {
            format:'infinite-canvas-workflow',
            version:1,
            exported_at:Date.now(),
            nodes:deps.serializableCanvasNodes(pickedNodes),
            connections:pickedConnections
        };
    }

    function workflowFilename(deps, ext){
        const title = (deps.canvas?.title || 'canvas-workflow').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 48) || 'canvas-workflow';
        const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
        return `${title}-${stamp}.${ext}`;
    }

    async function canvasAssistantExportWorkflow(deps, {actionId,nodeId,nodeIds,connectionIds,includeResources,scopeHash,beforeDownload}){
        if(!deps.canvas || !Array.isArray(nodeIds) || !nodeIds.length) throw new Error('没有可导出的节点范围');
        const idSet=new Set(nodeIds);
        const storedNodes=deps.serializableCanvasNodes();
        const selectedNodes=nodeIds.map(id=>storedNodes.find(node=>node.id===id)).filter(Boolean).map(node=>{const item={...node};delete item.assistantExportReceipts;return item;});
        const selectedConnections=(deps.connections||[]).filter(edge=>idSet.has(edge.from)&&idSet.has(edge.to));
        if(selectedNodes.length!==nodeIds.length) throw new Error('导出节点范围已变化，请重新读取画布');
        const expectedConnectionIds=selectedConnections.map(edge=>edge.id).filter(Boolean);
        if(JSON.stringify(expectedConnectionIds)!==JSON.stringify(connectionIds||expectedConnectionIds)) throw new Error('导出连线范围已变化，请重新读取画布');
        const format=includeResources?'zip':'json';
        const filename=workflowFilename(deps, format);
        let blob,contentType='application/json';
        if(includeResources){
            const res=await deps.fetch('/api/canvas-workflows/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nodes:selectedNodes,connections:selectedConnections,include_resources:true,filename})});
            if(!res.ok) throw new Error(await deps.responseErrorMessage(res,'导出包含资源的工作流失败'));
            blob=await res.blob();contentType=res.headers.get('content-type')||'application/zip';
            const bytes=new Uint8Array(await blob.slice(0,2).arrayBuffer());
            if(blob.size<=0||bytes[0]!==0x50||bytes[1]!==0x4b) throw new Error('服务返回的 ZIP 文件无效');
        }else{
            const payload={format:'infinite-canvas-workflow',version:1,exported_at:Date.now(),nodes:selectedNodes,connections:selectedConnections};
            blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
            if(blob.size<=0) throw new Error('工作流 JSON 为空');
        }
        if(typeof beforeDownload!=='function')throw new Error('缺少导出内容复核，未发起下载');
        await beforeDownload();
        deps.downloadBlob(blob,filename);
        return {receipt:{actionId:String(actionId),status:'download_started',format,filename,nodeId:String(nodeId||''),nodeIds:[...nodeIds],connectionIds:expectedConnectionIds,includeResources:!!includeResources,scopeHash:String(scopeHash||''),bytes:blob.size,contentType,archiveMagic:includeResources?'PK':'',downloadedAt:Date.now()}};
    }

    function openWorkflowTransferModal(deps){
        if(!deps.canvas){ deps.setStatus(deps.tr('canvas.needCanvas')); return; }
        if(deps.canvasAssetLibraryOpen) deps.toggleCanvasAssetLibrary(false);
        updateWorkflowTransferMeta(deps);
        deps.workflowTransferModal?.classList.add('open');
        deps.workflowTransferToggle?.classList.add('active');
        deps.refreshIcons();
    }

    function closeWorkflowTransferModal(deps){
        deps.workflowTransferModal?.classList.remove('open');
        deps.workflowTransferToggle?.classList.remove('active');
        deps.workflowImportDropZone?.classList.remove('drag-over');
    }

    function updateWorkflowTransferMeta(deps){
        const payload = selectedWorkflowPayload(deps);
        const nodeCount = payload.nodes.length;
        const connCount = payload.connections.length;
        deps.workflowExportMeta?.classList.remove('busy', 'success');
        if(deps.workflowExportMeta) deps.workflowExportMeta.textContent = nodeCount ? `已选择 ${nodeCount} 个节点，${connCount} 条连线` : '未选择节点，请先框选要导出的组件';
        if(deps.workflowTransferSub) deps.workflowTransferSub.textContent = nodeCount ? '导出当前框选内容，或把工作流导入到当前画布' : '请先框选节点再导出；导入会追加到当前画布';
    }

    function setWorkflowLibraryExportState(deps, state='idle', text='导出到资产库'){
        if(!deps.workflowExportLibraryBtn) return;
        deps.workflowExportLibraryBtn.disabled = state === 'busy';
        deps.workflowExportLibraryBtn.classList.toggle('busy', state === 'busy');
        deps.workflowExportLibraryBtn.classList.toggle('success', state === 'success');
        const icon = state === 'busy' ? 'loader-2' : state === 'success' ? 'check' : 'library-big';
        deps.workflowExportLibraryBtn.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i><span>${deps.escapeHtml(text)}</span>`;
        deps.refreshIcons();
    }

    async function exportSelectedWorkflow(deps, includeResources=false){
        if(!deps.canvas) return;
        const payload = selectedWorkflowPayload(deps);
        if(!payload.nodes.length){
            if(deps.workflowExportMeta) deps.workflowExportMeta.textContent = '未选择节点，请先框选要导出的组件';
            if(deps.workflowTransferSub) deps.workflowTransferSub.textContent = '请先框选节点再导出；导入会追加到当前画布';
            deps.setStatus('未选择节点，请先框选要导出的组件');
            return;
        }
        try {
            if(!includeResources){
                const filename = workflowFilename(deps, 'json');
                deps.downloadBlob(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}), filename);
                deps.setStatus('已导出工作流 JSON');
                return;
            }
            const filename = workflowFilename(deps, 'zip');
            const res = await deps.fetch('/api/canvas-workflows/export', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({...payload, include_resources:true, filename})
            });
            if(!res.ok) throw new Error(await deps.responseErrorMessage(res, '导出工作流失败'));
            const blob = await res.blob();
            deps.downloadBlob(blob, filename);
            deps.setStatus('已导出包含资源的工作流包');
        } catch(err) {
            deps.showErrorModal(err.message || '导出工作流失败', '导出工作流');
        }
    }

    function defaultWorkflowAssetTarget(deps){
        const libs = deps.canvasAssetLibraries();
        let lib = deps.activeCanvasAssetLibrary() || libs[0] || null;
        if(!lib) return {libraryId:'', categoryId:''};
        let cat = (lib.categories || []).find(item => String(item.type || '').toLowerCase() === 'workflow');
        if(!cat){
            lib = libs.find(item => (item.categories || []).some(cat => String(cat.type || '').toLowerCase() === 'workflow')) || lib;
            cat = (lib.categories || []).find(item => String(item.type || '').toLowerCase() === 'workflow');
        }
        return {libraryId:lib?.id || '', categoryId:cat?.id || ''};
    }

    async function exportSelectedWorkflowToLibrary(deps){
        if(!deps.canvas) return;
        const payload = selectedWorkflowPayload(deps);
        if(!payload.nodes.length){
            if(deps.workflowExportMeta) deps.workflowExportMeta.textContent = '未选择节点，请先框选要导出的组件';
            deps.setStatus('未选择节点，请先框选要导出的组件');
            return;
        }
        try {
            setWorkflowLibraryExportState(deps, 'busy', '导出中...');
            if(deps.workflowExportMeta){
                deps.workflowExportMeta.classList.remove('success');
                deps.workflowExportMeta.classList.add('busy');
                deps.workflowExportMeta.textContent = '正在导出到资产库...';
            }
            if(deps.workflowTransferSub) deps.workflowTransferSub.textContent = '正在保存工作流到资产库';
            deps.setStatus('正在导出工作流到资产库...');
            if(!deps.canvasAssetLibrary?.libraries?.length) await deps.loadCanvasAssetLibrary({renderPanel:false});
            const filename = workflowFilename(deps, 'zip');
            const target = defaultWorkflowAssetTarget(deps);
            const res = await deps.fetch('/api/canvas-workflows/export-to-library', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({...payload, include_resources:true, filename, name:filename.replace(/\.zip$/i, ''), library_id:target.libraryId, category_id:target.categoryId})
            });
            if(!res.ok) throw new Error(await deps.responseErrorMessage(res, '导出到资产库失败'));
            const data = await res.json();
            deps.canvasAssetLibrary = data.library || deps.canvasAssetLibrary;
            deps.activeCanvasAssetLibraryId = target.libraryId || deps.canvasAssetLibrary.active_library_id || deps.activeCanvasAssetLibraryId;
            deps.activeCanvasAssetCategoryId = data.item ? deps.findCanvasAssetCategoryForItem(data.item.id)?.id || deps.activeCanvasAssetCategoryId : deps.activeCanvasAssetCategoryId;
            deps.renderCanvasAssetLibrary();
            if(deps.assetManagerModal?.classList.contains('open')) deps.renderAssetManager();
            const itemName = data.item?.name || '工作流';
            if(deps.workflowExportMeta){
                deps.workflowExportMeta.classList.remove('busy');
                deps.workflowExportMeta.classList.add('success');
                deps.workflowExportMeta.textContent = `已导出到资产库：${itemName}`;
            }
            if(deps.workflowTransferSub) deps.workflowTransferSub.textContent = '导出完成，可在资产库的工作流分组中查看';
            setWorkflowLibraryExportState(deps, 'success', '已导出');
            deps.setStatus(`已导出工作流到资产库：${itemName}`);
            deps.setTimeout(() => {
                setWorkflowLibraryExportState(deps, 'idle');
                if(deps.workflowTransferModal?.classList.contains('open')) updateWorkflowTransferMeta(deps);
            }, 1800);
        } catch(err) {
            setWorkflowLibraryExportState(deps, 'idle');
            deps.workflowExportMeta?.classList.remove('busy', 'success');
            deps.showErrorModal(err.message || '导出到资产库失败', '导出工作流');
        }
    }

    function normalizeImportedWorkflow(deps, data){
        if(Array.isArray(data?.nodes)) return {nodes:data.nodes, connections:Array.isArray(data.connections) ? data.connections : []};
        if(Array.isArray(data?.workflow?.nodes)) return {nodes:data.workflow.nodes, connections:Array.isArray(data.workflow.connections) ? data.workflow.connections : []};
        return {nodes:[], connections:[]};
    }

    function insertWorkflowIntoCanvas(deps, imported){
        const srcNodes = (imported.nodes || []).filter(Boolean);
        const srcConnections = (imported.connections || []).filter(Boolean);
        if(!deps.canvas || !srcNodes.length) throw new Error('工作流中没有可导入的节点');
        deps.pushUndo();
        const minX = Math.min(...srcNodes.map(n => Number(n.x || 0)));
        const minY = Math.min(...srcNodes.map(n => Number(n.y || 0)));
        const target = deps.lastMouseBoard && Number.isFinite(deps.lastMouseBoard.x) ? deps.lastMouseBoard : deps.defaultPoint(0, 0);
        const dx = target.x - minX;
        const dy = target.y - minY;
        const idMap = new Map();
        const newNodes = srcNodes.map(n => {
            const copy = JSON.parse(JSON.stringify(deps.serializableCanvasNode(n)));
            const oldId = copy.id || deps.uid(copy.type || 'n');
            copy.id = deps.uid(copy.type || 'n');
            deps.window.CanvasAudio.detachTask(copy);
            deps.window.CanvasAudio.migrate(copy);
            copy.x = Number(copy.x || 0) + dx;
            copy.y = Number(copy.y || 0) + dy;
            copy.running = false;
            idMap.set(oldId, copy.id);
            return copy;
        });
        newNodes.forEach(node => {
            if((node.type === 'group' || node.type === 'promptGroup') && Array.isArray(node.items)){
                node.items = node.items.map(id => idMap.get(id)).filter(Boolean);
            }
        });
        deps.remapCanvasDepthCopies(newNodes, idMap);
        deps.window.CanvasClipHost?.remapCopies(newNodes,idMap);
        deps.window.CanvasVideoDeconstructionModel?.remapCopies(newNodes,idMap);
        const newConnections = srcConnections
            .map(c => ({...c, id:deps.uid('c'), from:idMap.get(c.from), to:idMap.get(c.to)}))
            .filter(c => c.from && c.to);
        deps.nodes.push(...newNodes);
        deps.connections.push(...newConnections);
        deps.selected.clear();
        newNodes.forEach(n => deps.selected.add(n.id));
        deps.sanitizeConnections();
        deps.syncGeneratorInputs();
        deps.render();
        deps.scheduleSave();
        deps.setStatus(`已导入 ${newNodes.length} 个节点`);
    }

    async function importWorkflowFile(deps, file){
        if(!deps.canvas || !file) return;
        const isCurrent = deps.captureMediaInputContext();
        if(!isCurrent()) return;
        try {
            const form = new FormData();
            form.append('file', file);
            const res = await deps.fetch('/api/canvas-workflows/import', {method:'POST', body:form});
            if(!res.ok) throw new Error(await deps.responseErrorMessage(res, '导入工作流失败'));
            const data = await res.json();
            if(!isCurrent()) return;
            const imported = normalizeImportedWorkflow(deps, data);
            const importedUrls = deps.canvasLocalAssetUrls(imported.nodes, []);
            insertWorkflowIntoCanvas(deps, imported);
            await deps.refreshMissingCanvasAssets();
            if(!isCurrent()) return;
            deps.render();
            closeWorkflowTransferModal(deps);
            const missing = importedUrls.filter(url => deps.missingAssetUrls.has(url));
            if(missing.length){
                deps.showErrorModal(`工作流已导入，但有 ${missing.length} 个本地素材文件缺失。请重新指定素材，或从原画布导出“包含资源”的 ZIP 后再导入。`, '导入资源缺失');
            }
        } catch(err) {
            if(!isCurrent()) return;
            deps.showErrorModal(err.message || '导入工作流失败', '导入工作流');
        }
    }

    async function importWorkflowAssetUrl(deps, url, name='workflow'){
        if(!deps.canvas || !url) return;
        const isCurrent = deps.captureMediaInputContext();
        if(!isCurrent()) return;
        try {
            const res = await deps.fetch(url, {cache:'no-store'});
            if(!res.ok) throw new Error('读取工作流资产失败');
            const blob = await res.blob();
            if(!isCurrent()) return;
            const fileName = name && /\.(json|zip)$/i.test(name) ? name : (url.split('/').pop()?.split('?')[0] || `${name || 'workflow'}.zip`);
            await importWorkflowFile(deps, new deps.File([blob], fileName, {type:blob.type || 'application/octet-stream'}));
        } catch(err) {
            if(!isCurrent()) return;
            deps.showErrorModal(err.message || '导入工作流资产失败', '导入工作流');
        }
    }

    const api={selectedWorkflowPayload, workflowFilename, canvasAssistantExportWorkflow, openWorkflowTransferModal, closeWorkflowTransferModal, updateWorkflowTransferMeta, setWorkflowLibraryExportState, exportSelectedWorkflow, defaultWorkflowAssetTarget, exportSelectedWorkflowToLibrary, normalizeImportedWorkflow, insertWorkflowIntoCanvas, importWorkflowFile, importWorkflowAssetUrl};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasWorkflowTransfer=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
