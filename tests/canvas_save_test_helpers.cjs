// Load the production state and timer owners for tests executing editor sections.
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=readFileSync(path.join(__dirname,'../static/js/canvas-save-session.js'),'utf8');
const schedulerSource=readFileSync(path.join(__dirname,'../static/js/canvas-save-scheduler.js'),'utf8');
function attachSaveState(context,kind){
    if(kind!=='classic' && kind!=='smart') throw new Error('Unknown editor kind');
    vm.runInContext(source,context);
    context[`${kind}SaveSession`]=context.CanvasSaveSession.create({clearQueuedOnBegin:kind==='classic'});
    vm.runInContext(schedulerSource,context);
    const identity=kind==='classic' ? 'canvas?.id || null' : 'canvasId';
    vm.runInContext(`globalThis.${kind}SaveScheduler=CanvasSaveScheduler.create({
        save:()=>saveCanvas(),getCanvasId:()=>${identity},
        setTimer:(fn,delay)=>setTimeout(fn,delay),clearTimer:id=>clearTimeout(id)
    });`,context);
    return context[`${kind}SaveSession`];
}
module.exports={attachSaveState};
