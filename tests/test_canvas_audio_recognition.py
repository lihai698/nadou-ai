import unittest
from backend import canvas_audio as audio


class AudioRecognitionTests(unittest.TestCase):
    def test_recognition_uses_configured_model_without_timestamp_requirement(self):
        provider = {'base_url': 'https://example.test/v1', 'protocol': 'openai',
                    'audio_models': ['recognize'], 'audio_timestamp_models': []}
        url, fields = audio.build_audio_recognition_request(provider, 'recognize', {'audioLanguage': 'zh', 'audioVoice': 'alloy'})
        self.assertEqual(url, 'https://example.test/v1/audio/transcriptions')
        self.assertEqual(fields, {'model': 'recognize', 'response_format': 'json', 'language': 'zh'})
        with self.assertRaises(audio.AudioConfigError):
            audio.build_audio_recognition_request(provider, 'unconfigured', {})

    def test_recognition_returns_text_not_an_audio_file(self):
        self.assertEqual(audio.audio_text_result({'text': '  你好  '}), {'text': '你好', 'kind': 'text'})
        for result in ({}, {'text': ''}, {'text': ['bad']}, {'audio': 'wrong'}):
            with self.assertRaises(audio.AudioResultError):
                audio.audio_text_result(result)

    def test_recognition_requires_one_audio_and_valid_media_url(self):
        audio.validate_recognition_references([{'url': '/api/storage-files/uploads/a.wav', 'kind': 'audio'}])
        for refs in ([], [{'url': '/assets/a.png', 'kind': 'image'}],
                     [{'url': 'file:///C:/secret.wav', 'kind': 'audio'}],
                     [{'url': '/assets/../secret.wav', 'kind': 'audio'}],
                     [{'url': '/assets/a.wav', 'kind': 'audio'}] * 2):
            with self.assertRaises(audio.AudioConfigError):
                audio.validate_recognition_references(refs)


if __name__ == '__main__':
    unittest.main()
