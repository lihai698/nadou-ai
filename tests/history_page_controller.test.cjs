const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const {createHistoryPager} = require('../static/js/history-page-controller.js');

function deferred(){
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return {promise, resolve, reject};
}

test('history pager fetches once, slices pages, and stops after the final page', async () => {
    const calls = [];
    const pager = createHistoryPager({
        pageSize: 2,
        loadItems: async () => {
            calls.push('fetch');
            return [{timestamp:1}, {timestamp:2}, {timestamp:3}, {timestamp:4}, {timestamp:5}];
        }
    });

    const first = await pager.load({reset:true});
    assert.deepEqual(first.items.map(item => item.timestamp), [1, 2]);
    assert.equal(first.done, false);
    assert.equal(pager.state.offset, 2);

    const second = await pager.load();
    assert.deepEqual(second.items.map(item => item.timestamp), [3, 4]);
    const last = await pager.load();
    assert.deepEqual(last.items.map(item => item.timestamp), [5]);
    assert.equal(last.done, true);
    assert.deepEqual(await pager.load(), {accepted:false, items:[], reset:false});
    assert.deepEqual(calls, ['fetch']);
});

test('history pager ignores duplicate prepends and keeps the next offset stable', async () => {
    const pager = createHistoryPager({
        pageSize: 2,
        loadItems: async () => [{timestamp:'a'}, {timestamp:'b'}, {timestamp:'c'}]
    });
    await pager.load({reset:true});
    assert.equal(pager.prepend({timestamp:'new'}), true);
    assert.equal(pager.prepend({timestamp:'new'}), false);
    assert.equal(pager.state.offset, 3);
    assert.deepEqual((await pager.load()).items.map(item => item.timestamp), ['c']);
    assert.equal(pager.remove('new'), true);
    assert.equal(pager.remove('new'), false);
    assert.equal(pager.state.offset, 3);
    assert.equal(pager.state.sourceLength, 3);
});

test('history pager rejects concurrent loads and exposes a failed fetch for retry', async () => {
    const firstRequest = deferred();
    let attempts = 0;
    const pager = createHistoryPager({
        pageSize: 2,
        loadItems: () => {
            attempts += 1;
            return attempts === 1 ? firstRequest.promise : Promise.resolve([{timestamp:'ok'}]);
        }
    });
    const first = pager.load({reset:true});
    assert.equal((await pager.load({reset:true})).accepted, false);
    firstRequest.reject(new Error('temporary failure'));
    await assert.rejects(first, /temporary failure/);
    assert.equal(pager.state.loading, false);
    assert.match(pager.state.error.message, /temporary failure/);
    assert.deepEqual((await pager.load({reset:true})).items.map(item => item.timestamp), ['ok']);
});

test('zimage page loads the controller before its inline gallery entry and removes the old pager state', () => {
    const root = path.join(__dirname, '..');
    const html = readFileSync(path.join(root, 'static/zimage.html'), 'utf8');
    const controllerIndex = html.indexOf('/static/js/history-page-controller.js');
    const inlineIndex = html.indexOf('<script>', controllerIndex);
    assert.ok(controllerIndex >= 0);
    assert.ok(inlineIndex > controllerIndex);
    assert.equal((html.match(/history-page-controller\.js/g) || []).length, 1);
    assert.match(html, /HistoryPageController\.createHistoryPager/);
    assert.doesNotMatch(html, /(?:let|const|var)\s+(?:allHistory|currentIndex|isLoading)\s*=/);
    assert.match(html, /historyPager\.state\.hasMore/);
});
