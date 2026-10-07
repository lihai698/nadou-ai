const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../static/js/canvas.js'), 'utf8');
const copyStart = source.indexOf('function pushUndo(){');
const copyEnd = source.indexOf('function copySelectedNodes(){', copyStart);
const dragStart = source.indexOf('function startNodeDrag(e, node){');
const dragEnd = source.indexOf('function startNodeResize(e, node){', dragStart);
assert.ok(copyStart >= 0 && copyEnd > copyStart && dragStart >= 0 && dragEnd > dragStart);

function editor(initialNodes, initialConnections, selectedIds){
    let serial = 0;
    const nodes = structuredClone(initialNodes);
    const connections = structuredClone(initialConnections);
    const context = vm.createContext({
        canvas:{id:'isolated'}, nodes, connections, selected:new Set(selectedIds),
        undoStack:[], UNDO_MAX:20, viewport:{scale:1},
        uid:prefix => `${prefix}-copy-${++serial}`,
        serializableCanvasNode:n => ({...n}),
        serializableCanvasNodes:() => nodes.map(n => ({...n})),
        canConnect:(from,to) => from !== to && context.nodes.some(n => n.id === from)
            && context.nodes.some(n => n.id === to),
        startKnifeDrag:() => false, setKnifeMode:() => {},
        sanitizeConnections:() => {}, syncGeneratorInputs:() => {},
        remapCanvasDepthCopies:() => {},
        render:() => {}, scheduleSave:() => {},
        document:{body:{classList:{add:() => {}}}}, window:{},
        nodesEl:{querySelector:() => null},
        scheduleLinksRender:() => {}, renderSelectionHub:() => {},
        workflowTransferModal:null, scheduleMinimapRender:() => {},
        endDrag:() => {},
    });
    vm.runInContext(source.slice(copyStart,copyEnd) + source.slice(dragStart,dragEnd),context);
    const state = () => ({
        nodes:JSON.parse(JSON.stringify(context.nodes)),
        connections:JSON.parse(JSON.stringify(context.connections)),
        selected:[...context.selected],
    });
    const drag = (id, {shift=false, dx=120, dy=70}={}) => {
        const node = context.nodes.find(n => n.id === id);
        vm.runInContext('startNodeDrag',context)({
            button:0, altKey:true, shiftKey:shift, clientX:200, clientY:200,
            preventDefault(){}, stopPropagation(){},
        },node);
        vm.runInContext('onNodeDrag',context)({clientX:200+dx,clientY:200+dy});
        return state();
    };
    return {context,state,drag,undo:() => vm.runInContext('performUndo()',context)};
}

test('Alt drag duplicates every selected node, moves the copies together, and undoes as one edit',()=>{
    const initial = [
        {id:'prompt-a',type:'prompt',x:80,y:100,text:'A'},
        {id:'prompt-b',type:'prompt',x:80,y:420,text:'B'},
        {id:'generator',type:'generator',x:480,y:160},
    ];
    const links = [{id:'a',from:'prompt-a',to:'generator'},
        {id:'b',from:'prompt-b',to:'generator'}];
    const e = editor(initial,links,['prompt-a','generator']);
    const moved = e.drag('prompt-a');
    assert.equal(moved.nodes.length,5);
    assert.equal(moved.connections.length,2);
    assert.equal(moved.selected.length,2);
    const promptCopy = moved.nodes.find(n => n.id !== 'prompt-a' && n.type === 'prompt' && n.text === 'A');
    const generatorCopy = moved.nodes.find(n => n.id !== 'generator' && n.type === 'generator');
    assert.equal(promptCopy.x,200); assert.equal(promptCopy.y,170);
    assert.equal(generatorCopy.x,600); assert.equal(generatorCopy.y,230);
    assert.deepEqual(moved.nodes.slice(0,3),initial);
    e.undo();
    assert.deepEqual(e.state().nodes,initial);
    assert.deepEqual(e.state().connections,links);
});

test('Alt+Shift drag maps selected internal and external input links to copied targets',()=>{
    const nodes = [
        {id:'prompt-a',type:'prompt',x:80,y:100,text:'A'},
        {id:'prompt-b',type:'prompt',x:80,y:420,text:'B'},
        {id:'generator',type:'generator',x:480,y:160},
    ];
    const e = editor(nodes,[
        {id:'a',from:'prompt-a',to:'generator'},
        {id:'b',from:'prompt-b',to:'generator'},
    ],['prompt-a','generator']);
    const moved = e.drag('prompt-a',{shift:true});
    assert.equal(moved.nodes.length,5);
    assert.equal(moved.connections.length,4);
    const copyA = moved.nodes.find(n => n.type === 'prompt' && n.id !== 'prompt-a' && n.text === 'A');
    const copyGen = moved.nodes.find(n => n.type === 'generator' && n.id !== 'generator');
    const newLinks = moved.connections.slice(2).map(c => `${c.from}->${c.to}`);
    assert.deepEqual(new Set(newLinks),new Set([`${copyA.id}->${copyGen.id}`,`prompt-b->${copyGen.id}`]));
    e.undo();
    assert.equal(e.state().nodes.length,3);
    assert.equal(e.state().connections.length,2);
});

test('group Alt+Shift drag copies members once, maps group items and moves the whole selection',()=>{
    const nodes = [
        {id:'image-a',type:'image',x:100,y:140,url:'data:image/png;base64,AA=='},
        {id:'image-b',type:'image',x:330,y:140,url:'data:image/png;base64,AA=='},
        {id:'group',type:'group',x:80,y:80,items:['image-a','image-b'],w:500,h:320},
        {id:'generator',type:'generator',x:720,y:130},
    ];
    const e = editor(nodes,[{id:'group-link',from:'group',to:'generator'}],
        ['group','image-a','generator']);
    const moved = e.drag('group',{shift:true});
    assert.equal(moved.nodes.length,8);
    assert.equal(moved.connections.length,2);
    const copyGroup = moved.nodes.find(n => n.type === 'group' && n.id !== 'group');
    const copyGen = moved.nodes.find(n => n.type === 'generator' && n.id !== 'generator');
    assert.equal(copyGroup.x,200); assert.equal(copyGroup.y,150);
    assert.equal(copyGen.x,840); assert.equal(copyGen.y,200);
    assert.equal(new Set(copyGroup.items).size,2);
    assert.ok(copyGroup.items.every(id => id !== 'image-a' && id !== 'image-b'));
    assert.deepEqual(copyGroup.items.map(id => moved.nodes.find(n => n.id === id)?.x),[220,450]);
    assert.equal(moved.connections[1].from,copyGroup.id);
    assert.equal(moved.connections[1].to,copyGen.id);
    e.undo();
    assert.deepEqual(e.state().nodes,nodes);
    assert.equal(e.state().connections.length,1);
});
