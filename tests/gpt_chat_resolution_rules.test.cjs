const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = readFileSync(path.join(root, 'static/gpt-chat.html'), 'utf8');
const rules = require('../static/js/gpt-chat-resolution-rules.js');

test('GPT chat resolution rules preserve preset and custom size behavior', () => {
    assert.equal(rules.normalizeCustomSize(' 1536 X 2048 '), '1536x2048');
    assert.equal(rules.normalizeCustomSize('1024*768'), '1024x768');
    assert.equal(rules.normalizeCustomSize('255x768'), '');
    assert.equal(rules.normalizeCustomSize('8193x768'), '');
    assert.equal(rules.sizeForResolution({ratio: 'landscape', resolution: '2k'}), '1536x1024');
    assert.equal(rules.sizeForResolution({ratio: 'portrait43', resolution: '4k'}), '2448x3264');
    assert.equal(rules.sizeForResolution({ratio: 'missing', resolution: '1k'}), '1024x1024');
    assert.equal(rules.sizeForResolution({ratio: 'square', resolution: 'custom', customSize: '123x768'}), '1024x1024');
    assert.equal(rules.sizeForResolution({ratio: 'square', resolution: 'custom', customSize: '1234x768'}), '1234x768');
});

test('GPT chat prompt parsing keeps direct sizes, ratio mapping, and resolution inference', () => {
    assert.equal(rules.sizeFromPrompt({message: '做一张 1536x1024 的横图'}), '1536x1024');
    assert.equal(rules.sizeFromPrompt({message: '做一张 3：2 高清横图', fallbackSize: '1024x1024'}), '1536x1024');
    assert.equal(rules.sizeFromPrompt({message: '做一张 9/16 超清海报', fallbackSize: '1024x1024'}), '1440x2560');
    assert.equal(rules.sizeFromPrompt({message: '保持原尺寸', fallbackSize: '1536x1024'}), '1536x1024');
    assert.equal(rules.sizeFromPrompt({message: '改成 16:9', fallbackSize: '2048x1536', resolution: 'custom'}), '2048x1536');
    assert.equal(rules.sizeFromPrompt({message: '改成 16:9 2K', fallbackSize: '1024x1024', resolution: 'custom'}), '1920x1080');

    assert.equal(rules.resolutionForRequest({resolution: '4k', message: '', requestedSize: '1024x1024'}), '4k');
    assert.equal(rules.resolutionForRequest({resolution: 'auto', message: '需要高清', requestedSize: '1024x1024'}), '2k');
    assert.equal(rules.resolutionForRequest({resolution: 'auto', message: '', requestedSize: '3000x2000'}), '4k');
    assert.equal(rules.resolutionForRequest({resolution: 'auto', message: '', requestedSize: '1024x1024'}), '1k');
});

test('real GPT chat page loads resolution rules before its inline controller', () => {
    const scriptUrls = [...html.matchAll(/<script\s+src="([^"]+)"/g)]
        .map(match => match[1].split('?')[0]);
    const rulesIndex = scriptUrls.indexOf('/static/js/gpt-chat-resolution-rules.js');
    assert.ok(rulesIndex >= 0);

    const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
    const pageScript = inlineScripts.at(-1) || '';
    assert.match(pageScript, /window\.GptChatResolutionRules/);
    assert.match(pageScript, /GptChatResolutionRules\.sizeFromPrompt/);
    assert.match(pageScript, /GptChatResolutionRules\.resolutionForRequest/);
    assert.doesNotMatch(pageScript, /function\s+chatSizeFromPrompt\s*\([^)]*\)\s*\{\s*const\s+text\s*=/);
    assert.doesNotMatch(pageScript, /function\s+normalizeChatCustomSize\s*\([^)]*\)\s*\{\s*const\s+match\s*=/);
});
