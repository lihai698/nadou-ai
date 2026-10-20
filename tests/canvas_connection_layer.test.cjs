const {test}=require('node:test');
const assert=require('node:assert/strict');
const classic=require('../static/js/canvas-connection-layer.js');
const smart=require('../static/js/smart-connection-layer.js');
function element(){return {attrs:{},dataset:{},style:{},setAttribute(k,v){this.attrs[k]=v;}};}
function classicHost(){
    const events=[],lines=[],buttons=[];
    const d={nodes:[{id:'a',x:10,y:20,w:100,h:80},{id:'b',x:400,y:20,w:100,h:80}],
        connections:[{id:'ab',from:'a',to:'b'},{id:'missing',from:'a',to:'gone'}],selected:new Set(['a']),
        CSS:{escape:s=>s},nodesEl:{querySelector:()=>null},
        document:{createElement:element,createElementNS:element},
        linksEl:{appendChild:n=>{events.push('write');lines.push(n);}},
        linkControlsEl:{appendChild:n=>buttons.push(n)},hoveredConnectionId:'',tempLink:null,
        knifeActive:false,knifeTrail:[],tr:s=>s,deleteConnection(){}};
    return {d,events,lines,buttons};
}
test('classic connection view falls back to node geometry and omits orphan connections',()=>{
    const {d,lines,buttons}=classicHost();classic.renderLinks(d);
    assert.equal(lines.length,2);assert.equal(buttons.length,1);
    assert.equal(lines[0].attrs.d,'M 110 60 C 240.5 60, 269.5 60, 400 60');
    assert.equal(lines[0].attrs.class,'link link-active');assert.equal(lines[1].dataset.connectionId,'ab');
    assert.equal(buttons[0].dataset.connectionId,'ab');
});
test('classic connection view reads all endpoint rectangles before appending paths',()=>{
    const {d,events}=classicHost();d.connections=[d.connections[0],{id:'ba',from:'b',to:'a'}];
    d.nodesEl.querySelector=()=>({querySelector:()=>({getBoundingClientRect:()=>{events.push('read');return {left:0,top:0,width:4,height:4};}})});
    d.screenToWorld=(x,y)=>({x,y});classic.renderLinks(d);
    assert.deepEqual(events.slice(0,4),['read','read','read','read']);
    assert.ok(events.slice(4).every(x=>x==='write'));
});
function smartHost(){return {nodes:[{id:'a',x:0,y:0,w:100,h:80},{id:'g',x:400,y:0,w:200,h:200,items:['b','c']},{id:'b',x:420,y:20,w:50,h:50},{id:'c',x:420,y:80,w:50,h:50}],
    canvas:{connections:[{from:'a',to:'b',kind:'input'},{from:'a',to:'c',kind:'input'},{from:'b',to:'c',kind:'flow'}]},
    isSmartGroupNode:n=>n?.id==='g',cascadeConnectionKeys:()=>new Set(),smartCascadeRunPath:null,
    selectedNodeIds:()=>[],loopInsertPreview:null,smartCascadeEdgeState:()=>'',nodeRect:n=>({x:n.x,y:n.y,width:n.w,height:n.h})};}
test('smart connection view merges member inputs and hides internal group edges',()=>{
    const html=smart.renderConnections(smartHost());
    assert.equal((html.match(/ conn-line"/g)||[]).length,1);
    assert.match(html,/data-conn-index="0,1"/);assert.doesNotMatch(html,/data-conn-index="2"/);
});
test('smart connection refresh coalesces one frame and releases the token when no SVG remains',()=>{
    const jobs=[];const d={connectionLayerRaf:0,requestAnimationFrame:fn=>{jobs.push(fn);return 7;},world:{querySelector:()=>null}};
    smart.scheduleConnectionLayerRefresh(d);smart.scheduleConnectionLayerRefresh(d);
    assert.equal(jobs.length,1);assert.equal(d.connectionLayerRaf,7);
    jobs[0]();assert.equal(d.connectionLayerRaf,0);
    smart.scheduleConnectionLayerRefresh(d);assert.equal(jobs.length,2);
});
