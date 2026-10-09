"""模型发现只建议分类，不更改用户的配置或调用音频服务。"""
import ast
import re
import unittest
from pathlib import Path


class AudioDiscoveryTests(unittest.TestCase):
    def test_audio_discovery_keeps_other_categories(self):
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'main.py').read_text(encoding='utf-8'))
        functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in
                     {'classify_upstream_model', 'parse_upstream_models'}]
        scope = {'re': re}
        exec(compile(ast.Module(body=functions, type_ignores=[]), 'main.py', 'exec'), scope)
        ids = ['gpt-image-1', 'sora-2', 'gpt-4o', 'whisper-1', 'gpt-4o-mini-transcribe',
               'FunAudioLLM/SenseVoiceSmall', 'tts-1', 'gpt-4o-mini-tts', 'speech-02-hd',
               'music-2.0', 'gpt-4o-audio-preview']
        groups, found = scope['parse_upstream_models']({'data': [{'id': m} for m in ids]})
        self.assertEqual(groups.get('audio'), sorted(ids[3:6]))
        self.assertEqual(groups.get('audioGeneration'), sorted(ids[6:10]))
        self.assertEqual(groups['image'], ['gpt-image-1'])
        self.assertEqual(groups['video'], ['sora-2'])
        self.assertEqual(groups['chat'], ['gpt-4o', 'gpt-4o-audio-preview'])
        self.assertEqual(found, sorted(ids))


if __name__ == '__main__':
    unittest.main()
