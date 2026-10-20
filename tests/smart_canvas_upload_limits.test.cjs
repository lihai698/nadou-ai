const {test} = require('node:test');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
const upload = source.match(/async function uploadFiles\(files\)\{[\s\S]*?\n\}/)[0];

function context(lang, response){
    const calls = [];
    const scope = createTaskContext({
        window:{StudioI18n:{lang:()=>lang}},
        SMART_UPLOAD_MAX:20,
        SMART_UPLOAD_MAX_FILE_BYTES:100 * 1024 * 1024,
        SMART_UPLOAD_MAX_BATCH_BYTES:500 * 1024 * 1024,
        isSupportedUploadFile:()=>true,
        FormData:class {append(){}},
        mediaKindForFile:()=> 'audio',
        tr:key=>key,
        fetch:async url=>{calls.push(url);return response || {ok:true,json:async()=>({files:[{url:'/test.wav'}]})};},
    });
    vm.runInContext(source.match(/async function smartResponseErrorMessage\([^\n]*\)\{[\s\S]*?\n\}/)[0] + '\n' + upload, scope);
    return {scope,calls};
}

for(const lang of ['zh','en']){
    test(`smart ${lang}: oversized audio shows the size limit before uploading`,async()=>{
        const ui=context(lang);
        await assert.rejects(vm.runInContext('uploadFiles([{name:"large.wav",size:100*1024*1024+1}])',ui.scope),
            lang==='en' ? /large.wav exceeds 100MB/ : /large.wav超过 100MB，无法上传/);
        assert.equal(ui.calls.length,0);
    });
    test(`smart ${lang}: excessive batch shows the total size limit before uploading`,async()=>{
        const ui=context(lang);
        await assert.rejects(vm.runInContext('uploadFiles(Array.from({length:6},()=>({name:"audio.wav",size:90*1024*1024})))',ui.scope),
            lang==='en' ? /500MB batch limit/ : /本次上传总大小超过 500MB/);
        assert.equal(ui.calls.length,0);
    });
}

test('smart audio exactly at the file limit still uploads',async()=>{
    const ui=context('zh');
    const result=await vm.runInContext('uploadFiles([{name:"limit.wav",size:100*1024*1024}])',ui.scope);
    assert.equal(result[0].url,'/test.wav');
    assert.equal(result[0].kind,'audio');
    assert.deepEqual(ui.calls,['/api/ai/upload']);
});

test('smart failed upload shows the server message without JSON syntax',async()=>{
    const response={ok:false,clone:()=>({json:async()=>({detail:'上传中断，请重试'})}),text:async()=>' {"detail":"上传中断，请重试"}'};
    const ui=context('zh',response);
    await assert.rejects(vm.runInContext('uploadFiles([{name:"audio.wav",size:100}])',ui.scope),
        error=>error.message==='上传中断，请重试');
    assert.equal(ui.calls.length,1);
});
