const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = readFileSync(path.join(__dirname, '..', 'static/klein.html'), 'utf8');
function handler(pattern){
    const source = html.match(pattern)?.[0];
    assert.ok(source);
    return source;
}
const handlers = [
    handler(/async function handleFile\(file, index\) \{[\s\S]*?\n        \}/),
    handler(/function clearSlot\(index, ev\) \{[\s\S]*?\n        \}/),
    handler(/async function submitLocal\(\) \{[\s\S]*?\n        \}/),
].join('\n');

function deferred(){
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return {promise, resolve};
}

function page(){
    const requests = [];
    const alerts = [];
    const elements = new Map();
    const element = id => {
        if(!elements.has(id)){
            const classes = new Set(['hidden']);
            elements.set(id, {src:'', value:'', classList:{
                add(value){ classes.add(value); },
                remove(value){ classes.delete(value); },
                contains(value){ return classes.has(value); },
            }});
        }
        return elements.get(id);
    };
    const context = vm.createContext({
        document:{getElementById:element},
        FileReader:class {readAsDataURL(file){ this.onload?.({target:{result:`data:${file.name}`}}); }},
        FormData:class {append(){}},
        fetch(){ const request=deferred(); requests.push(request); return request.promise; },
        tr(key){ return key; },
        alert(message){ alerts.push(message); },
    });
    vm.runInContext(`let uploadedNames={1:'',2:'',3:''};
        let base64Images={1:'',2:'',3:''};
        let uploadVersion={1:0,2:0,3:0};
        let uploadPending={1:false,2:false,3:false};
        ${handlers}`, context);
    return {context, alerts, requests, element};
}

const response = (ok, data) => ({ok, json:async () => data});

test('local generation waits and rejects an unuploaded visible reference', async () => {
    const ui = page();
    const upload = vm.runInContext('handleFile({name:"input.png"}, 1)', ui.context);
    await vm.runInContext('submitLocal()', ui.context);
    assert.deepEqual(ui.alerts, ['studio.uploading']);
    ui.requests[0].resolve(response(false, {detail:'文件超过 100MB，无法上传'}));
    await upload;
    await vm.runInContext('submitLocal()', ui.context);
    assert.deepEqual(ui.alerts, ['studio.uploading', '文件超过 100MB，无法上传', 'studio.uploadFailed']);
    assert.equal(ui.requests.length, 1);
    assert.equal(vm.runInContext('uploadedNames[1]', ui.context), '');
    assert.equal(vm.runInContext('base64Images[1]', ui.context), 'data:input.png');
});

test('a cleared or replaced reference ignores stale upload results', async () => {
    const ui = page();
    const old = vm.runInContext('handleFile({name:"old.png"}, 2)', ui.context);
    vm.runInContext('clearSlot(2)', ui.context);
    const current = vm.runInContext('handleFile({name:"current.png"}, 2)', ui.context);
    ui.requests[1].resolve(response(true, {files:[{comfy_name:'current-server.png'}]}));
    await current;
    ui.requests[0].resolve(response(true, {files:[{comfy_name:'old-server.png'}]}));
    await old;
    assert.equal(vm.runInContext('uploadedNames[2]', ui.context), 'current-server.png');
    assert.equal(ui.element('prev2').src, 'data:current.png');
    assert.deepEqual(ui.alerts, []);
});

test('a failed optional reference is not silently omitted from local generation', async () => {
    const ui = page();
    vm.runInContext("uploadedNames[1]='main-server.png'", ui.context);
    const upload = vm.runInContext('handleFile({name:"optional.png"}, 2)', ui.context);
    ui.requests[0].resolve(response(false, {detail:'上传失败'}));
    await upload;
    await vm.runInContext('submitLocal()', ui.context);
    assert.equal(ui.requests.length, 1);
    assert.deepEqual(ui.alerts, ['上传失败', 'studio.uploadFailed']);
});
