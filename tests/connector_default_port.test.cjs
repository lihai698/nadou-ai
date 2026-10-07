const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('外部素材工具默认连接当前后端端口', () => {
    const files = [
        'tools/photoshop-asset-connector/js/app.js',
        'tools/chrome-local-asset-importer/popup.html',
        'tools/chrome-local-asset-importer/sidepanel.html',
        'tools/chrome-local-asset-importer/popup.js',
    ];
    const text = files.map((file) => readFileSync(path.join(root, file), 'utf8')).join('\n');
    assert.match(text, /127\.0\.0\.1:3000/);
    assert.doesNotMatch(text, /8767/);
});
