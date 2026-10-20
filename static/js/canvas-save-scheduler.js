/* Own one pending save timer; do not retain callbacks for a replaced canvas. */
(function(root){
    'use strict';
    function create({save,getCanvasId,setTimer=(fn,delay)=>root.setTimeout(fn,delay),clearTimer=id=>root.clearTimeout(id)}){
        let handle=null,generation=0;
        function cancel(){
            generation++;
            if(handle!==null){clearTimer(handle);handle=null;}
        }
        function schedule(delay){
            cancel();
            const ticket=generation,canvasId=getCanvasId();
            handle=setTimer(()=>{
                if(ticket!==generation) return;
                handle=null;
                if(getCanvasId()!==canvasId) return;
                return save();
            },delay);
        }
        return {get pending(){return handle!==null;},schedule,cancel};
    }
    root.CanvasSaveScheduler={create};
})(globalThis);
