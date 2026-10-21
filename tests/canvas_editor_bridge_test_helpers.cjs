const vm=require('node:vm');
const assert=require('node:assert/strict');
const api=require('../static/js/canvas-editor-bridges.js');
function installEditorBridges(context,source,kind='classic'){
 context.CanvasEditorBridges=api;
 const name=kind+'EditorBridgeHost',start=source.indexOf(`function ${name}(`);assert.ok(start>=0,name);
 vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2)+`\nvar ${kind}EditorBridges=CanvasEditorBridges.create(${name}());`,context);
}
module.exports={installEditorBridges};
