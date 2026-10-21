"""静态页面版本标记、容错同步和 HTML 响应；路径、版本及原原子写入由 host 提供。"""



def versioned_static_html(html, *, current_app_version, urllib, re, os, STATIC_DIR):
    version = current_app_version()
    if not version:
        return html
    safe_version = urllib.parse.quote(version, safe="._-")
    pattern = re.compile(r'(?P<prefix>(?:src|href)=["\']|@import\s+url\(["\'])(?P<url>/static/[^"\')?#]+(?:\.(?:js|css|html)))(?:\?v=[^"\')#]*)?', re.I)
    def replace(match):
        url = match.group("url")
        cache_version = safe_version
        try:
            rel = urllib.parse.unquote(url[len("/static/"):]).replace("/", os.sep)
            path = os.path.abspath(os.path.join(STATIC_DIR, rel))
            static_root = os.path.abspath(STATIC_DIR)
            if path.startswith(static_root + os.sep) and os.path.isfile(path):
                cache_version = f"{safe_version}.{int(os.path.getmtime(path))}"
        except Exception:
            pass
        return f"{match.group('prefix')}{url}?v={cache_version}"
    return pattern.sub(replace, html)


def sync_static_html_versions(*, current_app_version, urllib, os, re, STATIC_DIR, versioned_static_html, write_text_atomic, write_diagnostic):
    version = current_app_version()
    if not version:
        return
    safe_version = urllib.parse.quote(version, safe="._-")
    try:
        for name in os.listdir(STATIC_DIR):
            # 跳过 macOS 在外置硬盘(ExFAT/NTFS)生成的 ._* Apple Double 元数据文件，
            # 这些是二进制文件，按 UTF-8 读取会抛 UnicodeDecodeError。
            if name.startswith("._"):
                continue
            if not name.lower().endswith(".html"):
                continue
            path = os.path.join(STATIC_DIR, name)
            if not os.path.isfile(path):
                continue
            # 单文件容错：某个文件读写失败不应中断整批同步。
            try:
                with open(path, "r", encoding="utf-8") as f:
                    old = f.read()
                new = versioned_static_html(re.sub(r'([?&]v=)[^"\'`\s<>)]*', rf'\g<1>{safe_version}', old))
                if new != old:
                    write_text_atomic(path, new, encoding="utf-8", newline="")
            except Exception as e:
                write_diagnostic(
                    f"static html version sync failed scope=file error={type(e).__name__}"
                )
    except Exception as e:
        write_diagnostic(
            f"static html version sync failed scope=directory error={type(e).__name__}"
        )


def static_html_response(filename, *, os, STATIC_DIR, versioned_static_html, Response):
    path = os.path.join(STATIC_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()
    return Response(
        versioned_static_html(html),
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": "no-cache"},
    )
