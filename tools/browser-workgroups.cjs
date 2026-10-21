/* Real canvas browser verification. Run against tools/verify-workgroups.py only. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const workspace=process.argv[2];
if(!workspace)throw new Error('Pass the isolated verification workspace');
const cases=JSON.parse(fs.readFileSync(path.join(workspace,'cases.json'),'utf8'));
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});const results=[];
 try{for(const c of cases){
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(c.url);await page.waitForSelector('.cw-tag');await page.waitForTimeout(500);
  const smart=c.kind==='smart',selector=smart?'.image-node':'.node';
  await page.evaluate(smart=>{
   nodes=['p','i','p2','i2'].map((id,index)=>({id,type:id.startsWith('p')?(smart?'smart-prompt':'prompt'):(smart?'smart-image':'image'),x:0,y:0,w:260,h:200,title:id,text:id.startsWith('p')?'完整的镜头提示词':'',...(id.startsWith('i')?(smart?{images:[{url:'/assets/output/creative-flow-'+(id==='i'?'old':'result')+'.png'}]}:{url:'/assets/output/creative-flow-'+(id==='i'?'old':'result')+'.png'}):{})}));
   for(const n of nodes){const index=['p','i','p2','i2'].indexOf(n.id);n.x=index%2?450:120;n.y=index>1?440:160;if(n.id==='p'){n.text='女孩站在书店门前，暖色电影灯光';n.nodeTag='人物';}}
   if(smart){canvas.connections=[];selectedId='';selectedIds=[];}else{connections=[];selected.clear();}
   viewport={x:30,y:30,scale:.8};applyViewport();render();scheduleSave();
  },smart);
  await page.waitForTimeout(1000);
  const node=id=>page.locator(`${selector}[data-id="${id}"]`);
  const snapshot=()=>page.evaluate(()=>JSON.parse(JSON.stringify({nodes,connections:typeof connections==='undefined'?canvas.connections:connections})));
  // Hover-only label, custom category, and persistence use native save/reload.
  await page.mouse.move(1000,700);assert.equal(await node('p').locator('.cw-tag').evaluate(el=>getComputedStyle(el).opacity),'0');
  await node('p').hover();await node('p').locator('.cw-tag').click();await page.getByRole('button',{name:'道具',exact:true}).click();
  await node('p').hover();await node('p').locator('.cw-tag').click();await page.getByRole('textbox',{name:'自定义标签',exact:true}).fill('主角参考');await page.getByRole('button',{name:'添加',exact:true}).click();
  assert.equal((await snapshot()).nodes.find(n=>n.id==='p').nodeTag,'主角参考');await page.waitForTimeout(1000);await page.reload();await page.waitForSelector('.cw-tag');
  assert.equal((await snapshot()).nodes.find(n=>n.id==='p').nodeTag,'主角参考');
  // Ctrl marquee via real pointer events.
  await page.keyboard.down('Control');await page.mouse.move(100,125);await page.mouse.down();await page.mouse.move(635,615,{steps:12});await page.mouse.up();await page.keyboard.up('Control');
  await page.getByRole('toolbar',{name:'框选工具栏',exact:true}).waitFor();
  const before=(await snapshot()).nodes.filter(n=>!n.groupMode);assert.equal(before.length,4);
  await page.getByRole('button',{name:'布局',exact:true}).click();await page.getByRole('button',{name:'水平',exact:true}).click();
  assert.equal(new Set((await snapshot()).nodes.map(n=>n.y)).size,1);
  await page.getByRole('button',{name:'布局',exact:true}).click();await page.getByRole('button',{name:'宫格',exact:true}).click();
  await page.getByRole('button',{name:'打组',exact:true}).click();await page.locator('.cw-frame').waitFor();
  let state=await snapshot(),group=state.nodes.find(n=>n.groupMode==='frame');assert.equal(group.items.length,4);assert.equal(state.nodes.length,5);
  assert.equal(await page.locator('.cw-frame').evaluate(el=>getComputedStyle(el).backgroundColor.includes('0)')),false);
  await page.getByRole('button',{name:'颜色',exact:true}).click();await page.getByRole('button',{name:'灰绿',exact:true}).click();assert.equal((await snapshot()).nodes.find(n=>n.id===group.id).groupColor,'#527c72');
  await page.getByRole('button',{name:'布局',exact:true}).click();await page.getByRole('button',{name:'垂直',exact:true}).click();
  assert.equal(new Set((await snapshot()).nodes.filter(n=>!n.groupMode).map(n=>n.x)).size,1);
  await page.getByRole('button',{name:'布局',exact:true}).click();await page.getByRole('button',{name:'宫格',exact:true}).click();
  // Group download must produce a real browser download with ZIP bytes.
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'批量下载',exact:true}).click();const download=await event;await download.saveAs(path.join(workspace,c.kind+'-assets.zip'));assert.ok(fs.statSync(path.join(workspace,c.kind+'-assets.zip')).size>200);
  // Native prompt editing remains available inside a permanent group.
  const input=node('p').locator('textarea').first();await input.fill('组内编辑后的完整提示词');await input.blur();
  assert.equal((await snapshot()).nodes.find(n=>n.id==='p').text,'组内编辑后的完整提示词');
  // Select group using the controller's public selection host only for navigation; all actions use UI.
  await page.evaluate(smart=>{if(smart){selectedIds=[];selectedId=nodes.find(n=>n.groupMode==='frame').id;syncSelectionUi();}else{selected.clear();selected.add(nodes.find(n=>n.groupMode==='frame').id);refreshSelectionVisuals();}},smart);
  await page.getByRole('button',{name:'创建工作流',exact:true}).click();await page.locator('.cw-dialog input[name=name]').fill('分组验收-'+c.kind);
  await page.locator('.cw-dialog input[name=cover]').setInputFiles(path.join(workspace,'data/media/output/creative-flow-old.png'));
  const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/canvas-workflows/export-to-library')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'保存工作流',exact:true}).click();await page.locator('.cw-dialog').waitFor({state:'detached',timeout:15000});
  const saved=await (await savedResponse).json();assert.ok(saved.item.cover_url.startsWith('/api/storage-files/local/'));assert.ok((await page.request.get(new URL(saved.item.cover_url,c.url).href)).ok());
  const original=(await snapshot()).nodes.map(n=>n.id);
  await page.evaluate(async ({smart,url})=>{const r=await fetch(url),blob=await r.blob(),file=new File([blob],'workgroup.zip',{type:'application/zip'});if(smart)await importSmartWorkflowFile(file);else await importWorkflowFile(file);},{smart,url:saved.item.url});
  state=await snapshot();const imported=state.nodes.filter(n=>!original.includes(n.id)),importedGroup=imported.find(n=>n.groupMode==='frame');assert.equal(imported.length,5);assert.ok(importedGroup.items.every(id=>imported.some(n=>n.id===id)));assert.ok(imported.some(n=>n.nodeTag==='主角参考'));
  await page.evaluate(({smart,original})=>{nodes=nodes.filter(n=>original.includes(n.id));if(smart){selectedId='';selectedIds=[];}else selected.clear();render();scheduleSave();},{smart,original});
  await page.waitForTimeout(1000);await page.reload();await page.waitForSelector('.cw-frame');state=await snapshot();assert.equal(state.nodes.find(n=>n.id==='p').nodeTag,'主角参考');assert.equal(state.nodes.find(n=>n.id==='p').text,'组内编辑后的完整提示词');
  await page.evaluate(smart=>{if(smart){selectedIds=[];selectedId=nodes.find(n=>n.groupMode==='frame').id;syncSelectionUi();}else{selected.clear();selected.add(nodes.find(n=>n.groupMode==='frame').id);refreshSelectionVisuals();}},smart);
  await page.screenshot({path:path.join(workspace,c.kind+'-group.png')});await page.getByRole('button',{name:'解组',exact:true}).click();assert.equal((await snapshot()).nodes.length,4);assert.equal(await page.locator('.cw-frame').count(),0);
  await page.evaluate(smart=>{
   const n={id:'down',type:smart?'smart-prompt':'llm',x:1000,y:200,w:260,h:240,text:'',llmEnabled:true,llmProvider:'flow-mock',llmModel:'flow-text',model:'flow-text'};nodes.push(n);
   if(smart){selectedIds=['p','i'];selectedId='';}else{selected.clear();['p','i'].forEach(id=>selected.add(id));}render();
  },smart);
  async function drag(from,to){const a=await from.boundingBox(),b=await to.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:10});await page.mouse.up();}
  await drag(page.locator('.cw-total-port.cw-out'),node('down'));
  state=await snapshot();assert.equal(state.connections.filter(e=>e.to==='down').length,2);assert.equal(await page.locator('.cw-selection').count(),0);assert.equal(state.nodes.filter(n=>n.groupMode==='frame').length,0);
  await page.evaluate(smart=>{if(smart){canvas.connections=[];selectedIds=['p','i'];selectedId='';}else{connections=[];selected.clear();['p','i'].forEach(id=>selected.add(id));}render();},smart);
  await page.getByRole('button',{name:'打组',exact:true}).click();
  await drag(page.locator('.cw-frame [data-port=out]'),node('down'));
  state=await snapshot();group=state.nodes.find(n=>n.groupMode==='frame');assert.equal(state.connections.length,1);assert.equal(state.connections[0].from,group.id);
  const old=state.nodes.find(n=>n.id==='p'),frameBox=await page.locator('.cw-frame').boundingBox();
  await page.mouse.move(frameBox.x+12,frameBox.y+frameBox.height-12);await page.mouse.down();await page.mouse.move(frameBox.x+52,frameBox.y+frameBox.height+18,{steps:8});await page.mouse.up();
  state=await snapshot();assert.equal(Math.round(state.nodes.find(n=>n.id==='p').x-old.x),50);assert.equal(Math.round(state.nodes.find(n=>n.id==='p').y-old.y),38);
  await page.getByRole('button',{name:'解组',exact:true}).click();state=await snapshot();assert.equal(state.connections.filter(e=>e.to==='down').length,2);assert.equal(new Set(state.connections.map(e=>e.id)).size,state.connections.length);
  await page.mouse.click(1200,800);await page.keyboard.press('Control+z');assert.equal((await snapshot()).nodes.filter(n=>n.groupMode==='frame').length,1);
  results.push({kind:c.kind,connections:'temporary fan-out clears selection, permanent single bus, group drag, ungroup expands edges, undo restores group'});
  // Execute a shared-upstream native LLM graph once per node, then inject a rejected call.
  const llmCalls=[];let reject=false;
  await page.route('**/api/canvas-llm',async route=>{const body=route.request().postDataJSON();llmCalls.push(body);await route.fulfill({status:reject?422:200,contentType:'application/json',body:JSON.stringify(reject?{detail:'模拟模型拒绝'}:{text:'本次新输出-'+llmCalls.length})});});
  await page.evaluate(smart=>{
   nodes=[{id:'p',type:smart?'smart-prompt':'prompt',x:120,y:200,w:240,h:200,text:'本次新的输入'}];
   for(const [i,id] of ['a','b','c'].entries())nodes.push({id,type:smart?'smart-prompt':'llm',x:450+i*300,y:200,w:260,h:240,text:'',llmEnabled:true,llmProvider:'flow-mock',llmModel:'flow-text',model:'flow-text',systemPrompt:'整理输入',llmInstruction:'整理输入'});
   const edges=[{id:'pa',from:'p',to:'a'},{id:'ab',from:'a',to:'b'},{id:'pc',from:'p',to:'c'}];
   if(smart)edges.forEach(c=>c.kind='input');
   if(smart){canvas.connections=edges;selectedIds=nodes.map(n=>n.id);selectedId='';}else{connections=edges;selected.clear();nodes.forEach(n=>selected.add(n.id));}render();
  },smart);
  await page.getByRole('button',{name:'打组',exact:true}).click();await page.getByRole('button',{name:'整组执行',exact:true}).click();
  await page.waitForFunction(smart=>!nodes.some(n=>n.running)&&nodes.filter(n=>['a','b','c'].includes(n.id)).every(n=>smart?String(n.text).startsWith('本次新输出-'):String(n.outputText).startsWith('本次新输出-')),smart);
  assert.equal(llmCalls.length,3);assert.ok(llmCalls[0].message.includes('本次新的输入'));assert.ok(llmCalls[1].message.includes('本次新输出-1'));
  await page.evaluate(smart=>{const g=nodes.find(n=>n.groupMode==='frame');nodes.push({id:'loop',type:smart?'smart-loop':'loop',x:120,y:500,w:260,h:180,count:2,loopStart:1,mode:'serial'});g.items.push('loop');const edge={id:'la',from:'loop',to:'a',...(smart?{kind:'input'}:{})};if(smart)canvas.connections.push(edge);else connections.push(edge);render();},smart);
  await page.getByRole('button',{name:'整组执行',exact:true}).click();await page.waitForFunction(()=>nodes.filter(n=>['a','b','c'].includes(n.id)).every(n=>!n.running));await page.waitForTimeout(700);assert.equal(llmCalls.length,8,'loop chain repeats twice; independent node runs once');
  reject=true;await page.getByRole('button',{name:'整组执行',exact:true}).click();await page.waitForTimeout(700);assert.equal(llmCalls.length,9,'first failed call must stop downstream calls');
  results.push({kind:c.kind,execution:'native LLM dependency order, shared upstream once, rejected call stops downstream'});
  assert.deepEqual(errors,[]);results.push({kind:c.kind,passed:['hover label','custom label save/reload','Ctrl marquee','horizontal/grid/vertical','group preserves members','color','ZIP browser download','edit group member','workflow library save','group reload','ungroup'],errors});await page.close();
 }
 fs.writeFileSync(path.join(workspace,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
