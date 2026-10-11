/* Shared save/recovery rules; the native editors own rendering and task execution. */
(function(root){
    'use strict';
    const transient = new Set(['running','runStatus','runError','pending','queued','_cascadeIdx','_cascadeFailed','_activeLoopCtx']);
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    function canonical(value){
        if(Array.isArray(value)) return value.map(canonical);
        if(value && typeof value === 'object'){
            const out = {};
            Object.keys(value).sort().forEach(key => {if(!transient.has(key) && value[key] !== undefined) out[key] = canonical(value[key]);});
            return out;
        }
        return value;
    }
    const equal = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
    function mergeNodes(localNodes, remoteNodes, baseNodes, mergeBoth){
        const local = new Map((localNodes || []).map(n => [n.id,n]));
        const remote = new Map((remoteNodes || []).map(n => [n.id,n]));
        const base = typeof baseNodes?.get === 'function' ? baseNodes : new Map((baseNodes || []).map(n => [n.id,n]));
        return [...new Set([...local.keys(),...remote.keys()])].map(id => {
            const a=local.get(id), b=remote.get(id), old=base.get(id);
            if(a && b) return mergeBoth(a,b,old);
            const remaining=a || b;
            // A deletion of an unchanged base node wins. New or edited nodes survive.
            if(old && equal(remaining,old)) return null;
            return clone(remaining);
        }).filter(Boolean);
    }
    const edgeKey = edge => `${edge.from}->${edge.to}:${edge.kind || 'flow'}`;
    function mergeConnections(local,remote,nodeIds,base=[]){
        const a=new Map((local || []).map(c=>[edgeKey(c),c])), b=new Map((remote || []).map(c=>[edgeKey(c),c]));
        const old=new Map((base || []).map(c=>[edgeKey(c),c]));
        return [...new Set([...a.keys(),...b.keys()])].map(key=>{
            const left=a.get(key),right=b.get(key),before=old.get(key);
            if(before && (!left || !right) && equal(left || right,before)) return null;
            const edge=right || left;
            return edge && nodeIds.has(edge.from) && nodeIds.has(edge.to) ? clone(edge) : null;
        }).filter(Boolean);
    }
    function mergeFields(base,local,remote,onConflict){
        if(!base) return clone(remote);
        const out=clone(remote);
        let conflict=false;
        new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)]).forEach(key=>{
            if(key==='id' || transient.has(key)) return;
            const left=!equal(local[key],base[key]),right=!equal(remote[key],base[key]);
            if(left && right && !equal(local[key],remote[key])) conflict=true;
            const source=right ? remote : left ? local : remote;
            if(Object.hasOwn(source,key)) out[key]=clone(source[key]); else delete out[key];
        });
        if(conflict) onConflict?.(local);
        return out;
    }
    function placeConflictCopies(copies,occupied){
        let bottom=(occupied || []).reduce((max,node)=>Math.max(max,Number(node.y || 0)+Math.max(260,Number(node.h || 0))),0);
        copies.forEach(copy=>{
            copy.y=bottom+40;
            bottom=copy.y+Math.max(260,Number(copy.h || 0));
        });
    }
    function mergeDocument(base,local,remote,makeCopy){
        if(!base || !Array.isArray(remote?.nodes)) throw new Error('缺少共同画布版本，已保留本地草稿，请重试。');
        const copies=[], ids=new Map();
        const addCopy=n=>{const copy=makeCopy(n);copies.push(copy);ids.set(n.id,copy.id);};
        const nodes=mergeNodes(local.nodes,remote.nodes,base.nodes,(a,b,old)=>mergeFields(old,a,b,addCopy)).concat(copies);
        placeConflictCopies(copies,[...(local.nodes || []),...(remote.nodes || [])]);
        copies.forEach(n=>{
            if(Array.isArray(n.items)) n.items=n.items.map(id=>ids.get(id)||id);
            if(Array.isArray(n.inputNodeIds)) n.inputNodeIds=n.inputNodeIds.map(id=>ids.get(id)||id);
            if(n.sourceNodeId) n.sourceNodeId=ids.get(n.sourceNodeId)||n.sourceNodeId;
        });
        const nodeIds=new Set(nodes.map(n=>n.id));
        nodes.filter(n=>['group','promptGroup','smart-group'].includes(n.type)).forEach(n=>{
            if(Array.isArray(n.items)) n.items=n.items.filter(id=>nodeIds.has(id));
        });
        const connections=mergeConnections(local.connections,remote.connections,nodeIds,base.connections);
        (local.connections || []).forEach(edge=>{
            if(!ids.has(edge.from) && !ids.has(edge.to)) return;
            const copy={...clone(edge),from:ids.get(edge.from)||edge.from,to:ids.get(edge.to)||edge.to};
            if(copy.id) copy.id=`${copy.id}-${ids.get(edge.from)||ids.get(edge.to)}`;
            if(nodeIds.has(copy.from)&&nodeIds.has(copy.to)&&!connections.some(c=>edgeKey(c)===edgeKey(copy))) connections.push(copy);
        });
        const settings=mergeFields(base.settings || {},local.settings || {},remote.settings || {});
        const logs=[...(remote.logs || [])];
        (local.logs || []).forEach(log=>{if(!logs.some(item=>equal(item,log)))logs.push(clone(log));});
        return {canvas:{...clone(remote),nodes,connections,settings,logs:logs.slice(-500)},conflicts:copies.length};
    }
    function content(canvas){return {nodes:canvas?.nodes || [],connections:canvas?.connections || [],settings:canvas?.settings || {},logs:canvas?.logs || []};}
    const key=(kind,id)=>`nadou.canvas-draft.${kind}.${id}`;
    const owner=root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ownerLock=`nadou.canvas-draft.owner.${owner}`;
    const states=new Map();
    let databasePromise, ownerReady;
    function stateFor(kind,id){
        const name=key(kind,id);
        if(!states.has(name)) states.set(name,{kind,id,sequence:0,durable:0,dirty:false,record:null,prepared:false,queue:Promise.resolve(),error:null});
        return states.get(name);
    }
    function validDraft(draft,id){return [1,2].includes(draft?.version) && draft.id===id && Array.isArray(draft.base?.nodes) && Array.isArray(draft.local?.nodes) && Array.isArray(draft.local?.connections);}
    function sessionDraft(kind,id){
        try {const draft=JSON.parse(root.sessionStorage.getItem(key(kind,id)) || 'null');return validDraft(draft,id) ? draft : null;}
        catch(error){root.console?.warn('画布临时草稿读取失败',error);return null;}
    }
    function writeSession(state){
        try {root.sessionStorage.setItem(key(state.kind,state.id),JSON.stringify(state.record));return true;}
        catch(error){clearSession(state);root.console?.warn('画布临时草稿备份失败',error);return false;}
    }
    function clearSession(state){
        try {
            const saved=sessionDraft(state.kind,state.id);
            if(!saved?.owner || saved.owner===owner) root.sessionStorage.removeItem(key(state.kind,state.id));
        } catch(error){root.console?.warn('画布临时草稿清理失败',error);}
    }
    function openDatabase(){
        if(!databasePromise){
            databasePromise=new Promise((resolve,reject)=>{
                if(!root.indexedDB){reject(new Error('本机草稿存储不可用'));return;}
                const request=root.indexedDB.open('nadou-canvas-drafts',1);
                request.onupgradeneeded=()=>{
                    const store=request.result.createObjectStore('drafts',{keyPath:'key'});
                    store.createIndex('canvas',['kind','id']);
                };
                request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
                request.onerror=()=>reject(request.error || new Error('本机草稿存储打开失败'));
                request.onblocked=()=>reject(new Error('本机草稿存储被其他页面占用'));
            }).catch(error=>{databasePromise=null;throw error;});
        }
        return databasePromise;
    }
    async function transaction(mode,work){
        const db=await openDatabase();
        return new Promise((resolve,reject)=>{
            const tx=db.transaction('drafts',mode);let result;
            tx.oncomplete=()=>resolve(result);
            tx.onabort=tx.onerror=()=>reject(tx.error || new Error('本机草稿写入失败'));
            try {work(tx.objectStore('drafts'),value=>{result=value;});}catch(error){tx.abort();reject(error);}
        });
    }
    function holdOwner(){
        if(!ownerReady){
            ownerReady=new Promise((resolve,reject)=>{
                if(!root.navigator?.locks){reject(new Error('当前浏览器不支持安全的跨页面草稿恢复'));return;}
                root.navigator.locks.request(ownerLock,()=>{resolve();return new Promise(()=>{});}).catch(reject);
            });
        }
        return ownerReady;
    }
    function enqueue(state,work){const task=state.queue.then(work);state.queue=task.catch(()=>{});return task;}
    function renderStatus(state){
        const warning=root.document?.getElementById?.('canvasSaveError');
        if(!warning || warning.dataset?.draftCanvas && warning.dataset.draftCanvas!==key(state.kind,state.id)) return;
        if(warning.dataset) warning.dataset.draftCanvas=key(state.kind,state.id);
        const label=warning.querySelector?.('[data-draft-status]'),button=warning.querySelector?.('[data-draft-export]');
        const en=root.StudioI18n?.lang?.()==='en';
        if(label) label.textContent=!state.dirty ? '' : state.error ? (en?'Local backup failed. Export your draft before leaving.':'本机备份失败，请先导出草稿再离开。') : state.durable===state.sequence ? (en?'Backed up on this device; canvas save is still pending.':'已备份本机，画布仍未保存成功。') : (en?'Backing up on this device. Please keep this page open.':'正在备份本机，请暂勿关闭页面。');
        if(button){button.hidden=!state.dirty;button.textContent=en?'Export draft':'导出草稿';button.onclick=()=>exportDraft(state.kind,state.id);}
        if(state.error && state.dirty){
            if(warning.hidden){const text=warning.querySelector?.('span');if(text) text.textContent=en?'Local draft backup failed. Please export it first.':'本机草稿备份失败，请先导出草稿。';}
            warning.hidden=false;
        }
    }
    function backupFailed(state,error,sequence=state.sequence){
        root.console?.warn('本机草稿备份失败',error);
        if(sequence===state.sequence){state.error=error;renderStatus(state);}
    }
    function saveDraft(kind,id,base,local){
        if(!id || !base || !local) return false;
        const state=stateFor(kind,id),sequence=++state.sequence;
        state.record={key:`${key(kind,id)}.${owner}`,version:2,kind,id,owner,sequence,updatedAt:Date.now(),base:clone(base),local:clone(local),recoveredConflicts:Number(state.record?.recoveredConflicts || 0)};
        state.dirty=true;state.error=null;
        const temporarySaved=writeSession(state),record=state.record;
        renderStatus(state);
        enqueue(state,async()=>{
            if(sequence!==state.sequence || !state.dirty) return;
            await holdOwner();
            await transaction('readwrite',store=>store.put(record));
            if(sequence===state.sequence){state.durable=sequence;state.error=null;renderStatus(state);}
        }).catch(error=>backupFailed(state,error,sequence));
        return temporarySaved;
    }
    function readDraft(kind,id){
        const state=states.get(key(kind,id));
        return state?.prepared ? state.record : state?.record || sessionDraft(kind,id);
    }
    function clearDraft(kind,id){
        const state=stateFor(kind,id),sequence=state.sequence;
        clearSession(state);state.record=null;state.dirty=false;state.error=null;renderStatus(state);
        enqueue(state,async()=>{
            if(sequence!==state.sequence || state.dirty) return;
            await transaction('readwrite',store=>{
                const request=store.get(`${key(kind,id)}.${owner}`);
                request.onsuccess=()=>{if(request.result?.sequence<=sequence) store.delete(request.result.key);};
            });
        }).catch(error=>root.console?.warn('已保存草稿的清理失败',error));
    }
    async function prepareRecovery(kind,id,remote,makeCopy){
        const state=stateFor(kind,id);
        const warning=root.document?.getElementById?.('canvasSaveError');
        if(warning?.dataset) warning.dataset.draftCanvas=key(kind,id);
        try {
            await holdOwner();
            await root.navigator.locks.request(`nadou.canvas-draft.recovery.${key(kind,id)}`,async()=>{
                const locks=await root.navigator.locks.query();
                const active=new Set(locks.held.map(lock=>lock.name));
                const records=await transaction('readonly',(store,done)=>{
                    const request=store.index('canvas').getAll([kind,id]);request.onsuccess=()=>done(request.result);
                });
                const closed=records.filter(record=>validDraft(record,id) && !active.has(`nadou.canvas-draft.owner.${record.owner}`));
                const legacy=sessionDraft(kind,id);
                const candidates=[...closed];
                if(legacy && (!legacy.owner || !active.has(`nadou.canvas-draft.owner.${legacy.owner}`))) candidates.push(legacy);
                candidates.sort((a,b)=>(a.updatedAt || 0)-(b.updatedAt || 0));
                let merged=clone(remote),conflicts=0;const seen=new Set();
                for(const draft of candidates){
                    const signature=JSON.stringify(canonical(content(draft.local)));
                    if(seen.has(signature) || equal(content(draft.local),content(merged))) continue;
                    seen.add(signature);
                    const result=mergeDocument(draft.base,draft.local,merged,makeCopy);
                    merged=result.canvas;conflicts+=result.conflicts + Number(draft.recoveredConflicts || 0);
                }
                const changed=!equal(content(merged),content(remote));
                const sequence=++state.sequence;
                const record=changed ? {key:`${key(kind,id)}.${owner}`,version:2,kind,id,owner,sequence,updatedAt:Date.now(),base:clone(remote),local:merged,recoveredConflicts:conflicts} : null;
                state.prepared=true;state.record=record;state.dirty=changed;
                // Transfer closed-page drafts atomically before removing their originals.
                await transaction('readwrite',store=>{
                    if(record) store.put(record);
                    closed.forEach(draft=>store.delete(draft.key));
                });
                state.durable=sequence;
                if(record) writeSession(state);
                else if(legacy && (!legacy.owner || !active.has(`nadou.canvas-draft.owner.${legacy.owner}`))){try {root.sessionStorage.removeItem(key(kind,id));}catch(error){root.console?.warn(error);}}
                renderStatus(state);
            });
            return true;
        } catch(error){backupFailed(state,error);return false;}
    }
    function exportDraft(kind,id){
        const draft=readDraft(kind,id);if(!draft) return;
        const document={...clone(draft.local),kind};
        const blob=new root.Blob([JSON.stringify(document,null,2)],{type:'application/json'});
        const url=root.URL.createObjectURL(blob),link=root.document.createElement('a');
        link.href=url;link.download=`${kind}-unsaved-canvas-${id}.json`;link.click();
        root.setTimeout(()=>root.URL.revokeObjectURL(url),1000);
    }
    root.addEventListener?.('beforeunload',event=>{
        if([...states.values()].some(state=>state.dirty)){event.preventDefault();event.returnValue='';}
    });
    function recoverDraft(kind,id,remote,makeCopy){
        const draft=readDraft(kind,id);
        if(!draft) return null;
        if(equal(content(draft.local),content(remote))){clearDraft(kind,id);return null;}
        const result=mergeDocument(draft.base,draft.local,remote,makeCopy);
        result.conflicts+=Number(draft.recoveredConflicts || 0);
        return result;
    }
    root.CanvasSaveRecovery={clone,equal,mergeNodes,mergeConnections,mergeDocument,placeConflictCopies,saveDraft,readDraft,clearDraft,recoverDraft,prepareRecovery,exportDraft,content};
})(typeof window !== 'undefined' ? window : globalThis);
