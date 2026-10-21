const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createClassic,createSmart}=require('../static/js/canvas-history.js');

function editor(kind){
    const events=[];
    const scene={canvas:{connections:[]},nodes:[{id:'a',text:'原文'}],connections:[],selected:new Set(['a']),
        selectedId:'a',selectedIds:['a'],selectedImage:{nodeId:'a',index:0},activeComposerSubject:{id:'a'},lastComposerNodeId:'a',
        window:{CanvasVideoDeconstructionBridge:{begin:()=>events.push('invalidate')},CanvasVideoDeconstructionUI:{closeAll:force=>events.push(['close',force])}},
        invalidateSmartVideoDeconstruction:()=>events.push('invalidate'),render:()=>events.push('render'),scheduleSave:()=>events.push('save'),
        toast:text=>events.push(text),tr:key=>key};
    scene.serializableCanvasNodes=()=>scene.nodes.map(({runtime,...node})=>node);
    const history=(kind==='classic'?createClassic:createSmart)(scene);
    return {scene,history,events};
}

for(const kind of ['classic','smart']){
    test(`${kind}: undo restores a deep snapshot and existing cleanup/save order`,()=>{
        const {scene,history,events}=editor(kind);
        history.pushUndo();scene.nodes[0].text='修改';
        scene.connections.push({from:'a',to:'b'});scene.canvas.connections.push({from:'a',to:'b'});
        history.performUndo();
        assert.equal(scene.nodes[0].text,'原文');
        assert.deepEqual(kind==='classic'?scene.connections:scene.canvas.connections,[]);
        assert.deepEqual(events.slice(0,kind==='classic'?4:3),kind==='classic'?['invalidate',['close',true],'render','save']:['invalidate','render','save']);
        if(kind==='classic')assert.equal(scene.selected.size,0);
        else assert.equal(scene.activeComposerSubject,null);
    });
    test(`${kind}: two controllers cannot undo each other's edits`,()=>{
        const a=editor(kind),b=editor(kind);a.history.pushUndo();a.scene.nodes[0].text='甲';b.scene.nodes[0].text='乙';
        b.history.performUndo();assert.equal(b.scene.nodes[0].text,'乙');
        a.history.performUndo();assert.equal(a.scene.nodes[0].text,'原文');assert.equal(b.scene.nodes[0].text,'乙');
        for(const key of ['undoStack','redoStack','pendingUndoSnapshot','redoBaseContent'])assert.ok(!(key in a.history));
    });
    test(`${kind}: retained history keeps its original bounded depth`,()=>{
        const {scene,history}=editor(kind),limit=kind==='classic'?30:40;
        for(let i=0;i<limit+5;i++){history.pushUndo();scene.nodes[0].text=String(i);}
        for(let i=0;i<limit;i++)history.performUndo();
        assert.equal(scene.nodes[0].text,'4');history.performUndo();assert.equal(scene.nodes[0].text,'4');
    });
}
test('classic: snapshots use the original storage projection',()=>{
    const {scene,history}=editor('classic');scene.nodes[0].runtime={busy:true};history.pushUndo();scene.nodes=[];history.performUndo();
    assert.deepEqual(scene.nodes,[{id:'a',text:'原文'}]);
});
test('smart: undo and redo restore selection and content in both directions',()=>{
    const {scene,history}=editor('smart');history.pushUndo();scene.nodes[0].text='新内容';scene.selectedId='b';scene.selectedIds=['b'];
    history.performUndo();assert.equal(scene.selectedId,'a');assert.deepEqual(scene.selectedIds,['a']);
    history.performRedo();assert.equal(scene.nodes[0].text,'新内容');assert.equal(scene.selectedId,'b');
});
test('smart: a discarded pending gesture creates no undo; a committed one captures its initial content',()=>{
    const {scene,history}=editor('smart');history.capturePendingUndo();history.discardPendingUndo();scene.nodes[0].text='未记录';
    history.commitPendingUndo();history.performUndo();assert.equal(scene.nodes[0].text,'未记录');
    history.capturePendingUndo();scene.nodes[0].text='拖动完成';history.commitPendingUndo();history.performUndo();
    assert.equal(scene.nodes[0].text,'未记录');
});
test('smart: suppression prevents a nested edit from creating another undo',()=>{
    const {scene,history}=editor('smart');history.pushUndo();scene.nodes[0].text='外部修改';history.suppressed=true;
    history.pushUndo();scene.nodes[0].text='嵌套修改';history.suppressed=false;history.performUndo();assert.equal(scene.nodes[0].text,'原文');
});
test('smart: direct field edits invalidate redo while viewport and no-op saves preserve it',()=>{
    for(const direct of [false,true]){
        const {scene,history}=editor('smart');history.pushUndo();scene.nodes[0].text='新内容';history.performUndo();
        scene.canvas.viewport={x:10,y:20,scale:2};if(direct)scene.nodes[0].text='直接编辑';history.beforeScheduleSave();history.performRedo();
        assert.equal(scene.nodes[0].text,direct?'直接编辑':'新内容');
    }
});
test('smart: storage projection updates the redo baseline without hiding an earlier content edit',()=>{
    for(const edited of [false,true]){
        const {scene,history}=editor('smart');history.pushUndo();scene.nodes[0].text='可重做';history.performUndo();
        if(edited)scene.nodes[0].text='保存前编辑';const preserve=history.prepareStorageNormalization();
        scene.nodes[0].stored=true;history.finishStorageNormalization(preserve);history.beforeScheduleSave();history.performRedo();
        assert.equal(scene.nodes[0].text,edited?'保存前编辑':'可重做');
    }
});
test('smart: clear discards undo, redo and an unfinished gesture',()=>{
    const {scene,history}=editor('smart');history.pushUndo();scene.nodes[0].text='新';history.performUndo();history.capturePendingUndo();
    history.reset();scene.nodes=[];history.commitPendingUndo();history.performUndo();history.performRedo();assert.deepEqual(scene.nodes,[]);
});
test('smart: failed rendering releases suppression and propagates the original error',()=>{
    const {scene,history}=editor('smart');history.pushUndo();scene.render=()=>{throw Error('render failed');};
    assert.throws(()=>history.performUndo(),/render failed/);assert.equal(history.suppressed,false);
});
