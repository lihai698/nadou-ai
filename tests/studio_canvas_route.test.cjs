const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname,'../static/index.html'), 'utf8');
const start = source.indexOf('        function canvasFrameRoute(');
const end = source.indexOf('        function switchUI(', start);

function page(){
    const storage = new Map();
    const context = vm.createContext({URL, location:{origin:'http://localhost:3000'}, sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}});
    vm.runInContext(source.slice(start,end), context);
    return context;
}

test('root reload restores the smart or classic canvas opened inside the frame', () => {
    for(const kind of ['smart-canvas','canvas']){
        const p=page();
        const route=`/static/${kind}.html?id=current-canvas&project=default`;
        const frame={id:'frame-canvas',dataset:{src:'/static/canvas-list.html'},contentWindow:{location:{href:'http://localhost:3000'+route}}};
        p.rememberCanvasFrameRoute(frame);
        assert.equal(p.restoreCanvasFrameRoute({dataset:frame.dataset}), route);
        frame.contentWindow.location.href='http://localhost:3000/static/canvas-list.html?project=default';
        p.rememberCanvasFrameRoute(frame);
        assert.equal(p.restoreCanvasFrameRoute(frame), '/static/canvas-list.html?project=default');
    }
});

test('invalid or unrelated routes are never restored as a canvas', () => {
    const p=page();
    for(const route of ['https://other.test/static/canvas.html?id=abc','/static/smart-canvas.html','/static/api-settings.html','javascript:alert(1)']){
        assert.equal(p.canvasFrameRoute(route), '');
    }
    assert.equal(p.restoreCanvasFrameRoute({dataset:{src:'/static/canvas-list.html'}}), '/static/canvas-list.html');
});

test('studio uses the remembered route at initial frame load and records child navigation', () => {
    assert.match(source, /target\.src = id === 'canvas' \? restoreCanvasFrameRoute\(target\)/);
    assert.match(source, /frame\.addEventListener\('load',[\s\S]*?rememberCanvasFrameRoute\(frame\)/);
});
