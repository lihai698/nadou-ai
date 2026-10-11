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
    function saveDraft(kind,id,base,local){
        if(!id || !base || !local) return false;
        try {root.sessionStorage.setItem(key(kind,id),JSON.stringify({version:1,id,base:clone(base),local:clone(local)}));return true;}
        catch(error){root.console?.warn('画布临时草稿备份失败',error);return false;}
    }
    function readDraft(kind,id){
        try {
            const draft=JSON.parse(root.sessionStorage.getItem(key(kind,id)) || 'null');
            return draft?.version===1 && draft.id===id && Array.isArray(draft.base?.nodes) && Array.isArray(draft.local?.nodes) && Array.isArray(draft.local?.connections) ? draft : null;
        } catch(error){root.console?.warn('画布临时草稿读取失败',error);return null;}
    }
    function clearDraft(kind,id){try {root.sessionStorage.removeItem(key(kind,id));}catch(error){root.console?.warn('画布临时草稿清理失败',error);}}
    function recoverDraft(kind,id,remote,makeCopy){
        const draft=readDraft(kind,id);
        if(!draft) return null;
        if(equal(content(draft.local),content(remote))){clearDraft(kind,id);return null;}
        return mergeDocument(draft.base,draft.local,remote,makeCopy);
    }
    root.CanvasSaveRecovery={clone,equal,mergeNodes,mergeConnections,mergeDocument,placeConflictCopies,saveDraft,readDraft,clearDraft,recoverDraft,content};
})(typeof window !== 'undefined' ? window : globalThis);
