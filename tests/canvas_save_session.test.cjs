const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname,'../static/js/canvas-save-session.js'),'utf8'),context);
const create=options=>context.CanvasSaveSession.create(options);

test('sessions start idle and do not share edit or in-flight state',()=>{
    const a=create(),b=create();a.queue();a.begin();
    assert.equal(a.isSaving,true);assert.equal(a.queued,true);
    assert.equal(b.isSaving,false);assert.equal(b.queued,false);assert.equal(b.inFlight,null);
    a.finish();
});

test('duplicate begin cannot replace the promise already awaited by callers',async()=>{
    const session=create();session.begin();const flight=session.inFlight;
    assert.throws(()=>session.begin(),/already saving/);
    assert.equal(session.inFlight,flight);session.finish();await flight;
});

test('classic begin clears only the old queue and keeps edits added afterwards',()=>{
    const session=create({clearQueuedOnBegin:true});session.queue();session.begin();
    assert.equal(session.queued,false);session.queue();session.finish();assert.equal(session.queued,true);
});

test('smart begin preserves its already queued edit until the host consumes it',()=>{
    const session=create();session.queue();session.begin();assert.equal(session.queued,true);
    session.finish();assert.equal(session.queued,true);session.clearQueue();assert.equal(session.queued,false);
});

test('finish releases all waiters only after exposing idle and no in-flight promise',async()=>{
    const session=create();session.begin();const seen=[];
    const waiters=[1,2].map(id=>session.inFlight.then(()=>seen.push([id,session.isSaving,session.inFlight])));
    session.finish();await Promise.all(waiters);
    assert.deepEqual(seen,[[1,false,null],[2,false,null]]);
});

test('a conflict clears the old queue while a later edit survives completion',()=>{
    const session=create();session.begin();session.queue();session.clearQueue();
    assert.equal(session.isSaving,true);session.queue();session.finish();assert.equal(session.queued,true);
});

test('finishing idle state is harmless and a subsequent save gets a new promise',async()=>{
    const session=create();session.finish();session.begin();const first=session.inFlight;
    session.finish();await first;session.finish();session.begin();assert.notEqual(session.inFlight,first);session.finish();
});

test('both editors load the state owner before their entry script',()=>{
    for(const name of ['canvas','smart-canvas']){
        const html=readFileSync(path.join(__dirname,`../static/${name}.html`),'utf8');
        const position=html.indexOf('/static/js/canvas-save-session.js');
        assert.ok(position>=0 && position<html.indexOf(`/static/js/${name}.js`));
    }
});
