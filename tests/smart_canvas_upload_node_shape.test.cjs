const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
const append = source.match(/function appendImagesToSmartNode\(uploaded, targetId='', opts=\{\}\)\{[\s\S]*?(?=\nasync function handleFiles)/)[0];

function createUi(selected) {
    const scope = vm.createContext({
        nodes: selected ? [selected] : [],
        selectedId: selected?.id || '',
        selectedIds: [],
        undoSuppressed: false,
        targetGroup: null,
        isSmartGroupNode: () => false,
        isSmartImageNode: node => node?.type === 'smart-image',
        selectedNode: () => selected || null,
        viewportCenter: () => ({x: 0, y: 0}),
        nodeRect: node => ({x: node.x || 0, y: node.y || 0, width: node._rect.width, height: node._rect.height}),
        nodeScale: node => Number(node.scale) > 0 ? Number(node.scale) : 1,
        createImageNodeAt: point => {
            const node = {id:'created', type:'smart-image', x:point.x, y:point.y, images:[], scale:2, _rect:{width:316, height:194}};
            scope.nodes.push(node);
            scope.selectedId = node.id;
            return node;
        },
        mediaKindForItem: () => 'audio',
        uploadTitleForItems: (_items, fallback) => fallback,
        addNodeToSmartGroup: () => {},
        render: () => {},
        scheduleSave: () => {},
        MEDIA_NODE_DEFAULT_SCALE: 2,
        MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE: 1.6,
        MEDIA_GROUP_DEFAULT_SCALE: 0.8,
        opts: {},
    });
    vm.runInContext(append, scope);
    return scope;
}

test('上传到已有节点后保留原宽高和缩放', () => {
    const node = {id:'existing', type:'smart-image', x:10, y:20, images:[{url:'/old.png'}], scale:2, _rect:{width:520, height:364}};
    const scope = createUi(node);
    const result = vm.runInContext("appendImagesToSmartNode([{url:'/audio.wav', kind:'audio'}], 'existing')", scope);
    assert.equal(result.w, 520);
    assert.equal(result.h, 364);
    assert.equal(result.scale, 2);
    assert.equal(result.images.length, 2);
});

test('上传到空节点后保留空节点默认尺寸', () => {
    const scope = createUi(null);
    const result = vm.runInContext("appendImagesToSmartNode([{url:'/audio.wav', kind:'audio'}])", scope);
    assert.equal(result.w, 316);
    assert.equal(result.h, 194);
    assert.equal(result.scale, 2);
    assert.equal(result.images.length, 1);
});
