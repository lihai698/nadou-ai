const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const sources=require('../static/js/canvas-media-sources.js');

const names={
 classic:{original:'canvasOriginalMediaUrl',filename:'canvasFileNameFromUrl',proxy:'canvasProxiedMediaUrl',display:'canvasDisplayMediaUrl',preview:'canvasMediaPreviewUrl',image:'canvasPreviewImgHtml',video:'canvasVideoPreviewHtml',fallback:'canvasVideoFallbackHtml',player:'canvasVideoPlayerHtml'},
 smart:{original:'smartOriginalMediaUrl',filename:'fileNameFromUrl',proxy:'proxiedMediaUrl',display:'displayMediaUrl',preview:'smartMediaPreviewUrl',image:'smartPreviewImgHtml',video:'smartVideoPreviewHtml',fallback:'smartVideoFallbackHtml',player:'smartVideoPlayerHtml'}
};
const escape=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(kind){
 const deps={URL,window:{location:{origin:'http://127.0.0.1:8188',href:'http://127.0.0.1:8188/static/canvas.html'}},escapeAttr:escape,escapeHtml:escape};
 for(const name of Object.values(names[kind]))deps[name]=(...args)=>sources[name](deps,...args);
 return {deps,call:(key,...args)=>deps[names[kind][key]](...args)};
}
for(const kind of ['classic','smart']){
 test(`${kind}: local, embedded and remote media keep their source and download names`,()=>{
  const {call}=fixture(kind);
  for(const raw of ['', '/assets/测试 图.png','/output/a.mp4?x=1#t=2','data:image/png;base64,eA==','blob:fixture'])assert.equal(call('display',raw),raw);
  assert.equal(call('display','https://example.invalid/图像.png?x=1'),'/'+'api/download-output?inline=1&url='+encodeURIComponent('https://example.invalid/图像.png?x=1')+'&name='+encodeURIComponent('图像.png'));
  assert.equal(call('proxy','https://example.invalid/a.mp4','指定.mp4'),'/api/download-output?inline=1&url=https%3A%2F%2Fexample.invalid%2Fa.mp4&name='+encodeURIComponent('指定.mp4'));
 });
 test(`${kind}: preview unwrap, dimension clamp and unsupported extensions`,()=>{
  const {call}=fixture(kind),raw='/assets/图.png?x=1#y';
  const wrapped='/api/media-preview?w=128&url='+encodeURIComponent(raw);
  assert.equal(call('original',wrapped),raw);
  assert.equal(call('original','/api/media-preview?w=128'),'/api/media-preview?w=128');
  for(const[size,width]of [[0,512],[-1,64],[63.5,64],[128.6,129],[3000,2048],['bad',512]])assert.equal(call('preview',wrapped,size),`/api/media-preview?w=${width}&url=${encodeURIComponent(raw)}`);
  assert.equal(call('preview','/assets/file.txt'),'/assets/file.txt');
  assert.equal(call('preview','/assets/video.flv'),kind==='classic'?'/api/media-preview?w=512&url=%2Fassets%2Fvideo.flv':'/assets/video.flv');
 });
 test(`${kind}: generated image and video markup keeps original identity and escapes URLs`,()=>{
  const {call}=fixture(kind),url='/assets/"a&b.png',preview='/api/media-preview?w=256&url='+encodeURIComponent(url);
  const image=call('image',url,256,'class="thumb"');
  assert.ok(image.includes(`src="${escape(preview)}"`));assert.ok(image.includes(`data-original-src="${escape(url)}"`));assert.ok(image.endsWith(' class="thumb">'));
  assert.equal(image.includes('loading="lazy" decoding="async"'),kind==='classic');
  const video=call('video','/assets/clip.mp4',128,'class="video"');assert.match(video,/data-preview-kind="video"/);assert.match(video,/data-url="\/assets\/clip.mp4"/);
  const fallback=call('fallback','https://example.invalid/clip.mp4');assert.match(fallback,/ muted preload="metadata" playsinline/);assert.ok(!fallback.includes(' autoplay'));
  const player=call('player','/output/clip.mp4','class="player"');assert.match(player,/ controls autoplay playsinline/);assert.equal(player.includes('data-inline-video-active="1"'),kind==='smart');
 });
 test(`${kind}: callback replacement is observed during source and markup generation`,()=>{
  const {deps,call}=fixture(kind),calls=[];
  deps[names[kind].original]=arg=>{calls.push(['original',arg]);return '/assets/fixed.png';};
  deps[names[kind].preview]=(arg,size)=>{calls.push(['preview',arg,size]);return 'preview&url';};
  assert.ok(call('image','requested',256).includes('src="preview&amp;url"'));
  assert.deepEqual(calls,[['original','requested'],['preview',kind==='classic'?'/assets/fixed.png':'requested',256]]);
 });
 test(`${kind}: filename handling preserves decoded paths and malformed encoding errors`,()=>{
  const {deps,call}=fixture(kind);assert.equal(call('filename','https://example.invalid/a/%E4%B8%AD%E6%96%87.mp4?x=1#t=2'),'中文.mp4');
  assert.equal(call('filename','/assets/path/'),'path');assert.throws(()=>call('filename','/assets/%zz.png'),URIError);
  deps.URL=class {constructor(){throw Error('unparseable URL');}};
  assert.equal(call('filename','folder/hello%20world.png?x=1#x'),'hello world.png');
  assert.equal(call('original','raw input'),'raw input');
 });
}
test('smart item names, original objects and unsupported proxy sources retain their existing rules',()=>{
 const {call}=fixture('smart'),item={url:'https://example.invalid/source.mp4',name:'保留 名称.mp4',kind:'video'};
 assert.equal(call('original',item),item.url);assert.ok(call('display',item).endsWith('&name='+encodeURIComponent(item.name)));
 assert.equal(item.url,'https://example.invalid/source.mp4');assert.equal(call('proxy','relative/path'),'/'+'api/download-output?inline=1&url=relative%2Fpath&name=path');
 assert.equal(fixture('classic').call('proxy','relative/path'),'relative/path');
});
test('module loads independently in a browser context without DOM, location or timers',()=>{
 const context={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/js/canvas-media-sources.js'),'utf8'),context);
 assert.equal(Object.keys(context.CanvasMediaSources).length,18);assert.deepEqual(Object.keys(context),['CanvasMediaSources']);
});
test('both real canvas pages load the source owner before their entry script',()=>{
 for(const name of ['canvas','smart-canvas']){
  const html=fs.readFileSync(path.join(__dirname,`../static/${name}.html`),'utf8'),owner=html.indexOf('/static/js/canvas-media-sources.js?'),entry=html.indexOf(`/static/js/${name}.js?`);
  assert.ok(owner>=0&&owner<entry);assert.equal(html.split('/static/js/canvas-media-sources.js?').length,2);
 }
});
