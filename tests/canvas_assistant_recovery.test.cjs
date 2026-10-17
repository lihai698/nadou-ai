const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../static/js/canvas-assistant.js'),'utf8');
function fn(name,indent){const start=source.indexOf(`${' '.repeat(indent)}async function ${name}(`);assert.ok(start>=0);const end=source.indexOf('\n'+' '.repeat(indent)+'}',start)+indent+2;return source.slice(start,end);}
test('原任务同步成功后清除旧暂停标记并继续，失败时保留原任务和提示',async()=>{
 for(const failed of [false,true]){
  const proposal={id:'action',action:'run',state:'accepted'};let queued=0,closed=0;
  const ctx=vm.createContext({busy:false,flight:false,error:'',alive:()=>true,render:()=>{},owner:'canvas',sessionId:'session',turn:{id:'turn'},proposal,
   autoErrors:new Map([['turn','旧查询失败']]),closeTasks:()=>closed++,queueAutomatic:()=>queued++,
   adapter:{syncNativeTask:async()=>{if(failed)throw Error('仍未保存');return true;}},api:async()=>({proposal:{...proposal,state:'completed'}})});
  vm.runInContext(fn('syncTask',12),ctx);await ctx.syncTask();
  assert.equal(proposal.state,failed?'accepted':'completed');assert.equal(ctx.autoErrors.has('turn'),failed);assert.equal(queued,failed?0:1);assert.equal(closed,failed?0:1);
  if(failed)assert.equal(ctx.error,'仍未保存');
 }
});
test('手动继续清理旧错误，新失败重新记录；忙碌时不改暂停状态',async()=>{
 for(const mode of ['success','failed','busy']){
  let closed=0;
  const ctx=vm.createContext({busy:mode==='busy',session:{id:'session'},canvasId:'canvas',request:null,AbortController,headers:{},
   autoErrors:new Map([['turn','旧错误']]),closeTasks:()=>closed++,syncControls:()=>{},showStatus:()=>{},turnProgress:new Map(),addProgress:()=>({label:{}}),
   document:{createElement:()=>({})},messages:{append:()=>{}},matches:()=>true,adapter:{refresh:async()=>{}},selectSession:async()=>{},
   fetch:async()=>{if(mode==='failed')throw Error('新的连接失败');return {ok:true};},consumeStream:async()=>{}});
  vm.runInContext(fn('continueTurn',8),ctx);await ctx.continueTurn('turn');
  assert.equal(ctx.autoErrors.get('turn'),mode==='busy'?'旧错误':mode==='failed'?'新的连接失败':undefined);
  assert.equal(closed,mode==='busy'?0:1,'开始继续时收起旧错误详情，进度由任务入口展示');
 }
});
