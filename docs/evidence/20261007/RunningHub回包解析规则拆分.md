# RunningHub 回包解析规则拆分（2026-10-07）

## 范围与职责

- 新增 `backend/runninghub_protocol.py`，集中处理 `runninghub_query_status` 和 `runninghub_extract_task_id` 两个纯解析规则。
- `main.py` 保留同名兼容入口，继续负责 HTTP 请求、认证、轮询、媒体下载和错误摘要；没有改变 RunningHub 的请求地址、字段或状态判断。
- 解析规则只读取根对象和 `data` 对象的既有字段，不保存上游原始回包，也不把未知内容伪装成成功。

## 保持的行为

状态读取优先使用根对象的 `status/state/taskStatus/task_status`，再读取 `data` 中的同名字段，并保持小写返回。任务编号优先使用根对象的 `taskId/task_id/id`，再读取 `data`，数字编号继续转为字符串，缺失或非法对象返回空字符串。

## 验证

- `tests/test_runninghub_protocol.py` 覆盖根字段优先级、嵌套字段、数字编号、空值和非法输入。
- RunningHub、图片查询、视频查询及错误脱敏相关专项共 26 项通过。
- `python/python.exe -X utf8 tools/check-core.py` 通过：Python 453 项、JavaScript 208 项，脚本语法和中英文词条检查通过。
- `py_compile` 和 `git diff --check` 通过。

## 未覆盖边界

真实 RunningHub 账户、网络故障和上游字段变更仍需在明确环境下单独验收；本次不调用真实供应商。
