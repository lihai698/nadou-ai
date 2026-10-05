const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');

function source(relative){
    return readFileSync(path.join(__dirname, '..', relative), 'utf8');
}
function section(text, begin, end){
    const start = text.indexOf(begin);
    const stop = text.indexOf(end, start);
    assert.ok(start >= 0 && stop > start, `${begin} should precede ${end}`);
    return text.slice(start, stop);
}
function translations(page){
    let bundle;
    const context = {
        window:{StudioI18n:{register:value=>{bundle = value;}},addEventListener:()=>{}},
        document:{addEventListener:()=>{}},
    };
    vm.runInNewContext(source(`static/js/i18n/${page}.js`), context);
    assert.ok(bundle);
    return bundle;
}

test('asset manager reports only files actually deleted and names protected files', async()=>{
    const script = section(source('static/js/asset-manager.js'),
        'async function deleteLocalAssets(ids){', 'async function saveLocalUploadInlineName(');
    const bundle = translations('asset-manager');
    for(const language of ['zh', 'en']){
        const messages=[];
        let renders=0;
        const context = vm.createContext({
            findLocalUpload:id=>({file:id}),
            setStatus:message=>messages.push(message),
            apiJson:async()=>({deleted:['free.png'],skipped_referenced:['used.png']}),
            loadLocalAssets:async()=>{},
            activeLocalUploadClassFilter:'',selectedLocalUploadIds:new Set(['used.png']),
            selectedLocalUploadId:'',render:()=>{renders++;},
            window:{StudioI18n:{t:key=>bundle[key][language]}},
        });
        vm.runInContext(script, context);
        await vm.runInContext("deleteLocalAssets(['free.png','used.png'])", context);
        assert.equal(renders,1);
        assert.equal(context.selectedLocalUploadIds.size,0);
        assert.match(messages.at(-1), language === 'zh'
            ? /已删除 1 个素材；1 个仍被使用.*已保留/
            : /Deleted 1 assets; kept 1 still in use/);
    }
});

test('smart canvas shows retention rather than a false deletion success', async()=>{
    const script = section(source('static/js/smart-canvas.js'),
        'async function deleteLocalAssetFromPanel(itemId){', 'function canvasImageDragPayload(');
    const bundle = translations('smart-canvas');
    const notices=[];
    const requests=[];
    const context = vm.createContext({
        activeAssetCategory:()=>({items:[{id:'used',file:'used.png'}]}),
        localAssetLibrary:{items:[]},
        fetch:async(url, options)=>{
            requests.push([url,options?.method]);
            return {ok:true,json:async()=>url.includes('/delete')
                ? {deleted:[],skipped_referenced:['used.png']} : {items:[],tree:null}};
        },
        setLocalAssetLibraryFromResponse:()=>{},renderAssetLibrary:()=>{},
        toast:message=>notices.push(message),tr:key=>bundle[key].zh,
    });
    vm.runInContext(script, context);
    await vm.runInContext("deleteLocalAssetFromPanel('used')", context);
    assert.deepEqual(requests,[['/api/local-assets/delete','POST'],['/api/local-assets',undefined]]);
    assert.match(notices.at(-1), /已保留/);
    assert.doesNotMatch(notices.at(-1), /已删除/);
});
