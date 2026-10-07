const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const path = require('node:path');

function loadClassicEditor(initialNodes, initialConnections, selectedIds) {
    const source = readFileSync(path.join(__dirname, '../static/js/canvas.js'), 'utf8');
    const fnStart = source.indexOf('function pushUndo(){');
    const fnEnd = source.indexOf('function selectedWorkflowPayload(){', fnStart);
    const keyStart = source.indexOf("window.addEventListener('keydown', e => {");
    const keyEnd = source.indexOf("\n});", keyStart) + 3;
    assert.ok(fnStart >= 0 && fnEnd > fnStart && keyStart >= 0 && keyEnd > keyStart);

    let serial = 0;
    const nodes = structuredClone(initialNodes);
    const connections = structuredClone(initialConnections);
    const handlers = {};
    const body = {tagName: 'BODY', isContentEditable: false};
    const classes = {contains: () => false};
    const context = vm.createContext({
        canvas: {id: 'classic-shortcut-test'},
        nodes,
        connections,
        selected: new Set(selectedIds),
        undoStack: [],
        UNDO_MAX: 20,
        viewport: {scale: 1},
        lastMouseBoard: {x: 760, y: 380},
        lastImagePasteAt: 0,
        clipboard: null,
        uid: prefix => `${prefix}-shortcut-${++serial}`,
        serializableCanvasNode: n => ({...n}),
        serializableCanvasNodes: (list = nodes) => list.map(n => ({...n})),
        canConnect: (from, to) => from !== to && context.nodes.some(n => n.id === from)
            && context.nodes.some(n => n.id === to),
        sanitizeConnections: () => {},
        // 快捷键测试不覆盖深度捕获任务复制；这里只提供真实入口所需的无副作用依赖。
        remapCanvasDepthCopies: () => {},
        syncGeneratorInputs: () => {},
        render: () => {},
        scheduleSave: () => {},
        deleteSelectedNodes: () => {},
        isEditableTarget: target => target?.tagName === 'INPUT'
            || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true,
        setKnifeMode: () => {},
        toggleZoomPreview: () => {},
        groupSelectedImages: () => {},
        performUndo: () => {},
        closeImageEditor: () => {},
        closePromptTemplateModal: () => {},
        navigateOutputLightbox: () => false,
        outputLightbox: {classList: classes},
        promptTemplateModal: {classList: classes},
        assetManagerModal: {classList: classes},
        workflowTransferModal: {classList: classes},
        logModal: {classList: classes},
        document: {
            activeElement: body,
            getElementById: () => ({classList: classes}),
        },
        window: {
            addEventListener: (type, handler) => { handlers[type] = handler; },
            getSelection: () => ({toString: () => ''}),
        },
        setTimeout,
    });
    vm.runInContext(source.slice(fnStart, fnEnd) + source.slice(keyStart, keyEnd), context);

    const dispatch = (key, options = {}) => {
        let prevented = false;
        handlers.keydown({
            key,
            target: body,
            ctrlKey: Boolean(options.ctrlKey),
            metaKey: Boolean(options.metaKey),
            altKey: Boolean(options.altKey),
            shiftKey: Boolean(options.shiftKey),
            repeat: false,
            preventDefault: () => { prevented = true; },
            stopPropagation: () => {},
        });
        return prevented;
    };
    return {context, dispatch, body};
}

function loadSmartEditor(initialNodes, initialConnections, selectedIds) {
    const source = readFileSync(path.join(__dirname, '../static/js/smart-canvas.js'), 'utf8');
    const fnStart = source.indexOf('function cloneSmartNode(');
    const fnEnd = source.indexOf('// 跨页"素材库', fnStart);
    const viewAdjustStart = source.indexOf('function remapSmartViewAdjustRefs(');
    const viewAdjustEnd = source.indexOf('function createSmartViewAdjustApiNode(', viewAdjustStart);
    const keyStart = source.indexOf("window.addEventListener('keydown', e => {");
    const keyEnd = source.indexOf("\n});", keyStart) + 3;
    assert.ok(fnStart >= 0 && fnEnd > fnStart && viewAdjustStart >= 0 && viewAdjustEnd > viewAdjustStart
        && keyStart >= 0 && keyEnd > keyStart);

    let serial = 0;
    const nodes = structuredClone(initialNodes);
    const canvas = {connections: structuredClone(initialConnections)};
    const handlers = {};
    const body = {tagName: 'BODY', isContentEditable: false};
    const classes = {contains: () => false};
    const undoSnapshots = [];
    const context = vm.createContext({
        canvas,
        nodes,
        nodeClipboard: null,
        selectedId: '',
        selectedIds: [...selectedIds],
        selectedImage: {nodeId: '', index: -1},
        lastMouseWorld: {x: 760, y: 380},
        lastNodePasteAt: 0,
        lastImagePasteAt: 0,
        viewportCenter: () => ({x: 500, y: 300}),
        uid: prefix => `${prefix}-shortcut-${++serial}`,
        clearSmartNodeTransientRunState: () => {},
        // 快捷键测试不覆盖深度捕获任务复制；这里只提供真实入口所需的无副作用依赖。
        remapSmartDepthCopies: () => {},
        selectedNodeIds: () => context.selectedIds.slice(),
        isEditableTarget: target => target?.tagName === 'INPUT'
            || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true,
        pushUndo: () => {
            undoSnapshots.push({nodes: structuredClone(context.nodes), connections: structuredClone(context.canvas.connections)});
        },
        render: () => {},
        scheduleSave: () => {},
        toast: () => {},
        toggleZoomPreview: () => {},
        toggleAssetLibrary: () => {},
        selectedNode: () => null,
        world: {querySelectorAll: () => []},
        imageEditModal: {classList: classes},
        imageEditMode: 'edit',
        closeImageEditor: () => {},
        seekPreviewVideoFrames: () => false,
        navigatePreviewImage: () => {},
        performRedo: () => {},
        performUndo: () => {},
        deleteNode: () => {},
        groupSelectedNodes: () => {},
        ungroupNode: () => false,
        window: {
            addEventListener: (type, handler) => { handlers[type] = handler; },
            getSelection: () => ({toString: () => ''}),
        },
        document: {activeElement: body},
        setTimeout,
    });
    vm.runInContext(
        source.slice(fnStart, fnEnd)
        + source.slice(viewAdjustStart, viewAdjustEnd)
        + source.slice(keyStart, keyEnd),
        context,
    );

    const dispatch = (key, options = {}) => {
        handlers.keydown({
            key,
            code: options.code || `Key${String(key).toUpperCase()}`,
            target: body,
            ctrlKey: Boolean(options.ctrlKey),
            metaKey: Boolean(options.metaKey),
            altKey: Boolean(options.altKey),
            shiftKey: Boolean(options.shiftKey),
            repeat: false,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
    };
    return {context, dispatch, body, undoSnapshots};
}

test('普通画布生产 Ctrl+C/V 处理器复制并粘贴节点和内部连线', async () => {
    const editor = loadClassicEditor([
        {id: 'prompt', type: 'prompt', x: 80, y: 100, text: 'A'},
        {id: 'generator', type: 'generator', x: 480, y: 160},
    ], [{id: 'link', from: 'prompt', to: 'generator'}], ['prompt', 'generator']);

    assert.equal(editor.dispatch('c', {ctrlKey: true}), true);
    assert.equal(editor.context.clipboard.nodes.length, 2);
    assert.equal(editor.context.clipboard.connections.length, 1);
    editor.dispatch('v', {ctrlKey: true});
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(editor.context.nodes.length, 4);
    assert.equal(editor.context.connections.length, 2);
    const copiedIds = new Set(editor.context.nodes.slice(2).map(node => node.id));
    assert.deepEqual(new Set(editor.context.connections[1] && [
        editor.context.connections[1].from,
        editor.context.connections[1].to,
    ]), copiedIds);

    editor.context.document.activeElement = {tagName: 'TEXTAREA', isContentEditable: false};
    editor.context.clipboard = null;
    assert.equal(editor.dispatch('c', {ctrlKey: true}), false);
    assert.equal(editor.context.clipboard, null);
});

test('智能画布生产 Ctrl+C/V 处理器复制并粘贴节点和内部连线', async () => {
    const editor = loadSmartEditor([
        {id: 'prompt', type: 'smart-prompt', x: 80, y: 100, text: 'A'},
        {id: 'image', type: 'smart-image', x: 480, y: 160, images: []},
    ], [{id: 'link', from: 'prompt', to: 'image'}], ['prompt', 'image']);

    editor.dispatch('c', {ctrlKey: true});
    assert.equal(editor.context.nodeClipboard.nodes.length, 2);
    assert.equal(editor.context.nodeClipboard.connections.length, 1);
    editor.dispatch('v', {ctrlKey: true});
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(editor.context.nodes.length, 4);
    assert.equal(editor.context.canvas.connections.length, 2);
    assert.equal(editor.context.selectedIds.length, 2);
    assert.equal(editor.undoSnapshots.length, 1);
});
