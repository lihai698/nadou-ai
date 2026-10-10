const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const classic = readFileSync(path.join(root, 'static/js/canvas.js'), 'utf8');
const smart = readFileSync(path.join(root, 'static/js/smart-canvas.js'), 'utf8');
function fn(source, name) {
  const match = source.match(new RegExp('(?:async )?function ' + name + '\\([^\\n]*\\).*?\\n\\}', 's'));
  assert.ok(match, name);
  return match[0];
}
function manual(id) {
  const index = JSON.parse(readFileSync(path.join(root, 'skills/canvas-assistant/project-knowledge/index.json'), 'utf8'));
  const item = index.entries.find(e => e.id === id);
  return readFileSync(path.join(root, 'skills/canvas-assistant/project-knowledge', item.file), 'utf8');
}
test('普通循环按连接和分组成员顺序轮换，上游文本覆盖本地文本', () => {
  const ctx = vm.createContext({nodes:[{id:'a',type:'prompt',text:'A'},{id:'b',type:'prompt',text:'B'},{id:'g',type:'promptGroup',items:['b','a']}],connections:[{from:'g',to:'loop'}],loopContext:null,loopPromptVisiting:new Set(),tr:k=>k});
  for (const name of ['loopCount','loopInputPromptItems','loopInputPrompt','renderLoopPrompt']) vm.runInContext(fn(classic,name),ctx);
  const result = vm.runInContext("[1,2,3].map(index=>renderLoopPrompt({id:'loop',count:3,showPrompt:true,variablePrompt:'local'}, {index,total:3}))",ctx);
  assert.deepEqual(Array.from(result),['B','A','B']);
  assert.ok(manual('classic.loop').includes('上游提示词优先'));
});
test('智能循环保留上游与本地文本组合，普通规则不可套用', () => {
  const ctx = vm.createContext({smartLoopContext:null,smartLoopPromptVisiting:new Set(),inputNodesFor:()=>[{text:'upstream'}],promptTextItemsForNode:n=>[n.text],splitSmartPromptItems:s=>[s],tr:k=>k,smartLoopCount:n=>n.count});
  for (const name of ['smartLoopPromptFieldValues','smartLoopActivePromptFieldValues','smartLoopDefaultPromptText','isSmartLoopDefaultPrompt','smartLoopSelectedLocalPrompt','smartLoopInputPromptItems','smartLoopSelectedInputPrompt','smartLoopPrompt']) vm.runInContext(fn(smart,name),ctx);
  assert.equal(vm.runInContext("smartLoopPrompt({id:'s',count:2,showPrompt:true,variablePrompts:['镜头《计数》','细节《计数》']},{index:2,total:2})",ctx),'upstream\n\n细节2');
  assert.ok(manual('smart.loop').includes('上游与有效本地文本'));
});
test('普通输入顺序保留已有inputs并追加新来源，output采用最后可用结果', () => {
  const ctx = vm.createContext({nodes:[{id:'o',type:'output',images:['/output/old.png','/output/new.png']},{id:'p',type:'prompt',text:'text'}],connections:[{from:'p',to:'g'},{from:'o',to:'g'}],CANVAS_MEDIA_OUTPUT_TYPES:[],outputUrlValue:v=>typeof v==='string'?v:v.url,mediaKindForOutputItem:()=> 'image'});
  for (const name of ['generatorSources','orderedSources']) vm.runInContext(fn(classic,name),ctx);
  const result = JSON.parse(vm.runInContext("JSON.stringify(orderedSources({id:'g',inputs:['o']},generatorSources({id:'g'})))",ctx));
  assert.equal(result[0].id,'o');
  assert.equal(result[0].refs[0].url,'/output/new.png');
  assert.equal(result[1].id,'p');
  assert.ok(manual('classic.output').includes('最新可用一项'));
});
test('剪辑30fps和默认工程与知识卡片一致', () => {
  const clip = require('../static/js/canvas-clip-model.js');
  const data = clip.createData();
  assert.equal(data.fps,30);
  const added = clip.addMedia(data,{kind:'video',url:'/output/a.mp4',durationSeconds:2});
  assert.equal(added.clips[0].endFrame,60);
  assert.ok(manual('classic.clip').includes('fps=30'));
});
test('Midjourney结果态控件遵循原任务、单图和版本规则', () => {
  const ctx=vm.createContext({});
  vm.runInContext(fn(classic,'midjourneyContinuationHtml'),ctx);
  function html(node) {ctx.node=node;return vm.runInContext('midjourneyContinuationHtml(node)',ctx);}
  assert.equal(html({}), '');
  assert.equal(html({lastTaskId:'t',lastAction:'blend'}),'');
  assert.equal(html({lastTaskId:'t',mjModalTaskId:'modal'}),'');
  const grid=html({lastTaskId:'t',lastImageCount:4,version:'6.1'});
  assert.ok(grid.includes('data-mj-action="upscale"'));
  assert.ok(grid.includes('data-mj-action="variation"'));
  const v8=html({lastTaskId:'t',lastImageCount:4,version:'8.2'});
  assert.ok(v8.includes('remix_subtle') && v8.includes('remix_strong'));
  const single=html({lastTaskId:'t',lastImageCount:1});
  assert.ok(single.includes('data-mj-action="zoom"') && single.includes('data-mj-action="pan"'));
  assert.ok(!single.includes('data-direction="down"'));
  assert.ok(manual('classic.midjourney').includes('当前没有向下按钮'));
});
