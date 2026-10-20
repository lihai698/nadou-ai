"""Characterize current image-size entry behavior without vendor requests."""
import unittest
from unittest.mock import patch
import main


class ImageSizeRuleEntryTests(unittest.TestCase):
    def test_parse_and_snap_keep_invalid_values_and_multiple_rounding(self):
        self.assertEqual(main.parse_size_pair(' 721 X 1081 '), (721,1081))
        self.assertEqual(main.parse_size_pair('16:9'), (0,0))
        self.assertEqual(main.snap_size_to_multiple('721x1081'), '736x1088')
        self.assertEqual(main.snap_size_to_multiple('auto'), 'auto')

    def test_chat_size_explicit_dimensions_override_ratio_and_resolution_hints(self):
        self.assertEqual(main.chat_prompt_size_override('生成 720×1280，1:1 高清'), '720x1280')
        self.assertEqual(main.chat_prompt_size_override('16：9 高清'), '1920x1080')
        self.assertEqual(main.chat_prompt_size_override('3比4', '4096x4096'), '2448x3264')
        self.assertEqual(main.chat_prompt_size_override('5:7'), '')

    def test_gpt_model_alias_and_supported_dimensions_remain_unchanged(self):
        for model in ['gpt-image-2','custom/gpt_image_2-high','gptimage2']:
            with self.subTest(model=model): self.assertTrue(main.is_gpt_image_2_model(model))
        self.assertFalse(main.is_gpt_image_2_model('gpt-image-1'))
        self.assertEqual(main.normalize_gpt_image_2_size('1024x1536'), '1024x1536')
        self.assertEqual(main.normalize_gpt_image_2_size('auto'), 'auto')

    def test_gpt_overflow_keeps_existing_pixel_rounding_and_ratio_limits(self):
        self.assertEqual(main.normalize_gpt_image_2_size('4096x4096'), '2880x2880')
        self.assertEqual(main.normalize_gpt_image_2_size('8192x1024'), '3072x1024')
        self.assertTrue(main.gpt_image_2_size_exceeds_supported('4096x4096'))
        self.assertFalse(main.gpt_image_2_size_exceeds_supported('auto'))
        self.assertIn('4096x4096',main.gpt_image_2_size_error_message('4096x4096'))

    def test_apimart_keeps_preset_default_and_nearest_ratio_rules(self):
        for size,expected in [('4K',('1:1','4k')),('auto',('auto','1k')),(' 16 : 9 ',('16:9','1k')),
                              ('1920x1080',('16:9','2k')),('invalid',('1:1','1k'))]:
            with self.subTest(size=size): self.assertEqual(main.apimart_size_resolution(size),expected)

    def test_seedream_rules_do_not_affect_other_models(self):
        self.assertEqual(main.normalize_volcengine_size('1024x1024','seedream'), '1920x1920')
        self.assertEqual(main.normalize_volcengine_size('1024x1024','other'), '1024x1024')
        self.assertEqual(main.normalize_volcengine_size('auto','seedream'), '2048x2048')
        self.assertEqual(main.normalize_volcengine_size('4k','other'), '4096x4096')

    def test_public_entry_keeps_live_parser_dependency(self):
        with patch.object(main,'parse_size_pair',return_value=(48,96)) as parse:
            self.assertEqual(main.snap_size_to_multiple('synthetic',32),'64x96')
        parse.assert_called_once_with('synthetic')

    def test_public_entry_keeps_configured_limits_as_the_single_owner(self):
        with patch.object(main,'GPT_IMAGE2_MAX_EDGE',64),patch.object(main,'GPT_IMAGE2_MAX_PIXELS',4096):
            self.assertTrue(main.gpt_image_2_size_exceeds_supported('65x64'))


if __name__=='__main__':unittest.main()
