const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/js/canvas.js'),'utf8');
const helper=source.slice(source.indexOf('function mergeCanvasAssistantChanges('),source.indexOf('function canvasAssistantCreationSettings('));
function editor(){
    const ctx=vm.createContext({canvas:{id:'c',updated_at:1},nodes:[{id:'p',text:'手动编辑',x:55},{id:'q',text:'原文'}],connections:[],lastCanvasUpdatedAt:1,
        structuredClone,render:()=>{},setStatus:value=>ctx.notice=value});
    ctx.remote={id:'c',updated_at:2,nodes:[{id:'p',text:'助手改写'},{id:'q',text:'助手更新'},{id:'g',type:'generator'}],connections:[{id:'e',from:'q',to:'g'}],
        assistant_receipts:{r:{createdNodeIds:['g'],createdEdgeIds:['e'],nodePatches:[
            {nodeId:'p',fields:{text:{before:'原文',after:'助手改写'}}},
            {nodeId:'q',fields:{text:{before:'原文',after:'助手更新'}}}],updatedAtAfter:2}}};
    vm.runInContext(helper,ctx);return ctx;
}
test('assistant merge preserves manual edits and applies independent nodes and edges once',()=>{
    const ctx=editor();assert.equal(vm.runInContext('mergeCanvasAssistantChanges(remote)',ctx),true);
    assert.equal(ctx.nodes[0].text,'手动编辑');assert.equal(ctx.nodes[0].x,55);
    assert.equal(ctx.nodes[1].text,'助手更新');assert.equal(ctx.nodes.length,3);assert.equal(ctx.connections.length,1);
    assert.match(ctx.notice,/保留手动修改/);
    assert.equal(vm.runInContext('mergeCanvasAssistantChanges(remote)',ctx),false);
    assert.equal(ctx.nodes.length,3);
});
test('assistant merge respects local deletion and ignores a different canvas',()=>{
    const ctx=editor();ctx.nodes=ctx.nodes.filter(n=>n.id!=='q');
    assert.equal(vm.runInContext("mergeCanvasAssistantChanges({...remote,id:'other'})",ctx),false);
    vm.runInContext('mergeCanvasAssistantChanges(remote)',ctx);
    assert.equal(ctx.nodes.some(n=>n.id==='q'),false);assert.equal(ctx.connections.length,0);
});
