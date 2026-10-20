"""聊天附件的文本、工作簿及内嵌图片读取。

路径解析、读取上限、图像与XML依赖由应用显式注入；仅读取调用方提供的附件。
"""
import os
import re

def _xml_local_name(tag):
    return str(tag or "").rsplit("}", 1)[-1]


def _xlsx_join_text(node, *, _xml_local_name):
    parts = []
    for child in node.iter():
        if _xml_local_name(child.tag) == "t" and child.text:
            parts.append(child.text)
    return "".join(parts).strip()


def _xlsx_shared_strings(archive, *, ET, _xlsx_join_text, _xml_local_name):
    try:
        raw = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(raw)
    values = []
    for node in root:
        if _xml_local_name(node.tag) == "si":
            values.append(_xlsx_join_text(node))
    return values


def _xlsx_sheet_paths(archive, *, ET, _xml_local_name):
    names = set(archive.namelist())
    fallback = [(os.path.basename(name).rsplit(".", 1)[0], name) for name in sorted(names) if re.match(r"xl/worksheets/sheet\d+\.xml$", name)]
    try:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_map = {}
        for rel in rels:
            rid = rel.attrib.get("Id")
            target = rel.attrib.get("Target") or ""
            if not rid or not target:
                continue
            target = target.lstrip("/")
            if not target.startswith("xl/"):
                target = f"xl/{target}"
            rel_map[rid] = target.replace("\\", "/")
        result = []
        for sheet in workbook.iter():
            if _xml_local_name(sheet.tag) != "sheet":
                continue
            title = sheet.attrib.get("name") or "Sheet"
            rid = sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            target = rel_map.get(rid, "")
            if target in names:
                result.append((title, target))
        return result or fallback
    except Exception:
        return fallback


def _xlsx_cell_text(cell, shared_strings, *, _xlsx_join_text, _xml_local_name):
    cell_type = cell.attrib.get("t", "")
    value_node = None
    formula_node = None
    inline_node = None
    for child in cell:
        name = _xml_local_name(child.tag)
        if name == "v":
            value_node = child
        elif name == "f":
            formula_node = child
        elif name == "is":
            inline_node = child
    raw_value = (value_node.text if value_node is not None else "") or ""
    formula = (formula_node.text if formula_node is not None else "") or ""
    if cell_type == "s" and raw_value.isdigit():
        idx = int(raw_value)
        value = shared_strings[idx] if 0 <= idx < len(shared_strings) else raw_value
    elif cell_type == "inlineStr" and inline_node is not None:
        value = _xlsx_join_text(inline_node)
    elif cell_type == "b":
        value = "TRUE" if raw_value == "1" else "FALSE" if raw_value == "0" else raw_value
    else:
        value = raw_value
    value = str(value or "").strip()
    if formula and value:
        return f"{value} [={formula}]"
    if formula:
        return f"={formula}"
    return value


def read_xlsx_attachment(path, limit, *, ET, EXCEL_MAX_COLS_PER_ROW, EXCEL_MAX_ROWS_PER_SHEET, EXCEL_MAX_SHEETS, XLSX_IMAGE_EXTS, _xlsx_cell_text, _xlsx_shared_strings, _xlsx_sheet_paths, _xml_local_name, zipfile):
    parts = []
    used = 0
    with zipfile.ZipFile(path) as archive:
        shared = _xlsx_shared_strings(archive)
        sheets = _xlsx_sheet_paths(archive)
        media_count = sum(1 for name in archive.namelist() if name.startswith("xl/media/") and os.path.splitext(name)[1].lower() in XLSX_IMAGE_EXTS)
        parts.append(f"Excel 工作簿：{os.path.basename(path)}")
        if media_count:
            parts.append(f"内嵌图片数量：{media_count}（已作为图片参考一并提供给模型）")
        for sheet_index, (sheet_name, sheet_path) in enumerate(sheets[:EXCEL_MAX_SHEETS], start=1):
            try:
                root = ET.fromstring(archive.read(sheet_path))
            except Exception:
                continue
            rows = []
            for row in root.iter():
                if _xml_local_name(row.tag) != "row":
                    continue
                cells = []
                for cell in row:
                    if _xml_local_name(cell.tag) != "c":
                        continue
                    ref = cell.attrib.get("r") or ""
                    value = _xlsx_cell_text(cell, shared)
                    if value:
                        cells.append(f"{ref}={value}" if ref else value)
                    if len(cells) >= EXCEL_MAX_COLS_PER_ROW:
                        break
                if cells:
                    row_ref = row.attrib.get("r") or str(len(rows) + 1)
                    rows.append(f"第 {row_ref} 行：" + " | ".join(cells))
                if len(rows) >= EXCEL_MAX_ROWS_PER_SHEET:
                    break
            if rows:
                section = f"\n工作表 {sheet_index}：{sheet_name}\n" + "\n".join(rows)
            else:
                section = f"\n工作表 {sheet_index}：{sheet_name}\n（未读取到非空单元格）"
            if used + len(section) > limit:
                remain = max(0, limit - used)
                if remain:
                    parts.append(section[:remain])
                parts.append("\n（Excel 内容较长，已截断）")
                break
            parts.append(section)
            used += len(section)
    return "\n".join(parts).strip()[:limit]


def xlsx_embedded_image_data_urls(path, max_images=4, max_size=1536, *, BytesIO, Image, XLSX_IMAGE_EXTS, base64, write_diagnostic, zipfile):
    urls = []
    try:
        with zipfile.ZipFile(path) as archive:
            media = [name for name in archive.namelist() if name.startswith("xl/media/") and os.path.splitext(name)[1].lower() in XLSX_IMAGE_EXTS]
            for name in sorted(media)[:max_images]:
                try:
                    raw = archive.read(name)
                    with Image.open(BytesIO(raw)) as img:
                        img.load()
                        if max(img.size) > max_size:
                            img.thumbnail((max_size, max_size), Image.LANCZOS)
                        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                            bg = Image.new("RGB", img.size, (255, 255, 255))
                            bg.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
                            img = bg
                        elif img.mode != "RGB":
                            img = img.convert("RGB")
                        buf = BytesIO()
                        img.save(buf, format="JPEG", quality=88, optimize=True)
                        encoded = base64.b64encode(buf.getvalue()).decode("ascii")
                        urls.append(f"data:image/jpeg;base64,{encoded}")
                except Exception as exc:
                    write_diagnostic(f"chat xlsx image extract failed error={type(exc).__name__}")
    except Exception as exc:
        write_diagnostic(f"chat xlsx image read failed error={type(exc).__name__}")
    return urls


def attachment_embedded_image_data_urls(refs, max_images=4, *, is_image_reference, output_file_from_url, xlsx_embedded_image_data_urls):
    urls = []
    for ref in (refs or []):
        if not isinstance(ref, dict) or is_image_reference(ref):
            continue
        path = output_file_from_url(ref.get("url", ""))
        if not path or os.path.splitext(path)[1].lower() != ".xlsx":
            continue
        urls.extend(xlsx_embedded_image_data_urls(path, max_images=max(0, max_images - len(urls))))
        if len(urls) >= max_images:
            break
    return urls[:max_images]


def read_text_attachment(path, limit, *, ET, TEXT_ATTACHMENT_EXTS, html, read_xlsx_attachment, write_diagnostic, zipfile):
    ext = os.path.splitext(path or "")[1].lower()
    if not path or not os.path.isfile(path):
        return ""
    try:
        if ext == ".xlsx":
            return read_xlsx_attachment(path, limit)
        if ext == ".xls":
            return "这是旧版 .xls 二进制 Excel 文件，当前内置解析器暂不支持直接读取内容。请另存为 .xlsx 后重新上传。"
        if ext == ".docx":
            with zipfile.ZipFile(path) as archive:
                raw = archive.read("word/document.xml")
            root = ET.fromstring(raw)
            parts = []
            for node in root.iter():
                if node.tag.endswith("}t") and node.text:
                    parts.append(node.text)
                elif node.tag.endswith("}p"):
                    parts.append("\n")
            return html.unescape("".join(parts)).strip()[:limit]
        if ext in TEXT_ATTACHMENT_EXTS:
            with open(path, "rb") as f:
                data = f.read(min(os.path.getsize(path), limit * 4))
            for encoding in ("utf-8-sig", "utf-8", "gb18030"):
                try:
                    return data.decode(encoding, errors="strict").strip()[:limit]
                except UnicodeDecodeError:
                    continue
            return data.decode("utf-8", errors="replace").strip()[:limit]
    except Exception as exc:
        write_diagnostic(f"chat attachment text read failed error={type(exc).__name__}")
    return ""


def attachment_text_blocks(refs, limit_each, *, CHAT_ATTACHMENT_MAX, is_image_reference, output_file_from_url, read_text_attachment):
    blocks = []
    for ref in (refs or [])[:CHAT_ATTACHMENT_MAX]:
        if not isinstance(ref, dict) or is_image_reference(ref):
            continue
        path = output_file_from_url(ref.get("url", ""))
        text = read_text_attachment(path, limit_each) if path else ""
        if not text:
            continue
        name = ref.get("name") or os.path.basename(path)
        blocks.append(f"附件：{name}\n{text}")
    return blocks


