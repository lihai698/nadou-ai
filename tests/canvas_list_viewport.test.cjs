const {test} = require('node:test');
const assert = require('node:assert/strict');

const {createCanvasListViewport} = require('../static/js/canvas-list-viewport.js');

function element({width = 1000, height = 700} = {}){
    const listeners = new Map();
    const classes = new Set();
    const node = {
        style: {},
        clientWidth: width,
        clientHeight: height,
        offsetWidth: 248,
        offsetHeight: 150,
        children: [],
        listeners,
        classList: {
            add(name){ classes.add(name); },
            remove(name){ classes.delete(name); },
            contains(name){ return classes.has(name); },
        },
        addEventListener(type, handler){ listeners.set(type, handler); },
        removeEventListener(type, handler){ if(listeners.get(type) === handler) listeners.delete(type); },
        querySelectorAll(selector){
            return selector === '.ws-card' ? this.children : [];
        },
        getBoundingClientRect(){ return {left: 10, top: 20}; },
    };
    return node;
}

function createHarness(){
    const board = element();
    const boardWorld = element();
    const document = {
        listeners: new Map(),
        addEventListener(type, handler){ this.listeners.set(type, handler); },
        removeEventListener(type, handler){ if(this.listeners.get(type) === handler) this.listeners.delete(type); },
    };
    const previous = global.document;
    global.document = document;
    const controller = createCanvasListViewport({board, boardWorld});
    return {board, boardWorld, document, controller, restore(){ global.document = previous; }};
}

test('viewport keeps cursor anchored while zooming and converts screen coordinates', () => {
    const h = createHarness();
    try {
        const {controller, board, boardWorld} = h;
        controller.apply();
        assert.equal(boardWorld.style.transform, 'translate(0px, 0px) scale(1)');
        assert.deepEqual(controller.screenToWorld(110, 220), {x:100, y:200});

        const wheel = {clientX:110, clientY:220, deltaY:-1, preventDefault(){this.prevented = true;}};
        controller.bind();
        board.listeners.get('wheel')(wheel);
        assert.equal(wheel.prevented, true);
        assert.ok(controller.state.scale > 1);
        assert.deepEqual(controller.screenToWorld(110, 220), {x:100, y:200});
    } finally {
        h.restore();
    }
});

test('viewport pans only on board background and bind/destroy are idempotent', () => {
    const h = createHarness();
    try {
        const {controller, board, document} = h;
        assert.equal(controller.bind(), true);
        assert.equal(controller.bind(), false);
        const background = {closest(){ return null; }};
        board.listeners.get('mousedown')({button:0, clientX:10, clientY:20, target:background});
        document.listeners.get('mousemove')({clientX:42, clientY:55});
        assert.deepEqual(controller.state, {x:32, y:35, scale:1});
        document.listeners.get('mouseup')();
        assert.equal(board.classList.contains('panning'), false);
        assert.equal(controller.destroy(), true);
        assert.equal(controller.destroy(), false);
        assert.equal(controller.isBound(), false);
        assert.equal(board.listeners.size, 0);
        assert.equal(document.listeners.size, 0);
    } finally {
        h.restore();
    }
});

test('reset fits cards and returns an empty board to the identity view', () => {
    const h = createHarness();
    try {
        const {controller, boardWorld} = h;
        const card = element();
        card.style.left = '40px';
        card.style.top = '80px';
        card.offsetWidth = 200;
        card.offsetHeight = 100;
        boardWorld.children.push(card);
        controller.reset();
        assert.equal(controller.state.scale, 1);
        assert.equal(controller.state.x, 360);
        assert.equal(controller.state.y, 220);
        boardWorld.children = [];
        controller.reset();
        assert.deepEqual(controller.state, {x:0, y:0, scale:1});
    } finally {
        h.restore();
    }
});
