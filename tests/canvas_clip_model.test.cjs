const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modelPath = path.join(__dirname, '../static/js/canvas-clip-model.js');

function model() {
  assert.ok(fs.existsSync(modelPath), '原生剪辑帧模型尚未实现');
  return require(modelPath);
}
function media(id, extra = {}) {
  return { kind: 'video', url: `/media/${id}.mp4`, sourceNodeId: id, sourceResultId: 'main', durationSeconds: 4, ...extra };
}
function sequence(...items) {
  const M = model();
  return items.reduce((data, item) => M.addMedia(data, item), M.createData());
}
function positions(data) {
  return data.clips.map(c => [c.startFrame, c.endFrame, c.sourceOffsetFrames]);
}

test('默认时长按手动图片4秒、上游6秒和视频metadata转换为整数帧', () => {
  const M = model();
  let d = sequence(media('pic', { kind: 'image', durationSeconds: undefined }), media('up', { kind: 'image', fromUpstream: true, durationSeconds: undefined }), media('fallback', { durationSeconds: undefined }), media('short', { durationSeconds: 0.01 }));
  assert.deepEqual(positions(d), [[0,120,0], [120,300,0], [300,480,0], [480,481,0]]);
  assert.equal(M.durationFrames(d), 481);
  assert.equal(d.clips[1].durationUnconfirmed, true);
  assert.equal(d.clips[2].durationUnconfirmed, true);
  assert.equal(d.exportMuted, false);
});

test('同步同节点多个结果各加一次，断连或URL变化保留原快照', () => {
  const M = model();
  let d = M.syncSources(M.createData(), [media('n'), media('n'), media('n', { sourceResultId: 'second', url: '/media/second.mp4' })]);
  assert.equal(d.clips.length, 2);
  d = M.syncSources(d, [media('n', { url: '/media/changed.mp4' })]);
  assert.equal(d.clips.length, 2);
  assert.equal(d.clips[0].url, '/media/n.mp4');
  assert.equal(M.syncSources(d, []).clips.length, 2);
});

test('来源身份避免字符串分隔符碰撞，无身份手动素材以URL区分', () => {
  let d = sequence(media('a:b', { sourceResultId: 'c' }), media('a', { sourceResultId: 'b:c' }), media('', { sourceResultId: '', url: '/image/a.png', kind: 'image' }), media('', { sourceResultId: '', url: '/image/b.png', kind: 'image' }));
  assert.equal(d.clips.length, 4);
});

test('删除最后实例后同步不会灌回，手动加回解除来源排除', () => {
  const M = model();
  let d = sequence(media('n'));
  d = M.duplicate(d, d.clips[0].id);
  d = M.remove(d, d.clips[0].id);
  assert.deepEqual(d.excludedSources, []);
  d = M.remove(d, d.clips[0].id);
  assert.deepEqual(d.excludedSources, ['["n","main"]']);
  assert.equal(M.syncSources(JSON.parse(JSON.stringify(d)), [media('n')]).clips.length, 0);
  d = M.addMedia(d, media('n'), { manual: true });
  assert.equal(d.clips.length, 1);
  assert.deepEqual(d.excludedSources, []);
});

test('分割已裁去2秒的片段时右段保留正确5秒源偏移', () => {
  const M = model();
  let d = sequence(media('v', { durationSeconds: 10 }));
  d = M.trim(d, d.clips[0].id, 'left', 60);
  d = M.move(d, d.clips[0].id, 0, { disableSnap: true });
  const id = d.clips[0].id;
  assert.deepEqual(positions(M.split(d, id, 0)), [[0,240,60]]);
  assert.deepEqual(positions(M.split(d, id, 240)), [[0,240,60]]);
  const split = M.split(d, id, 90);
  assert.deepEqual(positions(split), [[0,90,60], [90,240,150]]);
  assert.notEqual(split.clips[1].id, id);
  assert.equal(split.selectedClipId, split.clips[1].id);
  assert.equal(split.clips[1].sourceNodeId, 'v');
});

test('复制保留裁剪并寻找合法空位，不覆盖邻片', () => {
  const M = model();
  let d = sequence(media('a'), media('b'));
  d = M.trim(d, d.clips[0].id, 'left', 30);
  const original = d.clips[0];
  const copy = M.duplicate(d, original.id);
  assert.deepEqual(positions(copy), [[30,120,30], [120,240,0], [240,330,30]]);
  assert.equal(copy.clips[2].sourceNodeId, 'a');
  assert.notEqual(copy.clips[2].id, original.id);
});

test('删除后按时间顺序收紧所有片段，保留源偏移', () => {
  const M = model();
  let d = sequence(media('a'), media('b'), media('c'));
  d = M.move(d, d.clips[2].id, 500, { disableSnap: true });
  d = M.remove(d, d.clips[1].id);
  assert.deepEqual(positions(d), [[0,120,0], [120,240,0]]);
  assert.equal(M.durationFrames(d), 240);
});

test('视频左右裁剪不能越过源边界且最少一帧', () => {
  const M = model();
  let d = sequence(media('v'));
  d = M.move(d, d.clips[0].id, 60, { disableSnap: true });
  const id = d.clips[0].id;
  assert.deepEqual(positions(M.trim(d, id, 'left', 0)), [[60,180,0]]);
  d = M.trim(d, id, 'left', 90);
  assert.deepEqual(positions(M.trim(d, id, 'left', 40)), [[60,180,0]]);
  assert.deepEqual(positions(M.trim(d, id, 'right', 400)), [[90,180,30]]);
  assert.deepEqual(positions(M.trim(d, id, 'right', 0)), [[90,91,30]]);
  assert.deepEqual(positions(M.trim(d, id, 'left', 400)), [[179,180,119]]);
});

test('图片可延长且裁剪受前后邻片限制', () => {
  const M = model();
  let d = sequence(media('a'), media('pic', { kind: 'image' }), media('b'));
  const id = d.clips[1].id;
  assert.deepEqual(positions(M.trim(d, id, 'left', 0)), [[0,120,0], [120,240,0], [240,360,0]]);
  assert.deepEqual(positions(M.trim(d, id, 'right', 900)), [[0,120,0], [120,240,0], [240,360,0]]);
  d = M.remove(d, d.clips[2].id);
  d = M.trim(d, id, 'right', 900);
  assert.equal(d.clips[1].endFrame, 900);
});

test('移动吸附播放头或其他首尾，Shift关闭吸附，并防重叠', () => {
  const M = model();
  const d = sequence(media('a'), media('b'));
  const id = d.clips[1].id;
  assert.deepEqual(positions(M.move(d, id, 124, { thresholdFrames: 5 })), [[0,120,0], [120,240,0]]);
  assert.equal(M.move(d, id, 124, { thresholdFrames: 5, disableSnap: true }).clips[1].startFrame, 124);
  assert.equal(M.move(d, id, 198, { snapFrame: 200, thresholdFrames: 3 }).clips[1].startFrame, 200);
  assert.equal(M.move(d, id, 40, { disableSnap: true }).clips[1].startFrame, 120);
  const single = sequence(media('s'));
  assert.equal(M.move(single, single.clips[0].id, 198, { snapFrame: 320, thresholdFrames: 3 }).clips[0].startFrame, 200);
});

test('完整导出保留空隙，逐段从0开始并保留源offset和静音设置', () => {
  const M = model();
  let d = sequence(media('a'), media('b'));
  d = M.trim(d, d.clips[1].id, 'left', 150);
  d = M.move(d, d.clips[1].id, 300, { disableSnap: true });
  d.exportMuted = true;
  const full = M.exportTasks(d, 'full');
  assert.equal(full.length, 1);
  assert.deepEqual(positions(full[0].clipData), [[0,120,0], [300,390,30]]);
  const parts = M.exportTasks(d, 'segments');
  assert.equal(parts.length, 2);
  assert.deepEqual(positions(parts[1].clipData), [[0,90,30]]);
  assert.equal(parts[1].clipData.exportMuted, true);
  assert.equal(parts[1].sourceClipId, d.clips[1].id);
  assert.equal(M.exportTasks(M.createData(), 'full').length, 0);
});

test('复制重映射来源和排除身份、生成新实例并保留选择和快照', () => {
  const M = model();
  let d = sequence(media('a'), media('b'));
  d = M.remove(d, d.clips[0].id);
  const copied = M.remap(d, { a: 'a-copy', b: 'b-copy' });
  assert.equal(copied.clips[0].sourceNodeId, 'b-copy');
  assert.equal(copied.clips[0].url, '/media/b.mp4');
  assert.notEqual(copied.clips[0].id, d.clips[0].id);
  assert.equal(copied.selectedClipId, copied.clips[0].id);
  assert.deepEqual(copied.excludedSources, ['["a-copy","main"]']);
});

test('所有编辑和导出不改变调用方数据且不共享可变引用', () => {
  const M = model();
  const d = sequence(media('a'), media('b'));
  const before = JSON.stringify(d);
  const id = d.clips[0].id;
  const results = [M.addMedia(d, media('c')), M.syncSources(d, [media('c')]), M.split(d,id,30), M.duplicate(d,id), M.remove(d,id), M.move(d,id,500), M.trim(d,id,'right',80), M.remap(d, {}), M.split(d,id,0), M.exportTasks(d,'full')[0].clipData];
  for (const result of results) {
    assert.notEqual(result, d);
    assert.notEqual(result.clips, d.clips);
    if (result.clips.length) result.clips[0].url = '/changed';
  }
  assert.equal(JSON.stringify(d), before);
});

test('浏览器全局接口无需CommonJS，拒绝非图片视频和无URL素材', () => {
  const M = model();
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(modelPath, 'utf8'), context);
  assert.equal(typeof context.window.CanvasClipModel.split, 'function');
  assert.equal(M.addMedia(M.createData(), media('audio', {kind:'audio'})).clips.length, 0);
  assert.equal(M.addMedia(M.createData(), media('empty', {url:''})).clips.length, 0);
});

test('Map重映射保留未复制来源，排除与实例ID不共享原引用', () => {
  const M = model();
  let d = sequence(media('a'), media('b'), media('c'));
  d = M.remove(d, d.clips[0].id);
  const mapped = M.remap(d, new Map([['a', 'new-a'], ['b', 'new-b']]));
  assert.deepEqual(mapped.clips.map(c => c.sourceNodeId), ['new-b', 'c']);
  assert.deepEqual(mapped.excludedSources, ['["new-a","main"]']);
  assert.equal(new Set(mapped.clips.map(c => c.id)).size, 2);
  assert.equal(mapped.clips.some(c => d.clips.some(old => old.id === c.id)), false);
});

test('合法空隙放置选择最近位置并保持片段完整长度', () => {
  const M = model();
  let d = sequence(media('a', {durationSeconds:2}), media('b', {durationSeconds:2}), media('c', {durationSeconds:2}));
  d = M.move(d, d.clips[1].id, 300, {disableSnap:true});
  const moved = M.move(d, d.clips.find(c => c.sourceNodeId === 'b').id, 75, {disableSnap:true});
  assert.deepEqual(positions(moved), [[0,60,0], [60,120,0], [120,180,0]]);
});

test('小数帧四舍五入，非有限帧和不存在片段不损坏时间线', () => {
  const M = model();
  const d = sequence(media('a'));
  const id = d.clips[0].id;
  assert.deepEqual(positions(M.trim(d, id, 'right', 60.6)), [[0,61,0]]);
  assert.deepEqual(positions(M.split(d, id, NaN)), [[0,120,0]]);
  assert.deepEqual(positions(M.move(d, id, Infinity)), [[0,120,0]]);
  assert.deepEqual(positions(M.trim(d, id, 'left', Infinity)), [[0,120,0]]);
  assert.deepEqual(positions(M.remove(d, 'not-a-clip')), [[0,120,0]]);
});
