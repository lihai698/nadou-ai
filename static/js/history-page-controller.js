// Owns the in-memory pagination state used by a history gallery.
(function attachHistoryPageController(global){
    'use strict';

    function createHistoryPager({loadItems, pageSize=24, appendDelay=0} = {}){
        if(typeof loadItems !== 'function') throw new TypeError('loadItems must be a function');
        const size = Math.max(1, Number(pageSize) || 24);
        const delay = Math.max(0, Number(appendDelay) || 0);
        const state = {
            pageSize: size,
            sourceLength: 0,
            offset: 0,
            loading: false,
            hasMore: false,
            error: null
        };
        let source = [];
        let requestToken = 0;

        function waitForAppend(){
            if(!delay) return Promise.resolve();
            return new Promise(resolve => setTimeout(resolve, delay));
        }

        function itemKey(item){
            if(!item || typeof item !== 'object') return item;
            return item.timestamp ?? item.id ?? item.url ?? item.filename ?? null;
        }

        async function load({reset=false} = {}){
            if(state.loading) return {accepted:false, items:[], reset};
            if(!reset && !state.hasMore) return {accepted:false, items:[], reset};

            const token = ++requestToken;
            state.loading = true;
            state.error = null;
            const start = reset ? 0 : state.offset;
            if(reset){
                source = [];
                state.sourceLength = 0;
                state.offset = 0;
                state.hasMore = false;
            }
            try {
                if(reset){
                    const loaded = await loadItems();
                    if(token !== requestToken) return {accepted:false, items:[], reset};
                    source = Array.isArray(loaded) ? loaded : [];
                    state.sourceLength = source.length;
                } else {
                    await waitForAppend();
                    if(token !== requestToken) return {accepted:false, items:[], reset};
                }
                const items = source.slice(start, start + size);
                state.offset = start + items.length;
                state.hasMore = state.offset < source.length;
                return {
                    accepted:true,
                    items,
                    reset,
                    done:!state.hasMore,
                    offset:state.offset,
                    total:source.length
                };
            } catch(error){
                if(token === requestToken) state.error = error;
                throw error;
            } finally {
                if(token === requestToken) state.loading = false;
            }
        }

        function prepend(item){
            const key = itemKey(item);
            if(key == null || source.some(existing => itemKey(existing) === key)) return false;
            source.unshift(item);
            state.sourceLength = source.length;
            if(state.offset > 0) state.offset += 1;
            state.hasMore = state.offset < source.length;
            return true;
        }

        function remove(keyOrItem){
            const key = itemKey(keyOrItem);
            const index = source.findIndex(item => itemKey(item) === key);
            if(index < 0) return false;
            source.splice(index, 1);
            state.sourceLength = source.length;
            if(index < state.offset) state.offset = Math.max(0, state.offset - 1);
            state.hasMore = state.offset < source.length;
            return true;
        }

        function invalidate(){
            requestToken += 1;
            state.loading = false;
        }

        return {state, load, prepend, remove, invalidate};
    }

    global.HistoryPageController = {createHistoryPager};
    if(typeof module !== 'undefined' && module.exports) module.exports = global.HistoryPageController;
})(typeof window !== 'undefined' ? window : globalThis);
