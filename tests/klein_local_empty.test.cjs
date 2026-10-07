const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = readFileSync(path.join(__dirname, '..', 'static', 'klein.html'), 'utf8');
const start = html.indexOf('        async function submitLocal(');
const end = html.indexOf('        // 将主图尺寸', start);
assert.ok(start >= 0 && end > start, 'missing local Klein handler');
const handler = html.slice(start, end);

function makePage(response) {
    const alerts = [];
    const rendered = [];
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) {
            const classes = new Set();
            elements.set(id, {
                value: '', src: '', href: '', disabled: false, style: {}, innerHTML: '',
                classList: {
                    add(name){ classes.add(name); },
                    remove(name){ classes.delete(name); },
                    contains(name){ return classes.has(name); },
                },
            });
        }
        return elements.get(id);
    }
    const context = {
        document: {getElementById: element},
        CLIENT_ID: 'local-test',
        uploadedNames: {1: 'main.png'},
        uploadPending: {},
        base64Images: {1: 'data:image/png;base64,example'},
        fetch: async () => response,
        alert(message){ alerts.push(message); },
        tr(key){ return key; },
        lucide: {createIcons(){}},
        renderImageCard(data){ rendered.push(data); },
    };
    const submitLocal = vm.runInNewContext(`${handler}\nsubmitLocal`, context);
    return {run: submitLocal, alerts, rendered, element};
}

test('empty Klein result reports failure and restores the empty placeholder', async () => {
    const page = makePage({ok: true, json: async () => ({images: []})});
    await page.run();
    assert.deepEqual(page.alerts, ['studio.localRenderFailed']);
    assert.equal(page.element('placeholder').classList.contains('hidden'), false);
    assert.equal(page.element('loader').classList.contains('hidden'), true);
    assert.equal(page.rendered.length, 0);
});

test('Klein error response cannot render an image', async () => {
    const page = makePage({ok: false, json: async () => ({images: ['/output/incorrect.png'], error: '提交失败'})});
    await page.run();
    assert.deepEqual(page.alerts, ['提交失败']);
    assert.equal(page.rendered.length, 0);
});
