"""火山素材签名的纯协议回归；仅使用虚构凭据、固定时钟和独立服务。"""
import datetime
import hashlib
import hmac
import types
import unittest
import urllib.parse
from unittest.mock import Mock

from backend import avatar_asset_service as service


class AvatarAssetSigningTests(unittest.TestCase):
    def setUp(self):
        self.instant = datetime.datetime(2026, 10, 21, 1, 2, 3, tzinfo=datetime.timezone.utc)
        self.now = Mock(return_value=self.instant)
        self.clock = types.SimpleNamespace(datetime=types.SimpleNamespace(now=self.now), timezone=datetime.timezone)

    def digest(self, key, message):
        return service._volc_hmac(key, message, hmac=hmac, hashlib=hashlib)

    def sign(self, body='{"Name":"测试"}', **options):
        params = dict(ak='fixture-ak', sk='fixture-sk', action='CreateAsset', body_str=body,
                      service='ark', region='cn-beijing', version='2024-01-01', host='open.volcengineapi.com')
        params.update(options)
        return service.volcengine_sign_v4_headers(**params, datetime=self.clock, hashlib=hashlib,
                                                 urllib=urllib, _volc_hmac=self.digest, hmac=hmac)

    def test_hmac_known_digest(self):
        self.assertEqual(self.digest(b'key', 'The quick brown fox jumps over the lazy dog').hex(),
                         'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8')

    def test_hmac_unicode_uses_utf8(self):
        self.assertEqual(self.digest('虚构'.encode(), '消息'), hmac.digest('虚构'.encode(), '消息'.encode(), 'sha256'))

    def test_hmac_invalid_message_retains_error(self):
        with self.assertRaises(AttributeError):
            self.digest(b'fixture-key', None)

    def test_complete_baseline_vector(self):
        self.assertEqual(self.sign(), {
            'Content-Type': 'application/json', 'Host': 'open.volcengineapi.com', 'X-Date': '20261021T010203Z',
            'X-Content-Sha256': 'a98cc22293dac57f410cf78d91989ea6adc04b309333869d201b4589e5185318',
            'Authorization': 'HMAC-SHA256 Credential=fixture-ak/20261021/cn-beijing/ark/request, '
                             'SignedHeaders=content-type;host;x-content-sha256;x-date, '
                             'Signature=d4c2349011c3cacb1baea626c4313fe851292bfb2a5cd5ad5dc7d74690729287'})

    def test_clock_is_utc_and_read_once(self):
        self.sign()
        self.now.assert_called_once_with(datetime.timezone.utc)

    def test_empty_body_hashes_exact_bytes(self):
        self.assertEqual(self.sign('')['X-Content-Sha256'], hashlib.sha256(b'').hexdigest())

    def test_body_is_not_parsed_or_reformatted(self):
        a, b = self.sign('{"x":1}'), self.sign('{ "x": 1 }')
        self.assertNotEqual(a['Authorization'], b['Authorization'])
        self.assertEqual(b['X-Content-Sha256'], hashlib.sha256(b'{ "x": 1 }').hexdigest())

    def test_scope_arguments_remain_explicit(self):
        value = self.sign(service='fixture-service', region='fixture-region', version='v-custom', host='localhost:1234')
        self.assertEqual(value['Host'], 'localhost:1234')
        self.assertIn('/fixture-region/fixture-service/request', value['Authorization'])
        self.assertNotEqual(value['Authorization'], self.sign()['Authorization'])

    def test_action_and_version_are_percent_encoded(self):
        quote = Mock(wraps=urllib.parse.quote)
        parser = types.SimpleNamespace(parse=types.SimpleNamespace(quote=quote))
        service.volcengine_sign_v4_headers('fixture-ak', 'fixture-sk', '创建 &+/', '{}', 'ark', 'cn-beijing', 'a /&', 'fixture.test',
                                           datetime=self.clock, hashlib=hashlib, urllib=parser, _volc_hmac=self.digest, hmac=hmac)
        self.assertEqual(quote.call_args_list[0].args, ('创建 &+/',))
        self.assertEqual(quote.call_args_list[1].args, ('a /&',))
        self.assertTrue(all(call.kwargs == {'safe': ''} for call in quote.call_args_list))

    def test_four_stage_helper_order_and_keys(self):
        helper = Mock(side_effect=[b'date', b'region', b'service', b'signing'])
        service.volcengine_sign_v4_headers('fixture-ak', 'fixture-sk', 'CreateAsset', '{}', 'ark', 'cn-beijing', 'v1', 'fixture.test',
                                           datetime=self.clock, hashlib=hashlib, urllib=urllib, _volc_hmac=helper, hmac=hmac)
        self.assertEqual([call.args for call in helper.call_args_list],
                         [(b'fixture-sk', '20261021'), (b'date', 'cn-beijing'), (b'region', 'ark'), (b'service', 'request')])

    def test_keys_are_not_silently_trimmed(self):
        value = self.sign(ak=' fixture-ak ', sk=' fixture-sk ')
        self.assertIn('Credential= fixture-ak /', value['Authorization'])
        self.assertNotEqual(value['Authorization'], self.sign()['Authorization'])

    def test_version_changes_signature(self):
        self.assertNotEqual(self.sign()['Authorization'], self.sign(version='2024-01-02')['Authorization'])

    def test_host_changes_signature(self):
        self.assertNotEqual(self.sign()['Authorization'], self.sign(host='different.fixture')['Authorization'])

    def test_invalid_body_does_not_coerce(self):
        with self.assertRaises(AttributeError):
            self.sign(body=None)

    def test_invalid_secret_does_not_coerce(self):
        with self.assertRaises(AttributeError):
            self.sign(sk=None)


if __name__ == '__main__':
    unittest.main()
