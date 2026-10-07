const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = readFileSync(path.join(root, 'static/online.html'), 'utf8');
const pageScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

function deferred(){
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return {promise, resolve};
}

function page(){
    const elements = new Map();
    const alerts = [];
    const requests = [];
    function element(id){
        if(!elements.has(id)){
            const classes = new Set(['hidden']);
            elements.set(id, {
                id, src:'', value:'', disabled:false, prepend(){}, appendChild(){},
                classList:{
                    add(name){ classes.add(name); },
                    remove(name){ classes.delete(name); },
                    contains(name){ return classes.has(name); },
                    toggle(name, force){ if(force) classes.add(name); else classes.delete(name); },
                },
            });
        }
        return elements.get(id);
    }
    const context = vm.createContext({
        window:{addEventListener(){}, OnlineImageSizeRules:require('../static/js/online-image-size-rules.js')},
        document:{getElementById:element, addEventListener(){}, createElement(){ return {dataset:{}}; }},
        lucide:{createIcons(){}},
        IntersectionObserver:class {observe(){}},
        Image:class {set src(value){ this.naturalWidth=100; this.naturalHeight=100; this.onload?.(); }},
        FileReader:class {readAsDataURL(file){ this.onload?.({target:{result:`data:${file.name}`}}); }},
        FormData:class {append(){}},
        fetch(url, options){
            const request = deferred();
            requests.push({url, options, ...request});
            return request.promise;
        },
        alert(message){ alerts.push(message); },
        setTimeout, clearTimeout, console,
    });
    new vm.Script(pageScript, {filename:'static/online.html'}).runInContext(context);
    element('promptInput').value = 'test prompt';
    return {context, element, alerts, requests};
}

const uploadResponse = (ok, data) => ({ok, json:async () => data});

test('HTTP 413 clears the visible reference and reports the server error', async () => {
    const ui = page();
    const upload = vm.runInContext('handleFile({name:"large.png"}, 1)', ui.context);
    assert.equal(ui.element('prev1').classList.contains('hidden'), false);
    ui.requests[0].resolve(uploadResponse(false, {detail:'文件超过 100MB，无法上传'}));
    await upload;
    assert.equal(ui.element('prev1').classList.contains('hidden'), true);
    assert.equal(ui.element('prev1').src, '');
    assert.equal(vm.runInContext('refs[1]', ui.context), null);
    assert.deepEqual(ui.alerts, ['文件超过 100MB，无法上传']);
});

test('generation waits for an upload and includes it after success', async () => {
    const ui = page();
    const upload = vm.runInContext('handleFile({name:"ok.png"}, 1)', ui.context);
    await vm.runInContext('submitImage()', ui.context);
    assert.equal(ui.requests.length, 1);
    assert.deepEqual(ui.alerts, ['online.uploadPending']);
    ui.requests[0].resolve(uploadResponse(true, {files:[{url:'/assets/input/ok.png'}]}));
    await upload;
    const generate = vm.runInContext('submitImage()', ui.context);
    assert.equal(ui.requests[1].url, '/api/online-image');
    assert.equal(JSON.parse(ui.requests[1].options.body).reference_images[0].url, '/assets/input/ok.png');
    ui.requests[1].resolve(uploadResponse(true, {images:['/image.png'], timestamp:'1'}));
    await generate;
    assert.deepEqual(ui.alerts, ['online.uploadPending']);
    assert.equal(ui.element('outputImg').src, '/image.png');
});

test('cleared or replaced uploads cannot restore an obsolete reference', async () => {
    const ui = page();
    const first = vm.runInContext('handleFile({name:"old.png"}, 1)', ui.context);
    vm.runInContext('clearSlot(1)', ui.context);
    ui.requests[0].resolve(uploadResponse(true, {files:[{url:'/old.png'}]}));
    await first;
    assert.equal(vm.runInContext('refs[1]', ui.context), null);
    assert.equal(ui.element('prev1').classList.contains('hidden'), true);

    const second = vm.runInContext('handleFile({name:"second.png"}, 1)', ui.context);
    const third = vm.runInContext('handleFile({name:"third.png"}, 1)', ui.context);
    ui.requests[2].resolve(uploadResponse(true, {files:[{url:'/third.png'}]}));
    await third;
    ui.requests[1].resolve(uploadResponse(true, {files:[{url:'/second.png'}]}));
    await second;
    assert.equal(vm.runInContext('refs[1].url', ui.context), '/third.png');
    assert.equal(ui.element('prev1').src, 'data:third.png');
});
