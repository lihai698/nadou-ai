const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function editor(smart, initialNodes, initialLinks=[], ids=[]) {
    const file = smart ? 'smart-canvas.js' : 'canvas.js';
    const source = readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    function section(start,end) {
        const a=source.indexOf(start), b=source.indexOf(end,a);
        assert.ok(a>=0 && b>a, start);
        return source.slice(a,b);
    }
    let serial=0;
    const e=createTaskContext({nodes:structuredClone(initialNodes), connections:structuredClone(initialLinks),
        canvas:{id:'isolated',connections:structuredClone(initialLinks)}, selected:new Set(ids), selectedIds:ids,
        selectedId:ids.length===1?ids[0]:'', selectedImage:{}, activeComposerSubject:null,
        undoStack:[], UNDO_MAX:20, document:{activeElement:null},window:{},
        lastMouseBoard:{x:1200,y:1000},lastMouseWorld:{x:1200,y:1000},
        uid:p=>`${p}-copy-${++serial}`, render(){},scheduleSave(){},toast(){},setStatus(){},destroyLTXEditor(){},
        remapCanvasDepthCopies(){},remapSmartDepthCopies(){},remapSmartViewAdjustRefs(){},
        serializableCanvasNode:n=>structuredClone(n), serializableCanvasNodes:ns=>structuredClone(ns||e.nodes),
        serializableSmartNode:n=>structuredClone(n),normalizeLegacySmartNode:n=>n,
        clearSmartNodeTransientRunState:n=>{n.running=false;},syncGeneratorInputs(){},sanitizeConnections(){},
        isEditableTarget:()=>false,selectedNodeIds:()=>e.selectedIds.length?e.selectedIds:[e.selectedId].filter(Boolean),
        isNodeSelected:id=>e.selectedIds.includes(id)||e.selectedId===id,
        isSmartGroupNode:n=>n?.type==='smart-group',isHistoryGroupNode:()=>false,
        viewportCenter:()=>({x:1200,y:1000}),defaultPoint:()=>({x:1200,y:1000})});
    vm.runInContext(readFileSync(path.join(__dirname,'../static/js/canvas-audio.js'),'utf8'),e);
    if(smart) {
        e.pushUndo=()=>e.undoStack.push(structuredClone({nodes:e.nodes,connections:e.canvas.connections}));
        vm.runInContext(section('function cloneSmartNode(','// 跨页"素材库'),e);
        vm.runInContext(section('function duplicateForAltDrag(','function shellPoint('),e);
        vm.runInContext(section('function selectedSmartWorkflowPayload(','function normalizeImportedSmartWorkflow('),e);
        vm.runInContext(section('function deleteNode(id){','function clearNodeMediaBeforeDelete('),e);
    } else {
        vm.runInContext(source.match(/^const CANVAS_(?:GENERATOR|MEDIA_OUTPUT)_TYPES =.*$/gm).join('\n'),e);
        vm.runInContext(section('function wouldCreateGeneratorCycle(','function endDrag('),e);
        vm.runInContext(section('function pushUndo(){','function workflowFilename('),e);
        vm.runInContext(section('function insertWorkflowIntoCanvas(','async function importWorkflowFile('),e);
        vm.runInContext(section('function deleteSelectedNodes(){','function hasImageFiles('),e);
        vm.runInContext(section('function deleteNode(id, event){','function clearNodeContentBeforeDelete('),e);
    }
    return {e,run:code=>vm.runInContext(code,e),state:()=>JSON.parse(JSON.stringify({nodes:e.nodes,connections:smart?e.canvas.connections:e.connections}))};
}

const classic=[{id:'outer',type:'group',x:0,y:0,items:['inner'],groupMode:'workflow'},
    {id:'inner',type:'group',x:40,y:80,items:['prompt','loop'],groupMode:'workflow'},
    {id:'prompt',type:'prompt',x:100,y:160,text:'中文原正文'},
    {id:'loop',type:'loop',x:340,y:160,count:3,showPrompt:true,promptTemplate:'第{{index}}轮'}];
const smart=[{id:'group',type:'smart-group',x:0,y:0,items:['prompt','loop'],images:[{url:'/assets/synthetic.png'}]},
    {...classic[2],type:'smart-prompt'},{...classic[3],type:'smart-loop'}];
for(const isSmart of [false,true]) {
    const name=isSmart?'smart':'classic', initial=isSmart?smart:classic, root=initial[0].id;
    const links=[{id:'p-loop',from:'prompt',to:'loop',kind:'input'}];
    test(`${name}: copying only a group includes its members once and preserves internal loop links`,()=>{
        const t=editor(isSmart,initial,links,[root]);
        t.run('copySelectedNodes();pasteNodes()');
        const state=t.state(), copies=state.nodes.slice(initial.length), copyIds=new Set(copies.map(n=>n.id));
        assert.equal(copies.length,initial.length);
        assert.ok(copies.filter(n=>n.items).every(n=>n.items.every(id=>copyIds.has(id))));
        assert.equal(state.connections.length,2);
        assert.ok(copyIds.has(state.connections[1].from)&&copyIds.has(state.connections[1].to));
        assert.equal(copies.find(n=>n.type.endsWith('loop')).count,3);
        assert.deepEqual(state.nodes.slice(0,initial.length),initial);
        if(!isSmart) {
            t.e.selected=new Set([copies[0].id]);t.run('deleteSelectedNodes()');
            assert.deepEqual(t.state().nodes,initial);
        } else {
            t.run(`deleteNode('${copies[0].id}')`);
            assert.deepEqual(t.state().nodes.slice(0,initial.length),initial);
        }
    });
    test(`${name}: Alt duplication copies group members without moving or sharing originals`,()=>{
        const t=editor(isSmart,initial,links,[root]);
        t.run(isSmart?`duplicateForAltDrag(nodes[0],true)`:`duplicateNodesForAltDrag(nodes[0],true)`);
        const state=t.state(),copies=state.nodes.slice(initial.length),copyIds=new Set(copies.map(n=>n.id));
        assert.equal(copies.length,initial.length);
        assert.ok(copies.filter(n=>n.items).every(n=>n.items.every(id=>copyIds.has(id))));
        assert.deepEqual(state.nodes.slice(0,initial.length),initial);
        assert.equal(state.connections.length,2);
        assert.equal(t.e.undoStack.length,1*(isSmart?1:0));
    });
    test(`${name}: selected group workflow includes members and internal links`,()=>{
        const t=editor(isSmart,initial,links,[root]);
        const payload=t.run(isSmart?'selectedSmartWorkflowPayload()':'selectedWorkflowPayload()');
        assert.equal(payload.nodes.length,initial.length);
        assert.equal(payload.connections.length,1);
    });
}
test('classic: importing an incomplete group never borrows a matching existing node ID',()=>{
    const t=editor(false,[{id:'private-existing',type:'prompt',x:0,y:0,text:'原节点'}]);
    t.e.imported={nodes:[{id:'group',type:'group',x:0,y:0,items:['private-existing','missing']}],connections:[]};
    t.run('insertWorkflowIntoCanvas(imported)');
    assert.deepEqual(t.state().nodes[1].items,[]);
    assert.equal(t.state().nodes[0].text,'原节点');
});
test('classic: recursive group copy terminates on malformed cyclic and duplicate membership',()=>{
    const initial=[{id:'a',type:'group',x:0,y:0,items:['b','b','missing']},{id:'b',type:'group',x:20,y:20,items:['a']}];
    const t=editor(false,initial,[],['a']);
    t.run('copySelectedNodes();pasteNodes()');
    assert.equal(t.state().nodes.length,4);
    const copyIds=new Set(t.state().nodes.slice(2).map(n=>n.id));
    assert.ok(t.state().nodes.slice(2).every(n=>n.items.every(id=>copyIds.has(id))));
});
for(const selected of [true,false]) test(`classic: deleting a member via ${selected?'selection':'button'} removes dangling group references and undo restores them`,()=>{
    const t=editor(false,classic,[],['prompt']);
    t.run(selected?'deleteSelectedNodes()':"deleteNode('prompt')");
    assert.deepEqual(t.state().nodes.find(n=>n.id==='inner').items,['loop']);
    t.run('performUndo()');
    assert.deepEqual(t.state().nodes,classic);
});
test('smart: Alt duplication retains multi-selection and copies overlapping group members only once',()=>{
    const t=editor(true,smart,[],['group','prompt']);
    t.run('duplicateForAltDrag(nodes[0],false)');
    const copies=t.state().nodes.slice(smart.length);
    assert.equal(copies.length,3);
    assert.deepEqual(Array.from(t.e.selectedIds),[copies[0].id,copies[1].id]);
    assert.equal(t.e.selectedId,'');
});
