"""供应商与请求参数纯规则；不导入应用、不读取配置或访问网络。"""
import re
import unittest
from unittest.mock import Mock

from fastapi import HTTPException
from backend import image_size_rules, provider_protocols as protocols, provider_media_transfer as media
from backend import video_provider_service, video_request_service as video


def rule(name, *args, **kwargs):
    dependencies = {
        'is_apimart_provider': {'provider_protocol': protocols.provider_protocol},
        'is_gemini_provider': {'provider_protocol': protocols.provider_protocol},
        'is_volcengine_provider': {'provider_protocol': protocols.provider_protocol},
        'is_runninghub_provider': {'provider_protocol': protocols.provider_protocol},
        'is_jimeng_provider': {'provider_protocol': protocols.provider_protocol},
        'is_codex_provider': {'provider_protocol': protocols.provider_protocol},
        'is_gemini_cli_provider': {'provider_protocol': protocols.provider_protocol},
        'is_tudou_provider': {'is_tudou_base_url': lambda value: 'tudou.fixture' in str(value)},
        'effective_image_request_mode': {'detect_image_request_mode': lambda *a: rule('detect_image_request_mode', *a),
                                         'normalize_image_request_mode': lambda value: str(value or 'openai').strip().lower()},
        'is_tudou_async_image_mode': {'normalize_image_request_mode': lambda value: str(value or '').strip().lower(),
                                    'is_tudou_async_image_model': lambda value: rule('is_tudou_async_image_model', value)},
        'preferred_chat_model': {'CHAT_MODEL': 'fallback', 'is_volcengine_provider': lambda value: rule('is_volcengine_provider', value),
                                 'looks_like_vision_chat_model': lambda value: rule('looks_like_vision_chat_model', value)},
        'avatar_platform_for_provider': {'is_apimart_provider': lambda value: rule('is_apimart_provider', value),
                                         'is_volcengine_provider': lambda value: rule('is_volcengine_provider', value)},
        'provider_supports_avatar': {'avatar_platform_for_provider': lambda value: rule('avatar_platform_for_provider', value),
                                    'AVATAR_SUPPORTED_PLATFORMS': {'apimart', 'volcengine'}},
    }
    return getattr(protocols, name)(*args, **kwargs, **dependencies.get(name, {}))


class ProviderRequestRuleTests(unittest.TestCase):
    def test_protocol_identifiers_keep_normalization(self):
        for name, protocol in [('is_gemini_provider', 'gemini'), ('is_volcengine_provider', 'volcengine'),
                               ('is_runninghub_provider', 'runninghub'), ('is_jimeng_provider', 'jimeng'),
                               ('is_codex_provider', 'codex'), ('is_gemini_cli_provider', 'gemini-cli')]:
            with self.subTest(name=name):
                self.assertTrue(rule(name, {'protocol': ' ' + protocol.upper() + ' '}))
                self.assertFalse(rule(name, None))

    def test_ids_and_host_patterns_retain_existing_matching(self):
        cases = [('is_apimart_provider', {'base_url': 'https://API.APIMART.AI/v1'}),
                 ('is_runninghub_provider', {'id': ' RunningHub '}), ('is_jimeng_provider', {'id': ' JIMENG '}),
                 ('is_tudou_provider', {'id': ' TUDOU '}), ('is_tudou_provider', {'base_url': 'https://tudou.fixture/v1'}),
                 ('is_yuli_provider', {'base_url': 'https://API.YULI.HOST'}),
                 ('is_lingjing_provider', {'id': ' LINGJING '}), ('is_lingjing_provider', {'base_url': 'https://apistudio.vip'}),
                 ('is_agnes_provider', {'base_url': 'https://apihub.agnes-ai.com'})]
        for name, provider in cases:
            with self.subTest(name=name, provider=provider):
                self.assertTrue(rule(name, provider))
                self.assertFalse(rule(name, {}))

    def test_tudou_rejects_non_mapping(self):
        for value in (None, '', [], 3):
            self.assertFalse(rule('is_tudou_provider', value))

    def test_model_prefixes_are_separate(self):
        for name, model in [('is_tudou_async_image_model', 'GPT-IMAGE-2-PLUS'),
                            ('is_tudou_grok_image_model', 'GROK-IMAGINE-IMAGE-EDIT'),
                            ('is_tudou_grok_video_model', 'GROK-IMAGINE-VIDEO-HD')]:
            self.assertTrue(rule(name, ' ' + model + ' '))
            self.assertFalse(rule(name, 'prefix-' + model))
        self.assertTrue(rule('is_agnes_provider', {}, ' AGNES-VIDEO-TEST '))

    def test_detected_image_mode_overrides_stored_mode(self):
        self.assertEqual(rule('effective_image_request_mode', {'image_request_mode': 'openai', 'base_url': 'https://apihub.agnes-ai.com'}), 'openai-json')
        self.assertEqual(rule('effective_image_request_mode', {'image_request_mode': 'openai-responses'}, ' AGNES-IMAGE-DEMO '), 'openai-json')
        self.assertEqual(rule('effective_image_request_mode', {'image_request_mode': ' OPENAI-RESPONSES '}), 'openai-responses')

    def test_detection_scans_all_models(self):
        self.assertEqual(rule('detect_image_request_mode', '', ['other', None, ' AGNES-IMAGE-A ']), 'openai-json')
        self.assertEqual(rule('detect_image_request_mode', '', ['other']), '')

    def test_tudou_async_mode_requires_matching_model(self):
        provider = {'image_request_mode': 'tudou-async'}
        self.assertTrue(rule('is_tudou_async_image_mode', provider))
        self.assertTrue(rule('is_tudou_async_image_mode', provider, 'gpt-image-2'))
        self.assertFalse(rule('is_tudou_async_image_mode', provider, 'other'))
        self.assertFalse(rule('is_tudou_async_image_mode', {}, 'gpt-image-2'))

    def test_vision_markers_and_empty_model(self):
        for value in ('qwen-vl', 'GLM-4V', 'doubao-vision', 'minicpm-v', 'internvl'):
            self.assertTrue(rule('looks_like_vision_chat_model', value))
        for value in ('text-model', '', None):
            self.assertFalse(rule('looks_like_vision_chat_model', value))

    def test_volcengine_chat_prefers_endpoint_then_text(self):
        provider = {'protocol': 'volcengine', 'chat_models': ['vision', 'text', ' EP-ONE ', 'ep-two']}
        self.assertEqual(rule('preferred_chat_model', provider), 'EP-ONE')
        provider['chat_models'] = ['vision', 'text']
        self.assertEqual(rule('preferred_chat_model', provider), 'text')
        provider['protocol'] = 'openai'
        self.assertEqual(rule('preferred_chat_model', provider), 'vision')

    def test_chat_empty_list_and_blank_values_fall_back(self):
        for models in ([], ['', None, ' ']):
            self.assertEqual(rule('preferred_chat_model', {'chat_models': models}), 'fallback')

    def test_avatar_precedence_and_supported_gate(self):
        both = {'protocol': 'volcengine', 'base_url': 'https://apimart.ai'}
        self.assertEqual(rule('avatar_platform_for_provider', both), 'apimart')
        self.assertTrue(rule('provider_supports_avatar', both))
        self.assertFalse(rule('provider_supports_avatar', {'protocol': 'gemini'}))
        self.assertEqual(rule('avatar_platform_for_provider', None), '')

    def test_modelscope_size_keeps_validation_and_error(self):
        self.assertEqual(image_size_rules.modelscope_size(' 128*256 ', re=re, HTTPException=HTTPException), '128x256')
        self.assertEqual(image_size_rules.modelscope_size(None, '64x64', re=re, HTTPException=HTTPException), '64x64')
        with self.assertRaises(HTTPException) as caught:
            image_size_rules.modelscope_size('1x1', re=re, HTTPException=HTTPException)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn('1x1', caught.exception.detail)

    def test_video_content_role_preserves_image_omission(self):
        self.assertIsNone(video.volcengine_content_role('', 'image'))
        self.assertEqual(video.volcengine_content_role('', 'video'), 'reference_video')
        self.assertEqual(video.volcengine_content_role('audio', 'audio'), 'reference_audio')
        self.assertEqual(video.volcengine_content_role('first_frame', 'video'), 'first_frame')

    def test_duration_defaults_and_limits_are_distinct(self):
        for name, lower, upper, default in [('volcengine_video_duration', 1, 60, 5), ('apimart_video_duration', 4, 15, 5), ('apimart_veo31_duration', 4, 8, 8)]:
            fn = getattr(video, name)
            with self.subTest(name=name):
                self.assertEqual(fn(-1), lower)
                self.assertEqual(fn(100), upper)
                self.assertEqual(fn('bad'), default)

    def test_resolution_aliases_remain_provider_specific(self):
        self.assertEqual(video.volcengine_video_resolution('auto'), '')
        self.assertEqual(video.volcengine_video_resolution('1080'), '1080p')
        self.assertEqual(video.apimart_veo31_resolution('auto'), '720p')
        self.assertEqual(video.apimart_veo31_resolution('480p'), '720p')
        self.assertEqual(video.apimart_veo31_resolution('4K'), '4k')

    def test_video_model_aliases_and_normalization(self):
        self.assertTrue(video.is_volcengine_seedance2_model('seedance_2.0-test'))
        self.assertTrue(video.is_apimart_veo31_model(' VEO3.1-PRO '))
        self.assertEqual(video.apimart_veo31_model('veo3.1-pro'), 'veo3.1-quality')
        self.assertEqual(video.apimart_veo31_model('unknown'), 'veo3.1-fast')

    def test_video_size_and_aspect_preserve_defaults(self):
        self.assertEqual(video.apimart_video_size('keep_ratio'), 'adaptive')
        self.assertEqual(video.apimart_video_size('4:3'), '4:3')
        self.assertEqual(video.apimart_video_size('bad'), '16:9')
        self.assertEqual(video.apimart_veo31_aspect('1:1'), '16:9')
        self.assertEqual(video.apimart_veo31_aspect(' 9:16 '), '9:16')

    def test_reference_validation_differs_for_data_url(self):
        for value in (' https://fixture/media ', 'asset://one', 'http://fixture/media'):
            self.assertTrue(media.valid_video_image_input(value))
            self.assertTrue(media.valid_apimart_video_image_input(value))
        self.assertTrue(media.valid_video_image_input('data:image/png;base64,AA=='))
        self.assertFalse(media.valid_apimart_video_image_input('data:image/png;base64,AA=='))
        for value in (None, 1, '/assets/local.png', 'data:image/png,raw'):
            self.assertFalse(media.valid_video_image_input(value))
            self.assertFalse(media.valid_apimart_video_image_input(value))

    def test_trusted_asset_indexes_only_append_missing_types(self):
        self.assertEqual(video.apply_trusted_asset_prompt_index('使用图片1', 2, 1, 0), '使用图片1\n参考素材：视频1。')
        self.assertEqual(video.apply_trusted_asset_prompt_index('', 2, 0, 1), '参考素材：图片1、图片2，音频1。')
        self.assertEqual(video.apply_trusted_asset_prompt_index(' 保持 ', 0, 0, 0), '保持')

    def test_volc_prompt_keeps_duration_unused(self):
        self.assertEqual(video.volcengine_video_prompt_text(' 提示 ', '9:16', 60), '提示 --ratio 9:16')
        self.assertEqual(video.volcengine_video_prompt_text('', '1:1'), '--ratio 1:1')
        self.assertEqual(video.volcengine_video_prompt_text(' 保持 '), '保持')

    def test_video_api_root_preserves_protocol_paths(self):
        predicate = lambda provider: provider.get('protocol') == 'volcengine'
        for provider, expected in [({'base_url': 'https://fixture/api/v3/', 'protocol': 'volcengine'}, 'https://fixture'),
                                   ({'base_url': 'https://fixture/v1/'}, 'https://fixture'),
                                   ({'base_url': 'https://fixture/custom'}, 'https://fixture/custom'),
                                   ({}, 'https://fallback')]:
            self.assertEqual(video_provider_service.video_api_root(provider, AI_BASE_URL='https://fallback/v1', is_volcengine_provider=predicate),
                             expected)

    def test_provider_callbacks_are_used_at_call_time(self):
        callback = Mock(return_value='apimart')
        self.assertTrue(protocols.is_apimart_provider({}, provider_protocol=callback))
        callback.assert_called_once_with({})


if __name__ == '__main__':
    unittest.main()
