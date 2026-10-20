/* Own remote sync requests, notification filtering and polling; editors own merges. */
(function(root){
    'use strict';
    function timers(host){
        return {
            set:host.setTimer || ((fn,delay)=>root.setTimeout(fn,delay)),
            clear:host.clearTimer || (id=>root.clearTimeout(id)),
            poll:host.setPoll || ((fn,delay)=>root.setInterval(fn,delay)),
            clearPoll:host.clearPoll || (id=>root.clearInterval(id))
        };
    }
    function lifetime(host){
        let generation=0,active=true;
        return {
            capture:()=>({generation,id:host.getState().id}),
            current:ticket=>{
                const state=host.getState();
                return active && ticket.generation===generation && state.hasCanvas && state.id===ticket.id;
            },
            stop:()=>{active=false;generation++;},
            start:()=>{active=true;}
        };
    }
    function createClassic(host){
        const clock=timers(host),life=lifetime(host);
        let timer=null,pollTimer=null,pollBusy=false,timerVersion=0,pollVersion=0;
        function schedule(delay){
            const ticket=life.capture(),version=++timerVersion;
            if(!life.current(ticket)) return;
            clock.clear(timer);
            timer=clock.set(()=>{
                if(version!==timerVersion || !life.current(ticket)) return;
                timer=null;
                return syncNow();
            },delay);
        }
        async function syncNow(){
            const initial=host.getState(),ticket=life.capture();
            if(!life.current(ticket)) return;
            try {
                const response=await host.request(`/api/canvases/${initial.id}`);
                if(!life.current(ticket)) return;
                if(!response.ok) throw new Error(host.openError());
                const data=await response.json(),remote=data.canvas,state=host.getState();
                if(!life.current(ticket)) return;
                if(state.isSaving){schedule(700);return;}
                if(state.hasEdits && Number(remote?.updated_at || 0)>Number(state.updatedAt || 0)){
                    if(host.merge(remote)) host.scheduleSave();
                    return;
                }
                if(Number(remote?.updated_at || 0)>=Number(state.updatedAt || 0)) host.apply(remote);
            } catch(error){if(life.current(ticket)) host.error(error);}
        }
        async function checkVersion(){
            const initial=host.getState(),ticket=life.capture();
            if(!life.current(ticket) || initial.applying || pollBusy || initial.hidden) return;
            const pollRun={};
            pollBusy=pollRun;
            try {
                const response=await host.request(`/api/canvases/${initial.id}/meta`);
                if(!response.ok) throw new Error('meta failed');
                const meta=await response.json(),state=host.getState();
                if(!life.current(ticket)) return;
                if(Number(meta.updated_at || 0)>Number(state.updatedAt || 0)
                    || Number(meta.meta_revision || 0)!==Number(state.metaRevision || 0)) await syncNow();
            } catch(error){/* Retry on the next poll without interrupting editing. */}
            finally {if(pollBusy===pollRun) pollBusy=false;}
        }
        function start(){
            life.start();
            const ticket=life.capture(),version=++pollVersion;
            if(pollTimer!==null) clock.clearPoll(pollTimer);
            pollTimer=clock.poll(()=>{
                if(version===pollVersion && life.current(ticket)) return checkVersion();
            },2500);
        }
        function stop(){
            // A generation also rejects late responses after reopening the same ID.
            life.stop();timerVersion++;pollVersion++;
            clock.clear(timer);
            if(pollTimer!==null) clock.clearPoll(pollTimer);
            timer=null;pollTimer=null;pollBusy=false;
        }
        function handleMessage(data){
            const state=host.getState();
            if(!life.current(life.capture()) || !data || data.type!=='canvas_updated') return;
            if(data.client_id && data.client_id===state.clientId) return;
            if(data.canvas_id!==state.id) return;
            const updatedAt=Number(data.updated_at || 0);
            if(updatedAt && updatedAt<=Number(state.updatedAt || 0)) return;
            schedule(state.isSaving ? 700 : 120);
            if(data.client_id!=='canvas-assistant') host.status('Syncing...');
        }
        return {syncNow,start,stop,schedule,handleMessage};
    }
    function createSmart(host){
        const clock=timers(host),life=lifetime(host);
        let timer=null,pollTimer=null,timerVersion=0;
        function schedule(delay){
            const ticket=life.capture(),version=++timerVersion;
            if(!life.current(ticket)) return;
            clock.clear(timer);
            timer=clock.set(()=>{
                if(version!==timerVersion || !life.current(ticket)) return;
                timer=null;
                return syncNow();
            },delay);
        }
        async function syncNow(){
            const state=host.getState(),ticket=life.capture();
            if(!state.id || !life.current(ticket)) return;
            if(state.dragging || state.selecting){schedule(600);return;}
            try {
                const response=await host.request(`/api/canvases/${encodeURIComponent(state.id)}`);
                if(!response.ok) return;
                const data=await response.json();
                if(!life.current(ticket)) return;
                if(data && data.canvas) host.apply(data.canvas);
            } catch(error){/* Preserve the existing silent retry boundary. */}
        }
        function handleMessage(data={}){
            if(!data || data.type!=='canvas_updated') return;
            const state=host.getState();
            if(!life.current(life.capture()) || !state.id || data.canvas_id!==state.id) return;
            if(data.client_id && data.client_id===state.clientId) return;
            if(state.isSaving) return;
            const updatedAt=Number(data.updated_at || 0);
            if(updatedAt && updatedAt<=Number(state.updatedAt || 0)) return;
            schedule(200);
        }
        function start(){
            if(pollTimer!==null) return;
            life.start();
            const ticket=life.capture();
            pollTimer=clock.poll(async()=>{
                if(!life.current(ticket)) return;
                const initial=host.getState();
                if(!initial.id || !initial.hasCanvas || initial.isSaving || initial.dragging || initial.selecting) return;
                try {
                    const response=await host.request(`/api/canvases/${encodeURIComponent(initial.id)}/meta`);
                    if(!response.ok) return;
                    const meta=await response.json(),state=host.getState();
                    if(!life.current(ticket)) return;
                    if(Number(meta.updated_at || 0)>Number(state.updatedAt || 0)
                        || Number(meta.meta_revision || 0)!==Number(state.metaRevision || 0)) syncNow();
                } catch(error){}
            },8000);
        }
        function stop(){
            life.stop();timerVersion++;
            clock.clear(timer);
            if(pollTimer!==null) clock.clearPoll(pollTimer);
            timer=null;pollTimer=null;
        }
        return {syncNow,start,stop,handleMessage};
    }
    root.CanvasRemoteSync={createClassic,createSmart};
})(globalThis);
