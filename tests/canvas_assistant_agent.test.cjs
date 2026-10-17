const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function taskGlobals(taskList){return {taskList,resultMedia:context.window.CanvasAssistant.resultMedia,providers:[],imageProviders:[],status:{textContent:'',hidden:true},nativeExecutors:new Map(),imageExecutors:new Map(),autoErrors:new Map(),refreshTasks:()=>{},queueAutomatic:()=>{},closeTasks:()=>{}};}
const context=vm.createContext({window:{},TextDecoder,Uint8Array});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../static/js/canvas-assistant.js'),'utf8'),context);

test('正式正文排除旧完成建议段，但保留故事里的建议情节',()=>{
 const text='**离奇故事**\n\n一。\n\n二。\n\n三。\n\n四。\n\n故事已按 500 字左右完成。接下来你可以：①保存到画布②分析';
 assert.equal(context.window.CanvasAssistant.formalText(text),'**离奇故事**\n\n一。\n\n二。\n\n三。\n\n四。');
 assert.equal(context.window.CanvasAssistant.formalText('老人建议他不要进门。\n\n他还是进去了。'),'老人建议他不要进门。\n\n他还是进去了。');
 assert.equal(context.window.CanvasAssistant.formalText('正文\n\n---\n\n故事已按 500 字左右完成。接下来你可以选：①保存\n\n②配图'),'正文');
});

test('独立文本预览三段，展开与复制放入画布都使用全文，媒体各有操作',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas-assistant.js'),'utf8');
 const m=source.match(/^( *)function addReplyActions\([^\n]*\)\{/m),end=source.indexOf('\n'+m[1]+'}',m.index)+m[1].length+2;
 class El{constructor(tag){this.tagName=tag;this.children=[];this.textContent='';this.attrs={};}append(...v){this.children.push(...v);}replaceChildren(){this.children=[];this.textContent='';}setAttribute(k,v){this.attrs[k]=v;}}
 const root=new El('div'),full='**作品**\n\n第一段\n\n第二段\n\n第三段\n\n第四段';let copied,placed;
 const ctx=vm.createContext({document:{createElement:tag=>new El(tag)},formalText:context.window.CanvasAssistant.formalText,replyParagraphs:context.window.CanvasAssistant.replyParagraphs,navigator:{clipboard:{writeText:async v=>copied=v}},showStatus:()=>{},icons:()=>{},adapter:{addTextNode:async v=>{placed=v;return true;},addImageNode:async()=>true}});
 vm.runInContext(source.slice(m.index,end),ctx);ctx.addReplyActions(root,full,[{url:'/output/p.png',kind:'image'},{url:'/output/v.mp4',kind:'video'}]);
 const [text,image,video]=root.children;assert.equal(root.children.length,3);
 assert.deepEqual(text.children[0].children.map(p=>!!p.hidden),[false,false,false,false,true]);
 const buttons=text.children[1].children;assert.deepEqual(buttons.map(b=>b.textContent),['展开全文','复制全文','放到画布']);
 await buttons[0].onclick();assert.equal(text.children[0].children[4].hidden,false);assert.equal(buttons[0].textContent,'收起全文');
 await buttons[1].onclick();await buttons[2].onclick();assert.equal(copied,full);assert.equal(placed,full);
 assert.equal(image.children[0].tagName,'img');assert.equal(video.children[0].tagName,'video');assert.equal(video.children[0].controls,true);
 assert.equal(image.children[1].children[0].textContent,'复制图片地址');assert.equal(video.children[1].children[0].textContent,'复制视频地址');
});

test('结果媒体仅收集成功动作并去重，非法地址不能成为结果',()=>{
 const result=context.window.CanvasAssistant.resultMedia({media:[{url:'/output/one.png'},{url:'javascript:alert(1)'}],nativeActions:[{action:'run',state:'completed',receipt:{tasks:[{result:{images:['/output/one.png','/output/two.mp4']}}]}},{action:'run',state:'failed',receipt:{tasks:[{result:{images:['/output/failed.png']}}]}}]});
 assert.deepEqual(Array.from(result,r=>[r.url,r.kind]),[['/output/one.png','image'],['/output/two.mp4','video']]);
 const current=context.window.CanvasAssistant.resultMedia({nativeActions:[{state:'completed',action:'run',receipt:{node:{results:{generatedOutputs:['/output/old.png','/output/current.png']}},tasks:[{images:['/output/current.png']}]}}]});
 assert.deepEqual(Array.from(current,r=>r.url),['/output/current.png']);
});

test('已受理任务轮询间隔保留生成标识，待确认失败未知及停止时不显示',()=>{
 const working=context.window.CanvasAssistant.resultWorking;
 assert.equal(working({state:'waiting_result',nativeActions:[{state:'accepted'}]}),true);
 assert.equal(working({state:'waiting_confirmation',nativeActions:[{state:'pending'}]}),false);
 for(const state of ['failed','submission_unknown'])assert.equal(working({state:'waiting_result',nativeActions:[{state}]}),false);
 assert.equal(working({state:'cancelled',nativeActions:[{state:'accepted'}]}),false);
});

test('任务入口区分需要决定的状态，普通编辑自动执行但删除和未授权模型等待确认',()=>{
 const api=context.window.CanvasAssistant;
 assert.equal(api.taskPresentation([],false),'任务');
 assert.equal(api.taskPresentation([{state:'waiting_confirmation'}]),'任务 · 待确认');
 assert.equal(api.taskPresentation([{state:'completed'}]),'任务 · 已完成');
 assert.equal(api.taskPresentation([{state:'completed',steps:[{review:{status:'needs_changes'}}]}]),'任务 · 待改进');
 assert.equal(api.automaticNative({action:'shot_edit',state:'pending',chargeable:false},{state:'waiting_confirmation'}),true);
 assert.equal(api.automaticNative({action:'shot_column',state:'pending',arguments:{columnAction:'delete'}},{state:'waiting_confirmation'}),false);
 const run={action:'run',state:'pending',chargeable:true,runSettings:{provider:'chosen',model:'text',maxCalls:1}};
 assert.equal(api.automaticNative(run,{state:'waiting_confirmation'}),false);
 const turn={state:'waiting_confirmation',authorization:{used:0,limit:1,models:[{provider:'chosen',model:'text'}]}};
 assert.equal(api.automaticNative(run,turn),true);turn.authorization.used=1;assert.equal(api.automaticNative(run,turn),false);
 turn.authorization.used=0;turn.state='cancelled';assert.equal(api.automaticNative(run,turn),false);
});

test('普通原生编辑自动执行一次并续行，停止后不自动继续',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas-assistant.js'),'utf8');
 const m=source.match(/^( *)function queueAutomatic\([^\n]*\)\{/m),end=source.indexOf('\n'+m[1]+'}',m.index)+m[1].length+2;
 for(const stop of [false,true]){
  const proposal={id:'edit',state:'pending',action:'shot_edit',chargeable:false},turn={id:'turn',state:'waiting_confirmation',nativeActions:[proposal],agent:{consumedNativeActions:[]}};
  let calls=0,continues=0;
  const ctx=vm.createContext({autoQueued:false,autoRunning:false,destroyed:false,busy:false,sessionLoading:false,historyShown:false,session:{id:'session',turns:[turn]},canvasId:'canvas',autoErrors:new Map(),autoAttempts:new Set(),queryTimes:new Map(),automaticNative:context.window.CanvasAssistant.automaticNative,refreshTasks:()=>{},matches:()=>true,nativeExecutors:new Map([['edit',async(action,automatic)=>{assert.equal(action,'confirm');assert.equal(automatic,true);calls++;if(stop)turn.state='cancelled';proposal.state='completed';}]]),imageExecutors:new Map(),continueTurn:async()=>{continues++;turn.state='completed';},showStatus:()=>{}});
  vm.runInContext(source.slice(m.index,end),ctx);ctx.queueAutomatic();await new Promise(resolve=>setImmediate(resolve));ctx.queueAutomatic();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);assert.equal(continues,stop?0:1);
 }
});

test('执行状态只更新本轮摘要，局部错误在没有执行时可见',()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas-assistant.js'),'utf8');
 const code=source.match(/function showStatus\(value\)\{[\s\S]*?\n        \}/)?.[0]||source.match(/function showStatus\(value\)\{[^\n]+/)[0];
 const status={textContent:'',hidden:true},label={textContent:''};
 const ctx=vm.createContext({status,request:{progress:{label}},refreshTasks:()=>{}});vm.runInContext(code,ctx);
 ctx.showStatus('正在读取画布');assert.equal(label.textContent,'正在读取画布');assert.equal(status.textContent,'');assert.equal(status.hidden,true);
 ctx.request=null;ctx.showStatus('连接失败，请重试');assert.equal(status.textContent,'连接失败，请重试');assert.equal(status.hidden,false);
 ctx.showStatus('');assert.equal(status.hidden,true);
});

test('模型首步失败且无工具记录时仍在任务区保留错误',()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas-assistant.js'),'utf8');
 const m=source.match(/^( *)function drawHistory\([^\n]*\)\{/m),end=source.indexOf('\n'+m[1]+'}',m.index)+m[1].length+2;
 class El{constructor(){this.textContent='';this.children=[];this.classList={add:()=>{}};}append(...v){this.children.push(...v);}replaceChildren(){this.children=[];this.textContent='';}}
 const messages=new El(),taskList=new El(),turn={id:'first-failure',state:'failed',message:'需求',error:'模型连接失败'};
 let recorded;
 const ctx=vm.createContext({document:{createElement:()=>new El()},...taskGlobals(taskList),messages,turnProgress:new Map(),session:{turns:[turn]},addProgress:t=>{recorded=t;return {body:new El(),controls:new El()};},addReplyActions:()=>{},turnPresentation:context.window.CanvasAssistant.turnPresentation});
 vm.runInContext(source.slice(m.index,end),ctx);ctx.drawHistory();
 assert.equal(recorded.error,'模型连接失败');assert.equal(messages.children[1].hidden,true);
});

test('失败图片任务停止自动查询，避免后台循环推进',async()=>{
 const source=fs.readFileSync(require.resolve('../static/js/canvas-assistant.js'),'utf8');
 const m=source.match(/^( *)function queueAutomatic\([^\n]*\)\{/m),end=source.indexOf('\n'+m[1]+'}',m.index)+m[1].length+2;
 const turn={id:'turn',state:'waiting_result',agent:{},proposals:[{id:'p',state:'submitted',taskStatus:'failed'}]};
 const ctx=vm.createContext({autoQueued:false,autoRunning:false,destroyed:false,busy:false,sessionLoading:false,historyShown:false,session:{id:'s',turns:[turn]},canvasId:'c',autoErrors:new Map(),refreshTasks:()=>{throw Error('失败任务不能再次执行');}});
 vm.runInContext(source.slice(m.index,end),ctx);ctx.queueAutomatic();await new Promise(r=>setImmediate(r));assert.equal(ctx.autoRunning,false);
});
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
    assert.equal(context.window.CanvasAssistant.turnPresentation('paused').canContinue,true);
    assert.equal(context.window.CanvasAssistant.turnPresentation('cancelled').canContinue,false);
});
test('等待图片确认或结果时锁定新的创作输入',()=>{
    assert.equal(context.window.CanvasAssistant.composerLocked({turns:[{state:'waiting_confirmation'}]}),true);
    assert.equal(context.window.CanvasAssistant.composerLocked({turns:[{state:'waiting_result'}]}),true);
    assert.equal(context.window.CanvasAssistant.composerLocked({turns:[{state:'completed'}]}),false);
});
test('一行进度区分真实等待和完成，已消费操作折叠且错误仍可见',()=>{
 const api=context.window.CanvasAssistant;
 assert.equal(api.progressPresentation({state:'running',steps:[{tool:'read_canvas',label:'读取画布'}]}),'正在整理素材');
 assert.equal(api.progressPresentation({state:'running',steps:[{tool:'read_project_knowledge',label:'正在校验知识快照和内部工具'}]}),'正在整理素材');
 assert.equal(api.progressPresentation({state:'running',steps:[{tool:'apply_canvas_operations'}]}),'正在保存到画布');
 assert.equal(api.progressPresentation({state:'running',steps:[{tool:'inspect_result'}]}),'正在检查结果');
 assert.equal(api.progressPresentation({state:'running',steps:[{label:'任意内部步骤名'}]}),'正在创作');
 assert.equal(api.progressPresentation({state:'completed'}),'处理记录');
 for(const state of ['failed','interrupted','cancelled','paused'])assert.equal(api.progressPresentation({state}),'处理记录','终态原因在回复中说明，不重复播报');
 assert.equal(api.progressPresentation({state:'completed',steps:[{result:{review:{status:'needs_changes'}}}]}),'作品检查发现待改进项');
 assert.equal(api.progressPresentation({state:'completed',steps:[{review:{status:'unknown'}}]}),'作品质量尚未确认');
 assert.equal(api.progressPresentation({state:'completed',steps:[{review:{proposalId:'one',status:'needs_changes'}},{review:{proposalId:'one',status:'passed'}}]}),'处理记录');
 assert.equal(api.progressPresentation({state:'completed',steps:[{review:{proposalId:'one',status:'needs_changes'}},{review:{proposalId:'two',status:'passed'}}]}),'作品检查发现待改进项');
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
 let messages,taskList;
 class El{
  constructor(tag){this.tagName=tag;this.children=[];this.parentNode=null;this.className='';this.textContent='';this.attrs={};this.classList={add:c=>this.className+=' '+c};}
  append(...items){for(const n of items){if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(x=>x!==n);n.parentNode=this;this.children.push(n);}}
  replaceChildren(...items){for(const n of this.children)n.parentNode=null;this.children=[];this.append(...items);}
  setAttribute(k,v){this.attrs[k]=v;}
  get isConnected(){return this===messages||this===taskList||!!this.parentNode?.isConnected;}
 }
 const all=el=>[el,...el.children.flatMap(all)];
 for(const state of ['running','waiting_confirmation','waiting_result','completed','failed']){
  messages=new El('div');taskList=new El('div');const turn={id:'original-turn',state,message:'需求',reply:'给用户的成果',nativeActions:state==='running'?[]:[{id:'a',action:'update',state:state==='completed'?'completed':state==='waiting_result'?'accepted':'pending',nodeId:'n',arguments:{patch:{text:'new'}}}]};let cancelBody;
  const ctx=vm.createContext({document:{createElement:tag=>new El(tag)},...taskGlobals(messages),messages,taskList,...taskGlobals(taskList),turnProgress:new Map(),session:{id:'s',turns:[turn]},canvasId:'c',busy:false,request:null,current:()=>({nodes:[]}),matches:()=>true,icons:()=>{},adapter:{},input:{},syncControls:()=>{},continueTurn:()=>{},api:async(path,body)=>{assert.equal(path,'cancel');cancelBody=body;return {};},selectSession:async()=>{turn.state='cancelled';ctx.drawHistory();},showStatus:()=>{},addReplyActions:()=>{},addProposalCard:()=>{}});
  for(const name of ['turnPresentation','progressPresentation','nativeActionAttention','addProgress','addNativeActionCard','drawHistory'])vm.runInContext(uiFunction(name),ctx);
  turn.skillsUsed=[{name:'创作知识'}];
  turn.agent={plan:{state:'completed',steps:[{state:'completed'}],budget:{used:{serviceCalls:1},limit:{serviceCalls:2}}}};
  if(['waiting_confirmation','waiting_result'].includes(state))turn.reply='';
  ctx.drawHistory();assert.equal(all(messages).some(e=>e.className==='canvas-assistant-activity'||e.attrs['aria-label']==='原生操作方案'),false,'任务记录和确认不得占用聊天区');const elements=[...all(messages),...all(taskList)],stop=elements.find(e=>e.tagName==='button'&&e.textContent==='停止本轮'),card=elements.find(e=>e.attrs['aria-label']==='原生操作方案');
  const plan=elements.find(e=>e.className==='canvas-assistant-plan');assert.ok(plan);assert.equal(plan.parentNode.className,'canvas-assistant-progress-body');
  const skills=elements.find(e=>e.className.includes('canvas-assistant-turn-skills'));assert.equal(skills.parentNode.className,'canvas-assistant-progress-body');
  if(['waiting_confirmation','waiting_result'].includes(state))assert.equal(elements.some(e=>['等待操作确认','等待图片结果'].includes(e.textContent)),false,'摘要已经说明等待状态，不再添加重复回复');
  if(state==='failed'){assert.equal(stop,undefined);assert.ok(all(taskList).some(e=>e.tagName==='button'&&e.textContent==='继续创作'),'失败回合应在任务面板提供原回合继续入口');assert.equal(all(messages).some(e=>e.tagName==='button'&&e.textContent==='继续创作'),false);}
  else if(state==='completed'){assert.equal(stop,undefined);assert.equal(card.parentNode.className,'canvas-assistant-progress-body');}
  else{assert.ok(stop,state);assert.equal(stop.parentNode.parentNode.className,'canvas-assistant-activity');assert.equal(stop.parentNode.parentNode.parentNode,taskList);await stop.onclick();assert.equal(cancelBody.requestId,'original-turn');assert.equal(cancelBody.sessionId,'s');assert.equal(turn.state,'cancelled');assert.equal(stop.isConnected,false);}
  if(state==='waiting_confirmation'){assert.equal(all(taskList).some(e=>e.textContent==='确认操作'),false);assert.ok(all(taskList).some(e=>e.textContent==='本轮已停止，方案未执行'));}
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
 const ctx=vm.createContext({document:{createElement:tag=>new El(tag)},...taskGlobals(messages),messages,canvasId:'canvas',session:{id:'session'},busy:false,request:null,matches:()=>true,current:()=>({}),adapter:{},syncControls:()=>{},continueTurn:()=>{},api:async()=>({}),selectSession:async()=>{},showStatus:()=>{},imageConfirm:{checked:true},imageModels:{value:'["assistant-mock","image-user"]'}});
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
  const ctx=vm.createContext({document:{createElement:tag=>new El(tag),body:new El('body')},...taskGlobals(messages),messages,canvasId:'c',session:{id:'s'},busy:false,current:()=>({nodes:[]}),matches:()=>true,adapter:{},nativeActionAttention:()=>true,progressPresentation:()=>'',fetch:async url=>{requested=url;return {ok:true,blob:async()=>Buffer.from('saved-media')};},URL:{createObjectURL:blob=>{assert.equal(blob.toString(),'saved-media');return 'blob:original-file';},revokeObjectURL:()=>{}},setTimeout:fn=>fn(),showStatus:message=>{throw Error(message);},api:()=>{throw Error('补下载不能请求执行接口');}});
  vm.runInContext(source.slice(m.index,end),ctx);ctx.addNativeActionCard({state:'completed',agent:{consumedNativeActions:['original-export']}},proposal,progress);
  const buttons=all(messages).filter(e=>e.tagName==='button'&&e.textContent.startsWith('下载第'));
  assert.deepEqual(buttons.map(b=>b.textContent),['下载第 1 个文件','下载第 2 个文件']);
  await buttons[1].onclick();assert.equal(requested,'/api/download-output?url=%2Foutput%2Fpart-2.mp4&name='+encodeURIComponent('镜头二.mp4'));assert.equal(downloads.at(-1).href,'blob:original-file');
  assert.equal(downloads.at(-1).name,'镜头二.mp4');assert.equal(proposal.id,'original-export');
 }
 assert.equal(downloads.length,2);
});
