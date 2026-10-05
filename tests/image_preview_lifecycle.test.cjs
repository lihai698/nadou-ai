const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '..', 'static/js/image-preview.js'), 'utf8');

function makeNode(kind){
    const listeners = new Map();
    const classes = new Set();
    const node = {
        kind,
        style: {},
        listeners,
        children: [],
        classList: {
            add(name){ classes.add(name); },
            remove(name){ classes.delete(name); },
            contains(name){ return classes.has(name); }
        },
        addEventListener(type, handler){ listeners.set(type, handler); },
        removeEventListener(type, handler){ if(listeners.get(type) === handler) listeners.delete(type); },
        querySelector(selector){ return selector === 'img' || selector === '.studio-preview-img' ? this.children[0] || null : null; },
        getBoundingClientRect(){ return {left:10, top:20}; },
        closest(){ return null; },
        appendChild(child){ this.children.push(child); return child; }
    };
    return node;
}

function harness(){
    const container = makeNode('container');
    const img = makeNode('img');
    container.children.push(img);
    const head = {appendChild() {}};
    const document = {
        head,
        getElementById(){ return null; },
        createElement(){ return {id:'', textContent:''}; }
    };
    const window = {
        document,
        listeners:new Map(),
        addEventListener(type, handler){ this.listeners.set(type, handler); },
        removeEventListener(type, handler){ if(this.listeners.get(type) === handler) this.listeners.delete(type); }
    };
    const context = vm.createContext({window, document});
    vm.runInContext(source, context, {filename:'image-preview.js'});
    return {window, document, container, img, preview:window.StudioImagePreview};
}

test('preview attach is idempotent and destroy removes container and window listeners', () => {
    const h = harness();
    const first = h.preview.attach(h.container);
    const second = h.preview.attach(h.container);
    assert.equal(second, first);
    assert.equal(h.container.listeners.size, 3);
    assert.equal(h.window.listeners.size, 2);
    assert.equal(first.destroy(), true);
    assert.equal(first.destroy(), false);
    assert.equal(first.isDestroyed(), true);
    assert.equal(h.container.listeners.size, 0);
    assert.equal(h.window.listeners.size, 0);

    const replacement = h.preview.attach(h.container);
    assert.notEqual(replacement, first);
    assert.equal(replacement.isDestroyed(), false);
    assert.equal(h.container.listeners.size, 3);
    assert.equal(h.window.listeners.size, 2);
});

test('preview replace explicitly tears down the previous instance before rebinding', () => {
    const h = harness();
    const first = h.preview.attach(h.container);
    const replacement = h.preview.attach(h.container, {replace:true});
    assert.notEqual(replacement, first);
    assert.equal(first.isDestroyed(), true);
    assert.equal(h.container.listeners.size, 3);
    assert.equal(h.window.listeners.size, 2);
});

test('preview zoom and drag still use one active listener set and double click resets', () => {
    const h = harness();
    const preview = h.preview.attach(h.container);
    const wheel = {
        clientX:110,
        clientY:120,
        deltaY:-1,
        preventDefault(){ this.prevented = true; },
        stopPropagation(){ this.stopped = true; }
    };
    h.container.listeners.get('wheel')(wheel);
    assert.equal(wheel.prevented, true);
    assert.equal(wheel.stopped, true);
    assert.ok(preview.getZoom() > 1);

    const down = {
        button:0,
        clientX:110,
        clientY:120,
        target:{closest(){ return null; }},
        preventDefault(){},
        stopPropagation(){}
    };
    h.container.listeners.get('mousedown')(down);
    h.window.listeners.get('mousemove')({clientX:140, clientY:150});
    assert.match(h.img.style.transform, /translate\(20px, 20px\)/);
    h.container.listeners.get('dblclick')({
        preventDefault(){},
        stopPropagation(){}
    });
    assert.equal(preview.getZoom(), 1);
    assert.equal(h.img.style.transform, 'translate(0px, 0px) scale(1)');
});
