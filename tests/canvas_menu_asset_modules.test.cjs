const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
const acorn={};vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{exports:acorn,module:{exports:acorn}});
const source=fs.readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
const tree=acorn.parse(source,{ecmaVersion:'latest'});
class Target{
    constructor(){this.events=new Map();this.classes=new Set();this.attrs={};this.style={};this.innerHTML='';this.hidden=false;
        this.classList={add:(...keys)=>keys.forEach(key=>this.classes.add(key)),remove:(...keys)=>keys.forEach(key=>this.classes.delete(key)),contains:key=>this.classes.has(key),toggle:(key,on)=>on?this.classes.add(key):this.classes.delete(key)};}
    addEventListener(type,fn,options){const rows=this.events.get(type)||[];rows.push({fn,options});this.events.set(type,rows);}
    removeEventListener(type,fn,options){this.events.set(type,(this.events.get(type)||[]).filter(row=>row.fn!==fn||row.options!==options));}
    async emit(type,event){for(const row of [...(this.events.get(type)||[])])await row.fn(event);}
    setAttribute(key,value){this.attrs[key]=value;}
    querySelectorAll(){return [];}
}
function functions(context,names){
    vm.runInContext(tree.body.filter(node=>node.type==='FunctionDeclaration'&&names.includes(node.id.name)).map(node=>source.slice(node.start,node.end)).join('\n'),context);
}
function fixture(){
    const elements={canvasMoreMenu:new Target(),canvasMoreToggle:new Target()};
    const document=new Target();document.getElementById=id=>elements[id]||null;document.querySelectorAll=()=>[];
    const context=createTaskContext({document,window:new Target(),createMenu:new Target(),linkCreateMenu:new Target(),nodeInputMenu:new Target(),nodeOutputMenu:new Target(),imageNodeMenu:new Target(),
        menuPoint:null,linkCreateState:{old:true},board:{clientWidth:400,clientHeight:300,getBoundingClientRect:()=>({left:10,top:20,width:400,height:300})},
        screenToWorld:(x,y)=>({x:x-10,y:y-20}),ensureCanvas:()=>true,refreshIcons(){},
        assetManagerModal:new Target(),assetManagerBody:{innerHTML:''},assetManagerTab:'assets',
        managerSelectedAssetIds:new Set(),managerSelectedPromptIds:new Set(),managerSelectedWorkflowIds:new Set(),
        activeCanvasAssetLibraryId:'lib-a',activeCanvasAssetCategoryId:'cat-a',activeCanvasWorkflowCategoryId:'',activePromptLibraryId:'system',
        canvasPromptLibraries:[],canvasAssetLibraries:()=>[],activeCanvasAssetLibrary:()=>null,canvasMediaCategories:()=>[],activeCanvasMediaCategory:()=>null,
        activeCanvasWorkflowCategory:()=>({items:[]}),canvasWorkflowCategories:()=>[],bindCanvasPreviewImageFallbacks(){},
        escapeHtml:value=>String(value),escapeAttr:value=>String(value),canvasAssetLibrary:{},
        renderCanvasAssetLibrary(){},refreshCanvasPromptTemplatesFromLibraries(){}});
    functions(context,['closeCanvasMoreMenu','toggleCanvasMoreMenu','openCanvasNodeMenu','openCreateMenu','closeCreateMenu','closeLinkCreateMenu','closeImageNodeMenu',
        'renderAssetManager','renderImageAssetManager','renderPromptAssetManager','renderWorkflowAssetManager','workflowAssetThumbHtml']);
    return {context,elements,document};
}
function installAssetEvents(context){
    const controller=context.CanvasAssetManager.create(()=>context.classicAssetManagerHost());
    context.classicAssetManagerController=controller;
    controller.mount();
    return controller;
}
function target(selector,value){return {closest:query=>query===selector?value:null};}

test('classic menu opening closes sibling menus and updates the current world point',()=>{
    const {context,elements}=fixture();context.createMenu.offsetWidth=100;context.createMenu.offsetHeight=80;
    vm.runInContext('openCanvasNodeMenu()',context);
    assert.equal(context.createMenu.classes.has('open'),true);
    assert.equal(context.linkCreateState,null);
    assert.equal(elements.canvasMoreMenu.hidden,true);
    assert.equal(elements.canvasMoreToggle.attrs['aria-expanded'],'false');
    assert.deepEqual({...context.menuPoint},{x:200,y:150});
});

test('asset selection and library switching update the live state once',async()=>{
    const {context}=fixture();installAssetEvents(context);
    await context.assetManagerModal.emit('change',{target:target('[data-manager-asset-check]',{checked:true,dataset:{managerAssetCheck:'asset-a'}})});
    assert.equal(context.managerSelectedAssetIds.has('asset-a'),true);
    await context.assetManagerModal.emit('click',{target:target('[data-manager-asset-lib]',{dataset:{managerAssetLib:'lib-b'}})});
    assert.equal(context.activeCanvasAssetLibraryId,'lib-b');assert.equal(context.activeCanvasAssetCategoryId,'');assert.equal(context.managerSelectedAssetIds.size,0);
    assert.match(context.assetManagerBody.innerHTML,/当前分组为空/);
});

test('readonly prompt library actions do not ask for input or send requests',async()=>{
    const {context}=fixture();installAssetEvents(context);let calls=0;
    context.activeCanvasPromptLibrary=()=>({id:'system',readonly:true});context.window.prompt=()=>{calls++;};context.fetch=async()=>{calls++;};
    await context.assetManagerModal.emit('click',{target:target('[data-manager-prompt-edit]',{dataset:{managerPromptEdit:'p'}})});
    await context.assetManagerModal.emit('click',{target:target('[data-manager-prompt-lib-delete]',{})});
    assert.equal(calls,0);
});

test('workflow rename sends the original encoded identity and applies returned library',async()=>{
    const {context}=fixture();installAssetEvents(context);const calls=[];
    context.activeCanvasWorkflowCategory=()=>({items:[{id:'w/42',name:'old'}]});context.window.prompt=()=> 'new';
    context.fetch=async(url,options)=>{calls.push({url,options});return {json:async()=>({library:{id:'updated'}})};};
    await context.assetManagerModal.emit('click',{target:target('[data-manager-workflow-rename]',{dataset:{managerWorkflowRename:'w/42'}})});
    assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/asset-library/items/w%2F42');
    assert.equal(calls[0].options.method,'PATCH');assert.deepEqual(JSON.parse(calls[0].options.body),{name:'new'});assert.equal(context.canvasAssetLibrary.id,'updated');
});

test('classic menu listeners bind once, suspend on pagehide and restore once',async()=>{
    const {context,document,elements}=fixture();
    const controller=context.CanvasNodeMenu.create(()=>context.classicMenuHost());controller.mount();controller.mount();
    assert.equal(document.events.get('pointerdown').length,1);
    assert.equal(document.events.get('keydown').length,1);
    await context.window.emit('pagehide',{});assert.equal(document.events.get('keydown').length,0);
    await context.window.emit('pageshow',{persisted:true});controller.mount();assert.equal(document.events.get('keydown').length,1);
    await document.emit('keydown',{key:'Escape'});assert.equal(elements.canvasMoreMenu.hidden,true);
    controller.dispose();assert.equal(document.events.get('keydown').length,0);assert.equal(context.window.events.get('pageshow').length,0);
});

test('asset upload listeners detach on hide and replacement, and restore once',async()=>{
    const {context,elements}=fixture();const controller=installAssetEvents(context);
    const first=new Target();first.id='managerAssetUpload';elements.managerAssetUpload=first;
    vm.runInContext('renderAssetManager()',context);assert.equal(first.events.get('change').length,1);
    await context.window.emit('pagehide',{});assert.equal(first.events.get('change').length,0);
    await context.window.emit('pageshow',{persisted:true});controller.mount();assert.equal(first.events.get('change').length,1);
    const next=new Target();next.id='managerAssetUpload';elements.managerAssetUpload=next;
    vm.runInContext('renderAssetManager()',context);assert.equal(first.events.get('change').length,0);assert.equal(next.events.get('change').length,1);
    controller.dispose();assert.equal(next.events.get('change').length,0);assert.equal(context.assetManagerModal.events.get('click').length,0);
});

test('smart creation menu action fires once across repeated mounts and page restoration',async()=>{
    const {context}=fixture();let created=0;context.createNodeFromMenu=type=>{assert.equal(type,'image');created++;};
    const controller=context.SmartCreateMenu.create(()=>context.smartCreateMenuHost());controller.mount();controller.mount();
    const event={target:target('[data-create-type]',{dataset:{createType:'image'}}),stopPropagation(){}};
    await context.createMenu.emit('click',event);assert.equal(created,1);
    await context.window.emit('pagehide',{});await context.createMenu.emit('click',event);assert.equal(created,1);
    await context.window.emit('pageshow',{persisted:true});await context.createMenu.emit('click',event);assert.equal(created,2);
    controller.dispose();await context.createMenu.emit('click',event);assert.equal(created,2);
});

test('classic controller disposal clears generated button actions and closes menus',()=>{
    const {context}=fixture();const button={onclick:()=>{throw Error('disposed action');}};
    context.linkCreateMenu.querySelectorAll=()=>[button];context.linkCreateMenu.classList.add('open');
    const controller=context.CanvasNodeMenu.create(()=>context.classicMenuHost());controller.mount();controller.dispose();
    assert.equal(button.onclick,null);assert.equal(context.linkCreateMenu.classes.has('open'),false);assert.equal(context.linkCreateState,null);
});
