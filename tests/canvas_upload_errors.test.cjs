const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function page(name){
    const source = readFileSync(path.join(__dirname, '..', 'static/js', name), 'utf8');
    const functionNames = name === 'canvas.js'
        ? ['uploadImageBlobs', 'uploadCroppedBlob', 'uploadFilesToLibrary']
        : ['uploadImageBlobs', 'uploadCroppedBlob'];
    const handlers = functionNames.map(functionName => {
        const pattern = new RegExp(`async function ${functionName}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`);
        const match = source.match(pattern);
        assert.ok(match, `${name}: ${functionName} must exist`);
        return match[0];
    }).join('\n');
    const calls = [];
    const errors = [];
    const responses = [];
    const context = vm.createContext({
        FormData:class {append(){}},
        fetch(url){
            calls.push(url);
            return Promise.resolve(responses.shift());
        },
        showErrorModal(message){ errors.push(message); },
        toast(message){ errors.push(message); },
    });
    new vm.Script(handlers).runInContext(context);
    return {context, calls, errors, responses};
}

const response = (ok, data) => ({ok, json:async () => data});

for(const name of ['canvas.js', 'smart-canvas.js']){
    test(`${name}: successful crop upload returns the saved file`, async () => {
        const ui = page(name);
        ui.responses.push(response(true, {files:[{url:'/crop.png', name:'crop.png'}]}));
        const uploaded = await vm.runInContext('uploadCroppedBlob({}, "crop.png")', ui.context);
        assert.equal(uploaded.url, '/crop.png');
        assert.deepEqual(ui.errors, []);
    });

    test(`${name}: HTTP 413 reports crop upload failure and leaves the image unchanged`, async () => {
        const ui = page(name);
        ui.responses.push(response(false, {detail:'文件超过 100MB，无法上传'}));
        const uploaded = await vm.runInContext('uploadCroppedBlob({}, "crop.png")', ui.context);
        assert.equal(uploaded, undefined);
        assert.deepEqual(ui.calls, ['/api/ai/upload']);
        assert.deepEqual(ui.errors, ['文件超过 100MB，无法上传']);
    });

    test(`${name}: incomplete grid upload is reported instead of partially applied`, async () => {
        const ui = page(name);
        ui.responses.push(response(true, {files:[{url:'/one.png'}]}));
        const files = await vm.runInContext(
            'uploadImageBlobs([{blob:{},name:"one.png"},{blob:{},name:"two.png"}])', ui.context,
        );
        assert.equal(files.length, 0);
        assert.equal(ui.errors.length, 1);
    });
}

test('asset library upload saves all accepted files in one batch', async () => {
    const ui = page('canvas.js');
    ui.responses.push(response(true, {files:[{url:'/one.png',name:'one.png'}]}));
    ui.responses.push(response(true, {library:{id:'library'},items:[{url:'/one.png'}]}));
    const saved = await vm.runInContext(
        'uploadFilesToLibrary([{name:"one.png"}], "library", "category")', ui.context,
    );
    assert.equal(saved.library.id, 'library');
    assert.deepEqual(ui.calls, ['/api/ai/upload', '/api/asset-library/items/batch']);
});

test('asset library reports a partial batch response', async () => {
    const ui = page('canvas.js');
    ui.responses.push(response(true, {files:[{url:'/one.png',name:'one.png'}]}));
    ui.responses.push(response(true, {library:{id:'library'},items:[]}));
    await assert.rejects(
        vm.runInContext('uploadFilesToLibrary([{name:"one.png"}], "library", "category")', ui.context),
        /部分素材未保存/,
    );
});

test('asset library upload rejects HTTP 413 before creating library items', async () => {
    const ui = page('canvas.js');
    ui.responses.push(response(false, {detail:'本次上传总大小超过 500MB'}));
    await assert.rejects(
        vm.runInContext('uploadFilesToLibrary([{name:"large.png"}], "library", "category")', ui.context),
        /500MB/,
    );
    assert.deepEqual(ui.calls, ['/api/ai/upload']);
});
