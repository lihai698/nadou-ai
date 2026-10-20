"""RunningHub 公开参数策略独立于应用、网络和存储。"""
import copy
import re
import unittest

from backend import upstream_public_policy as policy


SECRET_JSON = re.compile(r'("apiKey"\s*:\s*")[^"]*')


def project(data, api_key="", *, redact=lambda text: text):
    return policy.public_runninghub_app_info(
        data, api_key, _UPSTREAM_SECRET_JSON_RE=SECRET_JSON, redact_log_text=redact,
    )


def value(data, depth=0, api_key="", *, redact=lambda text: text):
    return policy._public_runninghub_app_value(
        data, depth, api_key, _UPSTREAM_SECRET_JSON_RE=SECRET_JSON, redact_log_text=redact,
    )


class RunningHubPublicPolicyTests(unittest.TestCase):
    def test_all_field_sources_in_existing_priority_order(self):
        sources = ('nodeInfoList', 'fields', 'inputs', 'inputList', 'formItems', 'forms',
                   'params', 'parameters', 'apiParams')
        for index, source in enumerate(sources):
            data = {key: [] for key in sources[:index]}
            data.update({key: [{'name': key}] for key in sources[index:]})
            data['config'] = {'fields': [{'name': 'config'}]}
            self.assertEqual(project(data), {'nodeInfoList': [{'name': source}]})

    def test_nested_sources_preserve_priority_and_dictionary_order(self):
        self.assertEqual(project({'config': {'fields': {'second': 2, 'first': 1}},
                                  'webapp': {'fields': [{'name': 'ignored'}]}}),
                         {'nodeInfoList': [{'fieldName': 'second', 'fieldValue': 2},
                                           {'fieldName': 'first', 'fieldValue': 1}]})
        self.assertEqual(project({'config': [], 'webapp': {'fields': [], 'inputs': {'x': 0}}}),
                         {'nodeInfoList': [{'fieldName': 'x', 'fieldValue': 0}]})

    def test_invalid_or_empty_sources_return_empty_fields(self):
        for data in (None, [], (), 'fields', 1, {}, {'fields': (), 'inputs': '', 'config': None}):
            self.assertEqual(project(data), {'nodeInfoList': []})

    def test_nonempty_but_unusable_source_does_not_fall_back(self):
        self.assertEqual(project({'fields': [1, None], 'inputs': [{'name': 'ignored'}]}),
                         {'nodeInfoList': []})

    def test_slice_precedes_field_filtering_and_private_filtering(self):
        for prefix in ([None] * 256, [{'fieldName': 'apiKey'}] * 256):
            self.assertEqual(project({'fields': prefix + [{'name': 'later'}]}), {'nodeInfoList': []})
        self.assertEqual(len(project({'fields': [{}] * 257})['nodeInfoList']), 256)

    def test_field_name_fallback_order_is_preserved(self):
        self.assertEqual(project({'fields': [
            {'fieldName': '', 'inputName': 'prompt', 'name': 'apiKey'},
            {'fieldName': 'apiKey', 'inputName': 'prompt'},
            {'fieldName': 0, 'inputName': '', 'name': '', 'key': 'safe', 'paramName': 'apiKey'},
        ]})['nodeInfoList'], [
            {'fieldName': '', 'inputName': 'prompt', 'name': 'apiKey'},
            {'fieldName': 0, 'inputName': '', 'name': '', 'key': 'safe', 'paramName': 'apiKey'},
        ])

    def test_field_whitelist_and_original_order(self):
        field = {'debug': 'hidden', 'fieldValue': False, 'fieldName': 'prompt',
                 'nodeId': '12', 'required': True, 'unknown': 42, 'fieldData': None}
        projected = project({'fields': [field]})['nodeInfoList'][0]
        self.assertEqual(list(projected), ['fieldValue', 'fieldName', 'nodeId', 'required', 'fieldData'])
        self.assertEqual(projected['fieldValue'], False)

    def test_private_names_cover_camel_acronym_and_word_boundaries(self):
        for name in ('APIKey', 'api-key', 'clientSecret', 'debugInfo', 'sessionKey',
                     'authToken', 'access_token', 'refreshToken', 'requestHeaders',
                     'raw', 'private_key', 'cookies', 'credentials', 'traceId'):
            self.assertTrue(policy._runninghub_app_private_key(name), name)
        for name in ('monkey', 'keyboard', 'prompt', 'session', 'tokenizer', None, ''):
            self.assertFalse(policy._runninghub_app_private_key(name), name)

    def test_recursive_values_filter_without_mutating_source(self):
        data = {'fields': [{'fieldName': 'prompt', 'fieldValue': {
            'safe': (1, {'clientSecret': 'hidden', 'text': 'hello'}), 'debugInfo': 'hidden'},
            'options': [{'value': 0, 'request': 'hidden'}]}]}
        original = copy.deepcopy(data)
        self.assertEqual(project(data)['nodeInfoList'][0], {
            'fieldName': 'prompt', 'fieldValue': {'safe': [1, {'text': 'hello'}]},
            'options': [{'value': 0}]})
        self.assertEqual(data, original)

    def test_depth_limit_is_checked_before_primitive_handling(self):
        self.assertEqual(value('keep', depth=4), 'keep')
        self.assertIsNone(value('drop', depth=5))
        self.assertEqual(value({'x': [{'x': [{'x': 'deep'}]}]}), {'x': [{'x': [{'x': None}]}]})

    def test_dictionary_slice_precedes_private_key_filtering(self):
        data = {f'token-{i}': i for i in range(80)}
        data['visible'] = 'later'
        self.assertEqual(value(data), {})
        self.assertEqual(value(list(range(81))), list(range(80)))
        self.assertEqual(value(tuple(range(81))), list(range(80)))

    def test_key_truncation_precedes_private_detection_and_collisions(self):
        key = 'a' * 120
        self.assertEqual(value({key + '-apiKey': 1, key + '-other': 2, 4: True}),
                         {key: 2, '4': True})

    def test_redaction_order_and_string_limit(self):
        seen = []
        def redact(text):
            seen.append(text)
            return text + 'z' * 16001
        result = value('API fake-key {"apiKey":"fake-key"}', api_key='fake-key', redact=redact)
        self.assertEqual(seen, ['API <redacted> {"apiKey":"<redacted>"}'])
        self.assertEqual(len(result), 16000)
        self.assertTrue(result.startswith(seen[0]))

    def test_unknown_values_do_not_invoke_string_conversion(self):
        class Unknown:
            def __str__(self):
                raise AssertionError('must not stringify')
        self.assertIsNone(value(Unknown()))
        self.assertEqual(value([False, 0, 1.5, None]), [False, 0, 1.5, None])

    def test_callback_exception_is_not_swallowed(self):
        failure = RuntimeError('fixture only')
        def fail(text):
            raise failure
        with self.assertRaises(RuntimeError) as captured:
            project({'fields': [{'name': 'prompt'}]}, redact=fail)
        self.assertIs(captured.exception, failure)

    def test_mapping_access_order_and_readonly_input(self):
        events = []
        class Observed(dict):
            def get(self, key, *args):
                events.append(key)
                return super().get(key, *args)
            def __setitem__(self, key, item):
                raise AssertionError('source write')
        result = project(Observed(fields=[{'name': 'prompt'}]))
        self.assertEqual(result, {'nodeInfoList': [{'name': 'prompt'}]})
        self.assertEqual(events, ['nodeInfoList', 'fields', 'inputs', 'inputList', 'formItems',
                                  'forms', 'params', 'parameters', 'apiParams', 'config', 'webapp'])


if __name__ == '__main__':
    unittest.main()
