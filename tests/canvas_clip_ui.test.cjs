const test = require('node:test');
const assert = require('node:assert/strict');
const UI = require('../static/js/canvas-clip-node.js');
const fs = require('node:fs');
const vm = require('node:vm');

test('预览用源偏移定位，空隙显示黑场且片段端点不串片', () => {
  const clips = [{id:'a', startFrame:60, endFrame:150, sourceOffsetFrames:60}, {id:'b', startFrame:180, endFrame:240, sourceOffsetFrames:0}];
  assert.equal(UI.frameAt(clips, 59), null);
  assert.equal(UI.frameAt(clips, 150), null);
  assert.equal(UI.frameAt(clips, 180).clip.id, 'b');
  assert.equal(UI.frameAt(clips, 90).sourceSeconds, 3);
});

test('尺子点击在不同画布缩放下保持同一帧，轴滚动不会重复算偏移', () => {
  for (const scale of [.5, 1, 2]) {
    assert.equal(UI.frameFromClient(100 + 96 * scale, 100, scale), 120);
  }
  assert.equal(UI.frameFromClient(30, 100, 1), 0);
});

test('时间显示不把帧值误当秒，并支持一分钟以上', () => {
  assert.equal(UI.formatTime(1800), '01:00');
  assert.equal(UI.formatTime(119), '00:03');
});

test('Ctrl/Cmd/Alt+S不会误分割，普通S仍正常分割', () => {
  // 只在隔离VM暴露闭包供回归验证，不给产品增加测试入口。
  const source=fs.readFileSync(require.resolve('../static/js/canvas-clip-node.js'),'utf8')
    .replace('const api={mount,','root.__shortcut=shortcut;const api={mount,');
  const sandbox={CanvasClipModel:require('../static/js/canvas-clip-model.js'),document:{activeElement:null},module:{exports:{}}};
  vm.runInNewContext(source,sandbox);
  let data=sandbox.CanvasClipModel.addMedia(sandbox.CanvasClipModel.createData(),{kind:'image',url:'/sample.png'}),writes=0;
  const state={active:true,context:{canvasId:'c',generation:1},id:'n',frame:60,node:{clipData:data},el:{contains:()=>false},host:{isCurrent:()=>true,readOnly:()=>false,commit:(_,next)=>{data=next;state.node.clipData=next;writes++;}}};
  const event=extra=>({key:'s',target:{closest:()=>null},preventDefault(){},stopImmediatePropagation(){},...extra});
  sandbox.__shortcut(state,event({ctrlKey:true}));
  sandbox.__shortcut(state,event({metaKey:true}));
  sandbox.__shortcut(state,event({altKey:true}));
  assert.equal(writes,0);assert.equal(data.clips.length,1);
  sandbox.__shortcut(state,event({}));
  assert.equal(writes,1);assert.equal(data.clips.length,2);
});
