const {installClassicPreviewRuntime}=require('./canvas_preview_runtime_test_helpers.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');

function control(){
    const handlers=new Map();
    return {handlers,dataset:{},scrollTop:200,scrollLeft:4,clientHeight:100,
        addEventListener(type,fn){const list=handlers.get(type)||[];list.push(fn);handlers.set(type,list);},
        removeEventListener(type,fn){handlers.set(type,(handlers.get(type)||[]).filter(item=>item!==fn));},
        getBoundingClientRect:()=>({top:0,bottom:100}),
        emit(type,fields={}){for(const fn of [...(handlers.get(type)||[])])fn({stopPropagation(){},clientY:50,...fields});},
        count(type){return (handlers.get(type)||[]).length;}};
}
function setup(kind='classic',extra={}){
    const jobs=[];const e=createTaskContext({requestAnimationFrame:fn=>jobs.push(fn),...extra});
    const source=readFileSync(path.join(__dirname,`../static/js/${kind==='classic'?'canvas':'smart-canvas'}.js`),'utf8');
    const start=source.indexOf('function bindScrollableText(');
    vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),e);
    return {e,jobs,bind:el=>e.bindScrollableText(el)};
}

test('classic repeated text binding registers each handler once',()=>{
    const {bind}=setup();const el=control();bind(el);bind(el);
    assert.equal(el.count('mousedown'),1);assert.equal(el.count('scroll'),1);assert.equal(el.count('wheel'),1);
});

test('smart old scroll restoration cannot overwrite a new selection on the same control',()=>{
    const {bind,jobs}=setup('smart');const el=control();bind(el);el.emit('mousedown');
    el.scrollTop=0;el.emit('scroll');assert.equal(jobs.length,1);
    el.emit('mouseup');el.scrollTop=75;el.emit('mousedown');jobs.shift()();
    assert.equal(el.scrollTop,75);
});

function documentFor(elements){
    return {querySelectorAll:selector=>elements.filter(el=>el.dataset.canvasTextSelection===selector.match(/"([^"]+)"/)?.[1])};
}

test('text selection restores unexpected scroll jumps but permits explicit wheel scrolling',()=>{
    const {e,jobs}=setup();let clock=1000;
    const selection=e.CanvasTextSelection.create({requestFrame:fn=>jobs.push(fn),now:()=>clock});
    const el=control();selection.bind(el);el.emit('mousedown');el.scrollTop=0;el.emit('scroll');
    jobs.shift()();assert.equal(el.scrollTop,200);
    el.emit('wheel');clock++;el.scrollTop=0;el.emit('scroll');
    assert.equal(jobs.length,0);assert.equal(el.scrollTop,0);
});

test('suspending removes listeners and cancels old frames; resuming binds once',()=>{
    const cancelled=[];const {e,jobs,bind}=setup('classic',{cancelAnimationFrame:id=>cancelled.push(id)});
    const el=control();const root=documentFor([el]);bind(el);
    el.emit('mousedown');el.scrollTop=0;el.emit('scroll');
    e.classicTextSelection.suspend(root);
    assert.ok([...el.handlers.values()].every(list=>list.length===0));
    assert.deepEqual(cancelled,[1]);
    jobs.shift()();assert.equal(el.scrollTop,0);
    e.classicTextSelection.resume(root);e.classicTextSelection.resume(root);
    assert.equal(el.count('mousedown'),1);assert.equal(el.count('wheel'),1);
    e.classicTextSelection.unbind(el);e.classicTextSelection.resume(root);
    assert.equal(el.count('mousedown'),0);
});

test('each editor owns an independent selection guard',()=>{
    const {e,jobs}=setup();const a=control(),b=control();b.scrollTop=300;
    e.classicTextSelection.bind(a);e.smartTextSelection.bind(b);
    a.emit('mousedown');b.emit('mousedown');a.scrollTop=0;a.emit('scroll');b.scrollTop=0;b.emit('scroll');
    for(const job of jobs)job();assert.equal(a.scrollTop,200);assert.equal(b.scrollTop,300);
});

test('the production classic interaction host ends selection through the controller API',()=>{
    const {e,jobs,bind}=setup();const el=control();bind(el);el.emit('mousedown');el.scrollTop=0;el.emit('scroll');
    e.classicLayoutHost().endTextSelection();jobs.shift()();assert.equal(el.scrollTop,0);
});

for(const kind of ['classic','smart']){
    test(`${kind} real page lifecycle removes and restores text bindings`,()=>{
        const el=control(),listeners={};
        const {e,bind}=setup(kind,{document:documentFor([el]),canvas:{id:'c'},canvasOpenGeneration:0,openingCanvasId:'',
            window:{addEventListener:(name,fn)=>{listeners[name]=fn;}},
            [kind+'RemoteSync']:{stop(){},start(){},syncNow(){}}});
        const source=readFileSync(path.join(__dirname,`../static/js/${kind==='classic'?'canvas':'smart-canvas'}.js`),'utf8');
        const start=source.indexOf("window.addEventListener('pagehide'");
        const end=source.indexOf(kind==='classic'?'let models =':'function connectAssetLibrarySyncSocket(',start);
        if(kind==='classic')installClassicPreviewRuntime(e,source);
        vm.runInContext(source.slice(start,end),e);bind(el);
        listeners.pagehide();assert.equal(el.count('mousedown'),0);
        listeners.pageshow({persisted:true});listeners.pageshow({persisted:true});
        assert.equal(el.count('mousedown'),1);assert.equal(el.count('scroll'),1);
    });
}
