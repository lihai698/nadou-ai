# 阶段 6：受控诊断日志与 ModelScope 错误摘要

日期：2026-10-03。范围仅含公开代码和隔离模拟回包；未读取个人配置或用户数据，未调用真实供应商。

## 诊断日志

- 启动时默认写入 `data/logs/diagnostics.log`；可通过 `DIAGNOSTIC_LOG_FILE` 指定其他路径。写入目录属于本地用户数据，不进入发布包。
- `backend/diagnostics.py` 将单条摘要限制为 2000 字符，日志文件达到 2 MiB 时轮转，最多保留 3 份旧文件。只有调用方已脱敏的网络错误、HTTPX 重试和 RunningHub 错误摘要进入文件。
- 普通诊断信息和警告均可写入；验证过重新配置会关闭旧句柄，避免 Windows 下文件一直被占用。
- 诊断日志轮转参数现在可通过 `DIAGNOSTIC_LOG_MAX_BYTES` 和
  `DIAGNOSTIC_LOG_BACKUP_COUNT` 配置；前者限制在 1 KiB～64 MiB，后者限制在 1～20，
  无效值由运行时回退到 2 MiB/3 份默认值。`tools/check-environment.py` 会在启动前指出越界，
  不显示配置值。启动入口已把这两个参数传给轮转处理器，避免只改路径却无法核对磁盘占用上限。
- 自定义日志目录不可写时，启动配置会回退到 `data/logs/diagnostics.log`，只记录固定错误类型；默认目录也不可用时关闭文件日志，
  不因诊断辅助设施故障阻断本地画布启动。
- 控制台其他旧日志尚未全部接入受控文件，因此不能把此项视为全项目日志清理完成。

## ModelScope 错误

- 通用生图、角度任务和云端生图的失败提交、失败轮询与任务失败状态只返回脱敏、限长摘要，不再把完整上游 JSON、HTML、调试字段或异常文本返回页面。
- 网络异常写入脱敏诊断信息，页面收到可理解的重试提示；成功路径继续返回原有图片和业务结果。
- `upstream_error_summary()` 识别 ModelScope 的 `error_info` 字段。

## 通用生图与 Responses

- 通用生图提交失败、编辑接口回退失败及在线生图无图片时，页面只显示安全摘要或明确状态；旧版直接拼接 `response.text`、原始 JSON 和网络异常的出口已替换。
- Responses 的后台/流式回退日志不再写上游原始回包；524 超时和多次轮询失败会给出固定可理解提示，避免把调试体写回页面。
- 保留原有成功图片与上游业务结果结构，避免影响画布保存和素材处理。

## 验证

`tests/test_diagnostics.py` 覆盖普通日志写入、单条长度、轮转上限和关闭文件；`tests/test_modelscope_error_sanitization.py` 使用假回包覆盖四个生图入口、任务失败、网络错误及成功路径；`tests/test_generic_image_error_sanitization.py` 验证通用生图失败和成功路径。以上均在隔离环境通过；真实供应商报错仍待实际联调。

2026-10-04 补验：`test_diagnostics.py` 3 项、`test_check_environment.py` 6 项通过；额外覆盖轮转大小/份数的上下界、`.env` 越界提示和合法边界。测试只使用临时日志目录与自制配置，不读取真实 API/.env，不调用外部服务。
