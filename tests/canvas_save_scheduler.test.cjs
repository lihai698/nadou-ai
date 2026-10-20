const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname,'../static/js/canvas-save-scheduler.js'),'utf8'),context);
function clock(){
    let next=0;const jobs=new Map(),cancelled=[];
    return {jobs,cancelled,setTimer(callback,delay){const id=next++;jobs.set(id,{callback,delay});return id;},
        clearTimer:id=>cancelled.push(id),fire:id=>jobs.get(id).callback()};
}
function setup(){
    const timer=clock(),calls=[];let id='a';
    const scheduler=context.CanvasSaveScheduler.create({save:()=>calls.push(id),getCanvasId:()=>id,...timer});
    return {timer,calls,scheduler,changeId:value=>{id=value;}};
}
test('debounce cancels earlier callbacks and executes only the latest schedule',()=>{
    const h=setup();h.scheduler.schedule(500);h.scheduler.schedule(450);
    assert.equal(h.scheduler.pending,true);assert.deepEqual(h.timer.cancelled,[0]);
    h.timer.fire(0);assert.deepEqual(h.calls,[]);assert.equal(h.scheduler.pending,true);
    h.timer.fire(1);assert.deepEqual(h.calls,['a']);assert.equal(h.scheduler.pending,false);
    assert.equal(h.timer.jobs.get(1).delay,450);
});
test('pending is cleared before invoking the save callback',()=>{
    const timer=clock();let scheduler;
    scheduler=context.CanvasSaveScheduler.create({getCanvasId:()=> 'a',save:()=>assert.equal(scheduler.pending,false),...timer});
    scheduler.schedule(0);timer.fire(0);
});
test('cancel invalidates a callback even if it was already queued',()=>{
    const h=setup();h.scheduler.schedule(300);h.scheduler.cancel();
    h.timer.fire(0);assert.deepEqual(h.calls,[]);assert.equal(h.scheduler.pending,false);
});
test('an old canvas callback cannot save a newly opened canvas',()=>{
    const h=setup();h.scheduler.schedule(500);h.changeId('b');h.timer.fire(0);
    assert.deepEqual(h.calls,[]);assert.equal(h.scheduler.pending,false);
    h.scheduler.schedule(500);h.timer.fire(1);assert.deepEqual(h.calls,['b']);
});
test('timer handle zero is a real pending task and can be cancelled',()=>{
    const h=setup();h.scheduler.schedule(0);assert.equal(h.scheduler.pending,true);
    h.scheduler.cancel();assert.deepEqual(h.timer.cancelled,[0]);assert.equal(h.scheduler.pending,false);
});
test('schedulers have independent pending tasks',()=>{
    const a=setup(),b=setup();a.scheduler.schedule(0);b.scheduler.schedule(300);a.scheduler.cancel();
    assert.equal(a.scheduler.pending,false);assert.equal(b.scheduler.pending,true);b.timer.fire(0);assert.deepEqual(b.calls,['a']);
});
test('scheduling again inside save keeps the new pending task',()=>{
    const timer=clock();let scheduler,calls=0;
    scheduler=context.CanvasSaveScheduler.create({getCanvasId:()=> 'a',save:()=>{if(++calls===1)scheduler.schedule(300);},...timer});
    scheduler.schedule(0);timer.fire(0);assert.equal(scheduler.pending,true);timer.fire(1);assert.equal(calls,2);assert.equal(scheduler.pending,false);
});
test('both editors load the scheduler before their entry script',()=>{
    for(const name of ['canvas','smart-canvas']){
        const html=readFileSync(path.join(__dirname,`../static/${name}.html`),'utf8');
        const offset=html.indexOf('/static/js/canvas-save-scheduler.js');
        assert.ok(offset>=0 && offset<html.indexOf(`/static/js/${name}.js`));
    }
});
