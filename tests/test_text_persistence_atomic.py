"""文本型用户数据沿用原子替换，避免中断留下半文件。"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class TextPersistenceAtomicTests(unittest.IsolatedAsyncioTestCase):
    async def test_classification_prompt_uses_atomic_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory, "asset_classification_prompt.txt")
            target.write_text("旧提示词", encoding="utf-8")
            with patch.object(main, "ASSET_CLASSIFICATION_PROMPT_FILE", str(target)), patch.object(
                main, "write_text_atomic", side_effect=OSError("模拟替换失败")
            ) as writer:
                with self.assertRaises(OSError):
                    main.save_asset_classification_prompt("新提示词")
            self.assertEqual(target.read_text(encoding="utf-8"), "旧提示词")
            writer.assert_called_once()

    async def test_caption_save_uses_atomic_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory, "sample.png")
            caption = Path(directory, "sample.txt")
            image.write_bytes(b"png")
            caption.write_text("旧说明", encoding="utf-8")
            with patch.object(main, "_local_upload_safe_path", return_value=("sample.png", str(image))), patch.object(
                main, "_local_upload_kind_ext", return_value=("image", ".png")
            ), patch.object(main, "_local_upload_caption_path", return_value=str(caption)), patch.object(
                main, "write_text_atomic", side_effect=OSError("模拟替换失败")
            ) as writer:
                with self.assertRaises(OSError):
                    await main.save_local_asset_caption(
                        main.LocalAssetCaptionSaveRequest(name="sample.png", caption="新说明")
                    )
            self.assertEqual(caption.read_text(encoding="utf-8"), "旧说明")
            writer.assert_called_once()

    async def test_comfy_text_output_uses_atomic_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory, "output.txt")
            with patch.object(main, "output_path_for", return_value=str(target)), patch.object(
                main, "write_text_atomic", side_effect=OSError("模拟写入失败")
            ) as writer:
                with self.assertRaises(OSError):
                    main.save_comfy_text_output("文本", prefix="test_", name="output.txt")
            self.assertFalse(target.exists())
            writer.assert_called_once()


if __name__ == "__main__":
    unittest.main()
