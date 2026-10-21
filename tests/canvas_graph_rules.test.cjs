const {test}=require('node:test');
const assert=require('node:assert/strict');
const graph=require('../static/js/canvas-graph-rules.js');

test('classic order follows output-mediated dependencies and ignores disconnected generators',()=>{
    const host={nodes:[{id:'a',type:'generator'},{id:'out',type:'output'},{id:'b',type:'video'},{id:'other',type:'generator'}],connections:[{from:'a',to:'out'},{from:'out',to:'b'}]};
    assert.deepEqual(graph.computeCascadeOrder(host,'b'),['a','b']);
    assert.deepEqual(graph.computeConnectedWorkflowOrder(host,'b'),['a','b']);
    assert.deepEqual(graph.connectedClusterIds(host,'a'),['a','out','b']);
    assert.equal(graph.wouldCreateGeneratorCycle(host,'b','a'),true);
    assert.equal(graph.wouldCreateGeneratorCycle(host,'other','a'),false);
});

test('classic connection rules reject self links and reverse generator cycles',()=>{
    const host={nodes:[{id:'a',type:'generator'},{id:'b',type:'generator'},{id:'p',type:'prompt'}],connections:[{from:'a',to:'b'}],
        CANVAS_MEDIA_OUTPUT_TYPES:['generator'],CANVAS_GENERATOR_TYPES:['generator'],canvasApiAudioMode:()=>false};
    assert.equal(graph.canConnect(host,'a','a'),false);
    assert.equal(graph.canConnect(host,'b','a'),false);
    assert.equal(graph.canConnect(host,'p','a'),true);
    assert.equal(graph.canConnect(host,'missing','a'),false);
});

test('smart upstream respects edge kind and legacy inline references',()=>{
    const a={id:'a'},b={id:'b',inputNodeIds:['a']},c={id:'c'};
    const host={nodes:[a,b,c],canvas:{connections:[{from:'c',to:'b',kind:'flow'}]},canvasUsesConnections:true};
    assert.deepEqual(graph.upstreamNodesForKinds(host,b,['input']),[]);
    assert.deepEqual(graph.upstreamNodesForKinds(host,b,['flow']),[c]);
    host.canvasUsesConnections=false;assert.deepEqual(graph.upstreamNodesForKinds(host,b,['input']),[a]);
});

test('smart traversal terminates cycles and excludes non-workflow edges',()=>{
    const host={nodes:[{id:'a'},{id:'b'},{id:'c'}],canvas:{connections:[{from:'a',to:'b',kind:'input'},{from:'b',to:'a',kind:'flow'},{from:'a',to:'c',kind:'history'}]}};
    assert.deepEqual(graph.downstreamNodesForId(host,'a').map(n=>n.id),['b']);
    assert.deepEqual(graph.upstreamLineNodeIds(host,{id:'b'}),['a','b']);
});

test('smart generated result is excluded from downstream workflow targets',()=>{
    const source={id:'a',type:'smart-image'},generated={id:'generated',type:'smart-image',sourceNodeId:'a'},next={id:'next',type:'smart-image'};
    const host={nodes:[source,generated,next],canvas:{connections:[{from:'a',to:'generated',kind:'flow'},{from:'a',to:'next',kind:'input'}]},
        isSmartImageNode:n=>n?.type==='smart-image',isHistoryGroupNode:()=>false};
    assert.deepEqual(graph.downstreamWorkflowImageTargetsFor(host,source),[next]);
});

test('new reference nodes accept all existing node types in either direction without cycles',()=>{
    const types=['prompt','image','audio','output','llm','generator','video','rh','comfy','midjourney','msgen','loop','group','promptGroup','shot-table','clip'];
    const host={nodes:types.map(type=>({id:type,type})),connections:[]};
    for(const special of ['shot-table','audio','clip']) for(const type of types){
        assert.equal(graph.canConnect(host,type,special),type!==special,`${type} -> ${special}`);
        assert.equal(graph.canConnect(host,special,type),type!==special,`${special} -> ${type}`);
    }
    host.connections=[{from:'shot-table',to:'llm'},{from:'llm',to:'generator'}];
    assert.equal(graph.canConnect(host,'generator','shot-table'),false);
});
