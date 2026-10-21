const {test}=require('node:test');
const assert=require('node:assert/strict');
const groups=require('../static/js/canvas-workgroups.js');
const rect=n=>({x:n.x,y:n.y,width:n.w,height:n.h});
const sample=()=>[
    {id:'p',type:'prompt',x:800,y:200,w:180,h:160,text:'完整提示词'},
    {id:'i',type:'generator',x:20,y:400,w:320,h:340},
    {id:'v',type:'video',x:400,y:10,w:240,h:200},
    {id:'p2',type:'prompt',x:100,y:800,w:240,h:180},
    {id:'i2',type:'generator',x:900,y:800,w:220,h:260},
];
const edges=[{from:'p',to:'i'},{from:'i',to:'v'},{from:'p2',to:'i2'}];
test('all three layouts align unequal nodes without overlap or changing size/content',()=>{
    for(const mode of ['grid','horizontal','vertical']){
        const nodes=sample(),before=structuredClone(nodes);
        groups.arrange(nodes,edges,mode,rect);
        nodes.forEach((n,i)=>{assert.equal(n.w,before[i].w);assert.equal(n.h,before[i].h);assert.equal(n.text,before[i].text);});
        for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
            const a=nodes[i],b=nodes[j];assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,mode);
        }
        if(mode==='horizontal'){assert.equal(new Set(nodes.map(n=>n.y)).size,1);assert.ok(nodes[0].x<nodes[1].x&&nodes[1].x<nodes[2].x);}
        if(mode==='vertical'){assert.equal(new Set(nodes.map(n=>n.x)).size,1);assert.ok(nodes[0].y<nodes[1].y&&nodes[1].y<nodes[2].y);}
    }
});
test('fit preserves original members and encloses their full bounds',()=>{
    const nodes=sample(),before=structuredClone(nodes),frame={id:'g',groupMode:'frame',items:nodes.map(n=>n.id)};
    groups.fit(nodes,frame,rect);assert.deepEqual(nodes,before);
    nodes.forEach(n=>assert.ok(frame.x<n.x&&frame.y<n.y&&frame.x+frame.w>n.x+n.w&&frame.y+frame.h>n.y+n.h));
});
test('a stored group output bus expands all members without changing the persisted graph',()=>{
    const nodes=[...sample(),{id:'g',groupMode:'frame',items:['p','i','v']},{id:'down',type:'comfy'}];
    const stored=[...edges,{id:'bus',from:'g',to:'down'}],before=structuredClone(stored);
    const expanded=groups.effectiveConnections(nodes,stored);
    assert.deepEqual(expanded.filter(c=>c.to==='down').map(c=>c.from),['p','i','v']);assert.deepEqual(stored,before);
});
test('a group input feeds the first accepting generation nodes, preserving the inner chain',()=>{
    const nodes=[...sample(),{id:'g',groupMode:'frame',items:['p','i','v']},{id:'up',type:'image'}];
    const stored=[...edges,{from:'up',to:'g'}];
    assert.deepEqual(groups.effectiveConnections(nodes,stored).filter(c=>c.from==='up').map(c=>c.to),['i']);
});
test('ungroup expands input/output buses and preserves member data and connections',()=>{
    const nodes=[...sample(),{id:'g',groupMode:'frame',items:['p','i','v']},{id:'up',type:'image'},{id:'down',type:'comfy',inputNodeIds:['g']}];
    const result=groups.ungroup(nodes,[...edges,{from:'up',to:'g'},{from:'g',to:'down'}],nodes.find(n=>n.id==='g'));
    assert.ok(!result.nodes.some(n=>n.id==='g'));assert.ok(result.connections.some(c=>c.from==='up'&&c.to==='i'));
    assert.equal(result.connections.filter(c=>c.to==='down').length,3);assert.deepEqual(result.nodes.find(n=>n.id==='down').inputNodeIds,['p','i','v']);
    assert.ok(result.connections.some(c=>c.from==='i'&&c.to==='v'));
    assert.deepEqual(result.connections.filter(c=>c.from==='up').map(c=>c.to),['i']);
});
test('execution plan deduplicates shared upstreams and rejects cycles before mutation',()=>{
    const nodes=sample();assert.equal(groups.order(nodes,edges).filter(id=>id==='i').length,1);
    assert.throws(()=>groups.order(nodes,[...edges,{from:'v',to:'p'}]),/循环/);
    const before=structuredClone(nodes);assert.throws(()=>groups.arrange(nodes,[...edges,{from:'v',to:'p'}],'horizontal',rect),/循环/);assert.deepEqual(nodes,before);
});
test('existing material groups are not treated as workgroups',()=>{
    assert.equal(groups.isFrame({type:'group',items:['a']}),false);assert.equal(groups.isFrame({type:'smart-group',images:[{url:'a.png'}]}),false);
});
test('tags remain short plain text and use stable category colors',()=>{
    assert.equal(groups.tagLabel('  人物\n  '),'人物');assert.equal(groups.tagLabel({text:'人物'}),'');
    assert.equal(groups.tagLabel('一'.repeat(40)).length,16);assert.equal(groups.tagColor('人物'),groups.tagColor('人物'));
    assert.match(groups.tagColor('我的角色'),/^#[a-f0-9]{6}$/);
});
test('loop planning keeps a complete chain per round and independent nodes run once',()=>{
    const loop={node:{id:'loop'},count:2};
    const plan=groups.executionPlan(['setup','a','b','other'],[{from:'setup',to:'a'},{from:'a',to:'out'},{from:'out',to:'b'}],id=>['a','b'].includes(id)?loop:null);
    assert.deepEqual(plan.map(b=>b.ids),[['setup'],['a','b'],['other']]);assert.equal(plan[1].loop.count,2);
});
test('a graph requiring interleaved loop batches is rejected before any submission',()=>{
    const x={node:{id:'x'},count:2},y={node:{id:'y'},count:3};
    assert.throws(()=>groups.executionPlan(['a','b','c'],[{from:'a',to:'b'},{from:'b',to:'c'}],id=>id==='b'?y:x),/循环/);
});


test('native workflow drops require a complete same-origin snapshot',()=>{
    const payload={nodes:[{id:'g',groupMode:'frame',items:['p']},{id:'p',type:'prompt',text:'角色提示词',nodeTag:'人物'}],connections:[{from:'g',to:'p'}]};
    const value={version:1,origin:'http://127.0.0.1:3000',title:'作品',payload};
    const transfer={types:[groups.workflowDragType],getData:()=>JSON.stringify(value)};
    assert.deepEqual(groups.readWorkflowDrag(transfer,value.origin),value);
    assert.equal(groups.readWorkflowDrag({types:['Files']},value.origin),null);
    assert.throws(()=>groups.readWorkflowDrag(transfer,'http://other.local'),/无效/);
    payload.connections.push({from:'outside',to:'p'});
    assert.throws(()=>groups.readWorkflowDrag(transfer,value.origin),/不完整/);
    payload.connections=[];payload.nodes.push({...payload.nodes[1]});
    assert.throws(()=>groups.readWorkflowDrag(transfer,value.origin),/不完整/);
    assert.throws(()=>groups.readWorkflowDrag({types:[groups.workflowDragType],getData:()=>'{broken'},value.origin));
});
