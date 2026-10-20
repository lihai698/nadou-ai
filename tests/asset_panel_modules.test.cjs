const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
function fn(file,name){const s=fs.readFileSync(require.resolve('../static/js/'+file),'utf8');const p=s.indexOf('function '+name+'(');return s.slice(s.lastIndexOf('\n',p)+1,s.indexOf('\n}',p)+2);}
test('classic asset load forwards destructured renderPanel=false and updates live selection',async()=>{
 const library={active_library_id:'lib',libraries:[{id:'lib',categories:[{id:'cat',type:'image',items:[]}]}]};let errors=0,renderReads=0;
 const ctx=createTaskContext({canvasAssetLibrary:{libraries:[]},localCanvasAssetLibrary:{items:[]},activeCanvasAssetLibraryId:'',activeCanvasAssetCategoryId:'',LOCAL_CANVAS_ASSET_LIBRARY_ID:'local',fetch:async url=>({ok:true,json:async()=>url==='/api/asset-library'?{library}:{items:[],tree:null}}),setStatus:()=>errors++});
 Object.defineProperty(ctx,'canvasAssetPanel',{get(){renderReads++;return null;}});vm.runInContext(fn('canvas.js','loadCanvasAssetLibrary'),ctx);
 assert.ok(await ctx.loadCanvasAssetLibrary({renderPanel:false}));assert.equal(ctx.activeCanvasAssetLibraryId,'lib');assert.equal(ctx.activeCanvasAssetCategoryId,'cat');assert.equal(errors,0);assert.equal(renderReads,0);
});
test('smart asset real host preserves WebSocket constructor and canvas update callback',()=>{
 let socket,unload,updates=0,closed=0;const w={location:{host:'fixture.test'},addEventListener:(name,cb)=>{if(name==='beforeunload')unload=cb;}};w.parent=w;
 class Socket{constructor(url){this.url=url;socket=this;}close(){closed++;}}
 const ctx=createTaskContext({window:w,location:{protocol:'https:'},smartClientId:'fixture',WebSocket:Socket,handleCanvasUpdatedMessage:()=>updates++,clearTimeout(){},setTimeout:()=>1});vm.runInContext(fn('smart-canvas.js','connectAssetLibrarySyncSocket'),ctx);ctx.connectAssetLibrarySyncSocket();assert.equal(socket.url,'wss://fixture.test/ws/stats?client_id=fixture');socket.onmessage({data:JSON.stringify({type:'canvas_updated'})});assert.equal(updates,1);unload();assert.equal(closed,1);
});
test('smart asset sync ignores stale revisions and schedules fresh ones',()=>{
 let scheduled=0;const ctx=createTaskContext({assetLibraryUpdatedAt:10,assetLibraryRefreshTimer:null,clearTimeout(){},setTimeout:()=>++scheduled});vm.runInContext(fn('smart-canvas.js','handleAssetLibraryUpdatedMessage'),ctx);ctx.handleAssetLibraryUpdatedMessage({updated_at:9});assert.equal(scheduled,0);ctx.handleAssetLibraryUpdatedMessage({updated_at:11});assert.equal(scheduled,1);
});
