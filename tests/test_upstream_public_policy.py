import ast
from pathlib import Path
import unittest

from backend import upstream_public_policy as policy


class PublicPolicyEntryTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'main.py').read_text(encoding='utf-8'))
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name in {'runninghub_error_detail', 'log_runninghub_error'}]
        self.logs = []
        self.scope = dict(upstream_public_policy=policy,
            _safe_upstream_text=lambda value, limit=300: str(value)[:limit],
            redact_url_for_log=lambda value: 'redacted-url', upstream_error_summary=lambda value: 'safe-summary',
            redact_log_text=lambda value: str(value), write_diagnostic=self.logs.append)
        exec(compile(ast.Module(body=functions, type_ignores=[]), 'public-policy-main-entries', 'exec'), self.scope)

    def test_error_metadata_can_use_internal_dependency_names_without_collision(self):
        detail = self.scope['runninghub_error_detail']('mock failure', raw={'error': 'mock'},
            _safe_upstream_text='metadata text', redact_url_for_log='metadata url helper',
            upstream_error_summary='metadata summary helper', _callbacks='metadata callbacks', endpoint='mock-url')
        self.assertEqual(detail['_safe_upstream_text'], 'metadata text')
        self.assertEqual(detail['redact_url_for_log'], 'metadata url helper')
        self.assertEqual(detail['upstream_error_summary'], 'metadata summary helper')
        self.assertEqual(detail['_callbacks'], 'metadata callbacks')
        self.assertEqual(detail['endpoint'], 'redacted-url'); self.assertEqual(detail['error_summary'], 'safe-summary')

    def test_diagnostic_metadata_does_not_replace_the_real_writer_or_redactor(self):
        self.scope['log_runninghub_error']('mock stage', raw={'error': 'mock'},
            write_diagnostic='metadata writer', redact_log_text='metadata redactor', _callbacks='metadata callbacks')
        self.assertEqual(len(self.logs), 1)
        self.assertIn('metadata writer', self.logs[0]); self.assertIn('metadata redactor', self.logs[0])
        self.assertIn('metadata callbacks', self.logs[0]); self.assertIn('safe-summary', self.logs[0])
