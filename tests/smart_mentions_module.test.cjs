const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');const api=require('../static/js/smart-mentions.js');const {createTaskContext}=require('./canvas_task_test_helpers.cjs');
function fn(name){const s=fs.readFileSync(require.resolve('../static/js/smart-canvas.js'),'utf8'),p=s.indexOf('function '+name+'(');return s.slice(p,s.indexOf('\n}',p)+2);}
const escapeHtml=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
test('mention HTML chooses longest name and escapes attributes and plain text',()=>{
 const html=api.promptHtmlWithMentionTokens({escapeHtml,mediaKindForItem:()=> 'image',smartPreviewImgHtml:()=>'<img>'},'@AB <x>',[{name:'A',url:'/one'},{name:'AB',url:'/two?x="y"'}]);
 assert.match(html,/data-name="AB"/);assert.ok(!html.includes('/one'));assert.match(html,/&quot;y&quot;/);assert.ok(html.endsWith(' &lt;x&gt;'));
});
test('real mention host deduplicates manual reference and removes last reference cleanly',()=>{
 const node={id:'n'};let undo=0,saved=0;const context=createTaskContext({selectedNode:()=>node,mentionPicker:{classList:{remove(){}},innerHTML:''},mentionAnchorEl:null,mentionInsertMode:'manual-ref',inputRefKey:r=>r.url,pushUndo:()=>undo++,scheduleSave:()=>saved++,renderInputThumbsRow(){},mediaKindForItem:()=> 'image'});
 vm.runInContext(fn('addManualReferenceToSelectedNode')+'\n'+fn('removeManualReferenceFromSelectedNode'),context);
 context.addManualReferenceToSelectedNode({url:'/asset.png',name:'素材',asset_uris:{apimart:'asset://fixture'}});context.addManualReferenceToSelectedNode({url:'/asset.png'});assert.equal(node.manualInputRefs.length,1);assert.equal(node.manualInputRefs[0].asset_uris.apimart,'asset://fixture');assert.equal(undo,1);assert.equal(saved,1);
 context.removeManualReferenceFromSelectedNode('/asset.png');assert.equal(node.manualInputRefs,undefined);assert.equal(undo,2);assert.equal(saved,2);
});
test('mention anchor coordinates account for viewport scale',()=>{
 const style={},base={getBoundingClientRect:()=>({left:100,top:50,width:600})};api.positionMentionPickerAtCaret({promptInput:{closest:()=>base},mentionAnchorEl:{getBoundingClientRect:()=>({right:400,bottom:150})},viewport:{scale:2},mentionPicker:{offsetWidth:100,offsetParent:base,style}});assert.deepEqual(style,{left:'50px',top:'52px'});
});
test('programmatic token insertion saves the updated draft without requiring another keystroke',()=>{
 const events=[],node={id:'n'},range={startContainer:{nodeType:3,textContent:'@'},startOffset:1,setStart(){},deleteContents(){},insertNode(){events.push('insert');},setStartAfter(){},collapse(){}};
 const selection={rangeCount:1,getRangeAt:()=>range,removeAllRanges(){},addRange(){}};
 const deps={Node:{TEXT_NODE:3},promptInput:{focus(){},dataset:{preserveDraftOnce:'1'}},mentionRange:null,window:{getSelection:()=>selection},document:{createElement:()=>({dataset:{},after(){}}),createTextNode:()=>({})},mentionPicker:{classList:{remove(){}},innerHTML:''},selectedNode:()=>node,renderInputThumbsRow(){},mediaKindForItem:()=> 'image',smartPreviewImgHtml:()=>'<img>',escapeHtml,bindSmartPreviewImageFallbacks(){},savePromptDraftForCurrent:()=>events.push('draft'),scheduleSave:()=>events.push('save')};
 api.insertMentionToken(deps,{url:'/reference.png',name:'reference'});
 assert.deepEqual(events,['insert','draft','save']);assert.equal(deps.promptInput.dataset.preserveDraftOnce,undefined);
});
