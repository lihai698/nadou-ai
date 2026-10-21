const vm=require('node:vm');
const assert=require('node:assert/strict');
const api=require('../static/js/canvas-preview-runtime.js');

function installClassicPreviewRuntime(context,source){
    context.CanvasPreviewRuntime=api;
    context.nodesEl??={querySelectorAll:()=>[]};
    context.setTimeout??=()=>0;
    context.clearTimeout??=()=>{};
    function entry(name){
        const start=source.indexOf(`function ${name}(`);assert.ok(start>=0,name);
        return source.slice(start,source.indexOf('\n}',start)+2);
    }
    vm.runInContext(entry('classicPreviewRuntimeHost')+'\nvar classicPreviewRuntime=CanvasPreviewRuntime.create(classicPreviewRuntimeHost());\n'
        +entry('syncCanvasSelectedImageResolution')+'\n'+entry('scheduleCanvasImageResolutionSync'),context);
}
module.exports={installClassicPreviewRuntime};
