/* Each canvas owns one history controller. Stacks, pending snapshots and redo guards stay private. */
(function(root){
    'use strict';

function createClassic(deps){
let undoStack = [];
const UNDO_MAX = 30;

function pushUndo(){
    if(!deps.canvas) return;
    undoStack.push({nodes:JSON.parse(JSON.stringify(deps.serializableCanvasNodes())), connections:JSON.parse(JSON.stringify(deps.connections))});
    if(undoStack.length > UNDO_MAX) undoStack.shift();
}

function performUndo(){
    if(!deps.canvas || !undoStack.length) return;
    const state = undoStack.pop();
    deps.window.CanvasVideoDeconstructionBridge?.begin?.();
    deps.window.CanvasVideoDeconstructionUI?.closeAll?.(true);
    deps.nodes = state.nodes;
    deps.connections = state.connections;
    deps.selected.clear();
    deps.render();
    deps.scheduleSave();
}
    return {pushUndo, performUndo};
}

function createSmart(deps){
const UNDO_LIMIT = 40;
const undoStack = [];
const redoStack = [];
let redoBaseContent = '';
let undoSuppressed = false;
let pendingUndoSnapshot = null;

function capturePendingUndo(){ pendingUndoSnapshot = snapshotForUndo(); }

function commitPendingUndo(){
    if(pendingUndoSnapshot){
        redoStack.length = 0;
        redoBaseContent = '';
        undoStack.push(pendingUndoSnapshot);
        if(undoStack.length > UNDO_LIMIT) undoStack.shift();
        pendingUndoSnapshot = null;
    }
}

function discardPendingUndo(){ pendingUndoSnapshot = null; }

function snapshotForUndo(){
    return {
        nodes: JSON.parse(JSON.stringify(deps.nodes)),
        connections: JSON.parse(JSON.stringify(deps.canvas?.connections || [])),
        selectedId:deps.selectedId,
        selectedIds: deps.selectedIds.slice(),
        selectedImage: {...deps.selectedImage}
    };
}

function pushUndo(){
    if(undoSuppressed) return;
    if(!deps.canvas) return;
    redoStack.length = 0;
    redoBaseContent = '';
    undoStack.push(snapshotForUndo());
    if(undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function restoreHistorySnapshot(snap){
    deps.invalidateSmartVideoDeconstruction();
    undoSuppressed = true;
    try {
        discardPendingUndo();
        deps.nodes = snap.nodes;
        if(deps.canvas) deps.canvas.connections = snap.connections;
        deps.selectedId = snap.selectedId;
        deps.selectedIds = snap.selectedIds;
        deps.selectedImage = snap.selectedImage;
        deps.activeComposerSubject = null;
        deps.lastComposerNodeId = '';
        deps.render();
        redoBaseContent = redoStack.length ? historyContentSignature() : '';
        deps.scheduleSave();
    } finally {
        undoSuppressed = false;
    }
}

function historyContentSignature(){
    return JSON.stringify({nodes:deps.nodes, connections: deps.canvas?.connections || []});
}

function performUndo(){
    if(!undoStack.length){ deps.toast(deps.tr('smart.toastNoUndo')); return; }
    redoStack.push(snapshotForUndo());
    if(redoStack.length > UNDO_LIMIT) redoStack.shift();
    restoreHistorySnapshot(undoStack.pop());
    deps.toast(deps.tr('smart.toastUndone'));
}

function performRedo(){
    if(!redoStack.length){ deps.toast(deps.tr('smart.toastNoRedo')); return; }
    undoStack.push(snapshotForUndo());
    if(undoStack.length > UNDO_LIMIT) undoStack.shift();
    restoreHistorySnapshot(redoStack.pop());
    deps.toast(deps.tr('smart.toastRedone'));
}

function reset(){
    undoStack.length = 0;
    redoStack.length = 0;
    pendingUndoSnapshot = null;
}
function beforeScheduleSave(){
    // Field edits can bypass pushUndo; viewport-only and no-op saves must keep redo.
    if(!undoSuppressed && redoStack.length && historyContentSignature() !== redoBaseContent){
        redoStack.length = 0;
        redoBaseContent = '';
    }
}
function prepareStorageNormalization(){
    return redoStack.length && historyContentSignature() === redoBaseContent;
}
function finishStorageNormalization(preserveRedo){
    // Storage normalization is not a new edit. Do not mask changes made before saving.
    if(preserveRedo) redoBaseContent = historyContentSignature();
}
    return {capturePendingUndo, commitPendingUndo, discardPendingUndo, snapshotForUndo, pushUndo, restoreHistorySnapshot, historyContentSignature, performUndo, performRedo, reset, beforeScheduleSave, prepareStorageNormalization, finishStorageNormalization, get suppressed(){return undoSuppressed;}, set suppressed(value){undoSuppressed=value;}};
}

    const api={createClassic, createSmart};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasHistory=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
