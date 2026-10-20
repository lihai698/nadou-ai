const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
function setup(file,names,state){
    const e=createTaskContext(state),source=fs.readFileSync(path.join(__dirname,'../static/js/'+file),'utf8');
    for(const name of names){let start=source.indexOf(`function ${name}(`);assert.ok(start>=0);if(source.slice(start-6,start)==='async ')start-=6;vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),e);}
    return e;
}
const smartNames=['isHistoryGroupNode','nonPreviewOutputImages','cleanHistoryImages','hasHistoryConnection','demoteHistoryGroupNode','historyGroupForNode','positionHistoryGroupForNode','ensureHistoryGroupForNode','cascadeOutputTitle','pushRightSideNodes','replaceOutputsToNodeWithHistory','appendOutputsToNode','appendLoopOutputsToNode','finalizePendingNode','createLoopOutputSlot','loopOutputSlotsForRoot','tagLoopOutputSlot'];
function smart(extra={}){
    let serial=0;const state={nodes:[],canvas:{connections:[]},selectedId:'other',selectedImage:{nodeId:'other',index:0},
        activeComposerSubject:null,smartLoopContext:null,MEDIA_GROUP_DEFAULT_SCALE:0.5,MEDIA_NODE_DEFAULT_SCALE:1,
        uid:()=>`n${++serial}`,nodeRect:n=>({x:n.x||0,y:n.y||0,width:200,height:100}),isSmartImageNode:n=>n?.type==='smart-image',
        stripImageGenerationMeta:img=>{const result={...img};delete result.runPrompt;return result;},
        liveSmartNode:n=>state.nodes.find(x=>x.id===n.id)||n,markSmartNodeComplete:n=>{n.pending=0;n.running=false;},
        attachRunMeta:(n,m)=>{n.run=m;},mediaNodeDefaultScale:()=>1,copyMediaSizeFields:(_source,target)=>target,
        clearSourceBusyStateIfDownstreamDone(){},downstreamNodesForId:()=>[],tr:key=>key,nowMs:()=>100,
        cloneSmartNode:n=>structuredClone(n),smartCascadePathForCtx:ctx=>ctx?.path,...extra};
    state.addConnection=(from,to,kind)=>{if(!state.canvas.connections.some(c=>c.from===from&&c.to===to&&c.kind===kind))state.canvas.connections.push({from,to,kind});};
    return setup('smart-canvas.js',smartNames,state);
}
test('smart replacement archives old results once and excludes previews and generation metadata',()=>{
    const node={id:'out',type:'smart-image',images:[{url:'old',kind:'image',runPrompt:'old request'},{url:'preview',loopInputPreview:true}],audioOutputText:'old'};
    const e=smart({nodes:[node]});
    e.replaceOutputsToNodeWithHistory(node,[{url:'new',kind:'image'},{url:'new',kind:'image'}],'image',{id:'run'},{skipShift:true});
    const history=e.nodes.find(n=>n.historyFor==='out');assert.ok(history);
    assert.deepEqual(Array.from(history.images,i=>i.url),['old']);assert.equal(history.images[0].runPrompt,undefined);
    assert.deepEqual(Array.from(node.images,i=>i.url),['new']);assert.equal(node.audioOutputText,undefined);
    e.replaceOutputsToNodeWithHistory(node,[{url:'next',kind:'image'}],'image',null,{skipShift:true});
    assert.equal(e.nodes.length,2);assert.deepEqual(Array.from(history.images,i=>i.url),['new','old']);
    assert.equal(e.canvas.connections.length,1);assert.equal(e.canvas.connections[0].kind,'history');
});
test('each loop run archives prior results once and appends unique media without source previews',()=>{
    const node={id:'out',type:'smart-image',images:[{url:'previous',kind:'image'}]},ctx={runState:{}};
    const e=smart({nodes:[node]});e.appendLoopOutputsToNode(node,[{url:'r1',kind:'image'}],'image',ctx);
    e.appendLoopOutputsToNode(node,[{url:'r1',kind:'image'},{url:'r2',kind:'image'},{url:'preview',loopInputPreview:true}],'image',ctx);
    assert.deepEqual(Array.from(node.images,i=>i.url),['r1','r2']);
    assert.deepEqual(Array.from(e.nodes.find(n=>n.historyFor==='out').images,i=>i.url),['previous']);
    assert.equal(ctx.runState.loopAppendInitialized.size,1);
});
test('completion updates the live output while keeping another selected node and clearing transient metadata',()=>{
    const live={id:'out',type:'smart-image',images:[],pending:1,_selectAfterRunId:'source',_runMetaTargetId:'source'},source={id:'source'};
    const e=smart({nodes:[live,source]});e.finalizePendingNode({id:'out'},[{url:'audio',kind:'audio'}],{sourceNodeId:'source'},'audio');
    assert.equal(live.images[0].url,'audio');assert.equal(live.title,'Audio');assert.equal(live.pending,0);
    assert.equal(e.selectedId,'other');assert.equal(live._selectAfterRunId,undefined);assert.equal(live._runMetaTargetId,undefined);
    assert.equal(source.run.sourceNodeId,'source');
});
test('loop output slot strips inherited inputs and keeps the original requested output identity',()=>{
    const root={id:'root',type:'smart-image',inputNodeIds:['prompt'],manualInputRefs:[{url:'ref'}],blockedInputRefs:['ref'],images:[{url:'old'}],runPrompt:'old',x:10,y:20},path={states:{}};
    const e=smart({nodes:[root]});const output=e.createLoopOutputSlot(root,3,0,{outputNodeId:'reserved',pending:2,queued:true,loopNode:{id:'loop'},ctx:{path}});
    assert.equal(output.id,'reserved');assert.equal(output.pending,2);assert.equal(output.queued,true);
    assert.equal(output.inputNodeIds.length,0);assert.equal(output.manualInputRefs,undefined);assert.equal(output.blockedInputRefs,undefined);
    assert.equal(output.sourceNodeId,'root');assert.equal(output.loopRoundIndex,3);assert.equal(path.states['root->reserved'],'wait');
    assert.equal(e.canvas.connections[0].kind,'flow');assert.equal(root.inputNodeIds[0],'prompt');
});
test('classic conversion replaces only the output and reconnects its downstream to the new input group',()=>{
    const out={id:'out',type:'output',x:50,y:60},other={id:'other'},target={id:'target'};let id=0,saves=0;
    const e=setup('canvas.js',['createInputGroupFromOutput','convertOutputNodeToInputGroup'],{
        nodes:[out,other,target],connections:[{from:'other',to:'out'},{from:'out',to:'target'},{from:'other',to:'target'}],selected:new Set(['out']),
        outputImageUrls:()=>['one','two'],outputImageName:url=>url,uid:prefix=>prefix+(++id),pushUndo(){},canConnect:()=>true,
        syncGeneratorInputs(){},refreshGeneratorInputViews(){},render(){},scheduleSave:()=>saves++});
    e.convertOutputNodeToInputGroup('out');const group=e.nodes.find(n=>n.type==='group');assert.ok(group);
    assert.equal(e.nodes.includes(out),false);assert.ok(e.nodes.includes(other));assert.equal(group.items.length,2);
    assert.deepEqual(Array.from(e.connections,c=>[c.from,c.to]),[['other','target'],[group.id,'target']]);
    assert.deepEqual(Array.from(e.selected),[group.id]);assert.equal(saves,1);
});
