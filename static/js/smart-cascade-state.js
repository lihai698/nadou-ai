/* Smart cascade state. Host supplies instance state and effects. */
(function(root){
    'use strict';

    function activeSmartCascadeCount(deps){ return deps.smartCascadeRuns.size; }

    function smartCascadeRunForLoop(deps, loopId){ return loopId ? deps.smartCascadeRuns.get(loopId) || null : null; }

    function smartCascadeIsLoopRunning(deps, loopId){ return Boolean(smartCascadeRunForLoop(deps, loopId)); }

    function syncSmartCascadeLegacyState(deps, preferredLoopId=''){
        const activeIds = [...deps.smartCascadeRuns.keys()];
        deps.smartCascadeRunning = activeIds.length > 0;
        deps.smartCascadeActiveLoopId = preferredLoopId && deps.smartCascadeRuns.has(preferredLoopId)
            ? preferredLoopId
            : (activeIds[0] || '');
        const activeRun = deps.smartCascadeActiveLoopId ? deps.smartCascadeRuns.get(deps.smartCascadeActiveLoopId) : null;
        deps.smartCascadeStopRequested = Boolean(activeRun?.stopRequested);
        deps.smartCascadeRunPath = activeRun?.runPath || null;
    }

    function smartCascadeAnyRunning(deps){ return deps.smartCascadeRunning || activeSmartCascadeCount(deps) > 0; }

    function smartCascadeEdgeState(deps, edgeKey){
        for(const run of deps.smartCascadeRuns.values()){
            const state = run?.runPath?.states?.[edgeKey];
            if(state) return state;
        }
        return deps.smartCascadeRunPath?.states?.[edgeKey] || '';
    }

    function smartCascadePathForCtx(deps, ctx=null){
        return ctx?.runState?.runPath || ctx?.runPath || deps.smartCascadeRunPath;
    }

    function smartCascadeStopText(deps, stopping=false){
        return stopping ? '停止中...' : '停止运行';
    }

    function smartCascadeAbortError(deps){
        const err = new Error('已停止一键运行');
        err.smartCascadeStopped = true;
        return err;
    }

    function throwIfSmartCascadeStopRequested(deps, runState=null){
        if(runState?.submissionUnknown) throw new Error(deps.smartUnknownResubmissionNotice(true));
        if(runState?.stopRequested || (!runState && deps.smartCascadeStopRequested)) throw smartCascadeAbortError(deps);
    }

    function requestSmartCascadeStop(deps, loopId=''){
        const runState = loopId ? smartCascadeRunForLoop(deps, loopId) : (deps.smartCascadeRuns.get(deps.smartCascadeActiveLoopId) || [...deps.smartCascadeRuns.values()][0] || null);
        if(runState){
            if(runState.stopRequested) return;
            runState.stopRequested = true;
            syncSmartCascadeLegacyState(deps, runState.runKey || runState.loopId || loopId);
        } else {
            if(!deps.smartCascadeRunning || deps.smartCascadeStopRequested) return;
            deps.smartCascadeStopRequested = true;
        }
        deps.toast('已请求停止，当前任务完成后停止');
        deps.render();
    }

    const api={activeSmartCascadeCount, smartCascadeRunForLoop, smartCascadeIsLoopRunning, syncSmartCascadeLegacyState, smartCascadeAnyRunning, smartCascadeEdgeState, smartCascadePathForCtx, smartCascadeStopText, smartCascadeAbortError, throwIfSmartCascadeStopRequested, requestSmartCascadeStop};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartCascadeState=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
