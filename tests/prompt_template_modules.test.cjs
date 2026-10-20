const {test}=require('node:test');
const assert=require('node:assert/strict');
const classic=require('../static/js/canvas-prompt-template.js');
const smart=require('../static/js/smart-prompt-template.js');
test('template full text retains deliberate editor differences',()=>{
 const template={positive:' 正文 ',negative:'模糊',params:{ratio:'1:1'}};
 assert.equal(classic.canvasPromptTemplateText({},template,'full'),'正文\n\nNegative prompt:\n模糊\n\nParams:\nratio: 1:1');
 assert.equal(smart.promptTemplateText({},template,'full'),'正文');
 assert.equal(smart.promptTemplateText({},{...template,builtin:true},'full'),classic.canvasPromptTemplateText({},template,'full'));
});
for(const kind of ['classic','smart'])test(`${kind}: assistant template callback is consumed without editing a node`,()=>{
 const node={id:'n',type:'prompt',text:'original'};const seen=[];
 const deps={nodes:[node],canvasAssistantTemplateCallback:text=>seen.push(text),promptTemplateSelectedId:'t',render(){},document:{querySelectorAll:()=>[]},composerTemplateBtn:null};
 if(kind==='classic'){
  Object.assign(deps,{canvasPromptTemplates:[{id:'t',positive:'template'}],promptTemplateNodeId:'n',promptTemplateModal:{classList:{remove(){},contains:()=>false}}});
  classic.applyPromptTemplateToPromptNode(deps);
 }else{
  Object.assign(deps,{activePromptLibraryId:'user',promptLibraries:[{id:'user',items:[{id:'t',positive:'template'}]}],promptTemplatePanel:{dataset:{target:'assistant'},classList:{remove(){}}}});
  smart.applyPromptTemplateToNode(deps);
 }
 assert.deepEqual(seen,['template']);assert.equal(deps.canvasAssistantTemplateCallback,null);assert.equal(node.text,'original');
});
test('classic missing template leaves node unchanged',()=>{
 const node={id:'n',type:'prompt',text:'original'};
 classic.applyPromptTemplateToPromptNode({canvasPromptTemplates:[],promptTemplateSelectedId:'missing',nodes:[node],promptTemplateNodeId:'n'});
 assert.equal(node.text,'original');
});
