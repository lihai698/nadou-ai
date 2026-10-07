"""RunningHub 回包的纯解析规则。

本模块只读取调用方传入的 JSON 对象，不读取配置、不发起请求、不保存
上游原始回包。网络请求、认证、输出下载和错误文案仍由应用入口负责。
"""

from typing import Any


def runninghub_query_status(raw: Any) -> str:
    """按既有优先级读取 RunningHub 查询状态，并返回小写文本。"""

    if not isinstance(raw, dict):
        return ""
    values = [
        raw.get("status"),
        raw.get("state"),
        raw.get("taskStatus"),
        raw.get("task_status"),
    ]
    data = raw.get("data")
    if isinstance(data, dict):
        values.extend([
            data.get("status"),
            data.get("state"),
            data.get("taskStatus"),
            data.get("task_status"),
        ])
    for value in values:
        if value is not None:
            return str(value).lower()
    return ""


def runninghub_extract_task_id(raw: Any) -> str:
    """从根对象或 ``data`` 对象提取 RunningHub 任务编号。"""

    if not isinstance(raw, dict):
        return ""
    for key in ("taskId", "task_id", "id"):
        if raw.get(key):
            return str(raw[key])
    data = raw.get("data")
    if isinstance(data, dict):
        for key in ("taskId", "task_id", "id"):
            if data.get(key):
                return str(data[key])
    return ""
