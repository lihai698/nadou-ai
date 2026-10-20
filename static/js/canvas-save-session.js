/* One save-state owner per editor. No timers, persistence, DOM or network. */
(function(root){
    'use strict';
    function create({clearQueuedOnBegin=false}={}){
        let isSaving=false,queued=false,inFlight=null,release=null;
        return {
            get isSaving(){return isSaving;},
            get queued(){return queued;},
            get inFlight(){return inFlight;},
            queue(){queued=true;},
            clearQueue(){queued=false;},
            begin(){
                if(isSaving) throw new Error('Canvas is already saving');
                isSaving=true;
                if(clearQueuedOnBegin) queued=false;
                inFlight=new Promise(resolve=>{release=resolve;});
            },
            finish(){
                const complete=release;
                isSaving=false;
                inFlight=null;
                release=null;
                complete?.();
            }
        };
    }
    root.CanvasSaveSession={create};
})(globalThis);
