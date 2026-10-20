const test=require('node:test'),assert=require('node:assert/strict');
for(const kind of ['canvas','smart']){
 const draw=require(`../static/js/${kind}-editor-draw.js`),text=require(`../static/js/${kind}-editor-text.js`);
 test(`${kind}: mask export uses alpha threshold and produces opaque black/white pixels`,()=>{
  const input=new Uint8ClampedArray([9,8,7,8,1,2,3,9,4,5,6,0]);let result;
  const canvas={getContext:()=>({createImageData:()=>({data:new Uint8ClampedArray(12)}),putImageData:x=>result=x.data})};
  draw.maskCanvasFromDrawCanvas({document:{createElement:()=>canvas}},{width:3,height:1,getContext:()=>({getImageData:()=>({data:input})})});
  assert.deepEqual([...result],[0,0,0,255,255,255,255,255,0,0,0,255]);assert.equal(input[0],9);
 });
 test(`${kind}: drawing history restores text and pixels without aliasing`,()=>{
  let pixel=1;const canvas={width:1,height:1,getContext:()=>({getImageData:()=>({data:[pixel]}),putImageData:data=>pixel=data.data[0]})};
  const d={document:{getElementById:id=>id==='editDrawCanvas'?canvas:null},editDrawUndoStack:[],editDrawRedoStack:[],EDIT_DRAW_HISTORY_MAX:3,brushLabelCounter:1,editTextItems:[{id:'t',text:'before'}],editTextSelectedId:'t',removeEditTextInlineEditor(){},renderEditTextCanvas(){},syncTextToolState(){}};
  draw.pushEditDrawHistory(d);d.editTextItems[0].text='after';pixel=2;draw.undoEditDrawing(d);assert.equal(pixel,1);assert.equal(d.editTextItems[0].text,'before');draw.redoEditDrawing(d);assert.equal(pixel,2);assert.equal(d.editTextItems[0].text,'after');
 });
 test(`${kind}: text creation clamps font size and preserves coordinates`,()=>{
  const item=text.createEditTextItem({uid:()=> 'txt',editBrushSize:()=>20,brushColor:()=> '#f00'},'  hello  ',{x:10,y:20},{size:500});assert.equal(item.text,'hello');assert.equal(item.size,120);assert.equal(item.x,10);assert.equal(item.color,'#f00');
 });
 test(`${kind}: text hit testing chooses the last rendered overlapping label`,()=>{
  const ctx={save(){},restore(){},measureText:()=>({width:40,actualBoundingBoxAscent:12,actualBoundingBoxDescent:4})};
  const items=[{id:'back',x:10,y:20,size:20,text:'a'},{id:'front',x:10,y:20,size:20,text:'b'}];const d={editTextItems:items,document:{getElementById:()=>({getContext:()=>ctx})}};
  assert.equal(text.hitEditTextItem(d,{x:10,y:20}).id,'front');assert.equal(text.hitEditTextItem(d,{x:1000,y:1000}),null);
 });
}
