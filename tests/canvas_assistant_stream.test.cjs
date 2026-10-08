const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context=vm.createContext({window:{},TextDecoder,Uint8Array});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../static/js/canvas-assistant.js'),'utf8'),context);
const consume=context.window.CanvasAssistant.consumeStream;
function response(chunks){
    let index=0,released=false;
    return {body:{getReader:()=>({read:async()=>index<chunks.length?{done:false,value:Buffer.from(chunks[index++])}:{done:true},releaseLock(){released=true;}})},released:()=>released};
}
test('分段回复解析中文并以 turn_end 确认完成',async()=>{
    const r=response(['{"type":"text_delta","text":"中文', '回复"}\n{"type":"turn_', 'end","state":"completed"}\n']);
    const events=[];await consume(r,event=>events.push(event));
    assert.equal(events[0].text,'中文回复');assert.equal(events[1].state,'completed');assert.equal(r.released(),true);
});
test('断流和损坏事件不能当作成功，读锁始终释放',async()=>{
    for(const chunks of [['{"type":"text_delta","text":"半段"}\n'],['invalid\n']]){
        const r=response(chunks);await assert.rejects(consume(r,()=>{}));assert.equal(r.released(),true);
    }
});
