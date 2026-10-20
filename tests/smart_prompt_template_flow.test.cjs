const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'('),begin=source.lastIndexOf('\n',start)+1,end=source.indexOf('\n}',start)+2;assert.ok(start>=0);return source.slice(begin,end);}
function templates(enabled){
 const node={id:'n',type:'smart-prompt',llmEnabled:enabled,text:'旧正文或旧结果',llmInstruction:'旧规则'};let saved=0;
 const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
 const ctx=createTaskContext({nodes:[node],activePromptLibraryId:'user',promptLibraries:[{id:'user',items:[{id:'t',positive:'按照上游写分镜，只输出JSON'}]}],promptTemplateSelectedId:'t',canvasAssistantTemplateCallback:null,composerTemplateBtn:null,promptTemplatePanel:{dataset:{nodeId:'n'},classList:{remove(){}}},render:()=>{},scheduleSave:()=>saved++});
 vm.runInContext(fn('setPromptTemplateText'),ctx);vm.runInContext(fn('applyPromptTemplateToNode'),ctx);return {node,ctx,saves:()=>saved};
}
test('LLM模式引用模板只写规则，保留旧结果并标记待重新生成',()=>{const {node,ctx,saves}=templates(true);ctx.applyPromptTemplateToNode();assert.equal(node.text,'旧正文或旧结果');assert.equal(node.llmInstruction,'按照上游写分镜，只输出JSON');assert.equal(node.llmOutputStale,true);assert.equal(saves(),1);});
test('普通提示词引用模板仍写正文',()=>{const {node,ctx}=templates(false);ctx.applyPromptTemplateToNode();assert.equal(node.text,'按照上游写分镜，只输出JSON');assert.equal(node.llmInstruction,'旧规则');});
test('LLM输入只有上游原文，规则和旧输出不能拼进去',()=>{const ctx=vm.createContext({smartLoopContext:null,promptNodeUpstreamPromptText:()=> '上游故事',promptNodePromptItems:n=>[n.text]});vm.runInContext(fn('promptNodeLLMInputText'),ctx);assert.equal(ctx.promptNodeLLMInputText({text:'旧输出',llmInstruction:'只输出JSON'}),'上游故事');});
test('LLM请求用系统规则处理上游，成功后结果才可供下游读取',async()=>{
 const node={id:'n',type:'smart-prompt',llmEnabled:true,llmProvider:'mock',llmModel:'chosen',text:'旧输出',llmInstruction:'只输出分镜JSON',llmSystemEnabled:false,llmOutputStale:true};let body;
 const ctx=vm.createContext({nodes:[node],promptNodeLLMInputText:()=> '上游故事',render:()=>{},resolveChatProviderId:x=>x,resolveChatModel:x=>x,promptNodeInputMediaForLLM:()=>[],imageRefsOnly:()=>[],videoRefsOnly:()=>[],scheduleSave:()=>{},toast:()=>{},tr:x=>x,fetch:async(url,init)=>{body=JSON.parse(init.body);return {ok:true,json:async()=>({text:'真实模型结果'})};}});
 vm.runInContext(fn('runPromptLLMNode'),ctx);await ctx.runPromptLLMNode('n');assert.equal(body.message,'上游故事');assert.equal(body.system_prompt,'只输出分镜JSON');assert.equal(node.text,'真实模型结果');assert.equal(node.llmInstruction,'只输出分镜JSON');assert.equal(node.llmOutputStale,false);
});
test('规则已变化的旧LLM结果不向下游传播，普通正文不受影响',()=>{const ctx=vm.createContext({smartLoopContext:null,isSmartImageNode:()=>false,promptNodePromptItems:n=>[n.text]});vm.runInContext(fn('promptTextItemsForNode'),ctx);assert.equal(ctx.promptTextItemsForNode({type:'smart-prompt',llmEnabled:true,llmOutputStale:true,text:'旧结果'}).length,0);assert.equal(ctx.promptTextItemsForNode({type:'smart-prompt',llmEnabled:false,text:'普通正文'})[0],'普通正文');});
test('失败空结果和运行中规则变化均保留旧结果，不伪装完成',async()=>{
 for(const scenario of ['failed','empty','changed']){
  const node={id:'n',type:'smart-prompt',text:'旧结果',llmEnabled:true,llmInstruction:'规则',llmProvider:'p',llmModel:'m'};let error;
  const ctx=vm.createContext({nodes:[node],promptNodeLLMInputText:()=> '原文',render:()=>{},resolveChatProviderId:x=>x,resolveChatModel:x=>x,promptNodeInputMediaForLLM:()=>[],imageRefsOnly:()=>[],videoRefsOnly:()=>[],scheduleSave:()=>{},toast:v=>error=v,tr:x=>x,fetch:async()=>{if(scenario==='failed')throw Error('失败');if(scenario==='changed')node.llmInstruction='新规则';return {ok:true,json:async()=>({text:scenario==='empty'?'':'新结果'})};}});
  vm.runInContext(fn('runPromptLLMNode'),ctx);await ctx.runPromptLLMNode('n');assert.equal(node.text,'旧结果');assert.equal(node.llmOutputStale,true);assert.ok(error);
 }
});

test('下游真实文本入口也阻止过期结果',()=>{const n={type:'smart-prompt',llmEnabled:true,llmOutputStale:true,text:'旧结果'};const ctx=vm.createContext({smartLoopContext:null,isSmartImageNode:()=>false,promptNodePromptItems:n=>[n.text]});vm.runInContext(fn('promptTextItemsForNode'),ctx);vm.runInContext(fn('textForNode'),ctx);assert.equal(ctx.textForNode(n),'');n.llmOutputStale=false;assert.equal(ctx.textForNode(n),'旧结果');});
test('运行中更换模型或关闭LLM不能被旧请求覆盖',async()=>{for(const change of [n=>n.llmModel='new',n=>n.llmEnabled=false]){const node={id:'n',type:'smart-prompt',llmEnabled:true,llmInstruction:'规则',llmProvider:'p',llmModel:'m',text:'旧结果'};const ctx=vm.createContext({nodes:[node],promptNodeLLMInputText:()=> '原文',render:()=>{},resolveChatProviderId:x=>x,resolveChatModel:x=>x,promptNodeInputMediaForLLM:()=>[],imageRefsOnly:()=>[],videoRefsOnly:()=>[],scheduleSave:()=>{},toast:()=>{},tr:x=>x,fetch:async()=>{change(node);return {ok:true,json:async()=>({text:'过期返回'})};}});vm.runInContext(fn('runPromptLLMNode'),ctx);await ctx.runPromptLLMNode('n');assert.equal(node.text,'旧结果');assert.equal(node.llmOutputStale,true);}});
