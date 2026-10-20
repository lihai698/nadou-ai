/* Smart parameter panel responsibility: smart-param-state. Host supplies live state and effects. */
(function(root){
    'use strict';

function scheduleDynamicParamsRefresh(deps, delay=120){
    if(deps.dynamicParamsRefreshTimer){
        deps.clearTimeout(deps.dynamicParamsRefreshTimer);
        deps.dynamicParamsRefreshTimer = 0;
    }
    if(deps.dynamicParamsRefreshIdle && deps.window.cancelIdleCallback){
        deps.window.cancelIdleCallback(deps.dynamicParamsRefreshIdle);
        deps.dynamicParamsRefreshIdle = 0;
    }
    const seq = ++deps.dynamicParamsRefreshSeq;
    const run = () => {
        deps.dynamicParamsRefreshTimer = 0;
        deps.dynamicParamsRefreshIdle = 0;
        if(seq !== deps.dynamicParamsRefreshSeq) return;
        deps.renderDynamicParams();
    };
    if(deps.window.requestIdleCallback){
        deps.dynamicParamsRefreshIdle = deps.window.requestIdleCallback(run, {timeout:Math.max(180, Number(delay) + 260)});
    } else {
        deps.dynamicParamsRefreshTimer = deps.setTimeout(run, Math.max(0, Number(delay) || 0));
    }
}

function controlTypeKey(deps, el){
    return el ? Array.from(el.classList).find(c => c !== 'smart-control' && c.endsWith('-control')) || '' : '';
}

function openControlState(deps){
    const el = deps.dynamicParams?.querySelector('.smart-control.pinned, .smart-control.interacting');
    const key = controlTypeKey(deps, el);
    if(!key) return null;
    return { key, pinned: el.classList.contains('pinned'), interacting: el.classList.contains('interacting') };
}

function restoreOpenControl(deps, state){
    if(!state) return;
    const match = deps.dynamicParams?.querySelector(`.smart-control.${state.key}`);
    if(!match) return;
    if(state.pinned) match.classList.add('pinned');
    if(state.interacting) match.classList.add('interacting');
}

function dynamicParamsScrollSnapshot(deps){
    if(!deps.dynamicParams) return null;
    return {
        top:deps.dynamicParams.scrollTop || 0,
        left:deps.dynamicParams.scrollLeft || 0,
        sizePickers:[...deps.dynamicParams.querySelectorAll('.size-picker-control')].map(ctrl => ({
            key:controlTypeKey(deps, ctrl),
            lists:[...ctrl.querySelectorAll('.size-picker-list')].map(list => ({top:list.scrollTop || 0, left:list.scrollLeft || 0}))
        }))
    };
}

function restoreDynamicParamsScroll(deps, snapshot){
    if(!snapshot || !deps.dynamicParams) return;
    const apply = () => {
        deps.dynamicParams.scrollTop = snapshot.top || 0;
        deps.dynamicParams.scrollLeft = snapshot.left || 0;
        const used = new Set();
        (snapshot.sizePickers || []).forEach(item => {
            const pickers = [...deps.dynamicParams.querySelectorAll('.size-picker-control')];
            const index = pickers.findIndex((ctrl, i) => !used.has(i) && (!item.key || controlTypeKey(deps, ctrl) === item.key));
            if(index < 0) return;
            used.add(index);
            const lists = pickers[index].querySelectorAll('.size-picker-list');
            (item.lists || []).forEach((pos, listIndex) => {
                const list = lists[listIndex];
                if(!list) return;
                list.scrollTop = pos.top || 0;
                list.scrollLeft = pos.left || 0;
            });
        });
    };
    apply();
    deps.requestAnimationFrame(apply);
}

    const api={scheduleDynamicParamsRefresh, controlTypeKey, openControlState, restoreOpenControl, dynamicParamsScrollSnapshot, restoreDynamicParamsScroll};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartParamState=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
