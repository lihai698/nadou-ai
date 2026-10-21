// Editor fragment tests load the same task transport as the HTML entry points.
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const transport=readFileSync(path.join(__dirname,'../static/js/canvas-task-transport.js'),'utf8');
const recovery=readFileSync(path.join(__dirname,'../static/js/canvas-accepted-task-recovery.js'),'utf8');
const runtime=readFileSync(path.join(__dirname,'../static/js/canvas-task-runtime.js'),'utf8');
const graph=readFileSync(path.join(__dirname,'../static/js/canvas-graph-rules.js'),'utf8');
const cascadeState=readFileSync(path.join(__dirname,'../static/js/canvas-cascade-state.js'),'utf8');
const cascadeRunner=readFileSync(path.join(__dirname,'../static/js/canvas-cascade-runner.js'),'utf8');
const classicSource=readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
const classicMouseEntries=['setCanvasMouseMove','setCanvasMouseUp'].map(name=>{
    const start=classicSource.indexOf(`function ${name}(`);
    if(start<0)throw Error(`Missing production mouse boundary: ${name}`);
    return classicSource.slice(start,classicSource.indexOf('\n}',start)+2);
}).join('\n');
const cascadeHostStart=classicSource.indexOf('function classicCascadeHost(');
if(cascadeHostStart<0) throw new Error('Missing production cascade host');
const cascadeHost=classicSource.slice(cascadeHostStart,classicSource.indexOf('\n}',cascadeHostStart)+2);
const generationHostStart=classicSource.indexOf('function classicGenerationHost(');
if(generationHostStart<0) throw new Error('Missing production generation host');
const generationHost=classicSource.slice(generationHostStart,classicSource.indexOf('\n}',generationHostStart)+2);
const generationModules=['canvas-media-runner','canvas-direct-tasks','canvas-comfy-runner','canvas-llm-runner','canvas-midjourney-runner'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const providerHostStart=classicSource.indexOf('function classicProviderHost(');
if(providerHostStart<0) throw new Error('Missing production provider host');
const providerHost=classicSource.slice(providerHostStart,classicSource.indexOf('\n}',providerHostStart)+2);
const remainingGenerationModules=['canvas-provider-runner','smart-api-runner','smart-provider-runner','smart-direct-tasks','smart-comfy-runner','smart-generation-runner'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const onlineSizeRules=readFileSync(path.join(__dirname,'../static/js/online-image-size-rules.js'),'utf8');
const nodeParamModules=['canvas-image-params','canvas-node-params','smart-node-params'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const nodeParamHosts=[['canvas.js','classicNodeParamsHost'],['smart-canvas.js','smartNodeParamsHost']].map(([file,name])=>{
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    if(start<0) throw new Error(`Missing production node parameter host: ${name}`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');
const smartCascadeSource=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const smartCascadeHostStart=smartCascadeSource.indexOf('function smartCascadeHost(');
if(smartCascadeHostStart<0) throw new Error('Missing production smart cascade host');
const smartCascadeHost=smartCascadeSource.slice(smartCascadeHostStart,smartCascadeSource.indexOf('\n}',smartCascadeHostStart)+2);
const smartGenerationHostStart=smartCascadeSource.indexOf('function smartGenerationHost(');
if(smartGenerationHostStart<0) throw new Error('Missing production smart generation host');
const smartGenerationHost=smartCascadeSource.slice(smartGenerationHostStart,smartCascadeSource.indexOf('\n}',smartGenerationHostStart)+2);
const smartCascadeModules=['state','runner','steps'].map(name=>readFileSync(path.join(__dirname,`../static/js/smart-cascade-${name}.js`),'utf8')).join('\n');
const recoveryHosts=[['canvas.js','classicAcceptedTaskRecoveryHost'],['smart-canvas.js','smartAcceptedTaskRecoveryHost']].map(([file,name])=>{
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    if(start<0) throw new Error(`Missing production recovery host: ${name}`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');
const graphHosts=[['canvas.js','classicGraphHost'],['smart-canvas.js','smartGraphHost']].map(([file,name])=>{
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    if(start<0) throw new Error(`Missing production graph host: ${name}`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');
const runtimeHosts=[['canvas.js','classicTaskRuntimeHost'],['smart-canvas.js','smartTaskRuntimeHost']].map(([file,name])=>{
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    if(start<0) throw new Error(`Missing production task runtime host: ${name}`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');

const workflowParamModules=['canvas-workflow-params','smart-workflow-params'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const workflowParamHosts=[['canvas.js','classicWorkflowParamsHost'],['smart-canvas.js','smartWorkflowParamsHost']].map(([file,name])=>{
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    if(start<0) throw new Error(`Missing production workflow parameter host: ${name}`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');

const workflowTransferModules=['canvas-workflow-transfer','smart-workflow-transfer'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const workflowTransferHosts=[['canvas.js','classicWorkflowTransferHost'],['smart-canvas.js','smartWorkflowTransferHost']].map(([file,name])=>{
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    if(start<0) throw new Error(`Missing production workflow parameter host: ${name}`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');

const workflowConfigModules=['canvas-workflow-config','smart-workflow-config'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const workflowConfigHosts=[['canvas.js','classicWorkflowConfigHost'],['smart-canvas.js','smartWorkflowConfigHost']].map(([file,name])=>{
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    if(start<0) throw new Error(`Missing production workflow parameter host: ${name}`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');

const nodeEditModules=['canvas-node-edit','canvas-group-edit','smart-node-edit','smart-group-edit','smart-connection-edit'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const nodeEditHosts=[['canvas.js','classicNodeEditHost'],['smart-canvas.js','smartNodeEditHost']].map(([file,name])=>{
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    if(start<0) throw new Error(`Missing production workflow parameter host: ${name}`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');

const layoutModules=['canvas-layout','canvas-interaction','smart-layout','smart-selection'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const layoutHosts=[['canvas.js','classicLayoutHost'],['smart-canvas.js','smartLayoutHost']].map(([file,name])=>{
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    if(start<0) throw new Error(`Missing production workflow parameter host: ${name}`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');

const viewportModules=['canvas-viewport','smart-viewport'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const viewportHosts=[['canvas.js','classicViewportHost'],['smart-canvas.js','smartViewportHost']].map(([file,name])=>{
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    if(start<0) throw new Error(`Missing production workflow parameter host: ${name}`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');

const pointerModule=readFileSync(path.join(__dirname,'../static/js/smart-pointer-events.js'),'utf8');
const pointerSource=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const pointerStart=pointerSource.indexOf('function smartPointerHost(');
if(pointerStart<0) throw new Error('Missing production pointer host');
const pointerHost=pointerSource.slice(pointerStart,pointerSource.indexOf('\n}',pointerStart)+2);

const nodeViewModules=['canvas-node-view','canvas-generation-view','canvas-text-view','canvas-workflow-view'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const nodeViewSource=readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
const nodeViewStart=nodeViewSource.indexOf('function classicNodeViewHost(');
if(nodeViewStart<0) throw new Error('Missing production node view host');
const nodeViewHost=nodeViewSource.slice(nodeViewStart,nodeViewSource.indexOf('\n}',nodeViewStart)+2);

const smartViewModules=['smart-node-view','smart-node-body','smart-node-bindings'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const smartViewSource=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const smartViewStart=smartViewSource.indexOf('function smartNodeViewHost(');
if(smartViewStart<0) throw new Error('Missing production smart node view host');
const smartViewHost=smartViewSource.slice(smartViewStart,smartViewSource.indexOf('\n}',smartViewStart)+2);

const paramPanelModules=['smart-param-view','smart-param-controls','smart-param-state','smart-param-bindings'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const paramPanelSource=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const paramPanelStart=paramPanelSource.indexOf('function smartParamPanelHost(');
if(paramPanelStart<0) throw new Error('Missing production parameter panel host');
const paramPanelHost=paramPanelSource.slice(paramPanelStart,paramPanelSource.indexOf('\n}',paramPanelStart)+2);

const outputViewModules=['canvas-output-view','canvas-output-preview'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const outputViewSource=readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
const outputViewStart=outputViewSource.indexOf('function classicOutputViewHost(');
if(outputViewStart<0) throw new Error('Missing production output view host');
const outputViewHost=outputViewSource.slice(outputViewStart,outputViewSource.indexOf('\n}',outputViewStart)+2);

const imageEditorModules=['canvas-image-editor','smart-image-editor'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const imageEditorHosts=[['canvas.js','classicImageEditorHost'],['smart-canvas.js','smartImageEditorHost']].map(([file,name])=>{
 const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8'),start=source.indexOf(`function ${name}(`);
 if(start<0) throw new Error(`Missing production image editor host: ${name}`);
 return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');

const editorDrawModules=['canvas-editor-text','canvas-editor-draw','smart-editor-text','smart-editor-draw'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const editorDrawHosts=[['canvas.js','classicEditorDrawHost'],['smart-canvas.js','smartEditorDrawHost']].map(([file,name])=>{
 const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8'),start=source.indexOf(`function ${name}(`);
 if(start<0) throw new Error(`Missing production drawing host: ${name}`);
 return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');

const editorGridModules=['canvas-editor-grid','smart-editor-grid'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const editorGridHosts=[['canvas.js','classicEditorGridHost'],['smart-canvas.js','smartEditorGridHost']].map(([file,name])=>{
 const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8'),start=source.indexOf(`function ${name}(`);
 if(start<0) throw new Error(`Missing production grid host: ${name}`);
 return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');

const mediaPreviewModules=['smart-panorama','smart-media-preview'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const mediaPreviewSource=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const mediaPreviewStart=mediaPreviewSource.indexOf('function smartMediaPreviewHost(');
if(mediaPreviewStart<0) throw new Error('Missing production media preview host');
const mediaPreviewHost=mediaPreviewSource.slice(mediaPreviewStart,mediaPreviewSource.indexOf('\n}',mediaPreviewStart)+2);

const promptTemplateModules=['canvas-prompt-template','smart-prompt-template'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const promptTemplateHosts=[['canvas.js','classicPromptTemplateHost'],['smart-canvas.js','smartPromptTemplateHost']].map(([file,name])=>{
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    if(start<0) throw new Error(`Missing production template host: ${name}`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');

const logModules=['canvas-log','smart-log'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const logHosts=[['canvas.js','classicLogHost'],['smart-canvas.js','smartLogHost']].map(([file,name])=>{
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    if(start<0) throw new Error(`Missing production log host: ${name}`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');

const assetPanelModules=['canvas-asset-panel','smart-asset-model','smart-asset-panel','smart-asset-import'].map(name=>readFileSync(path.join(__dirname,`../static/js/${name}.js`),'utf8')).join('\n');
const assetPanelHosts=[['canvas.js','classicAssetPanelHost'],['smart-canvas.js','smartAssetPanelHost']].map(([file,name])=>{
    const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
    const start=source.indexOf(`function ${name}(`);
    if(start<0) throw new Error(`Missing production asset host: ${name}`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}).join('\n');

const mentionModule=readFileSync(path.join(__dirname,'../static/js/smart-mentions.js'),'utf8');
const mentionSource=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const mentionStart=mentionSource.indexOf('function smartMentionHost(');
if(mentionStart<0) throw new Error('Missing production mention host');
const mentionHost=mentionSource.slice(mentionStart,mentionSource.indexOf('\n}',mentionStart)+2);

const presetModule=readFileSync(path.join(__dirname,'../static/js/smart-prompt-presets.js'),'utf8');
const presetSource=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const presetStart=presetSource.indexOf('function smartPromptPresetHost(');
if(presetStart<0) throw new Error('Missing production preset host');
const presetHost=presetSource.slice(presetStart,presetSource.indexOf('\n}',presetStart)+2);

const recoveryControlModule=readFileSync(path.join(__dirname,'../static/js/smart-task-recovery-control.js'),'utf8');
const recoveryControlSource=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const recoveryControlStart=recoveryControlSource.indexOf('function smartTaskRecoveryControlHost(');
if(recoveryControlStart<0) throw new Error('Missing production task recovery control host');
const recoveryControlHost=recoveryControlSource.slice(recoveryControlStart,recoveryControlSource.indexOf('\n}',recoveryControlStart)+2);
const assistantExecutionModule=readFileSync(path.join(__dirname,'../static/js/smart-assistant-execution.js'),'utf8');
const assistantExecutionSource=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const assistantExecutionStart=assistantExecutionSource.indexOf('function smartAssistantExecutionHost(');
if(assistantExecutionStart<0) throw new Error('Missing production assistant execution host');
const assistantExecutionHost=assistantExecutionSource.slice(assistantExecutionStart,assistantExecutionSource.indexOf('\n}',assistantExecutionStart)+2);
const generatorInputModule=readFileSync(path.join(__dirname,'../static/js/canvas-generator-input.js'),'utf8');
const generatorInputSource=readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
const generatorInputStart=generatorInputSource.indexOf('function classicGeneratorInputHost(');
if(generatorInputStart<0) throw new Error('Missing production assistant execution host');
const generatorInputHost=generatorInputSource.slice(generatorInputStart,generatorInputSource.indexOf('\n}',generatorInputStart)+2);
const classicSaveCoordinatorModule=readFileSync(path.join(__dirname,'../static/js/canvas-save-coordinator.js'),'utf8');
const classicSaveCoordinatorSource=readFileSync(path.join(__dirname,'../static/js/canvas.js'),'utf8');
const classicSaveCoordinatorStart=classicSaveCoordinatorSource.indexOf('function classicSaveCoordinatorHost(');
if(classicSaveCoordinatorStart<0) throw new Error('Missing production assistant execution host');
const classicSaveCoordinatorHost=classicSaveCoordinatorSource.slice(classicSaveCoordinatorStart,classicSaveCoordinatorSource.indexOf('\n}',classicSaveCoordinatorStart)+2);
const smartSaveCoordinatorModule=readFileSync(path.join(__dirname,'../static/js/smart-save-coordinator.js'),'utf8');
const smartSaveCoordinatorSource=readFileSync(path.join(__dirname,'../static/js/smart-canvas.js'),'utf8');
const smartSaveCoordinatorStart=smartSaveCoordinatorSource.indexOf('function smartSaveCoordinatorHost(');
if(smartSaveCoordinatorStart<0) throw new Error('Missing production assistant execution host');
const smartSaveCoordinatorHost=smartSaveCoordinatorSource.slice(smartSaveCoordinatorStart,smartSaveCoordinatorSource.indexOf('\n}',smartSaveCoordinatorStart)+2);

function createTaskContext(...args){
    const context=vm.createContext(...args);
    vm.runInContext(readFileSync(path.join(__dirname,'../static/js/canvas-history.js'),'utf8'),context);
    for(const [file,kind] of [['canvas.js','classic'],['smart-canvas.js','smart']]){
        const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
        const start=source.indexOf('function '+kind+'HistoryHost(');
        if(start<0) throw new Error('Missing production history host: '+kind);
        vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
        vm.runInContext('var '+kind+'History=CanvasHistory.create'+(kind==='classic'?'Classic':'Smart')+'('+kind+'HistoryHost());',context);
    }
    vm.runInContext(readFileSync(path.join(__dirname,'../static/js/image-editor-session.js'),'utf8'),context);
    vm.runInContext(readFileSync(path.join(__dirname,'../static/js/canvas-text-selection.js'),'utf8'),context);
    vm.runInContext('var classicTextSelection=CanvasTextSelection.create(); var smartTextSelection=CanvasTextSelection.create();',context);
    vm.runInContext(transport,context);
    for(const [file,host,moduleName] of [
        ['canvas.js','classicOpenCoordinatorHost','canvas-open-coordinator'],
        ['smart-canvas.js','smartOpenCoordinatorHost','smart-open-coordinator'],
        ['canvas.js','classicNavigationHost','canvas-navigation'],
        ['smart-canvas.js','smartNavigationHost','smart-navigation'],
        ['canvas.js','classicRemoteApplicationHost','canvas-remote-application'],
        ['smart-canvas.js','smartRemoteApplicationHost','smart-remote-application'],
        ['canvas.js','classicConnectionLayerHost','canvas-connection-layer'],
        ['smart-canvas.js','smartConnectionLayerHost','smart-connection-layer'],
        ['canvas.js','classicOutputCoordinationHost','canvas-output-edit'],
        ['canvas.js','classicUploadHost','canvas-media-drop'],
        ['canvas.js','classicUploadHost','canvas-upload-coordination'],
        ['smart-canvas.js','smartUploadHost','smart-media-drop'],
        ['smart-canvas.js','smartUploadHost','smart-upload-coordination'],
        ['canvas.js','classicMenuHost','canvas-node-menu'],
        ['canvas.js','classicAssetManagerHost','canvas-asset-manager'],
        ['smart-canvas.js','smartCreateMenuHost','smart-create-menu'],
        ['canvas.js','classicPointerHost','canvas-pointer-events'],
        ['canvas.js','classicKeyboardHost','canvas-keyboard-events'],
        ['canvas.js','classicMediaInputHost','canvas-media-input-events'],
        ['smart-canvas.js','smartMediaInputHost','smart-media-input-events'],
        ['smart-canvas.js','smartDeferredActionsHost','smart-deferred-actions'],
        ['canvas.js','classicImageEditorEventHost','canvas-image-editor-events'],
        ['smart-canvas.js','smartImageEditorEventHost','smart-image-editor-events'],
        ['canvas.js','classicOutputCoordinationHost','canvas-output-recovery'],
        ['smart-canvas.js','smartOutputCoordinationHost','smart-output-coordination'],
        ['canvas.js','classicInputViewHost','canvas-input-view'],
        ['smart-canvas.js','smartInputHost','smart-input-thumbs'],
        ['smart-canvas.js','smartInputHost','smart-prompt-request'],
        ['canvas.js','classicDocumentManagementHost','canvas-document-management'],
        ['canvas.js','classicProviderConfigHost','canvas-provider-config'],
        ['smart-canvas.js','smartProviderConfigHost','smart-provider-config']
    ]){
        const source=readFileSync(path.join(__dirname,'../static/js',file),'utf8');
        const start=source.indexOf(`function ${host}(`);
        if(start<0) throw new Error(`Missing production host: ${host}`);
        vm.runInContext(readFileSync(path.join(__dirname,`../static/js/${moduleName}.js`),'utf8')+'\n'+source.slice(start,source.indexOf('\n}',start)+2),context);
    }


    vm.runInContext('var classicLegacyGateBindings=CanvasDocumentManagement.createLegacyGateBindings({});',context);
    vm.runInContext(recovery+'\n'+recoveryHosts,context);
    vm.runInContext(readFileSync(path.join(__dirname,'../static/js/canvas-task-results.js'),'utf8'),context);
    vm.runInContext(runtime+'\n'+runtimeHosts,context);
    vm.runInContext(graph+'\n'+graphHosts,context);
    vm.runInContext(cascadeState+'\n'+cascadeRunner+'\n'+cascadeHost,context);
    vm.runInContext(smartCascadeModules+'\n'+smartCascadeHost,context);
    vm.runInContext(generationModules+'\n'+generationHost,context);
    vm.runInContext(remainingGenerationModules+'\n'+providerHost+'\n'+smartGenerationHost,context);
    vm.runInContext(onlineSizeRules,context);
    if(!context.OnlineImageSizeRules && context.window?.OnlineImageSizeRules) context.OnlineImageSizeRules=context.window.OnlineImageSizeRules;
    vm.runInContext(nodeParamModules+'\n'+nodeParamHosts,context);
    vm.runInContext(workflowParamModules+"\n"+workflowParamHosts,context);
    vm.runInContext(workflowTransferModules+"\n"+workflowTransferHosts,context);
    vm.runInContext(workflowConfigModules+"\n"+workflowConfigHosts,context);
    vm.runInContext(nodeEditModules+"\n"+nodeEditHosts,context);
    vm.runInContext(layoutModules+"\n"+layoutHosts,context);
    vm.runInContext(viewportModules+"\n"+viewportHosts,context);
    vm.runInContext(pointerModule+"\n"+pointerHost,context);
    vm.runInContext(nodeViewModules+"\n"+nodeViewHost,context);
    vm.runInContext(smartViewModules+"\n"+smartViewHost,context);
    vm.runInContext(paramPanelModules+"\n"+paramPanelHost,context);
    vm.runInContext(outputViewModules+"\n"+outputViewHost,context);
    vm.runInContext(imageEditorModules+"\n"+imageEditorHosts,context);
    vm.runInContext(editorDrawModules+"\n"+editorDrawHosts,context);
    vm.runInContext(editorGridModules+"\n"+editorGridHosts,context);
    vm.runInContext(mediaPreviewModules+"\n"+mediaPreviewHost,context);
    vm.runInContext(promptTemplateModules+"\n"+promptTemplateHosts,context);
    vm.runInContext(logModules+"\n"+logHosts,context);
    vm.runInContext(assetPanelModules+"\n"+assetPanelHosts,context);
    vm.runInContext(mentionModule+"\n"+mentionHost,context);
    vm.runInContext(presetModule+"\n"+presetHost,context);
    vm.runInContext(recoveryControlModule+"\n"+recoveryControlHost,context);
    vm.runInContext(assistantExecutionModule+"\n"+assistantExecutionHost,context);
    vm.runInContext(generatorInputModule+"\n"+generatorInputHost,context);
    vm.runInContext(classicSaveCoordinatorModule+"\n"+classicSaveCoordinatorHost,context);
    vm.runInContext(smartSaveCoordinatorModule+"\n"+smartSaveCoordinatorHost,context);
    vm.runInContext(classicMouseEntries+'\nvar classicPointerController=typeof classicPointerController===\'undefined\'?CanvasPointerEvents.create(classicPointerHost):classicPointerController;',context);
    vm.runInContext('var classicMediaInputController=CanvasMediaInputEvents.create(classicMediaInputHost);',context);
    vm.runInContext('var smartMediaInputController=SmartMediaInputEvents.create(smartMediaInputHost);',context);
    vm.runInContext('var smartDeferredActions=SmartDeferredActions.create(smartDeferredActionsHost);',context);
    vm.runInContext('var classicImageEditorEvents=CanvasImageEditorEvents.create(classicImageEditorEventHost);var smartImageEditorEvents=SmartImageEditorEvents.create(smartImageEditorEventHost);',context);
    return context;
}

module.exports={createTaskContext};
