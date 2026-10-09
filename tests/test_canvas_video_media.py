import unittest,tempfile,subprocess,json
from pathlib import Path
try:
    from backend.canvas_video_media import VideoMedia, VideoCancelled, cap_cuts
except ImportError:
    VideoMedia=None
from backend.canvas_clip import find_media_tools

class VideoMediaTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.tools=find_media_tools()
    def tearDown(self):self.temp.cleanup()
    def media(self):
        self.assertIsNotNone(VideoMedia,'缺少拆镜媒体引擎')
        return VideoMedia(self.root/'result',lambda name:'/output/'+name,lambda url:self.root/url.removeprefix('/assets/'),[self.root],tools=self.tools)
    def make(self,graph,name='video.mp4'):
        subprocess.run([self.tools[0],'-hide_banner','-loglevel','error','-y','-f','lavfi','-i',graph,'-c:v','libx264','-pix_fmt','yuv420p',str(self.root/name)],check=True,capture_output=True)
    def test_real_pts_and_sheet_mapping(self):
        m=self.media();self.make('color=red:s=160x90:r=25:d=1[r];color=white:s=160x90:r=25:d=1[w];color=blue:s=160x90:r=25:d=1[b];[r][w][b]concat=n=3:v=1:a=0')
        d=m.detect({'source_url':'/assets/video.mp4'})
        self.assertEqual([c['seconds'] for c in d['cuts']],[1.,2.]);self.assertEqual(d['sheetRows'],1)
        p=m.output_dir/d['sheetUrl'].removeprefix('/output/')
        raw=subprocess.check_output([self.tools[0],'-v','error','-i',str(p),'-f','rawvideo','-pix_fmt','rgb24','-'])
        def rgb(x):n=(45*1280+x)*3;return raw[n:n+3]
        self.assertGreater(min(rgb(80)),220);self.assertGreater(rgb(240)[2],220);self.assertLess(rgb(240)[0],35)
    def test_one_shot_frames_and_cancel(self):
        m=self.media();self.make('color=blue:s=160x90:r=25:d=1')
        d=m.detect({'source_url':'/assets/video.mp4'});self.assertEqual(d['cuts'],[])
        r=m.extract_frames({'source_url':'/assets/video.mp4'},[.25,.5,.75]);self.assertEqual(len(r['frames']),3)
        c=m.extract_frames({'source_url':'/assets/video.mp4'},[.25],cancelled=lambda:True);self.assertTrue(c['cancelled']);self.assertEqual(c['frames'],[])
    def test_path_escape_and_unsupported_url(self):
        m=self.media()
        for url in ['file:///etc/passwd','/assets/../../outside.mp4','data:video/mp4;base64,abc']:
            with self.assertRaises(ValueError):m.resolve({'source_url':url})
    def test_equal_score_cap_keeps_tail(self):
        self.assertIsNotNone(VideoMedia)
        kept,threshold,capped=cap_cuts([{'seconds':i,'pts':i,'score':.4} for i in range(200)])
        self.assertEqual(len(kept),120);self.assertGreater(kept[-1]['seconds'],195);self.assertTrue(capped)
    def test_audio_absent_is_not_failure(self):
        m=self.media();self.make('color=blue:s=160x90:r=25:d=1');self.assertFalse(m.extract_audio({'source_url':'/assets/video.mp4'})['hasAudio'])
    def test_cancelled_audio_does_not_poison_retry_cache(self):
        m=self.media();m.probe=lambda *a,**kw:{'hasAudio':True,'durationSeconds':1};m.fingerprint=lambda s:'fixed';m.resolve=lambda s:self.root/'video.mp4';calls=[]
        def command(args,**kw):
            calls.append(args);Path(args[-1]).write_bytes(b'partial-invalid-mp3' if len(calls)==1 else b'valid-audio')
            if len(calls)==1:raise VideoCancelled('取消')
        m._command=command
        with self.assertRaises(VideoCancelled):m.extract_audio({})
        self.assertEqual(list(m.cache.glob('audio-*')),[])
        r=m.extract_audio({});self.assertEqual(len(calls),2);self.assertEqual(Path(r['path']).read_bytes(),b'valid-audio')
    def test_rotation_and_portrait_frame_preserve_aspect(self):
        m=self.media();self.make('color=blue:s=160x90:r=25:d=1',name='unrotated.mp4')
        subprocess.run([self.tools[0],'-v','error','-y','-display_rotation','90','-i',str(self.root/'unrotated.mp4'),'-c','copy',str(self.root/'video.mp4')],check=True,capture_output=True)
        meta=m.probe({'source_url':'/assets/video.mp4'});self.assertEqual((meta['displayWidth'],meta['displayHeight']),(90,160))
        r=m.extract_frames({'source_url':'/assets/video.mp4'},[.5]);p=m.output_dir/r['frames'][0]['url'].removeprefix('/output/')
        j=json.loads(subprocess.check_output([self.tools[1],'-v','error','-show_streams','-of','json',str(p)]))
        self.assertEqual((j['streams'][0]['width'],j['streams'][0]['height']),(90,160))
    def test_partial_frames_damage_and_missing_tools(self):
        m=self.media();self.make('color=blue:s=160x90:r=25:d=1');before=(self.root/'video.mp4').read_bytes()
        r=m.extract_frames({'source_url':'/assets/video.mp4'},[.5,99]);self.assertEqual(len(r['frames']),1);self.assertEqual(len(r['failures']),1);self.assertEqual((self.root/'video.mp4').read_bytes(),before)
        (self.root/'damaged.mp4').write_bytes(b'broken')
        with self.assertRaisesRegex(ValueError,'失败'):m.detect({'source_url':'/assets/damaged.mp4'})
        m.tools=('missing-tool-ffmpeg','missing-tool-ffprobe')
        with self.assertRaisesRegex(ValueError,'工具'):m.detect({'source_url':'/assets/video.mp4'})
    def test_contact_sheet_failure_does_not_discard_cuts(self):
        m=self.media();self.make('color=red:s=160x90:r=25:d=1[r];color=white:s=160x90:r=25:d=1[w];[r][w]concat=n=2:v=1:a=0')
        command=m._command
        def fail_sheet(args,**kw):
            if any('tile=' in str(a) for a in args):raise ValueError('联系表失败')
            return command(args,**kw)
        m._command=fail_sheet;d=m.detect({'source_url':'/assets/video.mp4'});self.assertEqual(len(d['cuts']),1);self.assertIsNone(d['sheetUrl'])
    def test_variable_frame_rate_uses_real_pts_and_frame_time(self):
        graph="color=red:s=160x90:r=10:d=1[r];color=white:s=160x90:r=10:d=1[w];[r][w]concat=n=2:v=1:a=0,setpts='if(lt(N,10),N/(10*TB),1+(N-10)/(5*TB))'"
        subprocess.run([self.tools[0],'-v','error','-y','-f','lavfi','-i',graph,'-fps_mode','vfr','-c:v','libx264','-pix_fmt','yuv420p',str(self.root/'video.mp4')],check=True,capture_output=True)
        m=self.media();d=m.detect({'source_url':'/assets/video.mp4'});self.assertEqual(len(d['cuts']),1);self.assertAlmostEqual(d['cuts'][0]['seconds'],1,places=2)
        self.assertIsNotNone(d['sheetUrl']);r=m.extract_frames({'source_url':'/assets/video.mp4'},[.5,1.5]);self.assertEqual(len(r['frames']),2)
    def test_real_audio_extraction_is_mono_16k_mp3_and_cached(self):
        subprocess.run([self.tools[0],'-v','error','-y','-f','lavfi','-i','color=blue:s=160x90:r=25:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-c:a','aac','-shortest',str(self.root/'video.mp4')],check=True,capture_output=True)
        m=self.media();source={'source_url':'/assets/video.mp4'};result=m.extract_audio(source);audio=json.loads(subprocess.check_output([self.tools[1],'-v','error','-show_streams','-of','json',result['path']]))['streams'][0]
        self.assertEqual(audio['codec_name'],'mp3');self.assertEqual(audio['channels'],1);self.assertEqual(int(audio['sample_rate']),16000);self.assertEqual(int(audio['bit_rate']),64000)
        path=Path(result['path']);stamp=path.stat().st_mtime_ns;self.assertEqual(m.extract_audio(source)['path'],result['path']);self.assertEqual(path.stat().st_mtime_ns,stamp)
