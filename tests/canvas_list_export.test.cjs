const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {URL} = require('node:url');

const source = readFileSync(path.join(__dirname, '..', 'static/js/canvas-list-export.js'), 'utf8');

function harness(fetchImpl){
    const downloads = [];
    const revoked = [];
    const window = {
        fetch: fetchImpl,
        location: {origin: 'http://localhost'},
        URL: {
            createObjectURL(blob){
                downloads.push({blob, href: `blob:${downloads.length + 1}`, name: ''});
                return downloads.at(-1).href;
            },
            revokeObjectURL(href){ revoked.push(href); },
        },
        document: {
            body: {appendChild(){}},
            createElement(){
                return {
                    click(){ downloads.at(-1).name = this.download; },
                    remove(){},
                    href: '',
                    download: '',
                };
            },
        },
        setTimeout(callback){ callback(); return 1; },
        Blob,
        StudioI18n: {lang: () => 'zh'},
    };
    const context = vm.createContext({
        window,
        TextEncoder,
        Uint8Array,
        Uint32Array,
        DataView,
        Blob,
        URL,
        console,
    });
    vm.runInContext(source, context, {filename: 'canvas-list-export.js'});
    return {module: window.CanvasListExport, downloads, revoked};
}

test('canvas list export helpers scan unique local and remote resource URLs', ()=>{
    const {module} = harness(async()=>({ok:true, json:async()=>({})}));
    assert.equal(module.safeExportBase(' bad/name?.json '), 'bad_name_.json');
    assert.deepEqual(Array.from(module.collectCanvasResourceUrls({
        a: '/assets/a.png',
        nested: ['/assets/a.png', '/output/b.mp4', 'https://example.test/c.png', 'plain text'],
    })), ['/assets/a.png', '/output/b.mp4', 'https://example.test/c.png']);
});

test('canvas list exports JSON with the current title and localized status', async()=>{
    const canvas = {id: 'c1', title: '我的/画布'};
    const payload = {canvas: {...canvas, nodes: [{id: 1}]}};
    const {module, downloads, revoked} = harness(async(url)=>{
        assert.equal(url, '/api/canvases/c1');
        return {ok: true, json: async()=>payload};
    });
    const statuses = [];
    await module.exportCanvas('c1', {
        canvas,
        setStatus: value => statuses.push(value),
        translate: (zh, en) => zh,
    });
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].name, '我的_画布.json');
    assert.deepEqual(JSON.parse(await downloads[0].blob.text()), payload.canvas);
    assert.deepEqual(statuses, ['正在导出...', '已导出']);
    assert.deepEqual(revoked, ['blob:1']);
});

test('canvas list exports a ZIP manifest, duplicate names, and skipped resource details', async()=>{
    const payload = {canvas: {
        title: '素材画布',
        image: '/assets/a/one.png',
        second: '/assets/b/one.png',
        missing: '/assets/missing.bin',
    }};
    const requests = [];
    const {module, downloads} = harness(async(url)=>{
        requests.push(url);
        if(url === '/api/canvases/c1') return {ok: true, json: async()=>payload};
        if(url.endsWith('/missing.bin')) return {ok: false, status: 404, arrayBuffer: async()=>new ArrayBuffer(0)};
        return {ok: true, arrayBuffer: async()=>new Uint8Array([1, 2, 3]).buffer};
    });
    const statuses = [];
    await module.exportCanvasWithResources('c1', {
        canvas: {title: '素材画布'},
        setStatus: value => statuses.push(value),
        translate: (zh, en) => zh,
    });
    assert.deepEqual(requests, ['/api/canvases/c1', '/assets/a/one.png', '/assets/b/one.png', '/assets/missing.bin']);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].name, '素材画布.zip');
    const bytes = new Uint8Array(await downloads[0].blob.arrayBuffer());
    assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
    const zipText = new TextDecoder().decode(bytes);
    assert.match(zipText, /canvas\.json/);
    assert.match(zipText, /resources\/one\.png/);
    assert.match(zipText, /resources\/one-2\.png/);
    assert.match(zipText, /resources-manifest\.json/);
    assert.match(zipText, /missing\.bin/);
    assert.deepEqual(statuses, ['正在收集资源...', '已导出，跳过 1 个资源']);
});
