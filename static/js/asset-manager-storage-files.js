// Owns the storage-file list while the preferences dialog is open.
(function attachAssetStorageFiles(global){
    'use strict';

    function createStorageFileBrowser({loadPage, onChange, pageSize=80}){
        const state = {
            kind:'generated', items:[], selected:new Set(), loading:false, loadingMore:false,
            offset:0, total:0, hasMore:false, pageSize, restoreScrollTop:null
        };
        let open = false;
        let session = 0;
        let request = 0;

        function begin(){
            open = true;
            session++;
            request++;
            state.items = [];
            state.selected.clear();
            state.loading = false;
            state.loadingMore = false;
            state.offset = 0;
            state.total = 0;
            state.hasMore = false;
            state.restoreScrollTop = null;
            return session;
        }

        function close(){
            open = false;
            session++;
            request++;
            state.selected.clear();
            state.loading = false;
            state.loadingMore = false;
        }

        function isCurrent(value){ return open && session === value; }
        function currentSession(){ return session; }

        async function load(kind='generated', options={}){
            if(!open) return false;
            const append = Boolean(options.append);
            const nextKind = kind || 'generated';
            if(append && (nextKind !== state.kind || state.loading || state.loadingMore || !state.hasMore)) return false;
            const token = ++request;
            const currentSession = session;
            const offset = append ? state.offset : 0;
            if(append){
                state.loadingMore = true;
            } else {
                state.kind = nextKind;
                state.items = [];
                state.offset = 0;
                state.total = 0;
                state.hasMore = false;
                state.selected.clear();
                state.restoreScrollTop = null;
                state.loading = true;
                onChange();
            }
            try {
                const data = await loadPage(nextKind, offset, state.pageSize);
                if(!isCurrent(currentSession) || token !== request) return false;
                const items = Array.isArray(data.items) ? data.items : [];
                state.items = append ? [...state.items, ...items] : items;
                state.offset = offset + items.length;
                state.total = Number(data.total ?? state.items.length);
                state.hasMore = Boolean(data.has_more);
                const ids = new Set(state.items.map(item => item.id));
                state.selected = new Set([...state.selected].filter(id => ids.has(id)));
                if(append) state.restoreScrollTop = options.scrollTop ?? null;
                return true;
            } catch(err){
                if(!isCurrent(currentSession) || token !== request) return false;
                throw err;
            } finally {
                if(isCurrent(currentSession) && token === request){
                    state.loading = false;
                    state.loadingMore = false;
                    onChange();
                }
            }
        }

        function select(id, checked){
            if(!open || !state.items.some(item => item.id === id)) return;
            if(checked) state.selected.add(id);
            else state.selected.delete(id);
            onChange();
        }

        function selectAll(){
            if(!open) return;
            state.items.forEach(item => state.selected.add(item.id));
            onChange();
        }

        function clearSelection(){ state.selected.clear(); }

        return {state, begin, close, isCurrent, currentSession, load, select, selectAll, clearSelection};
    }

    global.AssetStorageFiles = {createStorageFileBrowser};
    if(typeof module !== 'undefined' && module.exports) module.exports = global.AssetStorageFiles;
})(typeof window !== 'undefined' ? window : globalThis);
