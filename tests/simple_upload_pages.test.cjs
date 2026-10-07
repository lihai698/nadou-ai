const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred(){
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return {promise, resolve};
}

function page(name){
    const html = readFileSync(path.join(__dirname, '..', 'static', `${name}.html`), 'utf8');
    const handleFile = html.match(/async function handleFile\(file\) \{[\s\S]*?\n        \}/)?.[0];
    assert.ok(handleFile, `${name} upload handler must exist`);
    const elements = new Map();
    const alerts = [];
    const requests = [];
    const readers = [];
    let readImmediately = true;
    function element(id){
        if(!elements.has(id)){
            const classes = new Set(['hidden']);
            elements.set(id, {
                id, src:'', disabled:false, innerText:'',
                classList:{
                    add(value){ classes.add(value); },
                    remove(value){ classes.delete(value); },
                    contains(value){ return classes.has(value); },
                    replace(before, after){ classes.delete(before); classes.add(after); },
                },
            });
        }
        return elements.get(id);
    }
    const context = vm.createContext({
        document:{getElementById:element},
        window:{},
        FileReader:class {
            readAsDataURL(file){
                this.file = file;
                readers.push(this);
                if(readImmediately) this.finish();
            }
            finish(){ this.onload?.({target:{result:`data:${this.file.name}`}}); }
        },
        FormData:class {append(){}},
        fetch(){ const request=deferred(); requests.push(request); return request.promise; },
        tr(key){ return key; },
        alert(message){ alerts.push(message); },
        console:{error(){}},
    });
    vm.runInContext(`let uploadedPath='previous.png'; let uploadVersion=0;
        let uploadedFile=null; const previewImg=document.getElementById('previewImg');
        ${handleFile}`, context);
    return {context, element, alerts, requests, readers,
        deferReader(){ readImmediately=false; }};
}

const response = (ok, data) => ({ok, json:async () => data});

test('enhance: a late preview cannot reappear after upload failure', async () => {
    const ui = page('enhance');
    ui.deferReader();
    const upload = vm.runInContext('handleFile({name:"late.png"})', ui.context);
    ui.requests[0].resolve(response(false, {detail:'上传失败'}));
    await upload;
    ui.readers[0].finish();
    assert.equal(ui.element('previewImg').classList.contains('hidden'), true);
    assert.equal(ui.element('previewImg').src, '');
});

for(const name of ['angle', 'enhance']){
    test(`${name}: rejected replacement cannot reuse the previous uploaded image`, async () => {
        const ui = page(name);
        const uploading = vm.runInContext('handleFile({name:"new.png"})', ui.context);
        assert.equal(vm.runInContext('uploadedPath', ui.context), '');
        ui.requests[0].resolve(response(false, {detail:'文件超过 100MB，无法上传'}));
        await uploading;
        assert.equal(vm.runInContext('uploadedPath', ui.context), '');
        assert.deepEqual(ui.alerts, ['文件超过 100MB，无法上传']);
        assert.equal(ui.element('btnText').innerText, 'studio.uploadFailed');
        if(name === 'enhance'){
            assert.equal(ui.element('genBtn').disabled, true);
            assert.equal(ui.element('previewImg').classList.contains('hidden'), true);
        }
    });

    test(`${name}: slower upload cannot replace a newer selection`, async () => {
        const ui = page(name);
        const oldUpload = vm.runInContext('handleFile({name:"old.png"})', ui.context);
        const newUpload = vm.runInContext('handleFile({name:"new.png"})', ui.context);
        ui.requests[1].resolve(response(true, {files:[{comfy_name:'new-server.png'}]}));
        await newUpload;
        ui.requests[0].resolve(response(true, {files:[{comfy_name:'old-server.png'}]}));
        await oldUpload;
        assert.equal(vm.runInContext('uploadedPath', ui.context), 'new-server.png');
        assert.equal(ui.element('previewImg').src, 'data:new.png');
        assert.equal(ui.element('genBtn').disabled, false);
    });
}
