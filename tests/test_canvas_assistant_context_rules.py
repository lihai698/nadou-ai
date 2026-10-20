"""助手上下文的输入、引用顺序、分页和输出安全边界。"""
import copy
import json
import subprocess
import sys
import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from backend import canvas_assistant_canvas_rules as rules


def selection(nodes=(), references=(), assets=()):
    return SimpleNamespace(selectedNodeIds=list(nodes), referencedNodeIds=list(references),
                           referencedAssetIds=list(assets))


class ContextRuleTests(unittest.TestCase):
    def test_import_has_no_router_store_or_executor_dependency(self):
        code = '''import importlib.abc,sys
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self,fullname,path=None,target=None):
        if fullname in {'main','backend.canvas_assistant','backend.canvas_assistant_store',
                        'backend.canvas_assistant_agent','backend.canvas_assistant_operations'}:
            raise AssertionError(fullname)
sys.meta_path.insert(0,Block())
from backend import canvas_assistant_canvas_rules as rules
assert rules.canvas_context({},type('Selection',(),{'selectedNodeIds':[],'referencedNodeIds':[]})())[1:]==([],[])
assert rules.assistant_output_media({'images':['/assets/a.png']})==[{'url':'/assets/a.png','name':'助手图片'}]
'''
        subprocess.run([sys.executable, '-X', 'utf8', '-B', '-c', code], check=True,
                       capture_output=True)

    def test_reference_input_and_output_have_distinct_url_policies(self):
        urls = ['/assets/a.png', '/output/a.png', '/api/storage-files/local/a.png',
                'data:image/png;base64,a', 'https://example.invalid/a.png', '/static/a.png']
        self.assertEqual([rules.reference_kind({'url': url}) for url in urls],
                         ['image', 'image', 'image', 'image', '', ''])
        self.assertEqual([x['url'] for x in rules.assistant_output_media({'images': urls})],
                         [urls[0], urls[1], urls[3]])

    def test_reference_kind_explicit_kind_suffix_and_data_limit(self):
        self.assertEqual(rules.reference_kind({'url': '/assets/x.MOV?download=1'}), 'video')
        self.assertEqual(rules.reference_kind({'url': '/assets/x.bin', 'kind': 'IMAGE'}), 'image')
        self.assertEqual(rules.reference_kind({'url': '/assets/x.png', 'kind': 'audio'}), '')
        prefix = 'data:image/png;base64,'
        self.assertEqual(rules.reference_kind({'url': prefix + 'a' * (4_000_000-len(prefix))}), 'image')
        self.assertEqual(rules.reference_kind({'url': prefix + 'a' * (4_000_001-len(prefix))}), '')

    def test_assets_keep_node_order_deduplicate_per_node_and_stable_identity(self):
        canvas = {'nodes': [None, {'url': '/assets/ignored.png'},
                            {'id': 'a', 'url': '/assets/a.png', 'images': ['/assets/a.png', '/assets/b.png'],
                             'videos': ['/output/c.webm']}, {'id': 'b', 'url': '/assets/a.png'}]}
        assets = rules.node_reference_assets(canvas)
        self.assertEqual([(x['nodeId'], x['url'], x['kind']) for x in assets],
                         [('a', '/assets/a.png', 'image'), ('a', '/assets/b.png', 'image'),
                          ('a', '/output/c.webm', 'video'), ('b', '/assets/a.png', 'image')])
        canvas['nodes'][2]['title'] = '改名'
        self.assertEqual([x['id'] for x in rules.node_reference_assets(canvas)], [x['id'] for x in assets])
        canvas['nodes'][2]['images'][1] = '/assets/replaced.png'
        self.assertNotEqual(rules.node_reference_assets(canvas)[1]['id'], assets[1]['id'])

    def test_selection_order_precise_media_numbering_and_input_immutability(self):
        canvas = {'title': '引用', 'kind': 'smart', 'nodes': [
            {'id': 'first', 'images': ['/assets/a.png', '/assets/b.png'], 'private': 'hidden'},
            {'id': 'second', 'url': '/output/c.webm'}]}
        assets = rules.node_reference_assets(canvas)
        library = [{'id': 'local:x', 'url': '/api/storage-files/local/x.png', 'kind': 'image'}]
        payload = selection(['second', 'first', 'second'], ['first'], ['local:x', assets[1]['id'], 'local:x'])
        before = copy.deepcopy((canvas, library, vars(payload)))
        context, images, videos = rules.canvas_context(canvas, payload, library)
        self.assertEqual([x['id'] for x in context['nodes']], ['second', 'first'])
        self.assertEqual(images, ['/api/storage-files/local/x.png', '/assets/b.png'])
        self.assertEqual(videos, ['/output/c.webm'])
        self.assertEqual([x['referenceNumber'] for x in context['assets']], [4, 2])
        self.assertNotIn('hidden', json.dumps(context))
        self.assertEqual((canvas, library, vars(payload)), before)

    def test_context_whitelist_and_pagination_report_all_truncation(self):
        canvas = {'nodes': [{'id': str(i), 'text': '字' * 1801, 'api_key': 'hidden'} for i in range(125)],
                  'connections': [{'from': str(i), 'to': str(i+1), 'private': 'hidden'} for i in range(155)]}
        context, _, _ = rules.canvas_context(canvas, selection(['124']), offset=100, limit=20)
        self.assertEqual(context['nodes'][0]['id'], '99')
        self.assertEqual(context['page'], {'offset': 100, 'returned': 20, 'nextOffset': 120})
        self.assertEqual(context['counts'], {'nodes': 125, 'connections': 155, 'assets': 0})
        self.assertEqual(context['truncation'], {'nodes': True, 'connections': True, 'assets': False, 'text': True})
        self.assertEqual(len(context['nodes'][0]['text']), 1800)
        self.assertNotIn('hidden', json.dumps(context))
        tail, _, _ = rules.canvas_context(canvas, selection(['124']), offset=120, limit=20)
        self.assertEqual(tail['page'], {'offset': 120, 'returned': 5, 'nextOffset': None})

    def test_stale_node_or_exact_asset_returns_distinct_409(self):
        canvas = {'nodes': [{'id': 'a', 'url': '/assets/a.png'}]}
        for payload, message in [(selection(['missing']), '选中的节点'),
                                 (selection(assets=['canvas:a:old']), '引用的素材')]:
            with self.subTest(message=message):
                with self.assertRaises(HTTPException) as error:
                    rules.canvas_context(canvas, payload)
                self.assertEqual(error.exception.status_code, 409)
                self.assertIn(message, error.exception.detail)

    def test_image_and_video_limits_apply_to_deduplicated_combined_selection(self):
        for kind, count, suffix in [('image', 8, 'png'), ('video', 3, 'webm')]:
            assets = [{'id': str(i), 'url': f'/assets/{i}.{suffix}', 'kind': kind} for i in range(count+1)]
            payload = selection(assets=[str(i) for i in range(count)])
            context, images, videos = rules.canvas_context({}, payload, assets)
            self.assertEqual(len(images if kind == 'image' else videos), count)
            payload.referencedAssetIds.append(str(count))
            with self.assertRaises(HTTPException) as error:
                rules.canvas_context({}, payload, assets)
            self.assertEqual(error.exception.status_code, 422)
            assets[-1]['url'] = assets[0]['url']
            self.assertEqual(len(rules.canvas_context({}, payload, assets)[1 if kind == 'image' else 2]), count)

    def test_output_filters_only_first_eight_entries_and_preserves_names(self):
        self.assertEqual(rules.assistant_output_media(None), [])
        self.assertEqual(rules.assistant_output_media({'images': '/assets/a.png'}), [])
        self.assertEqual(rules.assistant_output_media({'images': [None]*8 + ['/assets/late.png']}), [])
        self.assertEqual(rules.assistant_output_media({'images': [
            {'url': '/assets/a.png', 'name': '结果'}, {'url': '/output/b.png'}, '/assets/c.png']}),
            [{'url': '/assets/a.png', 'name': '结果'}, {'url': '/output/b.png', 'name': None},
             {'url': '/assets/c.png', 'name': '助手图片'}])
