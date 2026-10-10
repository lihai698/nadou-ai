# 创作助手 Agent 实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话实施。用户已明确“做吧，一边做，一边研究，做好检查”，授权持续执行；不另设计划审批。按项目约定验收前不提交或上传。

**Goal:** 在两种画布完成有限多步创作、内置 Skill、真实结果回读与可恢复续行。

**Architecture:** Python 执行循环依赖注入模型、工具、持久化和事件；工具仅包装既有画布/图片入口。AssistantStore 管理回合和步骤，共用前端展示 Skill 和过程，生成保留现有确认卡。

**Tech Stack:** Python 3.10、FastAPI、Pydantic、原生 JavaScript/CSS；不新增依赖。

**Spec:** docs/superpowers/specs/2026-10-08-creative-assistant-agent-design.md

## Global Constraints

- 6 次模型请求、8 次工具执行、累计主动执行 900 秒；预算持久化，续行不清零。
- 同一工具/参数连续失败两次停止，无效协议只纠正一次。
- 图片调用须确认，原任务去重；停止不保证供应商取消或退费。
- 手动双模型、不增加生成模式、不增加整轮撤销、不复制参考 UI。
- Skill 在模型后，默认自动、手选单项；本期只内置三项，不支持脚本或外部导入。
- 真实入口修改，工作区已有其他修改保留；验收前不提交，模拟不调用真实模型。

## Review Focus

- 写入成功但历史保存中断：查稳定步骤回执，不重建节点。
- 两个页面同时续行：只一方取得执行权，不重复模型请求或图片任务。
- 用户停止在原子写入期间：显示真实保存结果并阻止下一工具。
- 生成结果不是图片或已丢失：清楚报错，不虚构视觉评价。
- 文本模型/Skill 在等待阶段变化：使用固定本轮快照；失效时拒绝静默替换。

### Task 1: 内置 Skill 与受限工具协议

**Files:** backend/canvas_assistant_skills.py、backend/canvas_assistant_tools.py、skills/canvas-assistant/*/SKILL.md、tests/test_canvas_assistant_agent.py。

**Interfaces:** SkillCatalog.index()/snapshot()/read() 提供白名单索引与版本正文；parse_decision(text) 返回回复/工具/参数/结束；tool_catalog() 提供同一份 schema。

- [ ] 先写目录越界、手选正文、未知工具/额外参数拒绝的失败测试。
- [ ] 运行 `python/python.exe -m unittest tests.test_canvas_assistant_agent -v`，确认功能未实现导致失败。
- [ ] 实现 Skill 限定目录和六工具 schema；内置海报、改图、提示词优化。
- [ ] 同命令通过；不加载密钥或脚本。

### Task 2: 执行循环、回执与历史接入

**Files:** backend/canvas_assistant_agent.py、backend/canvas_assistant.py、main.py、tests/test_canvas_assistant_agent.py。

**Interfaces:** run_agent(payload, previous, checkpoint, execute, call_model, emit) 返回结束状态与回复；checkpoint 将预算与工具意图先保存，工具写入与回执用固定 stepId；事件 agent_step/turn_end。

- [ ] 添加真实读写路由测试：第二次模型调用必须看到真实节点编号与写入回执；重复失败与预算停止。
- [ ] 运行失败测试，再实现工具注入与同一历史 owner。
- [ ] 新协议循环接入真实 chat；保留旧结构化回复解码兼容，不保留旧一轮调度入口。
- [ ] 原子写入、取消、版本冲突、历史中断后回执恢复通过；运行全部助手 Python 专项。

### Task 3: 图片完成后的可恢复续行

**Files:** backend/canvas_assistant.py、backend/canvas_assistant_agent.py、tests/test_canvas_assistant_agent.py。

**Interfaces:** POST /continue 使用 canvasId/sessionId/requestId；读取本轮保存模型/预算/工具结果。结果观察只查询已有 taskId，任务完成可去重地启动续行，断开与停止取消观察。

- [ ] 添加未完成任务不续行、重复/并发续行只消费一次、刷新保持预算与停止不自动续行的失败测试。
- [ ] 实现活动页面登记、结果检查与后端查询；仅白名单媒体进入文本模型。
- [ ] 生成失败保持原重试卡，不自动新建生成；观察最长 1800 秒。
- [ ] 路由与真实任务回归通过。

### Task 4: 共用界面与真实点击验收

**Files:** static/js/canvas-assistant.js、static/css/canvas-assistant.css、两画布 HTML 资源版本、tests/canvas_assistant_agent.test.cjs、output/assistant-agent-verification/（不入库）。

**Interfaces:** status 返回 skills 与 agent 能力；发送携带 skillId；agent_step 展示状态；活动页面通过只读轮询识别任务完成/续行；手动继续消费同一回合。

- [ ] 编写步骤流和状态的行为测试，运行失败后接入 UI。
- [ ] 新增 Skill 原生弹层、步骤详情、继续/停止；用户偏好按用户/画布保存。
- [ ] 隔离服务真实点击普通/智能画布：选择 Skill、发送、方案确认、结果回读、失败重试、停止、刷新继续。
- [ ] 检查浅深主题、390px、透明区域、输入与画布快捷键；截图和证据留 output。
- [ ] 运行相关检查及项目核心检查；审查、修复、清理被替代调度和无效引用；更新方案真实状态。

## 执行记录

- 工作在原源码目录的 `codex/creative-assistant-agent` 分支，保留已有未确认改动；不另起脱离真实入口的产品副本。隔离验收使用专用数据和端口。
- 用户明确要求持续实施，本计划随工作记录更新；本地 Git 提交和上传仍等待最终功能验收。

## 2026-10-09 实施记录

- Task 1～3 已完成：Skill 白名单和六项工具协议、有限多步 Agent、原生工具回执、图片确认与结果续行已接入并通过专项测试。
- Task 4 已完成主要路径：普通/智能画布 Skill 弹层、步骤流、确认卡、停止和继续入口已接入；两种画布隔离服务真实点击闭环和长任务手动停止均通过，刷新保留模型、Skill 与结果，不新增模型请求或图片任务。
- 审查修复后验证：`check-core.py` Python 563 项、JavaScript 249 项；Agent 23 项、素材引用 8 项，合计 31 项；助手相关五模块合计 75 项。前端 Agent 文件 3 项已包含在核心检查内。
- 审查发现并修复：后续请求丢失原需求/历史、素材库引用续行遗漏与替图风险、历史读取抢占执行及旧执行器写入、刷新断线误记停止。新增 8 项回归，实际浏览器验证断线保存 interrupted、点击继续恢复同一回合；主动停止仍保持 cancelled。
- 修复后的两次完整创作均为 5 次工具执行、6 次模型请求；finalStats 为 `submissions=2`、`failures=0`、`modelCalls=17`、`evaluations=2`、`cancelledModelCalls=4`，含两画布停止和刷新恢复验证。真实回执、原任务结果与图片文件已核对。
- 证据：`output/assistant-image-verification/recovery-verification.json`、`recovery-core-check.log`、`recovery-review-green.log`、`recovery-fixed-*.png`、`recovery-refresh-completed.png`；两种画布均检查了 390px Skill 弹层。上述隔离数据不入库。
- 正式 3000 服务首页及 status 正常，但当前进程尚未加载审查修复。自动审批拒绝停止/重启命令，需用户关闭原运行窗口并执行 `run.bat` 后核对。临时验收页面已关闭，隔离服务与证据保留。
- 未验证：真实供应商模型效果，纯文本供应商的实际兼容性；本轮不调用真实收费接口。视频、批量制作与整轮撤销不属于本阶段。
- 用户最终确认前不提交或上传。
