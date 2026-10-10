const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context=vm.createContext({window:{},TextDecoder,Uint8Array});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../static/js/canvas-assistant.js'),'utf8'),context);
test('多步执行与待确认完成流按顺序交付，不丢失步骤回执',async()=>{
    const bytes=Buffer.from(JSON.stringify({type:'agent_step',step:{id:'s1',tool:'read_canvas',state:'succeeded'},label:'读取画布'})+'\n'+JSON.stringify({type:'turn_end',state:'waiting_confirmation',reply:'请确认生成'})+'\n');
    let offset=0;const seen=[];
    await context.window.CanvasAssistant.consumeStream({body:{getReader:()=>({read:async()=>offset<bytes.length?{done:false,value:bytes.subarray(offset,offset+=7)}:{done:true},releaseLock(){}})}},event=>seen.push(event));
    assert.equal(seen.length,2);assert.equal(seen[0].step.state,'succeeded');assert.equal(seen[1].state,'waiting_confirmation');
});
test('待确认与停止状态不能误显示成失败',()=>{
    assert.equal(context.window.CanvasAssistant.turnPresentation('waiting_confirmation').failed,false);
    assert.equal(context.window.CanvasAssistant.turnPresentation('waiting_confirmation').label,'等待操作确认');
    assert.equal(context.window.CanvasAssistant.turnPresentation('interrupted').canContinue,true);
    assert.equal(context.window.CanvasAssistant.turnPresentation('paused').canContinue,false);
    assert.equal(context.window.CanvasAssistant.turnPresentation('cancelled').canContinue,false);
});
test('等待图片确认或结果时锁定新的创作输入',()=>{
    assert.equal(context.window.CanvasAssistant.composerLocked({turns:[{state:'waiting_confirmation'}]}),true);
    assert.equal(context.window.CanvasAssistant.composerLocked({turns:[{state:'waiting_result'}]}),true);
    assert.equal(context.window.CanvasAssistant.composerLocked({turns:[{state:'completed'}]}),false);
});
test('一行进度区分真实等待和完成，已消费操作折叠且错误仍可见',()=>{
 const api=context.window.CanvasAssistant;
 assert.equal(api.progressPresentation({state:'running',steps:[{label:'读取画布'}]}),'正在读取画布');
 assert.equal(api.progressPresentation({state:'completed'}),'本轮处理完成');
 assert.equal(api.progressPresentation({state:'waiting_confirmation',nativeActions:[{state:'completed'}]}),'操作已保存，等待继续');
 assert.equal(api.progressPresentation({state:'waiting_result'}),'等待生成结果');
 const turn={state:'completed',agent:{consumedNativeActions:['done']}};
 assert.equal(api.nativeActionAttention(turn,{id:'done',state:'completed'}),false);
 assert.equal(api.nativeActionAttention(turn,{id:'done',state:'completed'},'保存失败'),true);
 for(const state of ['pending','failed','submission_unknown'])assert.equal(api.nativeActionAttention(turn,{state}),true);
 assert.equal(api.nativeActionAttention({state:'cancelled'},{state:'pending'}),false);
});
test('新建会话响应未到时阻挡第二次新建，完成后解除等待',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../static/js/canvas-assistant.js'),'utf8');
 const code=source.match(/async function newSession\(\)\{[\s\S]*?\n        \}/)[0];
 let resolve,calls=0;const pending=new Promise(r=>resolve=r);
 const ctx=vm.createContext({busy:false,sessionLoading:false,canvasId:'canvas',sequence:0,api:()=>{calls++;return pending;},matches:()=>true,closeReference:()=>{},drawHistory:()=>{},contextChips:()=>{},syncControls:()=>{}});
 vm.runInContext(code,ctx);
 const first=ctx.newSession();assert.equal(ctx.sessionLoading,true);
 await ctx.newSession();assert.equal(calls,1);
 resolve({session:{id:'new'}});await first;assert.equal(ctx.sessionLoading,false);assert.equal(ctx.session.id,'new');
});
test('真实历史渲染将完成操作收起，待确认与等待结果可在详情外停止原回合',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas-assistant.js'),'utf8');
 function uiFunction(name){const m=source.match(new RegExp('^( *)function '+name+'\\([^\\n]*\\)\\{','m'));assert.ok(m,name);const end=source.indexOf('\n'+m[1]+'}',m.index)+m[1].length+2;return source.slice(m.index,end);}
 let messages;
 class El{
  constructor(tag){this.tagName=tag;this.children=[];this.parentNode=null;this.className='';this.textContent='';this.attrs={};this.classList={add:c=>this.className+=' '+c};}
  append(...items){for(const n of items){if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(x=>x!==n);n.parentNode=this;this.children.push(n);}}
  replaceChildren(...items){for(const n of this.children)n.parentNode=null;this.children=[];this.append(...items);}
  setAttribute(k,v){this.attrs[k]=v;}
  get isConnected(){return this===messages||!!this.parentNode?.isConnected;}
 }
 const all=el=>[el,...el.children.flatMap(all)];
 for(const state of ['running','waiting_confirmation','waiting_result','completed']){
  messages=new El('div');const turn={id:'original-turn',state,message:'需求',reply:'给用户的成果',nativeActions:state==='running'?[]:[{id:'a',action:'update',state:state==='completed'?'completed':state==='waiting_result'?'accepted':'pending',nodeId:'n',arguments:{patch:{text:'new'}}}]};let cancelBody;
  const ctx=vm.createContext({document:{createElement:tag=>new El(tag)},messages,turnProgress:new Map(),session:{id:'s',turns:[turn]},canvasId:'c',busy:false,request:null,current:()=>({nodes:[]}),matches:()=>true,icons:()=>{},adapter:{},input:{},syncControls:()=>{},continueTurn:()=>{},api:async(path,body)=>{assert.equal(path,'cancel');cancelBody=body;return {};},selectSession:async()=>{turn.state='cancelled';ctx.drawHistory();},showStatus:()=>{},addReplyActions:()=>{},addProposalCard:()=>{}});
  for(const name of ['turnPresentation','progressPresentation','nativeActionAttention','addProgress','addNativeActionCard','drawHistory'])vm.runInContext(uiFunction(name),ctx);
  ctx.drawHistory();const elements=all(messages),stop=elements.find(e=>e.tagName==='button'&&e.textContent==='停止本轮'),card=elements.find(e=>e.attrs['aria-label']==='原生操作方案');
  if(state==='completed'){assert.equal(stop,undefined);assert.equal(card.parentNode.className,'canvas-assistant-progress-body');}
  else{assert.ok(stop,state);assert.equal(stop.parentNode.parentNode,messages);await stop.onclick();assert.equal(cancelBody.requestId,'original-turn');assert.equal(cancelBody.sessionId,'s');assert.equal(turn.state,'cancelled');assert.equal(stop.isConnected,false);}
  if(state==='waiting_confirmation'){assert.equal(all(messages).some(e=>e.textContent==='确认操作'),false);assert.ok(all(messages).some(e=>e.textContent==='本轮已停止，方案未执行'));}
 }
});
test('取消未提交图片方案显示停止状态且不提供原任务查询',()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas-assistant.js'),'utf8');
 function uiFunction(name){const m=source.match(new RegExp('^( *)function '+name+'\\([^\\n]*\\)\\{','m'));assert.ok(m,name);const end=source.indexOf('\n'+m[1]+'}',m.index)+m[1].length+2;return source.slice(m.index,end);}
 class El{
  constructor(tag){this.tagName=tag;this.children=[];this.parentNode=null;this.className='';this.textContent='';this.attrs={};this.classList={add:c=>this.className+=' '+c,toggle:()=>{}};}
  append(...items){for(const n of items){if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(x=>x!==n);n.parentNode=this;this.children.push(n);}}
  replaceChildren(...items){for(const n of this.children)n.parentNode=null;this.children=[];this.append(...items);}
  setAttribute(k,v){this.attrs[k]=v;}
  get isConnected(){return this===messages||!!this.parentNode?.isConnected;}
 }
 const messages=new El('div');
 const progress={body:new El('div'),controls:new El('div')};
 messages.append(progress.body,progress.controls);
 const turn={id:'cancelled-turn',state:'cancelled'};
 const proposal={id:'proposal-1',state:'pending',provider:'assistant-mock',providerName:'隔离模拟平台',model:'image-user',ratio:'square',resolution:'auto',referenceImages:[],prompt:'海报'};
 const ctx=vm.createContext({document:{createElement:tag=>new El(tag)},messages,canvasId:'canvas',session:{id:'session'},busy:false,request:null,matches:()=>true,current:()=>({}),adapter:{},syncControls:()=>{},continueTurn:()=>{},api:async()=>({}),selectSession:async()=>{},showStatus:()=>{},imageConfirm:{checked:true},imageModels:{value:'["assistant-mock","image-user"]'}});
 vm.runInContext(uiFunction('addProposalCard'),ctx);
 ctx.addProposalCard(turn,proposal,progress);
 const all=el=>[el,...el.children.flatMap(all)],elements=all(messages),texts=elements.map(e=>e.textContent),buttons=elements.filter(e=>e.tagName==='button').map(e=>e.textContent);
 assert.ok(texts.includes('本轮已停止，方案未执行'));
 assert.equal(texts.includes('等待确认，尚未提交生成'),false);
 assert.equal(buttons.includes('查询原任务'),false);
 assert.equal(elements.find(e=>e.attrs['aria-label']==='图片生成方案').parentNode,progress.body);
});

test('媒体卡可逐个下载已生成文件，刷新后补下载不重新执行任务',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas-assistant.js'),'utf8');
 const m=source.match(/^( *)function addNativeActionCard\([^\n]*\)\{/m);
 const end=source.indexOf('\n'+m[1]+'}',m.index)+m[1].length+2;
 let messages,downloads=[];
 class El{
  constructor(tag){this.tagName=tag;this.children=[];this.parentNode=null;this.className='';this.textContent='';this.attrs={};}
  append(...items){for(const n of items){if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(x=>x!==n);n.parentNode=this;this.children.push(n);}}
  replaceChildren(...items){this.children=[];this.append(...items);}
  setAttribute(k,v){this.attrs[k]=v;}
  get isConnected(){return this===messages||!!this.parentNode?.isConnected;}
  click(){if(this.tagName==='a')downloads.push({href:this.href,name:this.download});}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this);this.parentNode=null;}
 }
 const all=el=>[el,...el.children.flatMap(all)];
 for(const state of ['completed','submission_unknown']){
  messages=new El('div');const progress={body:new El('div'),controls:new El('div'),label:new El('span')};messages.append(progress.body,progress.controls);
  const proposal={id:'original-export',action:'media_export',state,nodeId:'clip',arguments:{scope:'segments',destination:'download'},
   mediaExportSummary:{fileCount:2,durationSeconds:0.6},receipt:{mediaExport:{status:'succeeded',results:[
    {url:'/output/part-1.mp4',name:'镜头一.mp4'},{url:'/output/part-2.mp4',name:'镜头二.mp4'},
    {url:'https://untrusted.example/file.mp4',name:'foreign.mp4'},{url:'//untrusted.example/file.mp4'}]},exportReceipt:{status:'download_started'}}};
  let requested;
  const ctx=vm.createContext({document:{createElement:tag=>new El(tag),body:new El('body')},messages,canvasId:'c',session:{id:'s'},busy:false,current:()=>({nodes:[]}),matches:()=>true,adapter:{},nativeActionAttention:()=>true,progressPresentation:()=>'',fetch:async url=>{requested=url;return {ok:true,blob:async()=>Buffer.from('saved-media')};},URL:{createObjectURL:blob=>{assert.equal(blob.toString(),'saved-media');return 'blob:original-file';},revokeObjectURL:()=>{}},setTimeout:fn=>fn(),showStatus:message=>{throw Error(message);},api:()=>{throw Error('补下载不能请求执行接口');}});
  vm.runInContext(source.slice(m.index,end),ctx);ctx.addNativeActionCard({state:'completed',agent:{consumedNativeActions:['original-export']}},proposal,progress);
  const buttons=all(messages).filter(e=>e.tagName==='button'&&e.textContent.startsWith('下载第'));
  assert.deepEqual(buttons.map(b=>b.textContent),['下载第 1 个文件','下载第 2 个文件']);
  await buttons[1].onclick();assert.equal(requested,'/api/download-output?url=%2Foutput%2Fpart-2.mp4&name='+encodeURIComponent('镜头二.mp4'));assert.equal(downloads.at(-1).href,'blob:original-file');
  assert.equal(downloads.at(-1).name,'镜头二.mp4');assert.equal(proposal.id,'original-export');
 }
 assert.equal(downloads.length,2);
});
