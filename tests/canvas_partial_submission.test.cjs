const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync, mkdtempSync, writeFileSync, rmSync} = require('node:fs');
const {createServer} = require('node:http');
const {tmpdir} = require('node:os');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../static/js/canvas.js'), 'utf8');
function section(begin, end){
    const start = source.indexOf(begin);
    const stop = source.indexOf(end, start);
    assert.ok(start >= 0 && stop > start, `${begin} should precede ${end}`);
    return source.slice(start, stop);
}

function taskResponse(status, data={}){
    return {ok:status >= 200 && status < 300, status, json:async()=>data};
}
function submissionHarness(responses){
    const calls=[];
    const cascadeContext={};
    const context = vm.createContext({
        cascadeFetch:async(url, init)=>{
            calls.push({url, init});
            const next = responses.shift();
            if(next instanceof Error) throw next;
            if(!next) throw new Error('Unexpected submission');
            return next;
        },
        responseErrorMessage:async response=>`HTTP ${response.status}`,
        tr:key=>key,
        cascadeTargetIdFromOptions:options=>options?.cascadeTargetId || '',
        cascadeContextFor:id=>id ? cascadeContext : null,
        cascadeAbortError:message=>Object.assign(new Error(message),{isCascadeAbort:true}),
    });
    vm.runInContext(section('async function createCanvasImageTask(', 'async function createCanvasComfyTask('), context);
    return {calls,cascadeContext,run:(count,options={})=>{
        context.runOptions=options;
        return vm.runInContext(`submitCanvasImageTaskBatch(${count}, {prompt:'sample'}, runOptions)`, context);
    }};
}

test('batch retains an accepted task ID when a sibling receives an explicit 400 rejection', async()=>{
    const h=submissionHarness([taskResponse(202,{task_id:'accepted-1'}), taskResponse(400)]);
    const result=await h.run(2);
    assert.deepEqual(Array.from(result.taskInfos, task=>task.task_id), ['accepted-1']);
    assert.equal(result.unknownCount, 0);
    assert.match(result.warning, /1 项被明确拒绝/);
    assert.match(result.warning, /请勿直接重试整批/);
    assert.equal(h.calls.length, 2);
    assert.ok(h.calls.every(call=>call.url==='/api/canvas-image-tasks' && call.init.method==='POST'));
});

test('batch reports missing IDs as unknown for network, 408, 5xx, and malformed success responses', async()=>{
    for(const failure of [new TypeError('Failed to fetch'), taskResponse(408), taskResponse(503), taskResponse(200,{})]){
        const h=submissionHarness([taskResponse(202,{task_id:'accepted-1'}), failure]);
        const result=await h.run(2);
        assert.deepEqual(Array.from(result.taskInfos, task=>task.task_id), ['accepted-1']);
        assert.equal(result.unknownCount, 1);
        assert.match(result.warning, /可能已受理/);
    }
});

test('batch with no known task ID rejects and identifies whether acceptance is unknown', async()=>{
    const known=submissionHarness([taskResponse(400)]);
    await assert.rejects(known.run(1), error=>!error.submissionUnknown && /明确拒绝/.test(error.message));
    const unknown=submissionHarness([new TypeError('Failed to fetch')]);
    await assert.rejects(unknown.run(1), error=>error.submissionUnknown && /可能已受理/.test(error.message));
});

test('a partial cascade batch prevents a later parallel round from submitting',async()=>{
    const h=submissionHarness([taskResponse(202,{task_id:'accepted-1'}),taskResponse(408)]);
    const result=await h.run(2,{cascadeTargetId:'chain-1'});
    assert.equal(result.unknownCount,1);
    assert.equal(h.cascadeContext.submissionIncomplete,true);
    await assert.rejects(h.run(1,{cascadeTargetId:'chain-1'}),/已停止后续提交/);
    assert.equal(h.calls.length,2);
});

test('local HTTP ambiguity requires confirmation and preserves the old warning after a later success', async()=>{
    for(const response of [
        {status:408, body:{detail:'模拟网关超时'}},
        {status:200, body:{status:'queued'}},
    ]){
        const tempDir=mkdtempSync(path.join(tmpdir(),'daxiong-f07-unknown-'));
        const calls=[];
        const server=createServer((request, reply)=>{
            calls.push({method:request.method,path:request.url});
            writeFileSync(path.join(tempDir,'calls.json'),JSON.stringify(calls));
            const answer=calls.length===1 ? response : {status:202,body:{task_id:'known-after-manual-submit'}};
            reply.writeHead(answer.status,{'Content-Type':'application/json'});
            reply.end(JSON.stringify(answer.body));
        });
        try {
            await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
            const base=`http://127.0.0.1:${server.address().port}`;
            const submissionContext=vm.createContext({
                cascadeFetch:(url,init)=>fetch(base+url,init),
                responseErrorMessage:async res=>`HTTP ${res.status}`,
                tr:key=>key,
                cascadeTargetIdFromOptions:options=>options?.cascadeTargetId || '',
                cascadeContextFor:()=>null,
            });
            vm.runInContext(section('async function createCanvasImageTask(', 'async function createCanvasComfyTask('),submissionContext);
            let approved=false;
            const h=generatorHarness('generator',
                ()=>vm.runInContext("submitCanvasImageTaskBatch(1,{prompt:'isolated'})",submissionContext),
                ()=>approved);
            await h.run();
            assert.equal(h.generator.submissionUnknown,true);
            assert.match(h.generator.submissionWarning,/可能已受理/);
            await new Promise(resolve=>setTimeout(resolve,50));
            assert.equal(JSON.parse(readFileSync(path.join(tempDir,'calls.json'),'utf8')).length,1);
            await h.run();
            assert.equal(h.confirmations,1);
            assert.equal(calls.length,1);
            approved=true;
            await h.run();
            assert.equal(h.confirmations,2);
            assert.equal(calls.length,2);
            assert.deepEqual(h.queries,['known-after-manual-submit']);
            assert.equal(h.generator.submissionUnknown,true);
            assert.match(h.generator.submissionWarning,/可能已受理/);
            assert.ok(calls.every(call=>call.method==='POST' && call.path==='/api/canvas-image-tasks'));
        } finally {
            await new Promise(resolve=>server.close(resolve));
            const resolvedTempDir=path.resolve(tempDir);
            if(path.dirname(resolvedTempDir)!==path.resolve(tmpdir())
                || !path.basename(resolvedTempDir).startsWith('daxiong-f07-unknown-')){
                throw new Error('Refusing to remove a directory outside the isolated test area');
            }
            rmSync(resolvedTempDir,{recursive:true,force:true});
        }
    }
});

function generatorHarness(kind, submissionResult, confirmResult=true){
    const generator={id:'gen', type:kind==='rh' ? 'rh' : 'generator', x:10, y:20, count:2,
        rhModel:'mock-model', apiProvider:'mock'};
    const output={id:'out', type:'output', _pending:[]};
    const nodes=[generator, output];
    const saves=[], queries=[], notices=[];
    let nextId=0, submissions=0, confirmations=0, saveAllowed=true;
    const context=vm.createContext({
        nodes, CANVAS_REFERENCE_IMAGE_MAX:10,
        window:{confirm:()=>{confirmations++;return typeof confirmResult==='function' ? confirmResult() : confirmResult;}},
        rhSelectedEntryRef:()=>({id:'mock-model'}), rhMediaSources:()=>({prompt:'sample',refs:[]}),
        orderedSources:()=>[{prompt:'sample',refs:[]}], generatorSources:()=>[],
        imageRefsOnly:refs=>refs, outputForNode:()=>output,
        runSnapshot:()=>({node:{id:'gen'}}), generatorSizeForRun:async()=> '1024x1024',
        normalizedImageQuality:()=>'', resolveImageProviderId:()=> 'mock', resolveImageModel:()=> 'mock-model',
        cascadeTargetIdFromOptions:()=>'', submitCanvasImageTaskBatch:async()=>{
            submissions++;
            if(submissionResult instanceof Error) throw submissionResult;
            if(typeof submissionResult==='function') return submissionResult();
            return submissionResult || {
                taskInfos:[{task_id:'accepted-1'}], warning:'仅取得 1 个任务编号，1 项未收到可靠响应', unknownCount:1,
            };
        },
        uid:prefix=>`${prefix}-${++nextId}`, makePendingForRun:(id,run,node,options,task)=>({id,run,...task}),
        pendingById:(out,id)=>(out?._pending || []).find(pending=>pending.id===id),
        refreshRunNodes:()=>{}, scheduleSave:()=>{},
        saveCanvas:async()=>{
            saves.push(JSON.parse(JSON.stringify(nodes.map(node=>({
                ...node, running:undefined, runStatus:undefined, runError:undefined,
            })))));
            return saveAllowed;
        },
        showErrorModal:message=>notices.push(message),
        pollCanvasImageTask:async taskId=>{
            queries.push(taskId);
            output._pending=output._pending.filter(pending=>pending.canvasTaskId!==taskId);
            generator.runError='';
            return 'succeeded';
        },
        tr:key=>key, nowMs:()=>1, setTimeout:()=>{},
        isCascadeAbortError:()=>false,
        rememberUnsavedCanvasAcceptedTasks:()=>true,
        rememberUnsavedCanvasUnknownWarning:()=>{},
    });
    const code=kind==='rh'
        ? section('async function runRhModelNode(', 'function renderComfySettings(')
        : section('async function runGenerator(', 'async function midjourneyRequest(');
    vm.runInContext(section('function confirmCanvasUnknownResubmission(', 'async function createCanvasImageTask('),context);
    vm.runInContext(code,context);
    return {generator,output,saves,queries,notices,
        get submissions(){return submissions;},get confirmations(){return confirmations;},
        setSaveAllowed:value=>{saveAllowed=value;},
        run:(options={})=>{context.runOptions=options;return vm.runInContext(kind==='rh' ? 'runRhModelNode(nodes[0],runOptions)' : "runGenerator('gen',runOptions)",context);}};
}

for(const kind of ['generator','rh']){
    test(`${kind} saves the accepted task before polling and retains the warning after success`,async()=>{
        const h=generatorHarness(kind);
        await h.run();
        assert.deepEqual(h.queries,['accepted-1']);
        assert.deepEqual(h.saves[0][1]._pending.map(p=>p.canvasTaskId),['accepted-1']);
        assert.equal(h.saves[0][0].submissionUnknown,true);
        assert.match(h.saves[0][0].submissionWarning,/未收到可靠响应/);
        assert.equal(h.generator.submissionUnknown,true);
        assert.match(h.generator.submissionWarning,/未收到可靠响应/);
        assert.equal(h.notices.length,1);
    });

    test(`${kind} keeps an earlier unknown submission warning after a later successful batch`,async()=>{
        const h=generatorHarness(kind,{
            taskInfos:[{task_id:'accepted-2'}], warning:'', unknownCount:0,
        });
        h.generator.submissionWarning='上一次请求未收到可靠响应，可能已受理';
        h.generator.submissionUnknown=true;
        await h.run();
        assert.deepEqual(h.queries,['accepted-2']);
        assert.equal(h.confirmations,1);
        assert.equal(h.generator.submissionUnknown,true);
        assert.match(h.generator.submissionWarning,/上一次请求未收到可靠响应/);
        assert.match(h.saves[0][0].submissionWarning,/上一次请求未收到可靠响应/);
    });

    test(`${kind} shows an unknown status when no task ID arrives`,async()=>{
        const error=new Error('本次请求 1 项，仅取得 0 个任务编号；可能已受理。请勿直接重试整批。');
        error.submissionUnknown=true;
        const h=generatorHarness(kind,error);
        await h.run();
        assert.equal(h.queries.length,0);
        assert.equal(h.generator.submissionUnknown,true);
        assert.match(h.generator.submissionWarning,/可能已受理/);
        assert.equal(h.generator.runStatus,'failed');
        assert.equal(h.notices.length,1);
    });

    test(`${kind} requires confirmation before manually resubmitting an unknown task`,async()=>{
        const h=generatorHarness(kind,undefined,false);
        h.generator.submissionWarning='上一次请求可能已受理';
        h.generator.submissionUnknown=true;
        await h.run();
        assert.equal(h.confirmations,1);
        assert.equal(h.submissions,0);
        assert.equal(h.generator.submissionUnknown,true);
    });

    test(`${kind} stops a cascade before resubmitting an unknown task`,async()=>{
        const h=generatorHarness(kind);
        h.generator.submissionWarning='上一次请求可能已受理';
        h.generator.submissionUnknown=true;
        await assert.rejects(h.run({cascade:true}),/一键运行已停止/);
        assert.equal(h.confirmations,0);
        assert.equal(h.submissions,0);
    });

    test(`${kind} pauses accepted tasks when canvas persistence fails and blocks another submission`,async()=>{
        const h=generatorHarness(kind);
        h.setSaveAllowed(false);
        await h.run();
        assert.equal(h.submissions,1);
        assert.deepEqual(h.queries,[]);
        assert.equal(h.output._pending.length,1);
        assert.equal(h.output._pending[0].canvasTaskId,'accepted-1');
        assert.equal(h.output._pending[0].savePending,true);
        assert.equal(h.output._pending[0].queryPaused,true);
        assert.match(h.notices.join('\n'),/保存并查询/);
        await h.run();
        assert.equal(h.submissions,1);
        assert.deepEqual(h.queries,[]);
    });
}

test('recovery retries canvas save before querying the original accepted task',async()=>{
    let saveAllowed=false;
    const calls=[];
    const notices=[];
    const context=vm.createContext({
        saveCanvas:async()=>{calls.push('save');return saveAllowed;},
        pollCanvasImageTask:async id=>{calls.push(`query:${id}`);return 'succeeded';},
        scheduleSave:()=>calls.push('schedule'),
        showErrorModal:message=>notices.push(message),tr:key=>key,
    });
    vm.runInContext(section('async function saveAndQueryCanvasPendingTask(', 'async function pollCanvasImageTask('),context);
    context.pending={canvasTaskId:'accepted-1',savePending:true,queryPaused:true};
    assert.equal(await vm.runInContext('saveAndQueryCanvasPendingTask(pending)',context),'paused');
    assert.deepEqual(calls,['save']);
    assert.equal(context.pending.savePending,true);
    assert.match(notices[0],/不要重新提交/);
    saveAllowed=true;
    assert.equal(await vm.runInContext('saveAndQueryCanvasPendingTask(pending)',context),'succeeded');
    assert.deepEqual(calls,['save','save','schedule','query:accepted-1']);
    assert.equal(context.pending.savePending,undefined);
});

test('direct tasks create a recovery card when accepted IDs cannot be saved',async()=>{
    const node={id:'gen',type:'generator',x:10,y:20};
    const nodes=[node], connections=[], notices=[];
    let queries=0;
    const context=vm.createContext({
        nodes,connections,uid:(()=>{let n=0;return prefix=>`${prefix}-${++n}`;})(),
        makePendingForRun:(id,run,source,options,task)=>({id,run,...task}),
        scheduleSave:()=>{},saveCanvas:async()=>false,render:()=>{},
        showErrorModal:message=>notices.push(message),tr:key=>key,
        waitCanvasImageTaskResult:async()=>{queries++;return {images:[]};},
        rememberUnsavedCanvasAcceptedTasks:()=>true,
    });
    vm.runInContext(section('function pauseCanvasAcceptedTasksUntilSaved(', 'function rememberCanvasSubmissionWarning('),context);
    vm.runInContext(section('function materializeCanvasDirectTasks(', 'function completeCanvasImageTask('),context);
    context.run={node:{id:'gen'}};
    context.taskInfos=[{task_id:'accepted-direct-1'}];
    await assert.rejects(vm.runInContext('waitCanvasDirectTasks(nodes[0],taskInfos,run)',context),error=>error.queryPaused);
    assert.equal(queries,0);
    assert.equal(nodes.filter(item=>item.type==='output').length,1);
    const pending=nodes.find(item=>item.type==='output')._pending[0];
    assert.equal(pending.canvasTaskId,'accepted-direct-1');
    assert.equal(pending.savePending,true);
    assert.equal(pending.queryPaused,true);
    assert.equal(node._directPending,undefined);
    assert.match(notices[0],/保存并查询/);
});

test('unsaved task IDs restore as paused cards in the same browser without querying',()=>{
    const values=new Map();
    const storage={
        getItem:key=>values.get(key) || null,
        setItem:(key,value)=>values.set(key,value),
        removeItem:key=>values.delete(key),
    };
    const sourceNode={id:'gen',type:'generator',x:10,y:20};
    const outputNode={id:'out',type:'output',_pending:[]};
    const context=vm.createContext({
        canvas:{id:'isolated-canvas'}, nodes:[sourceNode,outputNode], connections:[],
        CANVAS_UNSAVED_ACCEPTED_TASKS_PREFIX:'canvas_unsaved_accepted_tasks_v1:',
        localStorage:storage, nowMs:()=>100,
        uid:(()=>{let n=0;return prefix=>`${prefix}-${++n}`;})(),
        findPendingTask:id=>{
            const out=context.nodes.find(node=>node.type==='output' && (node._pending || []).some(task=>task.canvasTaskId===id));
            return out ? {out,pending:out._pending.find(task=>task.canvasTaskId===id)} : null;
        },
        scheduleSave:()=>{},
    });
    vm.runInContext(section('function unsavedCanvasAcceptedTasksKey(', 'function confirmCanvasUnknownResubmission('),context);
    context.sourceNode=sourceNode;
    context.task={canvasTaskId:'accepted-1',providerId:'local-mock',model:'mock-model',startedAt:123,
        run:{prompt:'do not store this prompt',secret:'do not store this secret'}};
    context.outputNode=outputNode;
    assert.equal(vm.runInContext('rememberUnsavedCanvasAcceptedTasks(sourceNode,[task],outputNode)',context),true);
    const key='canvas_unsaved_accepted_tasks_v1:isolated-canvas';
    assert.equal(values.has(key),true);
    assert.doesNotMatch(values.get(key),/do not store/);
    context.nodes=[{...sourceNode},{...outputNode,_pending:[]}];
    assert.equal(vm.runInContext('restoreUnsavedCanvasAcceptedTasks()',context),1);
    const pending=context.nodes.find(node=>node.type==='output')._pending[0];
    assert.equal(pending.canvasTaskId,'accepted-1');
    assert.equal(pending.savePending,true);
    assert.equal(pending.queryPaused,true);
    assert.equal(pending.run.node.id,'gen');
    context.nodes=[{...sourceNode}];
    context.connections=[];
    assert.equal(vm.runInContext('restoreUnsavedCanvasAcceptedTasks()',context),1);
    assert.equal(context.nodes.filter(node=>node.type==='output').length,1);
    assert.equal(context.connections[0].from,'gen');
    assert.equal(context.nodes.find(node=>node.type==='output')._pending[0].savePending,true);
    context.canvas={id:'another-canvas'};
    assert.equal(vm.runInContext('restoreUnsavedCanvasAcceptedTasks()',context),0);
    assert.equal(values.has(key),true);
});

test('canvas save failure retains the local backup and successful PUT clears it',async()=>{
    const clears=[], statuses=[];
    let responseStatus=503;
    const context=vm.createContext({
        canvas:{id:'isolated-canvas',title:'demo',updated_at:1},nodes:[],connections:[],
        viewport:{x:0,y:0,scale:1},applyingRemoteCanvas:false,savingCanvasNow:false,
        saveCanvasAgain:false,localCanvasDirty:true,lastCanvasUpdatedAt:1,
        CLIENT_ID:'isolated-test',currentCanvasTime:null,currentCanvasTitle:null,
        sanitizeConnections:()=>{},setStatus:value=>statuses.push(value),
        clearUnsavedCanvasAcceptedTasks:id=>clears.push(id),
        clearUnsavedCanvasUnknownWarnings:()=>{},
        loadCanvasList:()=>{},setTimeout:()=>{},clearTimeout(){},saveTimer:null,
        fetch:async()=>({ok:responseStatus===200,status:responseStatus,
            json:async()=>({canvas:{id:'isolated-canvas',updated_at:2,nodes:[]}})}),
        console:{error:()=>{}},
    });
    vm.runInContext(section('function serializableCanvasNode(', 'async function loadConfig('),context);
    assert.equal(await vm.runInContext('saveCanvas()',context),false);
    assert.deepEqual(clears,[]);
    assert.ok(statuses.includes('Save failed'));
    responseStatus=200;
    assert.equal(await vm.runInContext('saveCanvas()',context),true);
    assert.deepEqual(clears,['isolated-canvas']);
});

test('a prior save cannot clear a newer accepted-task backup',()=>{
    const values=new Map();
    const key='canvas_unsaved_accepted_tasks_v1:isolated-canvas';
    values.set(key,JSON.stringify([{taskId:'newer-task',nodeId:'gen'}]));
    const context=vm.createContext({
        canvas:{id:'isolated-canvas'},
        CANVAS_UNSAVED_ACCEPTED_TASKS_PREFIX:'canvas_unsaved_accepted_tasks_v1:',
        localStorage:{getItem:k=>values.get(k) || null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},
        nodes:[],connections:[],nowMs:()=>1,scheduleSave:()=>{},
    });
    vm.runInContext(section('function unsavedCanvasAcceptedTasksKey(', 'function confirmCanvasUnknownResubmission('),context);
    context.savedNodes=[{id:'gen',_pending:[{canvasTaskId:'older-task'}]}];
    vm.runInContext("clearUnsavedCanvasAcceptedTasks('isolated-canvas',savedNodes)",context);
    assert.equal(JSON.parse(values.get(key))[0].taskId,'newer-task');
    context.savedNodes=[{id:'out',_pending:[{canvasTaskId:'newer-task'}]}];
    vm.runInContext("clearUnsavedCanvasAcceptedTasks('isolated-canvas',savedNodes)",context);
    assert.equal(values.has(key),false);
});

test('an unknown no-ID submission survives reload and guards a missing source node',()=>{
    const values=new Map();
    const storage={getItem:key=>values.get(key) || null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
    const sourceNode={id:'gen',submissionWarning:'请求可能已受理',submissionUnknown:true};
    const context=vm.createContext({
        canvas:{id:'isolated-canvas'}, nodes:[sourceNode],
        CANVAS_UNKNOWN_SUBMISSION_PREFIX:'canvas_unknown_submission_v1:',
        localStorage:storage,scheduleSave:()=>{},
        canvasOrphanUnknownSubmissionCount:0,
        window:{confirm:()=>false},
    });
    vm.runInContext(section('function unknownCanvasSubmissionKey(', 'function rememberUnsavedCanvasAcceptedTasks('),context);
    context.sourceNode=sourceNode;
    vm.runInContext('rememberUnsavedCanvasUnknownWarning(sourceNode)',context);
    assert.equal(values.has('canvas_unknown_submission_v1:isolated-canvas'),true);
    context.nodes=[{id:'gen'}];
    assert.equal(vm.runInContext('restoreUnsavedCanvasUnknownWarnings()',context),1);
    assert.equal(context.nodes[0].submissionUnknown,true);
    assert.equal(context.nodes[0].submissionWarning,'请求可能已受理');
    context.nodes=[];
    assert.equal(vm.runInContext('restoreUnsavedCanvasUnknownWarnings()',context),1);
    assert.equal(context.canvasOrphanUnknownSubmissionCount,1);
    assert.equal(vm.runInContext('confirmOrphanUnknownCanvasSubmission()',context),false);
});

test('reload does not automatically query a locally restored unsaved task',()=>{
    const queries=[];
    const context=vm.createContext({
        nodes:[{type:'output',_pending:[
            {canvasTaskType:'online-image',canvasTaskId:'unsaved-1',savePending:true},
            {canvasTaskType:'online-image',canvasTaskId:'saved-2'},
        ]}],
        materializeCanvasDirectTasks:()=>{},
        pollCanvasImageTask:id=>queries.push(id),
        watchCanvasDepthCapture:()=>{throw Error('unexpected depth capture');},
    });
    vm.runInContext(section('function resumeCanvasDepthCaptureTasks(', 'function openOutputNodeMenu(')
        +section('function resumeCanvasImageTasks(', 'function renderOutputMedia('),context);
    vm.runInContext('resumeCanvasImageTasks()',context);
    assert.deepEqual(queries,['saved-2']);
});

test('submission warning remains in serialized node data and visible node heading',()=>{
    const serialize=vm.createContext({});
    vm.runInContext(section('function serializableCanvasNode(', 'async function saveCanvas('),serialize);
    const serialized=vm.runInContext("serializableCanvasNode({id:'gen',submissionWarning:'1 项未收到可靠响应',submissionUnknown:true,runError:'old'})",serialize);
    assert.equal(serialized.submissionWarning,'1 项未收到可靠响应');
    assert.equal(serialized.submissionUnknown,true);
    assert.equal(serialized.runError,undefined);

    const head=section('function renderNode(node){', '    const body = document.createElement(\'div\');')+'    return el;\n}';
    let warningClick;
    const notices=[];
    const context=vm.createContext({
        document:{createElement:()=>({style:{},dataset:{},
            querySelector:selector=>selector==='.node-submission-warning'
                ? {addEventListener:(event, handler)=>{if(event==='click') warningClick=handler;}}
                : null,
        })},
        normalizeApiNodeLayout:()=>{}, defaultNodeSize:()=>({w:400,h:300}),
        selected:new Set(), CANVAS_GENERATOR_TYPES:['generator'],
        tr:key=>key, escapeHtml:value=>String(value), escapeAttr:value=>String(value),
        showErrorModal:message=>notices.push(message),
    });
    vm.runInContext(head,context);
    context.node={id:'gen',type:'generator',x:0,y:0,submissionWarning:'1 项未收到可靠响应',submissionUnknown:true};
    const el=vm.runInContext('renderNode(node)',context);
    assert.match(el.innerHTML,/提交状态未知/);
    assert.match(el.innerHTML,/title="1 项未收到可靠响应"/);
    assert.match(el.innerHTML,/node-submission-warning/);
    let stopped=false;
    warningClick({stopPropagation:()=>{stopped=true;}});
    assert.equal(stopped,true);
    assert.deepEqual(notices,['1 项未收到可靠响应']);
});
