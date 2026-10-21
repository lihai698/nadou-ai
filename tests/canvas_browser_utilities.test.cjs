const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../static/js/canvas-browser-utilities.js');

function editor(options={}){
    const calls=[],listeners=new Set(),texts=[];
    const deps={window:{isSecureContext:options.secure??true},navigator:{clipboard:{}},document:{
        addEventListener(type,fn){assert.equal(type,'copy');listeners.add(fn);calls.push('listen');},
        removeEventListener(type,fn){assert.equal(type,'copy');assert.ok(listeners.delete(fn));calls.push('unlisten');},
        execCommand(command){
            assert.equal(command,'copy');calls.push('copy');
            if(options.throwCopy)throw Error('copy unavailable');
            if(options.copyEvent!==false)for(const fn of listeners)fn({preventDefault(){calls.push('prevent');},clipboardData:{setData(type,value){assert.equal(type,'text/plain');texts.push(value);}}});
            return options.copyResult??true;
        },
        createElement(tag){
            assert.equal(tag,'textarea');calls.push('create');
            const ta={style:{},setAttribute(k,v){assert.equal(k,'readonly');assert.equal(v,'');},focus(args){assert.deepEqual(args,{preventScroll:true});calls.push('focus');},select(){calls.push('select');},setSelectionRange(a,b){assert.equal(a,0);assert.equal(b,ta.value.length);},remove(){calls.push('remove');}};
            return ta;
        },
        body:{appendChild(ta){assert.equal(ta.style.position,'fixed');calls.push('append');}},
    }};
    for(const name of Object.keys(api))deps[name]=(...args)=>api[name](deps,...args);
    return {deps,calls,listeners,texts};
}

test('validation errors retain Chinese messages and field locations',()=>{
    assert.equal(api.apiErrorMessage({}, {detail:[{loc:['body','items',0,'name'],msg:'不能为空'},'其他错误',null]}),'items.0.name: 不能为空\n其他错误\nnull');
});
test('error priority and object messages retain original behavior',()=>{
    assert.equal(api.apiErrorMessage({}, {detail:'具体原因',error:'后备'}),'具体原因');
    assert.equal(api.apiErrorMessage({}, {error:{message:'错误正文'}}),'错误正文');
    assert.equal(api.apiErrorMessage({}, {message:{msg:'消息'}}),'消息');
    assert.equal(api.apiErrorMessage({}, '原文'),'原文');
});
test('empty and missing errors use the supplied fallback',()=>{
    for(const value of [null,undefined,false,0,'',{detail:[]},{detail:''}])assert.equal(api.apiErrorMessage({},value,'重试'),'重试');
});
test('unknown error objects retain their JSON body and cyclic top-level values fall back',()=>{
    assert.equal(api.apiErrorMessage({}, {code:42}),'{'+'"code":42}');
    const cyclic={};cyclic.self=cyclic;assert.equal(api.apiErrorMessage({},cyclic,'重试'),'重试');
});
test('malformed cyclic validation items still raise instead of hiding failures',()=>{
    const cyclic={};cyclic.self=cyclic;assert.throws(()=>api.apiErrorMessage({}, {detail:[cyclic]}),TypeError);
});
test('response JSON uses the caller error interpreter without consuming the original body',async()=>{
    const {deps}=editor();const calls=[];deps.apiErrorMessage=(data,fallback)=>{calls.push([data,fallback]);return '解释结果';};
    const response={clone(){calls.push('clone');return {async json(){return {detail:'原始'};}};},text(){throw Error('original body consumed');}};
    assert.equal(await api.responseErrorMessage(deps,response,'后备'),'解释结果');assert.deepEqual(calls,['clone',[{detail:'原始'},'后备']]);
});
test('non-JSON response returns exact original text',async()=>{
    assert.equal(await api.responseErrorMessage({}, {clone(){return {json:async()=>{throw Error();}};},text:async()=>'中文\nraw'},'后备'),'中文\nraw');
});
test('response clone and text failures use fallback',async()=>{
    for(const text of [async()=>'',async()=>{throw Error();}])assert.equal(await api.responseErrorMessage({}, {clone(){throw Error();},text},'后备'),'后备');
});
test('copy listener supplies plain text and removes itself',()=>{
    const {deps,calls,listeners,texts}=editor();assert.equal(api.copyTextWithCopyEvent(deps,'中文\n正文'),true);
    assert.deepEqual(texts,['中文\n正文']);assert.equal(listeners.size,0);assert.deepEqual(calls,['listen','copy','prevent','unlisten']);
});
test('copy listener cleans up when execCommand throws',()=>{
    const {deps,calls,listeners}=editor({throwCopy:true});assert.equal(api.copyTextWithCopyEvent(deps,'正文'),false);assert.equal(listeners.size,0);assert.deepEqual(calls,['listen','copy','unlisten']);
});
test('copy command success without a copy event remains unconfirmed',()=>{
    const {deps,listeners}=editor({copyEvent:false});assert.equal(api.copyTextWithCopyEvent(deps,'正文'),false);assert.equal(listeners.size,0);
});
test('textarea copy cleans up the hidden element after success',()=>{
    const {deps,calls}=editor();assert.equal(api.copyTextWithTextarea(deps,'正文'),true);assert.deepEqual(calls,['create','append','focus','select','copy','remove']);
});
test('textarea copy cleans up the element after failure',()=>{
    const {deps,calls}=editor({throwCopy:true});assert.equal(api.copyTextWithTextarea(deps,'正文'),false);assert.equal(calls.at(-1),'remove');
});
test('clipboard verification distinguishes matches, mismatches and denied reads',async()=>{
    const {deps}=editor();deps.navigator.clipboard.readText=async()=>'正文';assert.equal(await api.clipboardMatchesText(deps,'正文'),true);assert.equal(await api.clipboardMatchesText(deps,'其他'),false);
    deps.navigator.clipboard.readText=async()=>{throw Error('denied');};assert.equal(await api.clipboardMatchesText(deps,'正文'),null);
    deps.window.isSecureContext=false;deps.navigator.clipboard.readText=()=>{throw Error('must not call');};assert.equal(await api.clipboardMatchesText(deps,'正文'),null);
});
test('empty clipboard requests have no browser side effects',async()=>{
    const {deps,calls}=editor();for(const value of ['',null,undefined,0,false])assert.equal(await api.copyTextToClipboard(deps,value),false);assert.deepEqual(calls,[]);
});
test('successful event copy short-circuits textarea and native clipboard writes',async()=>{
    const {deps,calls,texts}=editor();deps.navigator.clipboard.readText=async()=>'正文';deps.navigator.clipboard.writeText=async()=>{throw Error('unexpected native write');};
    assert.equal(await api.copyTextToClipboard(deps,'正文'),true);assert.deepEqual(texts,['正文']);assert.ok(!calls.includes('create'));
});
test('event failure falls back to textarea and denied verification preserves success',async()=>{
    const {deps,calls}=editor({copyEvent:false});deps.navigator.clipboard.readText=async()=>{throw Error('denied');};assert.equal(await api.copyTextToClipboard(deps,'正文'),true);assert.ok(calls.includes('create'));assert.equal(calls.at(-1),'remove');
});
test('readback mismatch rejects the first successful copy',async()=>{
    const {deps}=editor();deps.navigator.clipboard.readText=async()=>'其他';assert.equal(await api.copyTextToClipboard(deps,'正文'),false);
});
test('failed legacy copies use native write and verify exact text',async()=>{
    const {deps}=editor({copyResult:false});const writes=[];deps.navigator.clipboard.writeText=async text=>writes.push(text);deps.navigator.clipboard.readText=async()=>writes.at(-1);
    assert.equal(await api.copyTextToClipboard(deps,123),true);assert.deepEqual(writes,['123']);
});
test('insecure native fallback and denied writes return false',async()=>{
    const {deps}=editor({copyResult:false,secure:false});deps.navigator.clipboard.writeText=async()=>{throw Error('must not write');};assert.equal(await api.copyTextToClipboard(deps,'正文'),false);
    deps.window.isSecureContext=true;assert.equal(await api.copyTextToClipboard(deps,'正文'),false);
});
test('two callers have isolated browser environments and temporary listeners',async()=>{
    const a=editor(),b=editor();assert.equal(await a.deps.copyTextToClipboard('甲'),true);assert.equal(await b.deps.copyTextToClipboard('乙'),true);assert.deepEqual(a.texts,['甲']);assert.deepEqual(b.texts,['乙']);assert.equal(a.listeners.size+b.listeners.size,0);
});
test('caller callbacks remain live between operations',async()=>{
    const {deps}=editor();deps.copyTextWithCopyEvent=()=>true;deps.clipboardMatchesText=async()=>false;assert.equal(await api.copyTextToClipboard(deps,'正文'),false);deps.clipboardMatchesText=async()=>true;assert.equal(await api.copyTextToClipboard(deps,'正文'),true);
});
