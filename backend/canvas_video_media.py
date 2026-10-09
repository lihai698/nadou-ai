"""画布视频本地拆镜与抽帧，存储和 URL 由入口注入。"""
from __future__ import annotations
import hashlib,json,math,re,subprocess,time,uuid
from pathlib import Path
from urllib.parse import urlsplit
from backend.canvas_clip import find_media_tools,download_public_media,MEDIA_DEMUXERS

class VideoCancelled(ValueError):pass

def cap_cuts(cuts,cap=120):
    if len(cuts)<=cap:return list(cuts),.1,False
    threshold=sorted((c['score'] for c in cuts),reverse=True)[cap]
    strong=[c for c in cuts if c['score']>threshold];tied=[c for c in cuts if c['score']==threshold]
    need=cap-len(strong);chosen={id(tied[math.floor(i*len(tied)/need)]) for i in range(need)}
    return [c for c in cuts if c['score']>threshold or id(c) in chosen],threshold,True

class VideoMedia:
    def __init__(self,output_dir,url_for,resolve_local,allowed_roots,*,tools=None):
        self.output_dir=Path(output_dir).resolve();self.output_dir.mkdir(parents=True,exist_ok=True)
        self.cache=self.output_dir/'video_deconstruction';self.cache.mkdir(exist_ok=True)
        self.url_for=url_for;self.resolve_local=resolve_local;self.allowed_roots=[Path(p).resolve() for p in allowed_roots];self.tools=tools

    def resolve(self,source):
        url=str(source.get('source_url') or source.get('sourceUrl') or '')
        if len(url)>8192:raise ValueError('视频地址过长')
        if url.startswith(('/assets/','/output/','/api/storage-files/')):
            path=self.resolve_local(url)
            if not path:raise ValueError('视频文件不存在')
            path=Path(path).resolve()
            if not any(path.is_relative_to(root) for root in self.allowed_roots) or not path.is_file():raise ValueError('视频不在允许素材目录内')
            return path
        if urlsplit(url).scheme in {'http','https'}:
            dest=self.cache/(hashlib.sha256(url.encode()).hexdigest()+'.media')
            if not dest.exists():
                temporary=dest.with_suffix('.download-'+uuid.uuid4().hex)
                try:download_public_media(url,temporary);temporary.replace(dest)
                finally:temporary.unlink(missing_ok=True)
            return dest
        raise ValueError('请使用画布上已有的视频素材')

    def fingerprint(self,source):
        path=self.resolve(source);stat=path.stat()
        # 已保存的源身份与文件变化都参与确认，整批任务复用同一文件快照。
        return hashlib.sha256(json.dumps([str(path),stat.st_size,stat.st_mtime_ns,source.get('node_id'),source.get('result_id')],ensure_ascii=False).encode()).hexdigest()

    def _tools(self):return self.tools or find_media_tools()
    def _command(self,args,*,cancelled=lambda:False,timeout=1800):
        if cancelled():raise VideoCancelled('任务已取消')
        try:process=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        except OSError as exc:raise ValueError('媒体工具无法启动，请检查 FFmpeg 组件') from exc
        start=time.monotonic()
        try:
            while True:
                if cancelled():raise VideoCancelled('任务已取消')
                if time.monotonic()-start>timeout:raise ValueError('视频处理超时，请尝试较短视频')
                try:out,err=process.communicate(timeout=.25);break
                except subprocess.TimeoutExpired:continue
            if process.returncode:raise ValueError('视频处理失败：素材损坏、编码不支持或工具不可用')
            return out
        finally:
            if process.poll() is None:process.kill();process.communicate()

    def _input(self,path):return ['-protocol_whitelist','file,pipe','-format_whitelist',MEDIA_DEMUXERS,'-i',str(path)]
    def probe(self,source,*,cancelled=lambda:False):
        path=self.resolve(source)
        raw=self._command([self._tools()[1],'-v','error',*self._input(path),'-show_streams','-show_format','-of','json'],cancelled=cancelled,timeout=60)
        value=json.loads(raw);v=next((s for s in value.get('streams',[]) if s.get('codec_type')=='video'),None)
        if not v:raise ValueError('素材不包含视频画面')
        duration=float(value.get('format',{}).get('duration') or v.get('duration') or 0)
        if not math.isfinite(duration) or duration<=0:raise ValueError('无法读取有效视频时长')
        if duration>21600:raise ValueError('本地检测单次最多支持 6 小时视频')
        try:a,b=map(float,(v.get('avg_frame_rate') or '0/1').split('/'));fps=a/b if b else 0
        except (ValueError,ZeroDivisionError):fps=0
        width,height=v.get('width',0),v.get('height',0)
        rotation=next((s.get('rotation',0) for s in v.get('side_data_list',[]) if 'rotation' in s),v.get('tags',{}).get('rotate',0))
        if int(float(rotation or 0))%180:width,height=height,width
        return {'durationSeconds':duration,'fps':fps,'hasAudio':any(s.get('codec_type')=='audio' for s in value.get('streams',[])),'width':v.get('width',0),'height':v.get('height',0),'displayWidth':width,'displayHeight':height}

    def detect(self,source,*,cancelled=lambda:False,on_progress=lambda *a:None):
        meta=self.probe(source,cancelled=cancelled);path=self.resolve(source);on_progress('本地检测切点',0)
        raw=self._command([self._tools()[0],'-hide_banner','-nostats',*self._input(path),'-vf',"select='gt(scene,0.1)',metadata=print:file=-",'-an','-f','null','-'],cancelled=cancelled).decode('utf8',errors='replace')
        parsed=[{'pts':int(p),'seconds':float(s),'score':float(v)} for p,s,v in re.findall(r'pts:\s*(-?\d+)\s+pts_time:([-\d.]+).*?lavfi.scene_score=([\d.]+)',raw,re.S)]
        deduped=[]
        for cut in parsed:
            if not math.isfinite(cut['seconds']) or cut['seconds']<0:continue
            if deduped and meta['fps']>0 and cut['seconds']-deduped[-1]['seconds']<=2/meta['fps']:
                if cut['score']>deduped[-1]['score']:deduped[-1]=cut
            else:deduped.append(cut)
        cuts,threshold,capped=cap_cuts(deduped);rows=max(1,math.ceil(len(cuts)/8));sheet=None
        if cuts:
            on_progress('整理切点预览图',65);output=self.cache/('sheet-'+uuid.uuid4().hex+'.jpg')
            picks='+'.join('eq(pts\\,%d)'%c['pts'] for c in cuts)
            try:
                self._command([self._tools()[0],'-hide_banner','-nostats','-y',*self._input(path),'-vf',"select='%s',scale=-2:90,tile=8x%d"%(picks,rows),'-frames:v','1','-q:v','4','-an',str(output)],cancelled=cancelled)
                if output.is_file() and output.stat().st_size:sheet=self.url_for(output.relative_to(self.output_dir).as_posix())
            except VideoCancelled:raise
            except ValueError:output.unlink(missing_ok=True)
        coverage={'detectedCuts':len(deduped),'keptCuts':len(cuts),'appliedThreshold':threshold,'capped':capped,'coveredSeconds':cuts[-1]['seconds'] if cuts else 0,'durationSeconds':meta['durationSeconds']}
        return {**meta,'cuts':[{**c,'index':i} for i,c in enumerate(cuts)],'sheetUrl':sheet,'sheetColumns':8,'sheetRows':rows,'sheetTileHeight':90,'coverage':coverage}

    def extract_frames(self,source,seconds,*,cancelled=lambda:False,on_progress=lambda *a:None):
        if not isinstance(seconds,list) or len(seconds)>363:raise ValueError('抽帧数量无效')
        if cancelled():return {'frames':[],'failures':[],'cancelled':True}
        path=self.resolve(source);duration=self.probe(source,cancelled=cancelled)['durationSeconds'];frames=[];failures=[]
        for index,second in enumerate(seconds):
            if cancelled():return {'frames':frames,'failures':failures,'cancelled':True}
            if not isinstance(second,(int,float)) or not math.isfinite(second) or not 0<=second<duration:
                failures.append({'index':index,'error':'抽帧时刻超出视频范围'});continue
            output=self.cache/('frame-'+uuid.uuid4().hex+'.jpg')
            try:
                self._command([self._tools()[0],'-hide_banner','-nostats','-y','-ss',str(round(second,3)),*self._input(path),'-frames:v','1','-q:v','2','-an',str(output)],cancelled=cancelled,timeout=120)
                if not output.exists() or not output.stat().st_size:raise ValueError('该时刻未抽出画面')
                frames.append({'index':index,'seconds':second,'url':self.url_for(output.relative_to(self.output_dir).as_posix())})
            except VideoCancelled:return {'frames':frames,'failures':failures,'cancelled':True}
            except ValueError as exc:output.unlink(missing_ok=True);failures.append({'index':index,'seconds':second,'error':str(exc)})
            on_progress(index+1,len(seconds))
        return {'frames':frames,'failures':failures,'cancelled':False}

    def extract_audio(self,source,*,cancelled=lambda:False):
        meta=self.probe(source,cancelled=cancelled)
        if not meta['hasAudio']:return {'hasAudio':False,'durationSeconds':meta['durationSeconds']}
        if meta['durationSeconds']>3000:raise ValueError('对白转写单次最多 50 分钟，请先剪短视频')
        output=self.cache/('audio-'+self.fingerprint(source)+'.mp3')
        if not output.exists() or not output.stat().st_size:
            temporary=self.cache/('audio-'+uuid.uuid4().hex+'.mp3')
            try:
                self._command([self._tools()[0],'-hide_banner','-nostats','-y',*self._input(self.resolve(source)),'-vn','-ar','16000','-ac','1','-b:a','64k',str(temporary)],cancelled=cancelled)
                if cancelled():raise VideoCancelled('任务已取消')
                if not temporary.is_file() or not temporary.stat().st_size:raise ValueError('未能提取有效音轨')
                if temporary.stat().st_size>25*1024*1024:raise ValueError('音轨超过转写接口的 25MB 限制')
                temporary.replace(output)
            finally:temporary.unlink(missing_ok=True)
        if output.stat().st_size>25*1024*1024:raise ValueError('音轨超过转写接口的 25MB 限制')
        return {'hasAudio':True,'path':str(output),'url':self.url_for(output.relative_to(self.output_dir).as_posix()),'durationSeconds':meta['durationSeconds']}
