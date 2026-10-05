const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const rules = require('../static/js/canvas-task-error-rules.js');
const html = readFileSync(path.join(root, 'static/canvas.html'), 'utf8');
const canvasSource = readFileSync(path.join(root, 'static/js/canvas.js'), 'utf8');

test('canvas task error rules preserve restart, network, and ordinary messages', () => {
    const options = {fallback:'默认失败', restartMessage:'后端已重启'};
    assert.equal(rules.normalizeErrorMessage('', options), '默认失败');
    assert.equal(rules.normalizeErrorMessage(new Error('backend restarted and task status was lost'), options), '后端已重启');
    assert.equal(rules.normalizeErrorMessage(new Error('404 canvas-image-task not found'), options), '后端已重启');
    assert.equal(rules.normalizeErrorMessage(new TypeError('Failed to fetch'), options), '后端已重启');
    assert.equal(rules.normalizeErrorMessage(new Error('供应商拒绝请求'), options), '供应商拒绝请求');
});

test('real canvas page loads task error rules before the page controller', () => {
    const scriptUrls = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1].split('?')[0]);
    const rulesIndex = scriptUrls.indexOf('/static/js/canvas-task-error-rules.js');
    const pageIndex = scriptUrls.indexOf('/static/js/canvas.js');
    assert.ok(rulesIndex >= 0 && rulesIndex < pageIndex);
    assert.match(canvasSource, /CanvasTaskErrorRules\.normalizeErrorMessage/);
    assert.doesNotMatch(canvasSource, /function normalizeCanvasTaskError\(err, fallback=''\)\{[\s\S]*?backend restarted and task status was lost/);
});
