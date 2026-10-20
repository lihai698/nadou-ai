const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
function fn(file,name){const source=fs.readFileSync(require.resolve('../static/js/'+file),'utf8');const start=source.indexOf('function '+name+'(');return source.slice(source.lastIndexOf('\n',start)+1,source.indexOf('\n}',start)+2);}
for(const kind of ['classic','smart']){
 test(`${kind}: real wrapper forwards destructured defaults and retains 500 log cap`,()=>{
  let sounds=0,saves=0;const canvas={logs:Array.from({length:500},(_,id)=>({id:'old'+id}))};
  const context=createTaskContext({canvas,uid:()=> 'new',playGenerationCompleteSound:()=>sounds++,runPlatformLabel:()=> 'p',runTaskLabel:()=> 'm',smartRunPlatformLabel:()=> 'p',smartRunTaskLabel:()=> 'm',smartRunRequestMeta:()=> ({}),resultMediaUrls:x=>x,copyMediaSizeFields:(x,y)=>({...y,width:x.width}),outputUrlValue:x=>x.url,recoverStuckLoopOutputsFromLogs:()=>false,scheduleSave:()=>saves++});
  const name=kind==='classic'?'addGenerationLog':'addSmartGenerationLog';vm.runInContext(fn(kind==='classic'?'canvas.js':'smart-canvas.js',name),context);
  context[name]({run:{prompt:'prompt'}});assert.equal(canvas.logs.length,500);assert.equal(canvas.logs[0].runMs,0);assert.equal(canvas.logs[0].outputs.length,0);assert.equal(sounds,0);
  context[name]({run:{},outputs:[{url:'/output/a.png',width:20}]});assert.equal(canvas.logs[0].outputs[0].url,'/output/a.png');assert.equal(sounds,1);assert.equal(saves,kind==='smart'?2:0);
 });
 test(`${kind}: pending save finishes before log deletion with updated version`,async()=>{
  const order=[],canvas={id:'fixture',updated_at:1,logs:[{id:'log'}]},scheduler={pending:true,cancel(){order.push('cancel');}};
  const context=createTaskContext({canvas,canvasId:'fixture',localCanvasDirty:true,lastCanvasUpdatedAt:1,classicSaveScheduler:scheduler,smartSaveScheduler:scheduler,confirm:()=>true,tr:x=>x,saveCanvas:async()=>{order.push('save');canvas.updated_at=9;},fetch:async(url,options)=>{order.push('delete');const body=JSON.parse(options.body);assert.equal(body.base_updated_at,9);assert.equal(body.reset_referencing_nodes,true);return {ok:true,json:async()=>({canvas:{logs:[],updated_at:10}})};},document:{getElementById:()=>null},logList:null,smartLogList:{querySelectorAll:()=>[]},refreshIcons(){},setStatus(){},toast(){}});
  vm.runInContext(fn(kind==='classic'?'canvas.js':'smart-canvas.js','deleteCanvasLogEntry'),context);await context.deleteCanvasLogEntry('log',true);assert.deepEqual(order,['cancel','save','delete']);assert.equal(canvas.logs.length,0);assert.equal(canvas.updated_at,10);
 });
}
