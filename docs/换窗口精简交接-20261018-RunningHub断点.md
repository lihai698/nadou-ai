# 换窗精简交接｜2026-10-18｜RunningHub 验证断点

- 仓库：`F:/nadou-ai-源码-20261017-ddf9c27/nadou-ai-source-20261017/nadou-ai-source-20261017`；外层目录不是 Git。
- 分支 `codex/creative-assistant-agent`；HEAD `ddf9c2741702b570754cab4e36a9155cf2b9f9b8`；本窗零提交。
- 证据根目录 E＝仓库下 `.git/modularization/video-continuation-20261018/`；总记录《模块化续接执行记录-20261018.md》。

## 1．目标
让三个大文件的业务职责独立、真实入口可用、旧主体清除且验证可追溯，使用户以后修改单个功能时减少相互牵连；当前整体未完成。

## 2．本窗已完成（均被下述最近完整核心覆盖）
- 视频执行/结果21主体：《视频供应商执行与结果协调迁移验收-20261018.md》。
- 文本/ModelScope 8主体：同上文档；不调用真实模型。
- 更新/备份/重启45主体：同上文档；未对实际安装执行更新。
- 普通/智能上传拖放64主体：《画布上传与拖放职责迁移验收-20261018.md》。
- CLI管理24主体：验收归《模块化续接执行记录-20261018.md》（专项31、后续完整核心覆盖；无单独新验收单）。
- 菜单/素材管理29主体及监听：《菜单与素材管理职责及监听生命周期验收-20261018.md》。
- 普通选择/刀切/拖动12主体：《普通选择刀切与拖动画布职责迁移验收-20261018.md》。
- 普通指针11回调、30处鼠标赋值：《普通指针事件归属与离页清理验收-20261018.md》。
- 普通快捷键4组及延迟粘贴：《普通快捷键与延迟粘贴归属验收-20261018.md》。
- 普通媒体6组事件、picker和上传晚回：《普通媒体输入与上传目标归属验收-20261018.md》。
- 图片尺寸10主体：《后端图片尺寸规则迁移验收-20261018.md》。

## 3．已定决策与理由（承接，不擅自推翻）
- 当前工作目录就是用户要求的最新本地源码，不另建日常源码副本；真实入口迁移与旧主体清理同步进行。
- main保留路由/类型/锁/配置/host装配及薄委托；模块显式接收实时依赖，避免第二套状态或反向导入main。
- 常量、锁保持单点；画布异步目标用ID＋既有打开代次＋控制器生命周期判断，正常自动保存会替换canvas对象。
- 每批专项/主体审计/独立审查；阶段完整核心成功后才补写验收成功结论，不用旧日志覆盖新源码。
- Git提交曾获自主判断权；当前选择公开源码恢复点，避免把历史混合改动一并提交；未提交/推送/发布。
- 已恢复核对的最新完成阶段备份：E下 `checkpoint-image-size-core-verified/`，913项；不覆盖后续RunningHub改动。

## 4．放弃的方案
- 机械按行数搬空三个文件：不能证明职责清晰、入口可用或旧主体已清理。
- 用canvas对象身份拦截晚回：正常保存也换对象，会误取消正常粘贴；已用红/绿测试改为打开代次。
- 一次暂存/提交全部未提交文件、另建日常源码、只靠专项替代完整核心：混入旧任务、增加分叉或证据缺口。
- 复跑旧迁移脚本、顺手修供应商算法/原有业务：可能重复替换或扩大范围；失败迁移脚本也不复跑。

## 5．精确断点：RunningHub未收口，先处理失败验证
- 已接入16主体：新 `backend/runninghub_model_registry_service.py` 10；既有fields追加3、protocol追加2、config_service追加1；main薄委托。
- 实际快照 E下 `rh-registry-before/`；迁移脚本 `migrate-rh-registry-once.py` 已执行，禁止复跑。
- `rh-registry-before-v2.log` / `rh-registry-after.log` 各51项通过；独立审查新增8项通过，无新增实质问题。
- **最新扩大验证退出1**：`rh-registry-expanded.log`，573项、34失败、26错误、跳过2；会话26627已结束，无待收取测试。
- 首错：`tests/test_canvas_assistant_agent.py:63`，`test_automatic_safe_edit_needs_no_grant_but_export_does`，nativeActions为空导致IndexError。
- 已只读确认 `skills/canvas-assistant/project-knowledge/index.json` 中两处main.py来源SHA失效；这是事实，是否解释全部失败尚未确认。
- **下个动作改该index.json的两处来源SHA**：核对后运行 E下 `sync-main-knowledge.py`（元数据工具，不是迁移脚本），先复测上述助手用例，再判断剩余失败。
- 随后才做新完整核心，固定新日志 `E/rh-registry-checkpoint-core.log`；成功前不要写RunningHub验收完成或开始新批次。

## 6．硬约束
- 先读仓库 `AGENTS.md`、《项目长期维护与二次开发路线.md》及总记录；使用adaptive-workflow；保留全部已有改动。
- 用户底线：本地源码永远最新、可运行、可证明；模块化必须100%正确，失败/未验证不得当完成，不以数量宣称完成。
- AGENTS替换流程：全局查调用/测试/文档→迁移真实入口→验证→清被替代主体与专用依赖→再查引用/diff；不顺手删无关旧代码。
- 不读私人配置/API凭据，不import真实仓库main；不收费、不重跑任何已执行迁移脚本，不reset/clean、不丢改动。
- 当前不提交/推送/发布；大规模数据操作、公共接口/认证/架构改变或外部副作用须按授权边界处理。
- DeepSeek Harness可提供讨论材料；不配置其通道，不把它的建议当扩大权限的人工授权。

## 7．最近完整核心（在RunningHub16主体之前，不能冒充当前源码全过）
- 日志：`F:/nadou-ai-源码-20261017-ddf9c27/nadou-ai-source-20261017/nadou-ai-source-20261017/.git/modularization/video-continuation-20261018/image-size-checkpoint-core.log`。
- 退出码0；Python1170 / JS905；北京时间16:48:01开始、16:52:45结束；717个公开源码摘要前后一致；语法/词条/页面引用通过。
- 更早五个输入批次共同收口：`E/input-lifecycle-checkpoint-core.log`，退出0，Python1162 / JS905，16:38:20结束；旧日志保留。
- Python：`C:/Users/Lihai/AppData/Local/Temp/nadou-audit-26efa14234e543e995beea116912eea9/python/python.exe`；`-X utf8 -B tools/check-core.py`仅在公开沙箱导入main。
- 专项用 `E/run-public-patterns.py`；JS用 `node --test tests/*.test.cjs`；仅 `tools/prepare-release.py --preflight`，不打包发布。

## 8．风险、未验证与配额
- RunningHub扩大验证尚失败、当前源码未获新全量；不得断言失败只是索引问题，亦不得以审查8过替代修复验证。
- 交接时diff检查退出2：`backend/runninghub_protocol.py:194` 新增EOF空行待清理；按用户要求未再改产品代码，日志 `E/handoff-diff-check.log`。
- 保留原RunningHub公开chat_models只取fallback规则；真实供应商/登录/更新、私人工作流、付费生成均未验证。
- 物理Shift刀切、跨浏览器/触摸、精确失焦时序未手验；浏览器Ctrl+C/V受虚拟剪贴板限制，生产回归覆盖复制逻辑。
- 普通工作流导入与智能上传晚回、图片编辑器事件、智能视图、运行配置及后端剩余媒体/协议职责仍待审计。
- 额度按用户提供：周已用85%，10-25 04:41重置（北京时间，未另查）；建议每天0.5–1小时、约≤1.5%周额度规划，预留余量，耗额以实测为准。

## 9．可复制的开工指令
先读本交接和AGENTS，保留当前源码；从index.json两处main来源SHA与rh-registry-expanded.log首个助手失败开始，修正并复测后完成RunningHub新全量和验收，再继续剩余职责；不复跑迁移脚本、不读私配、不收费、不提交发布。
