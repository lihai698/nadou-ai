const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');

function page(fetchResult = {images: []}){
    const elements = new Map();
    const element = id => {
        if(!elements.has(id)) elements.set(id, {
            innerHTML:'', textContent:'', style:{}, dataset:{},
            classList:{toggle(){}, add(){}, remove(){}},
            querySelector(){ return {textContent:''}; }
        });
        return elements.get(id);
    };
    const alerts = [], requests = [], revoked = [], fileInputs = [];
    const buttons = [element('runBtn'), element('miniRunBtn')];
    const context = vm.createContext({
        window:{addEventListener(){}, StudioI18n:{t:key => key, lang:() => 'zh'}},
        document:{getElementById:element, querySelector:element,
            querySelectorAll:() => buttons, addEventListener(){},
            createElement:tag => {
                assert.equal(tag, 'input');
                const input = {files:[], click(){}};
                fileInputs.push(input);
                return input;
            }},
        fetch:async (url, options) => {
            requests.push({url, options});
            return {ok:true, json:async () => typeof fetchResult === 'function' ? fetchResult() : fetchResult};
        },
        alert:message => alerts.push(message), console,
        URL:{revokeObjectURL:url => revoked.push(url), createObjectURL:file => `blob:${file.name}`},
        FormData:class {append(){}},
    });
    for(const name of ['comfyui-settings-rules.js', 'comfyui-settings.js']){
        vm.runInContext(readFileSync(path.join(__dirname, '../static/js', name), 'utf8'), context);
    }
    const run = code => vm.runInContext(code, context);
    run("selectedName='custom/test.json'; currentWorkflow={'1':{class_type:'SaveVideo',inputs:{}}}; currentConfig={title:'Test',fields:[]}; miniTestNodes=defaultMiniTestNodes();");
    return {run, element, alerts, requests, revoked, buttons, fileInputs};
}

test('newly imported workflow can run with its original defaults before exposing fields', () => {
    const p = page();
    p.run('renderPreview()');
    assert.match(p.element('previewContent').innerHTML, /onclick="onRun\(\)"/);
});

test('video and audio test nodes have working delete controls and release local previews', () => {
    const p = page();
    p.run("workspaceMode='canvas'; addMiniNode('video'); addMiniNode('audio');");
    for(const kind of ['video', 'audio']){
        const id = p.run(`miniTestNodes.find(n=>n.type==='${kind}').id`);
        assert.match(p.element('miniCanvasHost').innerHTML, new RegExp(`removeMiniNode\\('${id}'\\)`));
        p.run(`updateMiniNode('${id}','url','blob:${kind}'); removeMiniNode('${id}')`);
        assert.equal(p.run(`miniTestNodes.some(n=>n.id==='${id}')`), false);
        assert.doesNotMatch(p.element('miniCanvasHost').innerHTML, new RegExp(`data-node="${id}"`));
        assert.ok(p.revoked.includes(`blob:${kind}`));
    }
    assert.equal(p.run("miniTestNodes.filter(n=>n.type==='comfy'||n.type==='output').length"), 2);
});

test('workflow-test video and audio results render playable media in both previews', async () => {
    for(const [key, kind, tag] of [['videos','video','video'], ['audios','audio','audio']]){
        const p = page({[key]:[`/output/test.${kind==='video'?'mp4':'wav'}`]});
        p.run("workspaceMode='canvas'");
        await p.run('onRun()');
        assert.equal(p.run('runResult.kind'), kind);
        assert.match(p.element('previewContent').innerHTML, new RegExp(`<${tag}[^>]*controls`));
        assert.match(p.element('miniCanvasHost').innerHTML, new RegExp(`<${tag}[^>]*controls`));
        assert.equal(p.element('status').textContent, 'comfy.runSuccess');
        assert.equal(p.alerts.length, 0);
    }
});

test('HTTP 200 generation errors and empty outputs do not report a successful test', async () => {
    for(const data of [{error:'ComfyUI rejected prompt'}, {images:[]}]){
        const p = page(data);
        await p.run('onRun()');
        assert.equal(p.element('status').textContent, 'comfy.runFailed');
        assert.equal(p.alerts[0], data.error || 'comfy.noRunOutput');
        assert.equal(p.run('runResult'), null);
    }
});

test('both run controls stay disabled during a request and duplicate clicks submit once', async () => {
    let finish;
    const pending = new Promise(resolve => {finish=resolve;});
    const p = page(() => pending);
    const first = p.run('onRun()');
    assert.ok(p.buttons.every(button => button.disabled));
    p.run("workspaceMode='canvas'; renderPreview(); renderWorkspaceView()");
    assert.match(p.element('previewContent').innerHTML, /id="runBtn"[^>]*disabled/);
    assert.match(p.element('miniCanvasHost').innerHTML, /id="miniRunBtn"[^>]*disabled/);
    await p.run('onRun()');
    assert.equal(p.requests.length, 1);
    finish({images:['/output/image.png']});
    await first;
    assert.ok(p.buttons.every(button => !button.disabled));
});

test('mini canvas inputs and unchanged defaults are sent using their configured field ids', async () => {
    const p = page({images:['/output/test.png']});
    p.run(`workspaceMode='canvas';
        currentConfig.fields=[
            {id:'reference',node:'199',input:'image',type:'image',default:'original.png'},
            {id:'prompt',node:'238',input:'value',type:'textarea',default:'original prompt'},
            {id:'duration',node:'227',input:'value',type:'number',default:7}
        ];
        previewValues={reference:'original.png',prompt:'original prompt',duration:7};
        updateMiniNode('image_1','value','uploaded.png');
        updateMiniNode('prompt_1','text','new prompt');`);
    await p.run('onRun()');
    const body = JSON.parse(p.requests[0].options.body);
    assert.deepEqual(body.fields, {reference:'uploaded.png', prompt:'new prompt', duration:7});
    assert.equal(body.config.fields[0].node, '199');
    assert.equal(body.config.fields[1].node, '238');
});

test('a completed test does not replace the result of a different selected workflow', async () => {
    let finish;
    const pending = new Promise(resolve => {finish=resolve;});
    const p = page(() => pending);
    const first = p.run('onRun()');
    p.run("selectedName='custom/other.json'; currentConfig={title:'Other',fields:[]}; runResult=null");
    finish({videos:['/output/old.mp4']});
    await first;
    assert.equal(p.run('runResult'), null);
    assert.ok(p.buttons.every(button => !button.disabled));
});

test('new prompt, video and audio nodes occupy different source positions', () => {
    const p = page();
    p.run("workspaceMode='canvas'; addMiniNode('video'); addMiniNode('audio'); addMiniNode('prompt')");
    const positions = p.run("miniTestNodes.filter(n=>!['comfy','output'].includes(n.type)).map(n=>n.x+','+n.y)");
    assert.equal(new Set(positions).size, positions.length);
});

test('an empty first image slot does not shift the second reference into it', () => {
    const p = page();
    p.run(`currentConfig.fields=[{id:'first',type:'image'},{id:'second',type:'image'}];
        previewValues={first:'original-first.png',second:'original-second.png'};
        addMiniNode('image'); miniTestNodes.filter(n=>n.type==='image')[1].value='second-upload.png';`);
    assert.deepEqual(JSON.parse(p.run('JSON.stringify(fieldsFromMiniCanvas())')),
        {first:'original-first.png',second:'second-upload.png'});
});

test('separate prompt fields retain positive and negative text while one field supports joined segments', () => {
    const p = page();
    p.run(`currentConfig.fields=[{id:'positive',type:'textarea'},{id:'negative',type:'textarea'}];
        previewValues={positive:'old positive',negative:'old negative'};
        updateMiniNode('prompt_1','text','new positive'); addMiniNode('prompt');
        miniTestNodes.filter(n=>n.type==='prompt')[1].text='new negative';`);
    assert.deepEqual(JSON.parse(p.run('JSON.stringify(fieldsFromMiniCanvas())')),
        {positive:'new positive',negative:'new negative'});
    p.run("currentConfig.fields=[{id:'positive',type:'textarea'}]; previewValues={positive:'old'}");
    assert.equal(p.run('fieldsFromMiniCanvas().positive'), 'new positive\n\nnew negative');
});

test('an unfinished media upload cannot silently run with the previous sidebar value', async () => {
    const p = page();
    p.run(`workspaceMode='canvas'; currentConfig.fields=[{id:'reference',type:'image'}];
        previewValues={reference:'old.png'}; updateMiniNode('image_1','url','blob:new.png');`);
    await p.run('onRun()');
    assert.equal(p.requests.length, 0);
    assert.equal(p.alerts[0], 'comfy.uploadNotReady');
});

test('populated unsupported input nodes are reported instead of silently ignored', async () => {
    const p = page();
    p.run(`workspaceMode='canvas'; addMiniNode('video');
        miniTestNodes.find(n=>n.type==='video').value='test.mp4';`);
    await p.run('onRun()');
    assert.equal(p.requests.length, 0);
    assert.equal(p.alerts[0], 'comfy.unmappedTestInput');
});

test('deleting a node during upload prevents late responses from modifying or reviving it', async () => {
    let finish;
    const pending = new Promise(resolve => {finish=resolve;});
    const p = page(() => pending);
    await p.run("pickMiniImage('image_1')");
    p.fileInputs[0].files=[{name:'test.png'}];
    const upload = p.fileInputs[0].onchange();
    p.run("removeMiniNode('image_1')");
    finish({files:[{comfy_name:'uploaded.png'}]});
    await upload;
    assert.equal(p.run("miniTestNodes.some(n=>n.id==='image_1')"), false);
    assert.ok(p.revoked.includes('blob:test.png'));
    assert.equal(p.alerts.length, 0);
});

test('a file chooser opened before deleting its node cannot start a stale upload', async () => {
    const p = page();
    await p.run("pickMiniImage('image_1')");
    p.run("removeMiniNode('image_1')");
    p.fileInputs[0].files=[{name:'test.png'}];
    await p.fileInputs[0].onchange();
    assert.equal(p.requests.length, 0);
});

test('playback controls stop clicks from bubbling into the upload picker', () => {
    const p = page();
    for(const kind of ['video','audio']){
        const html = p.run(`mediaPreviewHtml('${kind}','blob:media','test')`);
        assert.match(html, new RegExp(`<${kind}[^>]*onclick="event.stopPropagation\\(\\)"`));
    }
});
