const {test}=require('node:test');
const assert=require('node:assert/strict');
const model=require('../static/js/canvas-clip-model.js');
const clipHost=require('../static/js/canvas-clip-host.js');
function editor(){
 let generation=1;const canvas={id:'A'},nodes=[{id:'clip',type:'clip',x:0,y:0,w:760,clipData:model.createData()}],connections=[];let undo=0,saves=0;
 const host=clipHost.create({getState:()=>({canvas,nodes,connections,generation,scale:1}),uid:(p)=>p+'-'+nodes.length+'-'+connections.length,pushUndo:()=>undo++,save:()=>saves++,render(){},select(){},model});
 return {host,nodes,connections,canvas,next(){generation++},get counts(){return{undo,saves}}};
}
test('真实输出类型过滤，多结果和单素材快照身份稳定',()=>{
 const image={id:'im',type:'image',url:'/output/a.png'};
 const a=clipHost.mediaForNode(image),b=clipHost.mediaForNode({...image,url:'/output/b.png'});
 assert.equal(a[0].sourceResultId,b[0].sourceResultId);
 const list=clipHost.mediaForNode({id:'out',type:'output',images:[{url:'/output/a.mp4',kind:'video'},'/output/b.png',{url:'/output/c.mp3',kind:'audio'}]});
 assert.deepEqual(list.map(x=>x.kind),['video','image']);assert.notEqual(list[0].sourceResultId,list[1].sourceResultId);
 assert.deepEqual(clipHost.mediaForNode({id:'empty',type:'video'}),[]);
});
test('剪辑结果回画布复用同来源，切画布及A-B-A不会写入',()=>{
 const e=editor(),h=e.host.forNode('clip'),ctx=h.getContext();
 h.output('clip',[{url:'/output/real.mp4',durationSeconds:2,sourceClipId:null,name:'成片'}],ctx);
 assert.equal(e.nodes.length,2);assert.equal(e.connections.length,1);
 h.output('clip',[{url:'/output/repeat.mp4',durationSeconds:3,sourceClipId:null,name:'成片'}],ctx);
 assert.equal(e.nodes.length,2);assert.equal(e.nodes[1].images[0].url,'/output/repeat.mp4');
 e.next();e.canvas.id='B';e.next();e.canvas.id='A';
 assert.equal(h.output('clip',[{url:'/output/stale.mp4',durationSeconds:3}],ctx),false);
 assert.equal(e.nodes[1].images[0].url,'/output/repeat.mp4');
});
test('多结果源删除前项再追加新结果，不复用数组下标身份',()=>{
 const original=clipHost.mediaForNode({id:'source',type:'output',images:['/output/a.png','/output/b.png']});
 const changed=clipHost.mediaForNode({id:'source',type:'output',images:['/output/b.png','/output/c.png']});
 assert.equal(original[1].sourceResultId,changed[0].sourceResultId);
 const data=model.syncSources(model.syncSources(model.createData(),original),changed);
 assert.deepEqual(data.clips.map(c=>c.url),['/output/a.png','/output/b.png','/output/c.png']);
});
test('编辑独立撤销重做、只读不写且嵌套源URL纳入引用',()=>{
 const e=editor(),h=e.host.forNode('clip');const next=model.addMedia(e.nodes[0].clipData,{kind:'image',url:'/assets/p.png'});
 h.commit('clip',next);assert.equal(e.nodes[0].clipData.clips.length,1);
 h.undo();assert.equal(e.nodes[0].clipData.clips.length,0);h.redo();assert.equal(e.nodes[0].clipData.clips.length,1);
 assert.deepEqual(clipHost.collectUrls(e.nodes[0]),['/assets/p.png']);
 e.canvas.readOnly=true;assert.equal(h.commit('clip',model.createData()),false);assert.equal(e.nodes[0].clipData.clips.length,1);
});
test('复制剪辑及输出重映射来源、仅复制输出解除旧归属',()=>{
 const data=model.addMedia(model.createData(),{kind:'video',url:'/output/v.mp4',sourceNodeId:'src',sourceResultId:'one',durationSeconds:2});
 const clip={id:'newClip',type:'clip',clipData:data},out={id:'newOut',type:'output',sourceClipNodeId:'oldClip',sourceClipId:data.clips[0].id,images:[]};
 clipHost.remapCopies([clip,out],new Map([['oldClip','newClip'],['src','newSrc']]));
 assert.equal(clip.clipData.clips[0].sourceNodeId,'newSrc');assert.equal(out.sourceClipNodeId,'newClip');assert.equal(out.sourceClipId,clip.clipData.clips[0].id);
 const only={id:'onlyOut',type:'output',sourceClipNodeId:'oldClip',images:[]};clipHost.remapCopies([only],new Map([['oldOut','onlyOut']]));assert.equal(only.sourceClipNodeId,undefined);
});

test('视频时长探测期间到达的第二批结果，在探测完成后自动补入',async()=>{
 let finishProbe;
 const nodes=[{id:'clip',type:'clip',clipData:model.createData()},{id:'out',type:'output',images:[{url:'/output/first.mp4',kind:'video'}]}];
 const host=clipHost.create({model,getState:()=>({canvas:{id:'A'},generation:1,nodes,connections:[{from:'out',to:'clip'}]}),
  probeDuration:()=>new Promise(resolve=>{finishProbe=resolve}),save(){},render(){},pushUndo(){}});
 host.syncConnected();
 nodes[1].images.push({url:'/output/second.png',kind:'image'});
 host.syncConnected();finishProbe(2);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(nodes[0].clipData.clips.map(c=>c.url),['/output/first.mp4','/output/second.png']);
});
