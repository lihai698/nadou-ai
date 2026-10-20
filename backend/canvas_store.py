"""画布文档存储与锁内读改写。无 HTTP、媒体清理或应用全局状态依赖。

目录、共享锁、时钟、ID 和原子写入器由应用注入。现有数据格式与失败边界保持。
"""
import json
import os
import re

from backend.atomic_json import write_json_atomic
from backend.data_formats import canvas_version, mark_current, InvalidDataFormat, UnsupportedDataFormat
from backend.canvas_records import canvas_record, normalize_canvas_kind, normalize_canvas_color


class CanvasStoreError(Exception):
    """由应用适配层转换为原 HTTP 状态及 detail，模块不依赖 FastAPI。"""

    def __init__(self, *, status_code, detail):
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


class CanvasStore:
    def __init__(self, directory, *, lock, now_ms, new_id, default_project, retention_ms, writer=None):
        self.directory = directory
        self.lock = lock
        self.now_ms = now_ms
        self.new_id = new_id
        self.default_project = default_project
        self.retention_ms = retention_ms
        self.writer = writer if writer is not None else write_json_atomic

    def path(self, canvas_id):
        cleaned = re.sub('[^a-zA-Z0-9_-]', '', canvas_id or '')
        if not cleaned:
            raise CanvasStoreError(status_code=400, detail='无效的画布 ID')
        return os.path.join(self.directory, f'{cleaned}.json')

    def validate(self, canvas):
        try:
            canvas_version(canvas)
        except UnsupportedDataFormat as exc:
            raise CanvasStoreError(status_code=409, detail=str(exc)) from exc
        except InvalidDataFormat as exc:
            raise CanvasStoreError(status_code=500, detail=str(exc)) from exc

    def write(self, canvas):
        """不更新时间的底层写入；跨记录调用方需持有共享锁。"""
        self.validate(canvas)
        path = self.path(canvas['id'])
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                self.validate(json.load(f))
        mark_current(canvas, '画布')
        self.writer(path, canvas, ensure_ascii=False, indent=2)

    def save(self, canvas):
        with self.lock:
            self.validate(canvas)
            canvas['updated_at'] = max(self.now_ms(), int(canvas.get('updated_at') or 0) + 1)
            self.write(canvas)

    def for_project(self, project_id):
        """项目删除前完整校验；调用方须持有注入的同一把共享锁。"""
        moving = []
        for filename in os.listdir(self.directory):
            if not filename.endswith('.json'):
                continue
            path = os.path.join(self.directory, filename)
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.validate(data)
            except (OSError, ValueError) as exc:
                raise CanvasStoreError(status_code=500, detail='画布文件读取失败，项目未删除') from exc
            if filename != f"{data['id']}.json":
                raise CanvasStoreError(status_code=500, detail='画布文件名与 ID 不一致，项目未删除')
            if str(data.get('project') or '') == project_id:
                moving.append(data)
        return moving

    def create(self, title='未命名画布', icon='layers', kind='classic', project=None, board_x=None, board_y=None):
        timestamp = self.now_ms()
        canvas_kind = normalize_canvas_kind(kind)
        canvas = {
            'id': self.new_id(),
            'title': (title or ('智能画布' if canvas_kind == 'smart' else '未命名画布'))[:80],
            'icon': (icon or ('sparkles' if canvas_kind == 'smart' else '🧩'))[:32],
            'kind': canvas_kind, 'owner': '', 'color': '', 'pinned': False,
            'project': str(project or '').strip() or self.default_project,
            'created_at': timestamp, 'updated_at': timestamp,
            'nodes': [], 'connections': [], 'viewport': {'x': 0, 'y': 0, 'scale': 1},
        }
        if board_x is not None:
            canvas['board_x'] = float(board_x)
        if board_y is not None:
            canvas['board_y'] = float(board_y)
        self.save(canvas)
        return canvas

    def load(self, canvas_id):
        path = self.path(canvas_id)
        if not os.path.exists(path):
            raise CanvasStoreError(status_code=404, detail='画布不存在')
        with open(path, 'r', encoding='utf-8') as f:
            canvas = json.load(f)
        self.validate(canvas)
        if canvas.get('deleted_at'):
            raise CanvasStoreError(status_code=404, detail='画布已在回收站')
        return canvas

    def load_any(self, canvas_id):
        path = self.path(canvas_id)
        if not os.path.exists(path):
            raise CanvasStoreError(status_code=404, detail='画布不存在')
        with open(path, 'r', encoding='utf-8') as f:
            canvas = json.load(f)
        self.validate(canvas)
        return canvas

    def cleanup_trash(self):
        cutoff = self.now_ms() - self.retention_ms
        with self.lock:
            for filename in os.listdir(self.directory):
                if not filename.endswith('.json'):
                    continue
                path = os.path.join(self.directory, filename)
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    self.validate(data)
                    deleted_at = int(data.get('deleted_at') or 0)
                    if deleted_at and deleted_at < cutoff:
                        os.remove(path)
                except Exception:
                    continue

    def asset_documents(self):
        """素材索引的只读扫描；保留旧接口跳过坏 JSON、不过滤格式版本的边界。

        回收站清理由同一存储所有者负责；汇总层不直接读取画布目录。
        """
        self.cleanup_trash()
        for filename in os.listdir(self.directory):
            if not filename.endswith(".json"):
                continue
            try:
                with open(os.path.join(self.directory, filename), "r", encoding="utf-8") as f:
                    canvas = json.load(f)
            except Exception:
                continue
            if canvas.get("deleted_at"):
                continue
            yield canvas

    def records(self, include_deleted=False):
        self.cleanup_trash()
        records = []
        for filename in os.listdir(self.directory):
            if not filename.endswith('.json'):
                continue
            try:
                with open(os.path.join(self.directory, filename), 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.validate(data)
            except Exception:
                continue
            is_deleted = bool(data.get('deleted_at'))
            if include_deleted != is_deleted:
                continue
            records.append(canvas_record(data))
        return records

    def meta(self, canvas_id):
        canvas = self.load(canvas_id)
        return {
            'id': canvas.get('id'), 'updated_at': canvas.get('updated_at', 0),
            'meta_revision': int(canvas.get('meta_revision') or 0),
            'title': canvas.get('title', '未命名画布'), 'icon': canvas.get('icon', 'layers'),
            'kind': normalize_canvas_kind(canvas.get('kind')),
        }

    def update_meta(self, canvas_id, values):
        """更新画布的轻量元数据（标题/图标/负责人/颜色/置顶）。
        刻意不走 save（它会刷新 updated_at），以免打标签/置顶把画布顶到列表最前。"""
        with self.lock:
            canvas = self.load(canvas_id)
            before = {key: canvas.get(key) for key in ('title', 'icon')}
            if values.get('title') is not None:
                canvas['title'] = (values.get('title') or canvas.get('title') or '未命名画布')[:80]
            if values.get('icon') is not None:
                canvas['icon'] = (values.get('icon') or 'layers')[:32]
            if values.get('owner') is not None:
                canvas['owner'] = str(values.get('owner')).strip()[:40]
            if values.get('color') is not None:
                canvas['color'] = normalize_canvas_color(values.get('color'))
            if values.get('pinned') is not None:
                canvas['pinned'] = bool(values.get('pinned'))
            if values.get('project') is not None:
                canvas['project'] = str(values.get('project')).strip() or self.default_project
            if values.get('board_x') is not None:
                canvas['board_x'] = float(values.get('board_x'))
            if values.get('board_y') is not None:
                canvas['board_y'] = float(values.get('board_y'))
            if any((canvas.get(key) != value for key, value in before.items())):
                canvas['meta_revision'] = int(canvas.get('meta_revision') or 0) + 1
            self.write(canvas)
        return canvas

    def touch(self, canvas_id):
        with self.lock:
            canvas = self.load(canvas_id)
            self.save(canvas)
        return canvas

    def update_content(self, canvas_id, values, *, fields):
        """values 是已验证且补齐默认值的请求映射；fields 保留客户端显式传入字段。"""
        with self.lock:
            canvas = self.load(canvas_id)
            current_updated_at = int(canvas.get('updated_at') or 0)
            if values.get('base_updated_at') and current_updated_at and (int(values.get('base_updated_at')) < current_updated_at):
                raise CanvasStoreError(status_code=409, detail={
                    'message': '画布已被其他页面更新，已拒绝旧版本覆盖。',
                    'canvas': canvas, 'updated_at': current_updated_at,
                })
            current_title = (canvas.get('title') or '未命名画布')[:80]
            current_icon = (canvas.get('icon') or 'layers')[:32]
            incoming_title = (values.get('title') or current_title)[:80] if 'title' in fields else current_title
            incoming_icon = (values.get('icon') or current_icon)[:32] if 'icon' in fields else current_icon
            current_meta_revision = int(canvas.get('meta_revision') or 0)
            if (incoming_title != current_title or incoming_icon != current_icon) and (
                (values.get('base_meta_revision') is None and current_meta_revision > 0)
                or (values.get('base_meta_revision') is not None
                    and values.get('base_meta_revision') != current_meta_revision)
            ):
                raise CanvasStoreError(status_code=409, detail={
                    'message': '画布标题或图标已在其他页面更新，请合并后重试。',
                    'reason': 'meta_conflict', 'canvas': canvas,
                    'updated_at': current_updated_at, 'meta_revision': current_meta_revision,
                })
            canvas['title'] = incoming_title
            canvas['icon'] = incoming_icon
            canvas['kind'] = normalize_canvas_kind(canvas.get('kind'))
            canvas['nodes'] = values.get('nodes')
            canvas['connections'] = values.get('connections')
            if canvas['kind'] == 'smart':
                canvas['viewport'] = values.get('viewport')
            else:
                canvas['viewport'] = canvas.get('viewport') or {'x': 0, 'y': 0, 'scale': 1}
            canvas['logs'] = values.get('logs')[-500:]
            canvas['settings'] = values.get('settings') or {}
            self.save(canvas)
        return canvas

    def delete(self, canvas_id):
        with self.lock:
            canvas = self.load_any(canvas_id)
            if not canvas.get('deleted_at'):
                canvas['deleted_at'] = self.now_ms()
                self.save(canvas)

    def restore(self, canvas_id):
        with self.lock:
            canvas = self.load_any(canvas_id)
            if canvas.get('deleted_at'):
                canvas.pop('deleted_at', None)
                self.save(canvas)
        return canvas

    def purge(self, canvas_id):
        with self.lock:
            path = self.path(canvas_id)
            if os.path.exists(path):
                os.remove(path)
