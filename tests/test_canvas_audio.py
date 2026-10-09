import unittest

from backend.canvas_audio import (
    AudioConfigError,
    AudioResultError,
    migrate_audio_node,
    normalize_audio_settings,
    audio_input_summary,
    audio_result_from_payload,
    validate_audio_reference_url,
)


class CanvasAudioContractTests(unittest.TestCase):
    def test_normalize_audio_settings_uses_capability_defaults_and_clamps_values(self):
        provider = {"audio_generation_models": ["speech"], "audio_generation_instructions": True}
        value = normalize_audio_settings(
            "speech",
            provider,
            {
                "audioVoice": "unknown",
                "audioFormat": "wav",
                "audioSpeed": "9",
                "audioPitch": "99",
                "audioVolume": "-1",
                "audioInstructions": "  温暖  ",
            },
        )
        self.assertEqual(value["model"], "speech")
        self.assertEqual(value["audioVoice"], "alloy")
        self.assertEqual(value["audioFormat"], "wav")
        self.assertEqual(value["audioSpeed"], "4")
        self.assertEqual(value["audioPitch"], "0")
        self.assertEqual(value["audioVolume"], "1")
        self.assertEqual(value["audioInstructions"], "温暖")

    def test_normalize_audio_settings_rejects_unconfigured_model(self):
        with self.assertRaisesRegex(AudioConfigError, "音频模型"):
            normalize_audio_settings("missing", {"audio_generation_models": ["speech"]}, {})

    def test_audio_result_requires_real_audio_output(self):
        result = audio_result_from_payload(
            {"audios": [{"url": "https://cdn.example.test/rain.mp3", "name": "rain.mp3"}]},
            task_id="task-1",
            provider_id="provider-1",
            model="speech",
        )
        self.assertEqual(result["kind"], "audio")
        self.assertEqual(result["url"], "https://cdn.example.test/rain.mp3")
        self.assertEqual(result["name"], "rain.mp3")
        with self.assertRaisesRegex(AudioResultError, "没有返回真实音频"):
            audio_result_from_payload({"audios": []}, task_id="task-1", provider_id="p", model="m")

    def test_audio_reference_url_rejects_local_file_and_allows_project_or_https(self):
        self.assertTrue(validate_audio_reference_url("/assets/audio/rain.mp3"))
        self.assertTrue(validate_audio_reference_url("https://cdn.example.test/rain.mp3"))
        self.assertFalse(validate_audio_reference_url("file:///C:/secret/rain.mp3"))
        self.assertFalse(validate_audio_reference_url("C:/secret/rain.mp3"))
        self.assertFalse(validate_audio_reference_url("/assets/%2e%2e/private.mp3"))
        self.assertFalse(validate_audio_reference_url("/assets/../private.mp3"))

    def test_transcription_models_are_not_generation_models(self):
        with self.assertRaises(AudioConfigError):
            normalize_audio_settings("whisper", {"audio_models": ["whisper"]})

    def test_protocol_request_only_sends_supported_controls(self):
        from backend.canvas_audio import build_audio_request
        provider = {"base_url": "https://test.example/v1", "audio_generation_models": ["speech"]}
        url, body = build_audio_request(provider, "speech", "你好", {"audioPitch": 3, "audioVolume": 2})
        self.assertEqual(url, "https://test.example/v1/audio/speech")
        self.assertNotIn("pitch", body)
        self.assertNotIn("volume", body)
        with self.assertRaisesRegex(AudioConfigError, "参考音频"):
            build_audio_request(provider, "speech", "你好", {}, ["/assets/input/a.wav"])
        provider["audio_generation_protocol"] = "minimax-speech"
        _, body = build_audio_request(provider, "speech", "你好", {"audioPitch": 99, "audioVolume": -1})
        self.assertEqual(body["voice_setting"]["pitch"], 12)
        self.assertEqual(body["voice_setting"]["vol"], 0)

    def test_audio_input_summary_is_bounded_and_kind_specific(self):
        summary = audio_input_summary(
            "  雨声  ",
            [{"id": "a1", "url": "/assets/rain.mp3", "kind": "audio"}, {"id": "x", "kind": "image"}],
        )
        self.assertEqual(summary, {"prompt": "雨声", "reference_audio_ids": ["a1"], "reference_audio_count": 1})

    def test_migrate_legacy_audio_image_node(self):
        node = migrate_audio_node({
            "id": "legacy",
            "type": "image",
            "mediaKind": "audio",
            "url": "/assets/rain.mp3",
            "name": "rain.mp3",
        })
        self.assertEqual(node["type"], "audio")
        self.assertEqual(node["source"], "upload")
        self.assertEqual(node["mime"], "audio/mpeg")
        self.assertNotIn("mediaKind", node)


if __name__ == "__main__":
    unittest.main()
