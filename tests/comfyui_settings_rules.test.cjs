const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = readFileSync(path.join(root, 'static/comfyui-settings.html'), 'utf8');
const rulesSource = readFileSync(path.join(root, 'static/js/comfyui-settings-rules.js'), 'utf8');
const settingsSource = readFileSync(path.join(root, 'static/js/comfyui-settings.js'), 'utf8');
const apiSettingsSource = readFileSync(path.join(root, 'static/js/api-settings.js'), 'utf8');

test('ComfyUI field rules retain workflow input and media formats', () => {
    const rules = require('../static/js/comfyui-settings-rules.js');
    assert.equal(rules.guessType('clip.mp4?view=1', 'file'), 'video');
    assert.equal(rules.guessType('voice.wav', 'upload'), 'audio');
    assert.equal(rules.guessType('photo.webp', 'upload'), 'image');
    assert.equal(rules.guessType(0.75, 'denoise'), 'slider');
    assert.equal(rules.guessType(12, 'steps'), 'number');
    assert.equal(rules.guessType(true, 'enabled'), 'boolean');
    assert.equal(rules.guessType('hello', 'prompt'), 'textarea');
    assert.equal(rules.fieldKind({type: 'text', input: 'positive', name: '正向条件'}), 'prompt');
    assert.equal(rules.fieldKind({type: 'video', input: 'file'}), 'video');
    assert.equal(rules.fieldKind({type: 'number', input: 'steps'}), 'setting');
    assert.equal(rules.isMediaField({type: 'audio'}), true);
    assert.equal(rules.mediaAccept('video'), 'video/*');
    assert.equal(rules.mediaAccept('audio'), 'audio/*');
    assert.equal(rules.mediaAccept('image'), 'image/*');
});

test('ComfyUI save rules keep address compatibility and reject the first blank field name', () => {
    const rules = require('../static/js/comfyui-settings-rules.js');
    assert.deepEqual(rules.cleanComfyInstances([' 127.0.0.1:8188 ', '', '  ', 'http://host:8188', '127.0.0.1:8188']),
        ['127.0.0.1:8188', 'http://host:8188', '127.0.0.1:8188']);
    const fields = [{input: 'steps', name: '步数'}, {input: 'seed', name: ' '}, {input: 'cfg', name: ''}];
    assert.equal(rules.firstUnnamedField(fields), fields[1]);
    assert.equal(rules.firstUnnamedField([{input: 'steps', name: '步数'}]), undefined);
});

test('media preview uploads guard against stale responses and never fall back to local filenames', () => {
    assert.match(settingsSource, /const previewUploadVersion = \{\};/);
    assert.match(settingsSource, /previewUploadVersion\[`node:\$\{nodeId\}`\] !== version/);
    assert.match(settingsSource, /previewUploadVersion\[`field:\$\{fieldId\}`\] !== version/);
    assert.doesNotMatch(settingsSource, /comfy_name\s*\|\|\s*data\.files\?\.\[0\]\?\.filename\s*\|\|\s*file\.name/);
    assert.match(apiSettingsSource, /const rhPreviewUploadVersion = \{\};/);
    assert.match(apiSettingsSource, /rhPreviewUploadVersion\[key\] !== version/);
    assert.doesNotMatch(apiSettingsSource, /url:uploaded\?\.url \|\| localUrl/);
});

test('real ComfyUI HTML loads rules before page script and page save uses them', async () => {
    const scriptUrls = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1].split('?')[0]);
    const rulesIndex = scriptUrls.indexOf('/static/js/comfyui-settings-rules.js');
    const pageIndex = scriptUrls.indexOf('/static/js/comfyui-settings.js');
    assert.ok(rulesIndex >= 0 && rulesIndex < pageIndex);

    const elements = new Map();
    const element = id => {
        if(!elements.has(id)) elements.set(id, {innerHTML: '', textContent: '', style: {}});
        return elements.get(id);
    };
    const requests = [];
    const alerts = [];
    const window = {
        addEventListener(){},
        parent: {postMessage(){}},
        StudioI18n: {t: key => key, lang: () => 'zh'},
    };
    const context = vm.createContext({
        window,
        document: {getElementById: element, addEventListener(){}},
        fetch: async (url, options) => {
            requests.push({url, options});
            return {ok: true, json: async () => ({instances: JSON.parse(options.body).instances})};
        },
        alert: message => alerts.push(message),
        BroadcastChannel: class {postMessage(){}},
        console,
    });
    for(const url of scriptUrls.slice(rulesIndex, pageIndex + 1)){
        vm.runInContext(readFileSync(path.join(root, url.slice(1)), 'utf8'), context, {filename: url});
    }
    vm.runInContext("comfyInstances = [' 127.0.0.1:8188 ', ' ', 'http://host:8188']", context);
    await vm.runInContext('saveComfyInstances()', context);
    assert.deepEqual(JSON.parse(requests[0].options.body), {instances: ['127.0.0.1:8188', 'http://host:8188']});
    assert.equal(element('status').textContent, 'comfy.backendsSaved');
    assert.equal(alerts.length, 0);

    vm.runInContext("comfyInstances = ['  ']", context);
    await vm.runInContext('saveComfyInstances()', context);
    assert.equal(requests.length, 1);
    assert.equal(alerts[0], 'comfy.needBackend');
});
