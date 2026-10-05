const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = readFileSync(path.join(root, 'static/online.html'), 'utf8');
const rules = require('../static/js/online-image-size-rules.js');

test('online image size rules keep preset, custom ratio, and custom size behavior', () => {
    assert.deepEqual(rules.parseSizeValue(' 1536 X 2048 '), {width: '1536', height: '2048'});
    assert.deepEqual(rules.parseSizeValue('1024*768'), {width: '1024', height: '768'});
    assert.equal(rules.parseSizeValue('not-a-size'), null);
    assert.equal(rules.customRatioValue('3', '4'), 0.75);
    assert.equal(rules.customRatioValue('0', '4'), null);
    assert.equal(rules.customSizeValue('123.4', '567.8'), '123x568');
    assert.equal(rules.customSizeValue('', '567'), '');

    assert.equal(rules.currentSize({ratio: 'square', resolution: '1k'}), '1024x1024');
    assert.equal(rules.currentSize({ratio: 'landscape43', resolution: '2k'}), '2048x1536');
    assert.equal(rules.currentSize({
        ratio: 'custom', resolution: '2k', customRatioWidth: '3', customRatioHeight: '4',
    }), '1536x2048');
    assert.equal(rules.currentSize({
        ratio: '', resolution: 'custom', customWidth: '123.4', customHeight: '567.8',
    }), '123x568');
});

test('real online page loads size rules before its inline page controller', () => {
    const scriptUrls = [...html.matchAll(/<script\s+src="([^"]+)"/g)]
        .map(match => match[1].split('?')[0]);
    const rulesIndex = scriptUrls.indexOf('/static/js/online-image-size-rules.js');
    assert.ok(rulesIndex >= 0);

    const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
    const pageScript = inlineScripts.at(-1) || '';
    assert.match(pageScript, /window\.OnlineImageSizeRules/);
    assert.match(pageScript, /calculateCurrentSize/);
    assert.doesNotMatch(pageScript, /const\s+RES_LONG_SIDE\s*=/);
    assert.doesNotMatch(pageScript, /function\s+customRatioValue\s*\(/);
});
