// canvas-list-viewport.js — board viewport interaction for the project workspace.
// The module owns transform math and board pan/zoom listeners. Canvas data and
// card actions stay in canvas-list.js and are reached through the public state.
(function attachCanvasListViewport(global){
    'use strict';

    const MIN_SCALE = 0.3;
    const MAX_SCALE = 2;

    function createCanvasListViewport({board, boardWorld, beforePanStart} = {}){
        if(!board || !boardWorld) throw new TypeError('board and boardWorld are required');

        const state = {x:0, y:0, scale:1};
        let panState = null;
        let bound = false;

        function apply(){
            boardWorld.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
            board.style.backgroundSize = `${120 * state.scale}px ${120 * state.scale}px, ${120 * state.scale}px ${120 * state.scale}px, ${24 * state.scale}px ${24 * state.scale}px`;
            board.style.backgroundPosition = `${state.x}px ${state.y}px, ${state.x}px ${state.y}px, ${state.x}px ${state.y}px`;
        }

        function screenToWorld(clientX, clientY){
            const rect = board.getBoundingClientRect();
            return {
                x: (clientX - rect.left - state.x) / state.scale,
                y: (clientY - rect.top - state.y) / state.scale
            };
        }

        function boardCenterWorld(){
            return {
                x: (board.clientWidth / 2 - state.x) / state.scale,
                y: (board.clientHeight / 2 - state.y) / state.scale
            };
        }

        function reset(){
            const cards = Array.from(boardWorld.querySelectorAll('.ws-card'));
            if(!cards.length){
                state.x = 0;
                state.y = 0;
                state.scale = 1;
                apply();
                return;
            }
            const bounds = cards.reduce((acc, el) => {
                const x = parseFloat(el.style.left) || 0;
                const y = parseFloat(el.style.top) || 0;
                const w = el.offsetWidth || 248;
                const h = el.offsetHeight || 150;
                acc.minX = Math.min(acc.minX, x);
                acc.minY = Math.min(acc.minY, y);
                acc.maxX = Math.max(acc.maxX, x + w);
                acc.maxY = Math.max(acc.maxY, y + h);
                return acc;
            }, {minX:Infinity, minY:Infinity, maxX:-Infinity, maxY:-Infinity});
            const padding = board.clientWidth < 640 ? 20 : 40;
            const width = Math.max(1, bounds.maxX - bounds.minX);
            const height = Math.max(1, bounds.maxY - bounds.minY);
            const fitScale = Math.min(1, (board.clientWidth - padding * 2) / width, (board.clientHeight - padding * 2) / height);
            state.scale = board.clientWidth < 640 ? 1 : Math.min(MAX_SCALE, Math.max(0.9, fitScale));
            const fitsX = width * state.scale <= board.clientWidth - padding * 2;
            const fitsY = height * state.scale <= board.clientHeight - padding * 2;
            state.x = Math.round((fitsX ? (board.clientWidth - width * state.scale) / 2 : padding) - bounds.minX * state.scale);
            state.y = Math.round((fitsY ? Math.max(padding, (board.clientHeight - height * state.scale) / 2) : padding) - bounds.minY * state.scale);
            apply();
        }

        function onPanStart(event){
            if(event.button !== 0) return;
            const target = event.target;
            if(target?.closest?.('.ws-card, .ws-create-card, .ws-card-pop, button, input, textarea, select')) return;
            if(typeof beforePanStart === 'function') beforePanStart(event);
            panState = {startX:event.clientX, startY:event.clientY, ox:state.x, oy:state.y, moved:false};
            board.classList.add('panning');
        }

        function onPanMove(event){
            if(!panState) return;
            state.x = panState.ox + (event.clientX - panState.startX);
            state.y = panState.oy + (event.clientY - panState.startY);
            if(Math.abs(event.clientX - panState.startX) > 3 || Math.abs(event.clientY - panState.startY) > 3) panState.moved = true;
            apply();
        }

        function onPanEnd(){
            if(!panState) return;
            panState = null;
            board.classList.remove('panning');
        }

        function onWheel(event){
            event.preventDefault();
            const rect = board.getBoundingClientRect();
            const px = event.clientX - rect.left;
            const py = event.clientY - rect.top;
            const wx = (px - state.x) / state.scale;
            const wy = (py - state.y) / state.scale;
            const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
            const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale * factor));
            state.scale = next;
            state.x = px - wx * next;
            state.y = py - wy * next;
            apply();
        }

        function bind(){
            if(bound) return false;
            bound = true;
            board.addEventListener('mousedown', onPanStart);
            global.document.addEventListener('mousemove', onPanMove);
            global.document.addEventListener('mouseup', onPanEnd);
            board.addEventListener('wheel', onWheel, {passive:false});
            return true;
        }

        function destroy(){
            if(!bound) return false;
            bound = false;
            board.removeEventListener?.('mousedown', onPanStart);
            global.document.removeEventListener?.('mousemove', onPanMove);
            global.document.removeEventListener?.('mouseup', onPanEnd);
            board.removeEventListener?.('wheel', onWheel);
            onPanEnd();
            return true;
        }

        return {
            state,
            constants:{MIN_SCALE, MAX_SCALE},
            apply,
            screenToWorld,
            boardCenterWorld,
            reset,
            bind,
            destroy,
            isBound:() => bound
        };
    }

    global.CanvasListViewport = {createCanvasListViewport};
    if(typeof module !== 'undefined' && module.exports) module.exports = global.CanvasListViewport;
})(typeof window !== 'undefined' ? window : globalThis);
