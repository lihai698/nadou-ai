const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/js/canvas.js'),'utf8');
function fn(name){const begin=source.indexOf(`function ${name}(`),end=source.indexOf('\nfunction ',begin+1);assert.ok(begin>=0&&end>begin);return source.slice(begin,end);}
test('普通故事依赖线重开保留，非法与悬空连线清理',()=>{
 const nodes=[{id:'s',type:'prompt'},{id:'t',type:'shot-table',shotTableData:{source:{nodeId:'s'},productionData:{}}},{id:'p',type:'prompt',storyWorkflowOrigin:{tableId:'t'}},{id:'g',type:'generator'}];
 const ctx=createTaskContext({nodes,connections:[{from:'s',to:'p',kind:'story'},{from:'t',to:'p',kind:'story'},{from:'g',to:'p',kind:'story'},{from:'missing',to:'p',kind:'story'},{from:'p',to:'g'}],canConnect:(a,b)=>a==='p'&&b==='g'});
 vm.runInContext(fn('validStoryConnection')+fn('sanitizeConnections')+'sanitizeConnections()',ctx);
 assert.equal(ctx.connections.length,3);
});
test('普通配图仅使用输入线，不把故事依赖当提示词',()=>{
 const ctx=createTaskContext({nodes:[{id:'story',type:'prompt',text:'整篇原文'},{id:'p',type:'prompt',text:'本镜提示词'}],connections:[{from:'story',to:'g',kind:'story'},{from:'p',to:'g',kind:'input'}],CANVAS_MEDIA_OUTPUT_TYPES:[],gen:{id:'g'}});
 vm.runInContext(fn('generatorSources')+'result=generatorSources(gen)',ctx);
 assert.equal(ctx.result.length,1);assert.equal(ctx.result[0].prompt,'本镜提示词');
});
