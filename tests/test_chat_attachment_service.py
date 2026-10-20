"""Exercise real main attachment entries using only synthetic temporary documents."""
import ast
import base64
import html
import os
import re
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO
from pathlib import Path
from PIL import Image
from backend import chat_attachment_service


NAMES = "_xml_local_name _xlsx_join_text _xlsx_shared_strings _xlsx_sheet_paths _xlsx_cell_text read_xlsx_attachment xlsx_embedded_image_data_urls attachment_embedded_image_data_urls read_text_attachment attachment_text_blocks".split()


class ChatAttachmentServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.diagnostics = []
        tree = ast.parse(Path('main.py').read_text(encoding='utf-8'))
        constants = {'TEXT_ATTACHMENT_EXTS', 'XLSX_IMAGE_EXTS', 'EXCEL_MAX_SHEETS', 'EXCEL_MAX_ROWS_PER_SHEET', 'EXCEL_MAX_COLS_PER_ROW', 'MAX_ATTACHMENT_TEXT_CHARS'}
        self.ns = dict(chat_attachment_service=chat_attachment_service, os=os, re=re, html=html, ET=ET, zipfile=zipfile, Image=Image, BytesIO=BytesIO, base64=base64,
                       CHAT_ATTACHMENT_MAX=2, write_diagnostic=self.diagnostics.append,
                       is_image_reference=lambda ref: ref.get('kind') == 'image',
                       output_file_from_url=lambda url: str(self.root / url) if url else None)
        selected = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in NAMES
                    or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in constants for t in n.targets)]
        exec(compile(ast.Module(body=selected, type_ignores=[]), 'main.py', 'exec'), self.ns)

    def workbook(self, name='工作簿.xlsx'):
        path = self.root / name
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('xl/sharedStrings.xml', '<sst><si><t>共享文本</t></si></sst>')
            archive.writestr('xl/worksheets/sheet1.xml', '<worksheet><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>2+3</f><v>5</v></c><c r="C1" t="b"><v>1</v></c><c r="D1" t="inlineStr"><is><t>内联</t></is></c></row></worksheet>')
            archive.writestr('xl/worksheets/sheet2.xml', '<broken')
        return path

    def test_text_encoding_limits_and_missing_file(self):
        for encoding in ('utf-8-sig', 'gb18030'):
            path = self.root / (encoding + '.txt')
            path.write_bytes('中文附件文字'.encode(encoding))
            self.assertEqual(self.ns['read_text_attachment'](str(path)), '中文附件文字')
        path = self.root / 'limited.txt'
        path.write_text('abcdefghij', encoding='utf-8')
        self.assertEqual(self.ns['read_text_attachment'](str(path), 4), 'abcd')
        self.assertEqual(self.ns['read_text_attachment'](str(self.root / 'missing.txt')), '')
        path = self.root / 'old.xls'
        path.write_bytes(b'fixture')
        self.assertIn('另存为 .xlsx', self.ns['read_text_attachment'](str(path)))

    def test_xlsx_fallback_sheet_paths_formula_and_limit(self):
        path = self.workbook()
        result = self.ns['read_xlsx_attachment'](str(path))
        for expected in ('工作簿.xlsx', 'A1=共享文本', 'B1=5 [=2+3]', 'C1=TRUE', 'D1=内联'):
            self.assertIn(expected, result)
        self.assertLessEqual(len(self.ns['read_xlsx_attachment'](str(path), 30)), 30)

    def test_docx_text_and_corruption_diagnostics(self):
        path = self.root / '附件.docx'
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('word/document.xml', '<w:document xmlns:w="urn:test"><w:p><w:r><w:t>正文&amp;内容</w:t></w:r></w:p></w:document>')
        self.assertEqual(self.ns['read_text_attachment'](str(path)), '正文&内容')
        path.write_bytes(b'corrupt synthetic document')
        self.assertEqual(self.ns['read_text_attachment'](str(path)), '')
        self.assertTrue(self.diagnostics)
        self.assertNotIn('corrupt synthetic', ''.join(self.diagnostics))

    def test_embedded_images_respect_limits_and_resize_to_jpeg(self):
        path = self.workbook()
        image = BytesIO()
        Image.new('RGBA', (40, 20), (100, 150, 200, 128)).save(image, format='PNG')
        with zipfile.ZipFile(path, 'a') as archive:
            for index in range(3):
                archive.writestr(f'xl/media/image{index}.png', image.getvalue())
        urls = self.ns['xlsx_embedded_image_data_urls'](str(path), max_images=1, max_size=10)
        self.assertEqual(len(urls), 1)
        self.assertTrue(urls[0].startswith('data:image/jpeg;base64,'))
        with Image.open(BytesIO(base64.b64decode(urls[0].split(',', 1)[1]))) as decoded:
            self.assertEqual(decoded.size, (10, 5))
            self.assertEqual(decoded.mode, 'RGB')
        refs = [{'url': path.name}, {'url': path.name}]
        self.assertEqual(len(self.ns['attachment_embedded_image_data_urls'](refs, max_images=2)), 2)

    def test_attachment_entries_filter_images_and_use_declared_limits(self):
        (self.root / 'note.txt').write_text('一二三四五', encoding='utf-8')
        refs = [{'url': 'note.txt', 'name': '跳过图片', 'kind': 'image'},
                {'url': 'note.txt', 'name': '指定名称'}, {'url': 'note.txt', 'name': '超出数量'}]
        self.assertEqual(self.ns['attachment_text_blocks'](refs, limit_each=3), ['附件：指定名称\n一二三'])
