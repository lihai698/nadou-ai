"""上传限制与远程分块读取；可独立于应用和私人配置运行。"""
import asyncio
import unittest

from backend import upload_service as service


class LimitError(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail
        super().__init__(detail)


def limit_error(filename='文件', *, batch=False):
    return service._upload_limit_error(filename, batch=batch, HTTPException=LimitError,
                                       UPLOAD_MAX_FILE_BYTES=1024*1024, UPLOAD_MAX_BATCH_BYTES=2*1024*1024)


class Response:
    def __init__(self, chunks, length=None, error=None):
        self.headers = {} if length is None else {'Content-Length': length}
        self.chunks, self.error = chunks, error
        self.sizes, self.yielded = [], []

    async def aiter_bytes(self, size):
        self.sizes.append(size)
        for chunk in self.chunks:
            self.yielded.append(chunk)
            yield chunk
        if self.error:
            raise self.error


def read(response, *, state=None, filename='远程文件', file_limit=4, batch_limit=6):
    return service.read_httpx_response_limited(response, batch_state=state, filename=filename,
        UPLOAD_MAX_FILE_BYTES=file_limit, UPLOAD_READ_CHUNK_BYTES=2,
        UPLOAD_MAX_BATCH_BYTES=batch_limit, _upload_limit_error=limit_error)


class UploadReadLimitTests(unittest.IsolatedAsyncioTestCase):
    def test_file_and_batch_errors_keep_distinct_messages(self):
        single = limit_error('素材.png')
        self.assertEqual((single.status_code, single.detail), (413, '素材.png超过 1MB，无法上传'))
        self.assertEqual(limit_error('').detail, '文件超过 1MB，无法上传')
        self.assertEqual(limit_error(batch=True).detail, '本次上传总大小超过 2MB')

    def test_base64_checks_encoded_boundary_and_returns_original(self):
        for original in ('', None, 'YWJjZA==', 'data:image/png;base64,YWJjZA==', ' YWJj '):
            with self.subTest(original=original):
                self.assertEqual(service._base64_payload_size_hint(original, BASE64_UPLOAD_MAX_TEXT_LENGTH=100,
                    BASE64_UPLOAD_MAX_BYTES=4, _upload_limit_error=limit_error), str(original or ''))

    def test_base64_text_header_limit_precedes_payload_length(self):
        with self.assertRaises(LimitError) as caught:
            service._base64_payload_size_hint('data:image/png;base64,', BASE64_UPLOAD_MAX_TEXT_LENGTH=8,
                BASE64_UPLOAD_MAX_BYTES=4, _upload_limit_error=limit_error)
        self.assertIn('Base64 数据', caught.exception.detail)

    def test_base64_decoded_upper_bound_rejects_long_payload(self):
        with self.assertRaises(LimitError):
            service._base64_payload_size_hint('data:image/png;base64,'+'A'*9, BASE64_UPLOAD_MAX_TEXT_LENGTH=100,
                BASE64_UPLOAD_MAX_BYTES=4, _upload_limit_error=limit_error)

    async def test_announced_over_limit_stops_without_stream_iteration(self):
        response = Response([b'ab'], length='5')
        state = {'total': 1}
        with self.assertRaises(LimitError):
            await read(response, state=state)
        self.assertEqual((response.sizes, response.yielded, state), ([], [], {'total': 1}))

    async def test_exact_file_limit_preserves_bytes_and_chunk_size(self):
        response = Response([b'ab', b'cd'], length='4')
        state = {'total': 1}
        self.assertEqual(await read(response, state=state), b'abcd')
        self.assertEqual((response.sizes, state), ([2], {'total': 5}))

    async def test_invalid_length_falls_back_to_stream_limit(self):
        for length in ('invalid', None, '', '-1', object()):
            with self.subTest(length=length):
                response = Response([b'ab', b'cde'], length=length)
                state = {'total': 0}
                with self.assertRaises(LimitError):
                    await read(response, state=state)
                self.assertEqual(state, {'total': 2})

    async def test_empty_chunks_do_not_change_batch_total(self):
        state = {}
        self.assertEqual(await read(Response([b'', b'ab', b'', b'cd', b'']), state=state), b'abcd')
        self.assertEqual(state, {'total': 4})

    async def test_batch_accumulates_across_remote_responses(self):
        state = {'total': 0}
        self.assertEqual(await read(Response([b'ab', b'cd']), state=state), b'abcd')
        self.assertEqual(await read(Response([b'ef']), state=state), b'ef')
        with self.assertRaises(LimitError) as caught:
            await read(Response([b'g']), state=state)
        self.assertEqual((state, caught.exception.detail), ({'total': 6}, '本次上传总大小超过 2MB'))

    async def test_file_error_precedes_batch_error_for_same_chunk(self):
        response = Response([b'ab', b'cde', b'unread'])
        state = {'total': 0}
        with self.assertRaises(LimitError) as caught:
            await read(response, state=state, filename='视频.mp4', batch_limit=4)
        self.assertEqual(caught.exception.detail, '视频.mp4超过 1MB，无法上传')
        self.assertEqual((response.yielded, state), ([b'ab', b'cde'], {'total': 2}))

    async def test_stream_error_keeps_accepted_batch_total(self):
        failure = OSError('fixture stream interrupted')
        state = {'total': 1}
        with self.assertRaises(OSError) as caught:
            await read(Response([b'ab'], error=failure), state=state)
        self.assertIs(caught.exception, failure)
        self.assertEqual(state, {'total': 3})

    async def test_stream_cancellation_propagates(self):
        state = {'total': 0}
        with self.assertRaises(asyncio.CancelledError):
            await read(Response([b'ab'], error=asyncio.CancelledError()), state=state)
        self.assertEqual(state, {'total': 2})

    async def test_no_batch_state_allows_independent_empty_and_exact_reads(self):
        self.assertEqual(await read(Response([])), b'')
        self.assertEqual(await read(Response([b'abcd'])), b'abcd')


if __name__ == '__main__':
    unittest.main()
