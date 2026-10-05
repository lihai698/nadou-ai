const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const {createStorageFileBrowser} = require('../static/js/asset-manager-storage-files.js');

function deferred(){
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return {promise, resolve, reject};
}

test('storage directory switch accepts the latest click while an earlier request is pending', async () => {
    const requests = [];
    const browser = createStorageFileBrowser({
        loadPage(kind, offset, limit){
            const result = deferred();
            requests.push({kind, offset, limit, ...result});
            return result.promise;
        },
        onChange(){}
    });
    browser.begin();
    const oldLoad = browser.load('generated');
    const newLoad = browser.load('upload');
    assert.deepEqual(requests.map(item => item.kind), ['generated', 'upload']);
    requests[1].resolve({items:[{id:'new', name:'upload.png'}], total:1, has_more:false});
    assert.equal(await newLoad, true);
    requests[0].resolve({items:[{id:'old', name:'generated.png'}], total:1, has_more:false});
    assert.equal(await oldLoad, false);
    assert.equal(browser.state.kind, 'upload');
    assert.deepEqual(browser.state.items.map(item => item.id), ['new']);
    assert.equal(browser.state.loading, false);
});

test('closing and reopening discards old results and errors', async () => {
    const requests = [];
    let changes = 0;
    const browser = createStorageFileBrowser({
        loadPage(){
            const result = deferred();
            requests.push(result);
            return result.promise;
        },
        onChange(){ changes++; }
    });
    const firstSession = browser.begin();
    const oldLoad = browser.load('generated');
    browser.close();
    const nextSession = browser.begin();
    assert.equal(browser.isCurrent(firstSession), false);
    assert.equal(browser.isCurrent(nextSession), true);
    const newLoad = browser.load('local');
    requests[0].reject(new Error('old request failed'));
    assert.equal(await oldLoad, false);
    requests[1].resolve({items:[{id:'local-1'}], total:1, has_more:false});
    assert.equal(await newLoad, true);
    assert.deepEqual(browser.state.items.map(item => item.id), ['local-1']);
    assert.equal(changes, 3);
});

test('pagination retains selection and scroll, then a new directory clears both', async () => {
    const calls = [];
    const browser = createStorageFileBrowser({
        pageSize:2,
        loadPage:async (kind, offset, limit) => {
            calls.push({kind, offset, limit});
            if(kind === 'upload') return {items:[{id:'other'}], total:1, has_more:false};
            return offset === 0
                ? {items:[{id:'one'}, {id:'two'}], total:3, has_more:true}
                : {items:[{id:'three'}], total:3, has_more:false};
        },
        onChange(){}
    });
    browser.begin();
    await browser.load('generated');
    browser.select('one', true);
    assert.equal(await browser.load('generated', {append:true, scrollTop:125}), true);
    assert.deepEqual(calls.slice(0, 2), [
        {kind:'generated', offset:0, limit:2}, {kind:'generated', offset:2, limit:2}
    ]);
    assert.deepEqual([...browser.state.selected], ['one']);
    assert.equal(browser.state.restoreScrollTop, 125);
    assert.equal(browser.state.total, 3);
    assert.equal(await browser.load('generated', {append:true}), false);
    browser.selectAll();
    assert.equal(browser.state.selected.size, 3);
    await browser.load('upload');
    assert.equal(browser.state.selected.size, 0);
    assert.equal(browser.state.restoreScrollTop, null);
});

test('real asset page loads the controller before its only page entry', () => {
    const root = path.join(__dirname, '..');
    const html = readFileSync(path.join(root, 'static/asset-manager.html'), 'utf8');
    const urls = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1].split('?')[0]);
    const controller = urls.indexOf('/static/js/asset-manager-storage-files.js');
    const entry = urls.indexOf('/static/js/asset-manager.js');
    assert.ok(controller >= 0 && controller < entry);
    assert.equal(urls.filter(url => url === '/static/js/asset-manager.js').length, 1);
    const source = readFileSync(path.join(root, 'static/js/asset-manager.js'), 'utf8');
    assert.match(source, /storageFileBrowser\.load\(kind,/);
    assert.doesNotMatch(source, /storageSettingsState\.loadingMore/);
});
