# 创作助手项目知识与完整状态读取实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将两种画布全部现有节点的真实使用规则与完整状态接入当前创作助手，并建立逐节点、逐子功能的验收清单。

**Architecture:** 复用当前 Agent、工具协议和保存/回执流程。增加受控知识目录与节点状态读取工具，模型先查索引、再按需读取知识和当前节点；静态说明不扩大实际操作权限。本文件实施全量设计的第一阶段，后续操作覆盖与复杂任务分别排期，不把第一阶段宣称为全部完成。

**Tech Stack:** 当前 Python/FastAPI、Pydantic、静态 JavaScript、Markdown/JSON；不安装新框架、数据库或模型。

**Spec:** `docs/superpowers/specs/2026-10-09-creative-assistant-project-knowledge-design.md`

## Global Constraints

- 用户 2026-10-09 确认“开始”，批准设计方向；按项目现有节点逐类验收，暂不指定创作类型。
- 工作在 `D:\daxiong` 的现有助手真实入口。保留已有 Agent 和其它未确认改动，不新建独立产品副本。
- 文本模型与图片模型由用户手选；本阶段不调用真实收费模型，不自动提交生成任务。
- 沿用普通/智能画布现有界面；本阶段新增读取工具，不增加产品界面控件，因此不需要界面重设计。
- 知识可覆盖全部功能，但只开放已接入处理器的操作；删除用户数据、服务商配置修改、发布不因知识增加而获得授权。
- 任务与验收状态分别记录“说明已核对、读取已接入、操作已接入、验证已完成”，禁止用一个 completed 概括全链路。
- 不提交或推送本阶段，直到用户确认功能可用；不把其它任务的剪辑、CLI、透明背景、画布布局等改动纳入本功能提交。

## Review Focus

1. 分组操作产生的 promptGroup、导入旧类型和智能多引擎节点必须被知识索引覆盖；不能只扫描创建菜单。Task 1 固定案例。
2. 超过 100 节点、1800 字正文或多结果数组时必须显示分页/截断并可补读，不能将一页误报为全画布。Task 3 固定案例。
3. 工作流嵌套配置可能含凭据或任意服务字段，白名单读取不能泄露 token、api_key、authorization 和本机路径。Task 3 固定案例。
4. 相关源码或知识版本变化时必须标记待复核，旧回合不能静默改用新的知识正文；缺失知识不能破坏原有基础聊天。Task 2、4 固定案例。
5. 两种画布同名概念可能行为不同，尤其 smart-loop、分组顺序与输入角色；静态说明和实际工具权限必须分别返回。Task 1、4、5 固定案例。

## 全量目标的分期与完成边界

| 阶段 | 可交付结果 | 完成依据 |
| --- | --- | --- |
| A：本计划 | 全量节点/子功能知识、版本、按需读取、丰富状态和验收清单接入当前模型请求 | Task 1～6；知识内容、真实请求和只读界面验证 |
| B：节点操作覆盖 | 按 A 的清单逐类补齐字段修改、连接、原生动作、执行预检与确认、原任务查询 | 每类节点独立操作计划和回归；复用原生执行接口 |
| C：复杂任务与质量检查 | 持久阶段计划、依赖执行、预算、断点恢复、创作规则和作品核验 | 组合案例、失败/中断恢复、实际作品要求对照 |
| D：真实模型验收 | 配置模型后逐类验证效果，报告范围与未验证项 | 用户明确批准具体服务、任务和额度后执行 |

B 依赖 A 的节点字段与能力合同；C 依赖 B 的实际操作处理器。尚未建立的 B/C 接口不在本计划里先搭空壳。A 完成后据真实核对结果编写下一份计划，继续原目标。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `skills/canvas-assistant/project-knowledge/index.json` | 运行时知识条目、原生类型映射、字段说明、来源和状态；不是第四个用户 Skill |
| `skills/canvas-assistant/project-knowledge/project.md` | 两画布/素材/模型/工作流/任务/保存导出之间的数据流说明 |
| `skills/canvas-assistant/project-knowledge/nodes/*.md` | 21 类当前节点说明；旧类型映射与交互产生类型独立记录 |
| `skills/canvas-assistant/project-knowledge/creation.md` | 现有三个 Skill 的使用方法、节点组合、视觉核验范围；拓展技巧按后续阶段验收 |
| `docs/创作助手项目知识/README.md` | 人可读的覆盖清单、维护方法和能力边界，链接真实运行时文件，不复制正文 |
| `docs/创作助手项目知识/验收清单.json` | 节点到子功能的验收记录，精确区分自动、真实 UI 和供应商效果 |
| `backend/canvas_assistant_knowledge.py` | 知识加载、白名单读取、快照/版本与源变化状态 |
| `backend/canvas_assistant_state.py` | 节点字段白名单、正文/数组分页、相关连接与任务概要 |
| `backend/canvas_assistant_tools.py` | 注册 read_project_knowledge 与 read_node_state；扩展 ReadCanvas 分页参数 |
| `backend/canvas_assistant_agent.py` | 索引/快照进入 Agent，提醒查知识与实际状态；不扩大预算或权限 |
| `backend/canvas_assistant.py` | 真实工具执行和只读路由，初始上下文的数量/截断信息 |
| `tests/test_canvas_assistant_knowledge.py` | 知识正确性、来源、映射、版本与目录边界 |
| `tests/test_canvas_assistant_state.py` | 状态字段、分页、脱敏、未知类型与当前画布范围 |
| `tests/test_canvas_assistant_agent.py` | 实际工具读取进入后续模型请求和续行的一体回归 |
| `PROJECT_STATE.md`、设计/方案 | 更新当前进度与真实验证结果，不覆盖旧交接证据 |

## Task 1：按真实节点/子功能盘点并固定能力合同

**Files:** 创建上述知识 index、project、creation、21 张节点卡片、README 和验收清单；创建 `tests/test_canvas_assistant_knowledge.py`。

**Interfaces:** index.json version=1；entries 中每项字段为 id、kind、nativeType、name、summary、file、sections、sources、parameters、inputs、outputs、features、coverage。kind 为 project/classic/smart；id 使用 project.*、classic.*、smart.*。sources 每项包含 path、symbol、evidence；parameters 每项包含 field、type、default、limits、source；动态默认/范围注明 runtime 并指向真实规则，不臆造固定值。

features 的每项使用稳定 id，并包含 label、effect（display/configure/execute/media/export）、preconditions、source 和 verification。coverage 四个状态为 documented/readable/actionable/verified，分别记录状态与证据；本阶段未开放的动作不能标 actionable。

验收清单使用相同功能 id，分别记录 explanation、read、operation、automatedCheck、uiCheck、supplierCheck；检查结果为 pending/passed/failed/not_applicable，not_applicable 必须附理由。

- [x] **Step 1：写失败测试。** `test_current_node_families_are_indexed` 固定 classic 的 image、prompt、promptGroup、loop、group、llm、generator、midjourney、msgen、video、minimax、rh、comfy、ltxDirector、clip、output 及 smart 的 image、prompt、loop、group、minimax 共 21 项；`test_legacy_and_operation_created_types_are_explicit` 固定 promptGroup、smart-container 和缺失 smart-image type 的兼容说明。
- [x] **Step 2：运行** `.\python\python.exe -m unittest tests.test_canvas_assistant_knowledge -v`；确认缺少 index 的失败，而不是 Python 环境失败。
- [x] **Step 3：逐类读创建、渲染、参数变更、输入解析、执行、回填和导入导出源码。** 以 `createNodeByType`、`add*Node`、`create*Node`、`run*Node` 为起点，逐个记录按钮/参数，不把创建函数当完整实现。
- [x] **Step 4：写 21 张卡片与项目地图。** 节点正文必须包含 sections：overview、controls、parameters、inputs_outputs、connections、execution、results、errors_recovery、persistence、examples、limitations；controls 中区分实际执行、仅展示、参数修改、复制/导出/重置，不遗漏预设与提示词替换。
- [x] **Step 5：增加规则准确性案例。** `test_smart_loop_is_not_always_the_generation_target` 区分输入/循环控制与最终执行；`test_dynamic_workflows_do_not_claim_fixed_parameters` 对 ComfyUI/RunningHub 的当前 schema 标记动态；`test_every_feature_has_source_and_verification_row` 比对 id 唯一、来源存在和每个子功能验收行。
- [x] **Step 6：运行同一专项，检查每张卡片正文与源函数。** 新源码中的 clip 已有别的任务在修改，记录核对时版本；发现源变化则待复核，不改动剪辑实现。只能在核对后标 documented。

## Task 2：受控知识读取、快照与版本检查

**Files:** 创建 `backend/canvas_assistant_knowledge.py`；扩展 `tests/test_canvas_assistant_knowledge.py`。

**Interfaces:** `ProjectKnowledge(root: Path | None = None)` 默认使用 Task 1 的 runtime 目录；`snapshot() -> dict` 返回 version、entries、documents 和 sourceStatus；`index(snapshot: dict, kind: str, native_types: list[str] | None = None) -> list[dict]` 返回简短目录；`read(snapshot: dict, capability_id: str, section: str = "overview") -> dict` 返回 id、section、content、version、sourceStatus、coverage。

sourceStatus 为 current/stale/unavailable。索引保存本次核对的来源摘要；文件摘要变化只表明需要复核，不表明哪条规则必然错误。知识版本按文件内容生成，相关源码状态和知识版本分开保存。

- [x] **Step 1：写失败测试。** `test_read_only_catalogued_section` 读取 classic.loop 的 parameters；`test_path_and_uncatalogued_section_are_rejected` 拒绝 `../`、绝对路径、任意文件和未登记 section；`test_active_snapshot_does_not_change_with_files` 对读取中被改动文件保持原正文；`test_source_drift_marks_stale` 修改临时来源文件后返回 stale。
- [x] **Step 2：运行知识专项，确认新增组件缺失导致失败。** 测试用临时公开样例，不更改项目真实源码来制造 drift。
- [x] **Step 3：实现以上接口。** 路径 resolve 后限制到知识根目录，不允许 symlink 越界；索引 entry 和文件内容先校验再提供。单张卡片最大 64 KiB，单节最大 24 KiB；超过上限报具体错误，不能静默截断。调用者只接受 id/section，不接受文件路径。
- [x] **Step 4：补异常案例。** `test_missing_catalog_is_reported_without_losing_base_chat`、`test_symlink_outside_root_rejected`、`test_duplicate_id_or_invalid_source_is_reported`。sourceStatus unavailable 与知识文件缺失分开处理。
- [x] **Step 5：运行知识专项；核对只输出公开说明与来源状态，无文件执行和配置秘密。** docs 的 README 只链接 runtime 正文，避免两份知识逐渐不一致。

## Task 3：完整节点状态与可补读分页

**Files:** 创建 `backend/canvas_assistant_state.py`、`tests/test_canvas_assistant_state.py`；修改 `backend/canvas_assistant.py` 的 canvas_context；扩展现有引用测试。

**Interfaces:** `read_node_state(canvas: dict, node_id: str, *, text_offset: int = 0, text_limit: int = 12000, item_offset: int = 0, item_limit: int = 30) -> dict`；返回 nodeId/type/kind/updatedAt、identity、parameters、content、membership、connections、runtime、results 和 pagination。正文分页上限 24000 字符，数组单页上限 100；字段分别返回 total/offset/returned/nextOffset，读结果不修改 canvas。

`canvas_overview(canvas: dict, *, node_ids: list[str] | None = None, offset: int = 0, limit: int = 50) -> dict` 返回节点摘要与 page；limit 1～100，超出范围 422。初始 canvas_context 保留原 nodes/assets/selectedNodeIds 等契约，增加 counts、truncation 和可补读提示；不增加默认媒体发送数量。

- [x] **Step 1：写失败测试。** `test_long_text_can_be_read_in_pages` 用 30001 字正文拼接分页后等于原文；`test_large_canvas_reports_total_and_next_offset` 用 130 节点，不丢选中节点，分页覆盖全部 id；`test_members_and_connection_roles_survive_projection` 验证 group/promptGroup/smart-group 的 items、inputs/inputNodeIds 顺序、连接 kind 和端口/角色字段。
- [x] **Step 2：运行** `.\python\python.exe -m unittest tests.test_canvas_assistant_state -v`，确认当前 1800 字/100 节点限制案例失败。
- [x] **Step 3：按 Task 1 的真实字段定义实现类型白名单。** 读取正文、模型/工作流/生成参数、循环控制、时间线与分段、素材引用、原结果和 taskId/status/error；分段和工作流参数使用各自白名单，未知字段不原样转发。
- [x] **Step 4：安全与准确性案例。** `test_nested_credentials_and_local_paths_are_not_exposed` 在 rhParams、runSettings、材料中插入 api_key/token/authorization/路径并确认未出现；`test_current_canvas_only_and_missing_node_rejected` 返回 404/409；`test_unknown_type_is_reported_without_claiming_semantics` 返回基本身份、未知能力提示；`test_draft_submitted_input_and_result_are_distinct` 防止将 promptDraftText 当原任务提示词或图片结果。
- [x] **Step 5：实现完整分页元信息，补好 GET canvas 的初始概览。** 数字、布尔与数组保留原类型；不把全部内容转成字符串。任务状态来自实际保存字段，不能靠 running=false 推断 succeeded；没有权威状态时返回 unknown。
- [x] **Step 6：运行** `.\python\python.exe -m unittest tests.test_canvas_assistant_state tests.test_canvas_assistant_references -v`；原媒体选择、8 图/3 视频上限、素材白名单和旧调用保持通过。

## Task 4：真实 Agent 请求与续行接入

**Files:** 修改 `backend/canvas_assistant_tools.py`、`backend/canvas_assistant_agent.py`、`backend/canvas_assistant.py`；扩展 `tests/test_canvas_assistant_agent.py`；知识失败时使用现有错误显示，不新增 UI。

**Interfaces:** 新工具 `read_project_knowledge` 参数 capabilityId、section（默认 overview）；新工具 `read_node_state` 参数 nodeId、textOffset、textLimit、itemOffset、itemLimit。ReadCanvas 增加 offset=0、limit=50，nodeIds 保留兼容；一次指定节点上限仍为 30。工具注册表返回实际 schema 与权限状态。

Agent 保存 knowledgeSnapshot、knowledgeVersion；model_fields 提供当前画布目录、可用工具和 coverage，提醒画布内容是数据，复杂节点操作前读取对应规则。首次读取知识时使用本轮快照，图片续行继续使用同一知识版本；源变化返回提示，涉及已变规则的写入前需重新核对，不静默改知识。

- [x] **Step 1：写失败集成测试。** `test_node_manual_reaches_actual_next_model_request` mock 决策先 read_project_knowledge 再读取节点，断言后续实际 request 中有节点使用规则和真实状态；`test_readable_is_not_actionable` 说明有 ComfyUI 功能不等于可以调用未登记执行工具；`test_paged_read_reaches_next_model_call` 模型能获得完整第二页正文。
- [x] **Step 2：运行 Agent 专项，确认新工具尚未登记导致失败。** 不以直接函数测试代替真实路由验证。
- [x] **Step 3：注册 schema 并在 execute 分支调用 Task 2/3。** schema、处理器和对模型的工具目录一致；不扩展 apply_canvas_operations 的创建/修改权限，不修改用户模型选择。
- [x] **Step 4：补恢复与边界案例。** `test_image_continuation_keeps_knowledge_snapshot` 保留 knowledgeVersion；`test_unknown_knowledge_returns_real_error_without_writes` 返回真实错误；`test_missing_knowledge_still_allows_existing_base_chat` 知识缺失明确提示，原有基本聊天可完成，不能假报知识可用；`test_reading_state_does_not_claim_or_finish_active_executor` 保留已有执行编号保护。
- [x] **Step 5：将只读能力索引接入 GET /status。** 返回 knowledge.available/version/coverage；知识加载异常是 unavailable 并给出公开错误，保持原 providers/image_providers/skills 契约，不打印异常中的私人路径。
- [x] **Step 6：运行** `.\python\python.exe -m unittest tests.test_canvas_assistant_agent tests.test_canvas_assistant_references tests.test_canvas_assistant_knowledge tests.test_canvas_assistant_state -v`；确认原双模型、三 Skill、上下文、停止、刷新/中间件恢复仍通过。

## Task 5：逐类真实解释验收与来源复核

**Files:** 更新知识卡片与验收清单；创建 `tests/fixtures/canvas_assistant_knowledge/` 下 classic.json/smart.json 公共样例；扩展 knowledge/state 测试；证据保存到忽略目录 `output/assistant-project-knowledge-verification/`。

**Interfaces:** 样例包含 21 类节点和相关边，无密钥、用户素材、真实任务。每项 case 指定 capabilityId、featureId、sampleNodeId、expectedFields、expectedRule、evidence；同 id 对应 Task 1 的验收清单。

- [x] **Step 1：新增对照测试。** `test_every_current_node_family_has_a_real_state_case` 覆盖21类；`test_group_and_loop_input_order_matches_native_rules` 使用公开样例对照当前解析逻辑；`test_workflow_parameters_preserve_schema_types` 布尔/数字/选择/媒体类型保留，不把动态参数全当文本。
- [x] **Step 2：在隔离数据服务里，用浏览器逐类核对实际节点按钮和字段。** 服务不改变正式画布和素材；需要外部服务的执行按钮只核对条件、请求构造和模拟状态，不调用真实供应商。截取实际页面，记录普通/智能类型差异。
- [x] **Step 3：仅模型边界模拟真实 Agent 使用知识/状态。** 保存真实请求字段、工具步骤、节点 id、知识版本、未执行生成证明；模拟不能证明模型实际理解能力，标为接入链路验收。
- [x] **Step 4：复核源漂移。** 盘点期间已发生变化的来源逐项重读更新证据；未处理变化保持 stale/pending，不凑成“全部通过”。
- [x] **Step 5：填写验收清单。** documented/readable 可在证据充分时完成；新增动作、复杂任务、供应商效果保留 pending。既有基础动作的 actionable 可引用已有测试但注明范围，不用旧截图证明新功能。

## Task 6：核心回归、原入口交付与清理

**Files:** `PROJECT_STATE.md`、本计划、设计和项目知识 README；必要时修改 tools/check-core.py，仅在运行时目录未被现有 skills 沙箱复制覆盖时调整。

- [ ] **Step 1：运行** `.\python\python.exe tools/check-core.py`，期望退出 0 且报告实际 Python/JS 项数，不预填数量。当前 sandbox 已复制 skills，因此新知识应自然可用；若实际失败再做最小修复。
- [x] **Step 2：运行** `.\python\python.exe tools/check-data-formats.py --root D:\daxiong` 和 `git diff --check`；保持用户画布未修改、数据格式通过。
- [ ] **Step 3：确认真实入口加载新模块，检查 /status、/canvas、助手发送请求及两画布页面。** 若正式服务重启被自动审批拒绝，记录旧/新进程状态并请用户重启，不通过替代终止命令绕过。
- [x] **Step 4：清理被完全替代的截断说明和重复上下文映射。** 新完整读取经过验证前不删除旧基本读取；兼容字段保留，原有调用方/测试逐项搜索。没有被替代的原生节点实现不删除。
- [x] **Step 5：只读审查最终差异，核对无秘密/用户数据/其它任务覆盖。** 用户确认可用前不提交、不上传。
- [x] **Step 6：交付阶段 A 的实际证据和剩余阶段 B/C/D。** 报告哪些节点知识已核对、哪些只读已可用、哪些动作尚未接入及真实模型未验证；后续计划使用本次确认的整体目标，不重复询问是否继续这一目标。

## 计划自查与当前执行状态

- 对照设计：知识地图、版本、全量状态和逐类清单由 Task 1～5 覆盖；不把后续 B/C/D 已授权目标缩减为 A，只按依赖分阶段实施。
- 覆盖 review focus：非菜单节点（Task 1）、分页（Task 3）、嵌套凭据（Task 3）、源/知识版本（Task 2/4）、两画布语义和权限（Task 1/4/5）。
- 接口一致：knowledge id 与 feature id 全程稳定；源状态和知识版本分开；readable 与 actionable 分开。
- 阶段 A Task 1～5 已完成本地实现和规定范围的接入验证；Task 6 已完成相关回归/清理，正式重启受自动审批阻断，整库前端受另一个任务的未完成测试影响。不能宣称正式入口已加载最终版本或整库回归全绿。
- 执行方式：原目录 Native；用户已批准并明确开始实施，随后要求 A 收拢后重启并自动新建接续对话。沿用现有授权，不重新询问设计/实施许可。

## 2026-10-09 最终实施与交付记录

- 盘点时21类节点（普通16/智能5）加项目数据流/创作说明共23条知识、239章节、423子功能行。Markdown单源、来源基线、旧回合快照、源变化写保护、缺知识基本聊天降级已接入真实Agent工具。
- 完整状态读取已核对分页/嵌套引用、LLM历史、动态工作流/随机字段、原提交和草稿、真实结果/run元信息、智能视频查询状态及凭据脱敏。旧无界分段投影已删除，基础上下文保留兼容摘要和补读提示。
- 最终相关专项75项（final-targeted-75.log）；知识/状态36项；原生JavaScript规则5项；21类真实路由模拟验收84次文本请求、0个生成、画布未修改。两画布最终真实页面读取后统计92次请求/23回合/0生成；默认节点DOM与截图及239章节回读已有证据。
- 本轮完整Python回归643项通过（core-final-5.log）。整批JavaScript313项中309通过、4失败，全部是另一个对话正在修复的视频拆解测试；整库核心退出非0，不伪称全部通过。180秒核心轮曾超时，最后使用同一核心检查仅放宽子进程等待到360秒，未删除测试或关闭检查。
- 数据格式检查通过（canvas v1:8/history v0:1/projects v0:1）、差异检查通过。FFmpeg/FFprobe Gyan9.0.2已安装可用。
- 独立最终审查无助手阻断问题。运行期间其它任务新增shot-table镜头表：当前明确unknown、待接续补核，不算21类已验收；groupMode=workflow变化已补说明、字段和回归。
- 自动审批拒绝正式3000停止/重启，仅给出blocked by policy。PID24128仍是旧进程，/status知识available=false、3Skill/双模型列表正常；未绕过。用户须关闭原运行窗口并运行run.bat加载，接续对话可先在隔离服务执行B计划。
- 后续B节点操作、C持久复杂任务/质量核验、D真实模型效果未完成。现有三Skill与双模型/图片回读已有上一阶段隔离证据，但不等于真实供应商作品质量验收。未提交或上传助手功能。
- 用户授权自动交接，来源PROJECT_STATE.md中新编号PH-20261009-creative-assistant-knowledge-02；最终进度以该交接区为准。原计划Task6正式入口检查和整库成功仍留未完成，交付不隐去这些限制。
