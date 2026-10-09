const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const source=readFileSync(require('node:path').join(__dirname,'../static/js/canvas.js'),'utf8');
function section(a,b){return source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));}
test('剪辑真实创建入口使用原生addNode、30fps纯数据和正确尺寸',()=>{
 const c=vm.createContext({window:{CanvasClipModel:require('../static/js/canvas-clip-model.js')},uid:()=> 'clip-new',defaultPoint:()=>({x:3,y:4}),addNode:n=>n});
 assert.ok(source.includes('function addClipNode('),'剪辑创建函数尚未实现');
 vm.runInContext(section('function addClipNode(','function addPromptNode('),c);
 const n=vm.runInContext('addClipNode({x:12,y:13})',c);assert.equal(n.type,'clip');assert.equal(n.x,12);assert.equal(n.clipData.fps,30);assert.equal(n.clipData.exportMuted,false);
});
test('剪辑连线接受媒体源及输出，拒绝提示词和环路',()=>{
 const nodes=[{id:'c',type:'clip'},{id:'im',type:'image'},{id:'vid',type:'video'},{id:'out',type:'output'},{id:'prompt',type:'prompt'}];
 const c=vm.createContext({nodes,CANVAS_GENERATOR_TYPES:['video'],CANVAS_MEDIA_OUTPUT_TYPES:['video'],wouldCreateGeneratorCycle:(a,b)=>a==='out'&&b==='c'});
 vm.runInContext(section('function canConnect(','function sanitizeConnections('),c);
 assert.equal(vm.runInContext("canConnect('im','c')",c),true);assert.equal(vm.runInContext("canConnect('vid','c')",c),true);
 assert.equal(vm.runInContext("canConnect('c','out')",c),true);assert.equal(vm.runInContext("canConnect('prompt','c')",c),false);assert.equal(vm.runInContext("canConnect('out','c')",c),false);
});
test('画布缺失检查收集剪辑嵌套素材及预览URL',()=>{
 const nodes=[{id:'c',type:'clip',clipData:{clips:[{url:'/assets/p.png',posterUrl:'/output/p.jpg'},{url:'/api/storage-files/generated/v.mp4'}]}}];
 const c=vm.createContext({nodes,canvas:{logs:[]},window:{CanvasClipHost:require('../static/js/canvas-clip-host.js')},outputUrlValue:i=>typeof i==='string'?i:i?.url});
 vm.runInContext(section('function canvasLocalAssetUrls(','async function refreshMissingCanvasAssets('),c);
 assert.deepEqual(Array.from(vm.runInContext('canvasLocalAssetUrls()',c)),['/assets/p.png','/output/p.jpg','/api/storage-files/generated/v.mp4']);
});
test('生成结果局部刷新后，已连接的剪辑轴自动接入新增真实素材',async()=>{
 const model=require('../static/js/canvas-clip-model.js'),Host=require('../static/js/canvas-clip-host.js');
 const nodes=[{id:'c',type:'clip',clipData:model.createData()},{id:'out',type:'output',images:[]}],connections=[{id:'edge',from:'out',to:'c'}];
 const bridge=Host.create({model,getState:()=>({canvas:{id:'qa'},nodes,connections,generation:1,scale:1}),pushUndo(){},save(){},render(){}});
 const noop=()=>{},c=vm.createContext({nodes,window:{CanvasClipBridge:bridge},captureOutputScrolls:()=>({}),applyViewport:noop,refreshOutputNodeContent:()=>true,restoreOutputScrolls:noop,refreshGeometry:noop,refreshGeometryAfterLayout:noop,refreshIcons:noop,bindCanvasPreviewImageFallbacks:noop,syncCanvasSelectedImageResolution:noop,measureCanvasOriginalImageNodes:noop,refreshOutputTimer:noop,nodesEl:{}});
 vm.runInContext(section('function refreshNodes(','function refreshRunNodes('),c);
 nodes[1].images.push({url:'/output/real.png',kind:'image'});vm.runInContext("refreshNodes(['out'])",c);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(nodes[0].clipData.clips.length,1);assert.equal(nodes[0].clipData.clips[0].url,'/output/real.png');
});

test('剪辑加号同时列出当前画布图片视频与资产库素材',()=>{
 const source=readFileSync(require('node:path').join(__dirname,'../static/js/canvas.js'),'utf8');
 const start=source.indexOf('function canvasClipMediaItems('),end=source.indexOf('function initCanvasClipBridge(',start);
 assert.ok(start>=0&&end>start,'缺少剪辑素材候选整理函数');
 const c=vm.createContext({window:{CanvasClipHost:{mediaForNode:(node,nodes)=>{
   if(node.type==='image'&&node.url)return [{kind:node.mediaKind||'image',url:node.url,name:node.name,sourceNodeId:node.id,sourceResultId:'primary'}];
   if(node.type==='output')return (node.images||[]).map((item,i)=>({kind:item.kind||'image',url:item.url,name:item.name,sourceNodeId:node.id,sourceResultId:item.id||item.url}));
   return [];
 }}}});
 vm.runInContext(source.slice(start,end),c);
 const result=vm.runInContext(`canvasClipMediaItems(
   [{id:'canvas-image',type:'image',url:'/assets/canvas.png',name:'画布图片'},
    {id:'canvas-video',type:'image',url:'/assets/canvas.mp4',mediaKind:'video',name:'画布视频'},
    {id:'canvas-output',type:'output',images:[{url:'/output/generated.png',kind:'image',name:'生成图片'}]}],
   [{url:'/assets/library.png',kind:'image',name:'资产库图片'}],[]
 )`,c);
 assert.equal(JSON.stringify(result.map(item=>item.url)),JSON.stringify(['/assets/canvas.png','/assets/canvas.mp4','/output/generated.png','/assets/library.png']));
});
