const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const context=vm.createContext({window:{},TextDecoder,Uint8Array});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/js/canvas-assistant.js'),'utf8'),context);

test('assistant image choice overrides inherited image model while preserving size and video settings',()=>{
    assert.equal(typeof context.window.CanvasAssistant.creationSettings,'function');
    const inherited={engine:'comfyui',provider_id:'old-platform',model:'old-image',ratio:'9:16',resolution:'4k',videoModel:'video-user'};
    const result=context.window.CanvasAssistant.creationSettings(inherited,JSON.stringify(['image-platform','image-user']));
    assert.equal(result.engine,'api');
    assert.equal(result.provider_id,'image-platform');
    assert.equal(result.model,'image-user');
    assert.equal(result.ratio,'9:16');
    assert.equal(result.resolution,'4k');
    assert.equal(result.videoModel,'video-user');
    assert.equal(inherited.model,'old-image');
});

test('unconfirmed image choice keeps existing canvas settings for compatibility',()=>{
    assert.equal(typeof context.window.CanvasAssistant.creationSettings,'function');
    const inherited={engine:'api',provider_id:'canvas-image',model:'image-original'};
    const result=context.window.CanvasAssistant.creationSettings(inherited,'');
    assert.equal(JSON.stringify(result),JSON.stringify(inherited));
    assert.notEqual(result,inherited);
});
