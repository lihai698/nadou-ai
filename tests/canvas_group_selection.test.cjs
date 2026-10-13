const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const source = readFileSync(path.join(__dirname, '../static/js/canvas.js'), 'utf8');
function section(start, end) {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    return source.slice(from, to);
}
function editor(initialNodes, initialConnections = [], ids = []) {
    let serial = 0;
    const context = vm.createContext({
        nodes:structuredClone(initialNodes), connections:structuredClone(initialConnections),
        selected:new Set(ids), selectDrag:null, undoCount:0,
        ensureCanvas:() => true, uid:prefix => `${prefix}-${++serial}`,
        defaultPoint:() => ({x:0,y:0}),
        syncGeneratorInputs:() => {}, refreshGeneratorInputViews:() => {},
        render:() => {}, scheduleSave:() => {},
        workflowTransferModal:null, window:{},
        CANVAS_GENERATOR_TYPES:['generator','comfy','llm'], canConnect:() => true,
        document:{body:{classList:{add(){},remove(){}}}},
        selectionBox:{style:{},getBoundingClientRect:() => ({left:0,top:0,right:1200,bottom:900})},
    });
    context.pushUndo = () => context.undoCount++;
    context.nodeRect = n => ({x:n.x,y:n.y,w:n.w,h:n.h,cx:n.x+n.w/2,cy:n.y+n.h/2});
    context.nodesEl = {
        querySelector:selector => {
            const node = context.nodes.find(n => selector.includes(`"${n.id}"`));
            return node ? {offsetWidth:node.w,offsetHeight:node.h} : null;
        },
        querySelectorAll:() => context.nodes.map(n => ({dataset:{id:n.id},getBoundingClientRect:() => ({left:n.x,top:n.y,right:n.x+n.w,bottom:n.y+n.h})})),
    };
    vm.runInContext(section('function groupSelectedImages(){','function renderSelectionHub(){')
        + section('function handoffExistingInputsToGroup(','function portPoint('), context);
    return {context, run:code => vm.runInContext(code,context), state:() => JSON.parse(JSON.stringify({nodes:context.nodes,connections:context.connections}))};
}
const nodes = [
    {id:'image',type:'image',x:100,y:130,w:220,h:190,url:'test.png'},
    {id:'generator',type:'generator',x:430,y:130,w:280,h:420},
    {id:'output',type:'output',x:800,y:400,w:300,h:230,images:[]},
];
const links = [{id:'input',from:'image',to:'generator'},{id:'result',from:'generator',to:'output'}];

test('分组包含选中的图片、生成器和输出，完整包围且保留连线', () => {
    const e = editor(nodes, links, nodes.map(n => n.id));
    e.run('groupSelectedImages()');
    const state = e.state(), group = state.nodes.find(n => n.type === 'group');
    assert.deepEqual(group.items, ['image','generator','output']);
    assert.deepEqual(state.connections, links);
    assert.deepEqual(state.nodes.slice(0,3), nodes);
    for(const node of nodes) {
        assert.ok(group.x < node.x && group.y < node.y);
        assert.ok(group.x+group.w > node.x+node.w && group.y+group.h > node.y+node.h);
    }
    assert.equal(e.context.undoCount, 1);
});

test('Ctrl 框选多个节点结束时自动成组，R 框选仍只多选', () => {
    for(const autoGroup of [true,false]) {
        const e = editor(nodes, links);
        e.context.selectDrag = {autoGroup};
        e.run('finishSelection()');
        assert.equal(e.state().nodes.filter(n => n.type === 'group').length, autoGroup ? 1 : 0);
        if(autoGroup) assert.deepEqual(e.state().nodes.at(-1).items, nodes.map(n => n.id));
        else assert.deepEqual([...e.context.selected], nodes.map(n => n.id));
    }
});

test('只框选单个节点不自动成组，已选中的组再次分组不重复套组', () => {
    const single = editor([nodes[0]]);
    single.context.selectDrag = {autoGroup:true};
    single.run('finishSelection()');
    assert.equal(single.state().nodes.length, 1);
    const existing = editor([{id:'group',type:'group',x:0,y:0,w:400,h:400,items:['image']},nodes[0]],[],['group']);
    existing.run('groupSelectedImages()');
    assert.equal(existing.state().nodes.length,2);
    assert.equal(existing.context.undoCount,0);
});

test('原有图片提示词素材组仍接管输入连线', () => {
    const initial = [nodes[0],{id:'prompt',type:'prompt',x:100,y:400,w:220,h:130,text:'hello'},nodes[1]];
    const e = editor(initial, links.slice(0,1), ['image','prompt']);
    e.run('groupSelectedImages()');
    const state=e.state(), group=state.nodes.at(-1);
    assert.deepEqual(group.items,['image','prompt']);
    assert.equal(state.connections.length,1);
    assert.equal(state.connections[0].from,group.id);
    assert.equal(state.connections[0].to,'generator');
});

test('工作流组成员拖入拖出更新所有节点类型，保留原连线', () => {
    const e = editor(nodes,links,nodes.map(n => n.id));
    e.run('groupSelectedImages()');
    e.run("nodes.find(n=>n.id==='generator').x=1800;updateGroupMembership([nodes.find(n=>n.id==='generator')]);");
    assert.ok(!e.state().nodes.at(-1).items.includes('generator'));
    e.run("nodes.find(n=>n.id==='generator').x=430;updateGroupMembership([nodes.find(n=>n.id==='generator')]);");
    assert.ok(e.state().nodes.at(-1).items.includes('generator'));
    assert.deepEqual(e.state().connections,links);
});
