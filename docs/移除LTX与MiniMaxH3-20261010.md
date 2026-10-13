# 移除 LTX 与 MiniMax H3 的本地验收记录

用户确认：删除 LTX 和普通、智能画布中的 MiniMax H3，其他功能一概不动；删除后进行本地模拟验收。本记录优先于历史文档中继续验收这两个功能的待办。修改在 2026-10-10 实施，最终核对在 2026-10-11 完成。

## 删除范围

- 普通画布的 LTX、MiniMax H3 创建菜单及专属节点实现；智能画布的 MiniMax H3 菜单及专属实现。
- 两功能的时间线、参数编辑、分段运行、专属 ComfyUI/RunningHub 编译、恢复、导出、助手动作和知识登记。
- `static/js/ltx-director-timeline.js`、`backend/canvas_assistant_timeline.py`。
- `workflows/MiniMax_H3.json` 及其 `.config.json`、`workflows/LTXDirectorv2-API.json` 及其 `.config.json`。
- 三张专属知识卡及四个专属测试文件；混合测试仅移除对应功能的测试，并保留通用任务恢复与归属测试。
- `static/runninghub/api_providers.json` 仅移除 title 为 `Minimax-多参视频生成`、workflowId 为 `2084608321469898754` 的一个内置工作流预设，其余配置与删除前完全相等。

没有改动通用 MiniMax 模型配置、MiniMax 文本/音频协议、普通视频生成、ComfyUI、RunningHub、剪辑及其他节点的功能。共享 CSS 规则保留，仅裁去目标功能选择器。通用 LLM 回执使用的 `timeline_hash` 算法原样移至 native 模块，避免依赖已删除文件。

主要入口为 `static/js/canvas.js`、`static/js/smart-canvas.js`、两画布 HTML、`static/js/canvas-assistant*.js`、`backend/canvas_assistant*.py` 和 `main.py`。页面缓存版本更新为 `2026.10.10.remove-directors.1`。

用户画布、素材、任务记录、实际 API 配置未删除或迁移。历史画布中这两种节点的数据仍保留，但不能再创建或执行；未知类型由既有保护处理，不自动删除其内容。公开源码删除前备份为 `output/remove-directors/before-source.zip`，原文件摘要为 `before-manifest.json`。不可整体恢复备份覆盖后续其他工作；需要回退时只恢复本次列明文件。

## 验证结果

| 验证 | 结果与证据 |
| --- | --- |
| 完整核心回归 | Python 929 项、JavaScript 437 项、33 个 JS 语法检查和中英文词条检查通过；`output/remove-directors/core-final.log` |
| 最后清理后的专项 | native JS 69 项、state Python 23 项、删除边界 Python 2 项通过；`native-final.log`、`state-final.log` |
| 删除边界 | 三种旧类型不能创建或执行，原数据保留；通用运行和剪辑导出保留；`tests/test_canvas_removed_directors.py` |
| 两画布真实页面 | 菜单不再出现目标功能，原生其他菜单、模型选择和中文提示词正常；`classic-menu.png`、`smart-menu.png` |
| 普通画布组合模拟 | 提示词→LLM→图片→结果复用完成 4/4；6 节点、6 连线、原手选模型保留；1 次模拟 LLM、2 个唯一图片任务 |
| 刷新恢复 | 保存回执、原图片及提示词引用恢复，未新增模型、LLM、图片或供应商请求；`chain-reopened.png` |
| 范围核对 | 13 个专属文件删除；剩余 407 行与删除前过滤目标行后的内容完全相同；其他 RunningHub 配置完全相同 |
| 知识保护 | 22 项知识，20 种助手节点类型，`ProjectKnowledge.changed(snapshot)==[]`；D 矩阵来源摘要匹配当前源码 |

最终只读核对脚本：`output/remove-directors/verify-final.py`。从项目根目录运行：

```powershell
python/python.exe -X utf8 -c 'import runpy; runpy.run_path("output/remove-directors/verify-final.py",run_name="__main__")'
```

最终证据为 `output/remove-directors/retirement-verified.json`、`scope-audit.json` 和 `stats-before-reload.json`。初次核心检查中的知识摘要漂移失败保留在 `core-check.log`，同步已核对来源后完整重跑通过，没有关闭保护检查。

## 验收边界与使用

本轮真实模型、供应商和视频调用均为 0，未追加 GPT CLI 额度。页面整链使用隔离 3033 服务、公开源码副本与模拟任务；正式 3000 服务和用户数据未操作。最终清理的无调用方字段及内置 H3 预设未重新复制到模拟副本，对当前整链没有影响；当前最终源码已通过对应专项检查。

正式清单从 487 项移除 80 项，现为 **407 项：32 partial、375 pending、0 项全量 operation passed**。本轮完成指定删除及相关本地模拟验证，不能据此宣称所有 B/C/D 功能或真实模型效果全部验收完成。过去的 LTX/H3 报告只作历史证据。

双击根目录 `run.bat` 启动原程序，刷新普通/智能画布加载新版本；检查右键创建菜单即可看到删除结果。已有任务和素材照常使用。源码尚未提交、推送或发布；待用户手动确认后按 AGENTS.md 仅同步已确认范围。
