"""项目删除的跨记录协调；画布读写由其现有入口注入。

保留逐个迁移后删除索引的原行为。中途失败保留项目，已迁移画布不回滚，
重试只迁移仍属于该项目的画布。这不是跨文件原子事务。
"""
from backend.project_store import ProjectOperationError


def delete_project(project_id, *, store, read_canvases, write_canvas):
    if project_id == store.default_id:
        raise ProjectOperationError("默认项目不可删除", status_code=400)
    with store.lock:
        projects = store.ensure_default()
        if not any(project.get("id") == project_id for project in projects):
            raise ProjectOperationError("项目不存在", status_code=404)
        # 适配器必须先完成全部文件验证，再返回待迁移画布；不能边读边写。
        moving = read_canvases(project_id)
        for canvas in moving:
            canvas["project"] = store.default_id
            write_canvas(canvas)
        store.save([project for project in projects if project.get("id") != project_id])
        return {"ok": True, "moved": len(moving)}
