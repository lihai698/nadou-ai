const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

for (const page of ['static/zimage.html', 'static/angle.html']) {
    test(`${page} only reads ModelScope token status`, () => {
        const html = readFileSync(path.join(root, page), 'utf8');
        assert.match(html, /\/api\/config\/token\/status/);
        assert.doesNotMatch(html, /fetch\(\s*['"]\/api\/config\/token['"]/);
        assert.doesNotMatch(html, /data\.token/);
    });
}
