"""Independent runtime boundaries: selection state, static bytes and bounded diagnostics."""
import collections
import concurrent.futures
import json
import os
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
import urllib.parse
import urllib.request

from backend import comfy_backend_selection as selection
from backend import static_page_service as pages
from backend import network_log_service as network


class Reply:
    def __init__(self,payload=None,status=200):self.payload=payload;self.status_code=status;self.closed=False
    def __enter__(self):return self
    def __exit__(self,*args):self.close()
    def close(self):self.closed=True
    def read(self):return json.dumps(self.payload).encode()


class ComfySelectionTests(unittest.TestCase):
    def deps(self,queues,load=None,probe=None):
        state={'instances':list(queues),'load':dict(load or {}),'reports':[],'reads':[]}
        def open_url(url,timeout):
            state['reads'].append((url,timeout));addr=url.removeprefix('http://').removesuffix('/queue')
            value=queues[addr]
            if isinstance(value,Exception):raise value
            return Reply({'queue_running':[None]*value,'queue_pending':[]})
        deps={'get_instances':lambda:state['instances'],'get_backend_load':lambda:state['load'],
              'urllib':SimpleNamespace(request=SimpleNamespace(urlopen=open_url)),'json':json,'LOAD_LOCK':threading.Lock(),
              'check_images_exist':probe or (lambda addr,images:True),'write_diagnostic':state['reports'].append}
        return state,deps

    def test_media_detection_and_original_nested_parameter_projection(self):
        for key,value,expected in [('text','中文',False),('text','A.MP4?x=1',True),('image','x',True),('mask',0,False),('file','  ',False)]:
            self.assertEqual(selection.is_comfy_input_media_value(key,value),expected)
        data={'a':{'inputs':{'image':'图.png','prompt':'中文'}},'b':{'audio':'声音.wav','image':'图.png'},'c':[],'d':{'inputs':'no','filename':'其他.bin'}}
        self.assertEqual(selection.collect_required_comfy_media(data,is_comfy_input_media_value=selection.is_comfy_input_media_value),['图.png','声音.wav','其他.bin'])

    def test_asset_probe_quotes_names_and_closes_responses(self):
        calls=[];replies=[]
        def get(url,**kw):calls.append((url,kw));r=Reply(status=200 if not replies else 404);replies.append(r);return r
        library=SimpleNamespace(get=get)
        self.assertFalse(selection.check_images_exist('fixture:8188',['中文 a.png','missing.png'],urllib=urllib,requests=library))
        self.assertTrue(all(r.closed for r in replies));self.assertEqual(len(calls),2)
        self.assertIn('%E4%B8%AD%E6%96%87%20a.png',calls[0][0]);self.assertEqual(calls[0][1],{'stream':True,'timeout':0.5})

    def test_no_required_assets_performs_no_request(self):
        self.assertTrue(selection.check_images_exist('fixture',[],urllib=urllib,requests=SimpleNamespace()))

    def test_asset_probe_failure_returns_false(self):
        def fail(*args,**kw):raise OSError('fixture')
        self.assertFalse(selection.check_images_exist('fixture',['x'],urllib=urllib,requests=SimpleNamespace(get=fail)))

    def test_effective_load_and_asset_tie_break_keep_original_order(self):
        state,deps=self.deps({'a':1,'b':0,'c':1},load={'b':3},probe=lambda addr,images:addr=='c')
        self.assertEqual(selection.get_best_backend(['x'],**deps),'c')
        self.assertEqual(state['load'],{'b':3});self.assertEqual(len(state['reads']),3)

    def test_unreachable_backends_keep_fallback_and_bounded_reports(self):
        state,deps=self.deps({'a':OSError('fixture-private'),'b':RuntimeError('fixture-private')})
        self.assertEqual(selection.get_best_backend(**deps),'a');self.assertEqual(selection.reserve_best_backend(**deps),'a')
        self.assertEqual(state['load'],{'a':1});self.assertEqual(len(state['reports']),4)
        self.assertTrue(all('fixture-private' not in row for row in state['reports']))

    def test_configuration_replacement_is_observed_after_network_callback(self):
        state,deps=self.deps({'a':0,'b':0})
        def probe(addr,images):
            if addr=='a':state['load']={'a':10,'b':0}
            return True
        deps['check_images_exist']=probe
        self.assertEqual(selection.reserve_best_backend(**deps),'b');self.assertEqual(state['load'],{'a':10,'b':1})

    def test_concurrent_reservations_increment_the_shared_locked_owner_once(self):
        state,deps=self.deps({'a':0,'b':0})
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:results=list(pool.map(lambda _:selection.reserve_best_backend(**deps),range(16)))
        self.assertEqual(collections.Counter(results),{'a':8,'b':8});self.assertEqual(state['load'],{'a':8,'b':8})


class StaticPageTests(unittest.TestCase):
    def deps(self,directory,version='v 中文'):
        deps={'current_app_version':lambda:version,'urllib':urllib,'re':__import__('re'),'os':os,'STATIC_DIR':str(directory)}
        deps['versioned_static_html']=lambda html:pages.versioned_static_html(html,**{k:deps[k] for k in ('current_app_version','urllib','re','os','STATIC_DIR')})
        return deps

    def test_versioned_html_preserves_external_urls_and_fragments(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);(root/'canvas.js').write_text('x',encoding='utf8');os.utime(root/'canvas.js',(1000,1000));deps=self.deps(root)
            html='<script src="/static/canvas.js?v=old#part"></script><link href="https://fixture.invalid/x.css"><script src="/static/../outside.js"></script>'
            result=deps['versioned_static_html'](html)
            self.assertIn('/static/canvas.js?v=v%20%E4%B8%AD%E6%96%87.1000#part',result)
            self.assertIn('https://fixture.invalid/x.css',result);self.assertIn('/static/../outside.js?v=v%20%E4%B8%AD%E6%96%87',result)

    def test_empty_version_leaves_html_unchanged(self):
        with tempfile.TemporaryDirectory() as name:
            deps=self.deps(name,'');self.assertEqual(deps['versioned_static_html']('src="/static/a.js?v=old"'),'src="/static/a.js?v=old"')

    def test_sync_skips_metadata_and_continues_after_a_file_failure(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);(root/'._a.html').write_bytes(b'\xff\xfe');(root/'a.html').write_text('broken',encoding='utf8');(root/'b.html').write_text('ok',encoding='utf8');(root/'other.txt').write_text('untouched',encoding='utf8')
            deps=self.deps(root,'v');events=[]
            def render(html):
                if html=='broken':raise RuntimeError('fixture-private')
                return html+'-v'
            def write(path,value,**kw):events.append((Path(path).name,kw));Path(path).write_text(value,encoding=kw['encoding'])
            pages.sync_static_html_versions(**{k:deps[k] for k in ('current_app_version','urllib','os','re','STATIC_DIR')},versioned_static_html=render,write_text_atomic=write,write_diagnostic=events.append)
            self.assertEqual((root/'b.html').read_text(),'ok-v');self.assertEqual((root/'a.html').read_text(),'broken')
            self.assertEqual((root/'._a.html').read_bytes(),b'\xff\xfe');self.assertEqual((root/'other.txt').read_text(),'untouched')
            self.assertIn('static html version sync failed scope=file error=RuntimeError',events)
            self.assertIn(('b.html',{'encoding':'utf-8','newline':''}),events)

    def test_directory_error_does_not_expose_its_message(self):
        events=[]
        def fail(*args):raise OSError('fixture-private')
        pages.sync_static_html_versions(current_app_version=lambda:'v',urllib=urllib,os=SimpleNamespace(listdir=fail),re=__import__('re'),STATIC_DIR='fixture',versioned_static_html=lambda x:x,write_text_atomic=lambda *a,**k:None,write_diagnostic=events.append)
        self.assertEqual(events,['static html version sync failed scope=directory error=OSError'])

    def test_response_keeps_html_media_type_and_no_cache(self):
        with tempfile.TemporaryDirectory() as name:
            (Path(name)/'page.html').write_text('中文',encoding='utf8')
            result=pages.static_html_response('page.html',os=os,STATIC_DIR=name,versioned_static_html=lambda x:x+'!',Response=lambda *a,**kw:(a,kw))
            self.assertEqual(result,(('中文!',),{'media_type':'text/html; charset=utf-8','headers':{'Cache-Control':'no-cache'}}))


class NetworkLogTests(unittest.TestCase):
    def deps(self,write=None,proxies=None):
        redact=lambda value:network.redact_url_for_log(value,urllib=urllib)
        text=lambda value:network.redact_log_text(value,redact_url_for_log=redact)
        summary=lambda value:network.format_proxy_summary(value,redact_url_for_log=redact)
        return {'redact_url_for_log':redact,'redact_log_text':text,'format_proxy_summary':summary,'urllib':SimpleNamespace(request=SimpleNamespace(getproxies=lambda:proxies or {})),'write_diagnostic':write,'format_context':lambda:'fixture-context'}

    def test_url_redaction_covers_ipv6_bad_ports_and_relative_paths(self):
        redact=self.deps()['redact_url_for_log']
        self.assertEqual(redact('https://user:fixture-private@[::1]:42/path?q=x#y'),'https://[::1]:42/path')
        self.assertEqual(redact('http://fixture.invalid:bad/x?q=y'),'http://fixture.invalid/x')
        self.assertEqual(redact('/x?q=y#z'),'/x');self.assertEqual(redact(''),'?')

    def test_text_and_proxy_redaction_remove_only_the_original_sensitive_parts(self):
        deps=self.deps();text=deps['redact_log_text']('API_KEY=fixture-private request https://user:fixture-private@host.invalid/path?token=x#y')
        self.assertEqual(text,'API_KEY=<redacted> request https://host.invalid/path')
        self.assertEqual(deps['format_proxy_summary']({'https':'http://user:pass@proxy.invalid:42','no_proxy':'private'}),'https=http://proxy.invalid:42/')

    def test_request_url_and_exception_chain_use_the_diagnostic_sink(self):
        events=[];deps=self.deps(events.append,{'https':'http://user:pass@proxy.invalid:42'})
        cause=ValueError('token=fixture-private');error=RuntimeError('https://user:pass@upstream.invalid/path?q=x');error.__cause__=cause
        error.request=SimpleNamespace(url='https://upstream.invalid/task?secret=x')
        network.log_net_error('authorization=fixture-private',error,**deps)
        self.assertEqual(len(events),1);self.assertNotIn('fixture-private',events[0]);self.assertNotIn('user:pass',events[0]);self.assertIn('url=https://upstream.invalid/task',events[0]);self.assertIn('ValueError: token=<redacted>',events[0])

    def test_self_referencing_exception_does_not_loop(self):
        events=[];error=RuntimeError('fixture');error.__cause__=error
        network.log_net_error('fixture',error,**self.deps(events.append));self.assertEqual(events[0].count('RuntimeError:'),1)

    def test_diagnostic_sink_failure_keeps_the_original_fallback_behavior(self):
        calls=[]
        def write(value):calls.append(value);raise OSError('fixture sink')
        network.log_net_error('fixture',RuntimeError('fixture'),**self.deps(write))
        self.assertEqual(len(calls),2);self.assertIn('error=RuntimeError',calls[1])


if __name__=='__main__':unittest.main()
