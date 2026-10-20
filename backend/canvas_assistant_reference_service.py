"""助手素材目录：顺序读取资产库与本地上传树，返回公开媒体字段。

应用注入三个只读端口；资产库遍历完成后才读取本地树，保留各来源的地址策略。
本模块不持有索引或用户路径，也不替代助手路由的可引用地址检查。
"""


def read_reference_assets(*, load_asset_library, load_local_tree_and_items, media_kind):
    """从真实素材索引读取公开展示字段，不接受客户端自报媒体地址。"""
    items = []
    library = load_asset_library()
    for lib in library.get("libraries", []):
        library_id = str(lib.get("id") or "")
        for category in lib.get("categories", []):
            if category.get("type") == "workflow":
                continue
            for item in category.get("items", []):
                if not isinstance(item, dict):
                    continue
                url = item.get("url")
                item_id = str(item.get("id") or "")
                kind = item.get("kind") or media_kind(url or "")
                if not item_id or kind not in {"image", "video"} or not isinstance(url, str) or not url.startswith(("/assets/", "/output/", "/api/storage-files/local/", "https://", "http://")):
                    continue
                items.append({"id": f"asset:{library_id}:{item_id}", "url": url, "thumbnail": item.get("thumbnail") or item.get("thumb") or item.get("preview") or "", "name": item.get("name") or "图片资产", "kind": kind, "source": "asset", "libraryId": library_id, "categoryId": str(category.get("id") or ""), "libraryName": lib.get("name") or "资产库", "categoryName": category.get("name") or ""})
    _, local_items = load_local_tree_and_items()
    for item in local_items:
        item_id = str(item.get("id") or "")
        url = item.get("url")
        if not item_id or item.get("kind") not in {"image", "video"} or not isinstance(url, str) or not url.startswith("/api/storage-files/local/"):
            continue
        items.append({"id": f"local:{item_id}", "url": url, "thumbnail": "", "name": item.get("name") or "本地素材", "kind": item["kind"], "source": "local", "libraryId": "local", "categoryId": item.get("folder") or "", "libraryName": "本地素材", "categoryName": item.get("folder") or "全部上传"})
    return items
