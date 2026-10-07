"""上传入口的大小限制和分块读取行为。"""

import asyncio
import base64
from io import BytesIO
import zipfile
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class FakeUpload:
    def __init__(self, chunks, filename="sample.bin"):
        self.chunks = list(chunks)
        self.filename = filename
        self.calls = []

    async def read(self, size=None):
        if size is None:
            raise AssertionError("上传读取不能一次性 read() 全量内容")
        self.calls.append(size)
        return self.chunks.pop(0) if self.chunks else b""


class UploadLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_file_limit_is_checked_while_reading_chunks(self):
        upload = FakeUpload([b"1234", b"5678"], filename="大文件.bin")
        with patch.object(main, "UPLOAD_MAX_FILE_BYTES", 7), patch.object(main, "UPLOAD_READ_CHUNK_BYTES", 4):
            with self.assertRaises(main.HTTPException) as ctx:
                await main.read_upload_file_limited(upload)
        self.assertEqual(ctx.exception.status_code, 413)
        self.assertTrue(upload.calls)
        self.assertTrue(all(size == 4 for size in upload.calls))

    async def test_batch_limit_is_checked_across_files(self):
        state = {"total": 0}
        first = FakeUpload([b"12345"], filename="one.bin")
        second = FakeUpload([b"6789"], filename="two.bin")
        with patch.object(main, "UPLOAD_MAX_FILE_BYTES", 10), patch.object(main, "UPLOAD_MAX_BATCH_BYTES", 8):
            await main.read_upload_file_limited(first, batch_state=state)
            with self.assertRaisesRegex(main.HTTPException, "总大小") as ctx:
                await main.read_upload_file_limited(second, batch_state=state)
        self.assertEqual(ctx.exception.status_code, 413)

    def test_base64_text_limit_matches_decoded_limit(self):
        with patch.object(main, "BASE64_UPLOAD_MAX_BYTES", 6), patch.object(main, "BASE64_UPLOAD_MAX_TEXT_LENGTH", 16):
            value = base64.b64encode(b"123456").decode("ascii")
            self.assertEqual(main._base64_payload_size_hint(value), value)
            with self.assertRaisesRegex(main.HTTPException, "Base64"):
                main._base64_payload_size_hint(base64.b64encode(b"123456789").decode("ascii"))

    def test_workflow_zip_uncompressed_limit_is_checked_before_extracting(self):
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("workflow.json", b"{}")
            archive.writestr("resource.bin", b"123456789")
        with zipfile.ZipFile(BytesIO(buffer.getvalue()), "r") as archive:
            with patch.object(main, "WORKFLOW_ZIP_MAX_UNCOMPRESSED_BYTES", 8):
                with self.assertRaisesRegex(main.HTTPException, "解压后") as ctx:
                    main.validate_workflow_zip_limits(archive)
        self.assertEqual(ctx.exception.status_code, 413)


if __name__ == "__main__":
    unittest.main()
