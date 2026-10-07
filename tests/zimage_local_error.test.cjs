const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = readFileSync(path.join(__dirname, '..', 'static', 'zimage.html'), 'utf8');
const start = html.indexOf('        async function runLocalTask(');
const end = html.indexOf('        // 工具函数', start);
assert.ok(start >= 0 && end > start, 'missing local generation handler');
const handler = html.slice(start, end);

function runWithResponse(response) {
    const alerts = [];
    const rendered = [];
    let placeholderRemoved = false;
    const fields = {
        width: {value: '1024'},
        height: {value: '1024'},
        masonry: {prepend(){}},
    };
    const context = {
        document: {getElementById(id){ return fields[id]; }},
        CLIENT_ID: 'local-test',
        fetch: async () => response,
        alert(message){ alerts.push(message); },
        tr(key){ return key; },
        setLoading(){},
        createPlaceholder(){ return {remove(){ placeholderRemoved = true; }}; },
        renderImageCard(data){ rendered.push(data); },
    };
    const runLocalTask = vm.runInNewContext(`${handler}\nrunLocalTask`, context);
    return {run: () => runLocalTask('测试提示词'), alerts, rendered, wasPlaceholderRemoved: () => placeholderRemoved};
}

test('a local ComfyUI error is shown instead of disappearing silently', async () => {
    const page = runWithResponse({ok: true, json: async () => ({images: [], error: 'ComfyUI 连接失败'})});
    await page.run();
    assert.deepEqual(page.alerts, ['ComfyUI 连接失败']);
    assert.equal(page.rendered.length, 0);
    assert.equal(page.wasPlaceholderRemoved(), true);
});

test('an empty successful response reports a failure', async () => {
    const page = runWithResponse({ok: true, json: async () => ({images: []})});
    await page.run();
    assert.deepEqual(page.alerts, ['studio.localRenderFailed']);
    assert.equal(page.rendered.length, 0);
});

test('an HTTP failure never renders an image from an error response', async () => {
    const page = runWithResponse({ok: false, json: async () => ({images: ['/output/incorrect.png'], error: '提交失败'})});
    await page.run();
    assert.deepEqual(page.alerts, ['提交失败']);
    assert.equal(page.rendered.length, 0);
});

test('a successful local image still appears in the gallery', async () => {
    const page = runWithResponse({ok: true, json: async () => ({images: ['/output/test.png']})});
    await page.run();
    assert.deepEqual(page.alerts, []);
    assert.equal(page.rendered.length, 1);
});
