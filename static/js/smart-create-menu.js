/* Canvas menus and asset management: smart-create-menu. Host supplies live state and effects. */
(function(root){
    'use strict';

function closeCreateMenu(deps){
    deps.createMenu?.classList.remove('open');
    deps.createMenuGroupId = '';
}

function openCreateMenu(deps, event, options={}){
    if(!deps.createMenu) return;
    deps.createMenuPoint = deps.screenToWorld(event);
    deps.createMenuGroupId = options.groupId || '';
    const actions = deps.createMenu.querySelector('.create-menu-actions');
    if(actions) actions.hidden = Boolean(options.groupId);
    deps.createMenu.classList.add('open');
    deps.refreshIcons();
    const w = deps.createMenu.offsetWidth;
    const h = deps.createMenu.offsetHeight;
    const left = Math.max(14, Math.min(deps.window.innerWidth - w - 14, event.clientX + 8));
    const top = Math.max(14, Math.min(deps.window.innerHeight - h - 14, event.clientY + 8));
    deps.createMenu.style.left = `${left}px`;
    deps.createMenu.style.top = `${top}px`;
}

function handleCreateMenuMouseDown(deps, event){event.stopPropagation();}

function handleCreateMenuClick(deps, event){
    event.stopPropagation();
    const card = event.target.closest('[data-create-type]');
    if(card) deps.createNodeFromMenu(card.dataset.createType || 'image');
}


function create(host){
    const deps=host();
    let bindings=[],active=false,listening=false,disposed=false;
    
    function listen(target,type,fn,options){
        target.addEventListener(type,fn,options);bindings.push([target,type,fn,options]);
    }
    function suspend(){
        for(const [target,type,fn,options] of bindings)target.removeEventListener(type,fn,options);
        bindings=[];
        
        active=false;
    }
    function mount(){
        if(disposed||active)return;
        active=true;
        if(!listening){
            deps.window.addEventListener('pagehide',suspend);
            deps.window.addEventListener('pageshow',mount);
            listening=true;
        }
        
        if(deps.createMenu){
            listen(deps.createMenu,'mousedown',event=>handleCreateMenuMouseDown(deps,event));
            listen(deps.createMenu,'click',event=>handleCreateMenuClick(deps,event));
        }
 
        
    }
    
    function dispose(){
        suspend();
        if(listening){
            deps.window.removeEventListener('pagehide',suspend);
            deps.window.removeEventListener('pageshow',mount);
        }
        listening=false;disposed=true;
    }
    return {mount,dispose};
}
    const api={create, closeCreateMenu, openCreateMenu, handleCreateMenuMouseDown, handleCreateMenuClick};
    if(typeof module!=='undefined' && module.exports) module.exports=api;
    root.SmartCreateMenu=api;
})(typeof globalThis!=='undefined' ? globalThis : window);
