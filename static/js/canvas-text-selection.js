/* Per-editor text selection state and listener lifecycle. No canvas document state. */
(function(root){
    'use strict';
    let nextOwnerId=0;

    function create(options={}){
        const requestFrame=options.requestFrame || (fn=>root.requestAnimationFrame(fn));
        const cancelFrame=options.cancelFrame || (id=>root.cancelAnimationFrame?.(id));
        const now=options.now || (()=>Date.now());
        const ownerId=String(++nextOwnerId);
        const bindings=new WeakMap();
        const frames=new Set();
        let guard=null;

        function cancelFrames(){
            for(const frame of frames) cancelFrame(frame.id);
            frames.clear();
        }

        function bind(el){
            if(!el || bindings.has(el)) return;
            const listeners=[];
            const listen=(type,fn,settings)=>{
                el.addEventListener(type,fn,settings);
                listeners.push([type,fn,settings]);
            };
            bindings.set(el,listeners);
            el.dataset.canvasTextSelection=ownerId;
            const stop=e=>e.stopPropagation();
            listen('mousedown',e=>{
                e.stopPropagation();
                cancelFrames();
                guard={el,scrollTop:el.scrollTop || 0,scrollLeft:el.scrollLeft || 0,
                    clientY:e.clientY,wheelUntil:0,active:true};
            });
            listen('mousemove',e=>{
                e.stopPropagation();
                if(guard?.el===el) guard.clientY=e.clientY;
            });
            listen('mouseup',e=>{
                e.stopPropagation();
                if(guard?.el===el) endSelection();
            });
            listen('mouseleave',e=>{
                e.stopPropagation();
                if(guard?.el===el){el.scrollTop=guard.scrollTop;el.scrollLeft=guard.scrollLeft;}
            });
            listen('scroll',()=>{
                const selection=guard;
                if(!selection || selection.el!==el || !selection.active || now()<selection.wheelUntil){
                    if(selection?.el===el){selection.scrollTop=el.scrollTop || 0;selection.scrollLeft=el.scrollLeft || 0;}
                    return;
                }
                const nextTop=el.scrollTop || 0;
                const previousTop=selection.scrollTop || 0;
                const rect=el.getBoundingClientRect();
                const pointerBelow=Number.isFinite(selection.clientY) && selection.clientY>rect.bottom-10;
                const pointerAbove=Number.isFinite(selection.clientY) && selection.clientY<rect.top+10;
                const jumpedToTop=previousTop>Math.max(80,el.clientHeight*0.45) && nextTop<4 && !pointerAbove;
                const wrongDirectionJump=pointerBelow && nextTop<previousTop-Math.max(40,el.clientHeight*0.25);
                if(jumpedToTop || wrongDirectionJump){
                    const frame={id:null};
                    frames.add(frame);
                    frame.id=requestFrame(()=>{
                        frames.delete(frame);
                        // A later selection or suspended page owns a different guard.
                        if(guard===selection && selection.active){
                            el.scrollTop=previousTop;el.scrollLeft=selection.scrollLeft || 0;
                        }
                    });
                    return;
                }
                selection.scrollTop=nextTop;selection.scrollLeft=el.scrollLeft || 0;
            },{passive:true});
            listen('click',stop);
            listen('dblclick',stop);
            listen('wheel',e=>{
                e.stopPropagation();
                if(guard?.el===el) guard.wheelUntil=now()+180;
            },{passive:true});
        }

        function unbind(el,keepMarker=false){
            const listeners=bindings.get(el);
            if(!listeners) return;
            for(const [type,fn,settings] of listeners) el.removeEventListener(type,fn,settings);
            bindings.delete(el);
            if(!keepMarker && el.dataset.canvasTextSelection===ownerId) delete el.dataset.canvasTextSelection;
            if(guard?.el===el){guard=null;cancelFrames();}
        }

        function endSelection(){
            if(guard) guard.active=false;
            cancelFrames();
        }

        function ownedElements(rootNode){
            return rootNode?.querySelectorAll?.(`[data-canvas-text-selection="${ownerId}"]`) || [];
        }

        function suspend(rootNode=root.document){
            for(const el of ownedElements(rootNode)) unbind(el,true);
            guard=null;
            cancelFrames();
        }

        function resume(rootNode=root.document){
            for(const el of ownedElements(rootNode)) bind(el);
        }

        return {bind,unbind,endSelection,suspend,resume};
    }

    const api={create};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.CanvasTextSelection=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
