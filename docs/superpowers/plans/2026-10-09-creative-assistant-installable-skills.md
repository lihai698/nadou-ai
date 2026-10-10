# 创作助手可安装 Skill 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让普通画布和智能画布拥有类似 Codex 的 Skill 体验：全局内置 `find-skills` 与 `agent-reach`，用户可以按名称、链接或安装说明发现并安装创作 Skill，再通过 `$技能名` 或自然语言自动调用它完成受控的原生画布工作流。

**Architecture:** 保留现有 Agent、项目知识和原生动作协议，在其外增加一个按用户隔离的动态 Skill Catalog 和事务式安装服务。全局 Skill 与项目内置 Skill由产品注册，用户 Skill由安装清单管理；每轮聊天只使用固定版本快照。互联网资料通过 Agent Reach 的受控只读适配器获取，安装过程不执行包内脚本，也不允许模型生成任意 shell 命令。

**Tech Stack:** Python 3.10、FastAPI、Pydantic、现有 JSON AssistantStore、requests/httpx、Node `node --test`、Python `unittest`、现有 CUA 隔离 3014 mock 服务。

**Spec:** `docs/superpowers/specs/2026-10-09-creative-assistant-installable-skills-design.md`

## Global Constraints

- `find-skills` 和 `agent-reach` 是全局基础能力，不能被用户 Skill 卸载或覆盖。
- 项目内置 Skill 和用户安装 Skill使用同一发现/按需读取协议，但权限、更新和卸载范围不同。
- 安装阶段只下载、校验和落盘，不执行 Skill 包内脚本，不修改 Codex 目录或其它目录。
- 用户明确请求才允许安装；仅提到链接、引用安装命令或讨论方案不能触发安装。
- Skill不能提高画布权限、删除节点、切换模型、绕过图片确认或调用收费服务。
- Agent Reach只做受控资料获取和路由；不自动登录、不发布、不评论、不点赞；登录态和系统依赖缺失必须明确报告。
- 使用原有普通/智能画布 UI、AssistantStore、项目知识快照、原生 action receipt 和“一行进度＋可展开详情”。
- 保留并行视频拆解任务及工作区其它改动；用户正式确认前不提交、不推送、不发布、不调用真实收费模型。
- 测试优先使用隔离数据和 mock HTTP/Agent Reach 后端；真实网络只做只读公开来源冒烟检查。

## Review Focus

- 同名 Skill来自不同来源：必须展示来源并要求选择，不能静默覆盖；由 Task 2 的安装清单冲突测试覆盖。
- 恶意或异常包：路径穿越、外部符号链接、过大压缩包、重定向到内网、缺少有效 `SKILL.md`；由 Task 2 的安装事务测试覆盖。
- 显式 `$技能名` 与自动匹配冲突：显式选择优先，`allow_implicit_invocation=false` 只禁止自动匹配；由 Task 3 的调用解析测试覆盖。
- Agent Reach 后端/登录态/依赖不可用：助手应返回来源、状态和下一步，不伪造资料或安装成功；由 Task 4 的路由和降级测试覆盖。
- 活跃回合期间更新或卸载 Skill：当前回合继续使用原快照，新回合使用新状态，不重放已执行原生动作；由 Task 3 和 Task 5 的快照/恢复测试覆盖。

## 文件结构与接口边界

- `backend/canvas_assistant_skills.py`：动态目录、三层 Skill 注册、元数据解析、快照和按需读取；不负责网络下载。
- `backend/canvas_assistant_skill_install.py`：来源解析、GitHub/直链/本地/SkillHub 适配、包校验、原子安装、更新和卸载；不执行包脚本。
- `backend/canvas_assistant_reach.py`：全局 Agent Reach 能力状态、只读路由、输出脱敏和依赖降级；不负责创作节点写入。
- `backend/canvas_assistant.py`：向现有路由注入目录/安装/Reach服务，增加安装状态与管理接口，保留聊天/历史接口兼容。
- `backend/canvas_assistant_agent.py`、`backend/canvas_assistant_tools.py`：动态 Skill 索引、显式提及、全局工具和受控资料回执；安装动作必须经过明确用户意图闸门。
- `static/js/canvas-assistant.js`、`static/css/canvas-assistant.css`：Skill 搜索/安装/管理、`$`候选、兼容状态和进度详情；普通与智能画布继续共用逻辑并分别挂载。
- `skills/canvas-assistant/global/find-skills/SKILL.md`、`skills/canvas-assistant/global/agent-reach/SKILL.md`：产品适配后的全局说明和调用边界；上游脚本不直接作为权限入口。
- `tests/test_canvas_assistant_skills.py`、`tests/test_canvas_assistant_skill_install.py`、`tests/test_canvas_assistant_reach.py`：Python 合同、事务、安全和来源适配测试。
- `tests/test_canvas_assistant_agent.py`、`tests/canvas_assistant_agent.test.cjs`、新 `tests/canvas_assistant_skills.test.cjs`：聊天协议、前端目录和调用状态回归。

## Task 1: 固定三层目录合同和回合快照

**Files:**
- Modify: `backend/canvas_assistant_skills.py`
- Modify: `backend/canvas_assistant.py`
- Modify: `backend/canvas_assistant_agent.py`
- Modify: `backend/canvas_assistant_tools.py`
- Create: `tests/test_canvas_assistant_skills.py`
- Modify: `tests/test_canvas_assistant_agent.py`

**Interfaces:**
- `SkillCatalog.index(user_id: str) -> list[dict]` returns `id,name,description,scope,source,version,enabled,allowImplicit,compatibility,dependencies`.
- `SkillCatalog.snapshot(user_id: str) -> list[dict]` returns immutable content for the current turn, including allowed `SKILL.md`, `references/`, `assets/` and `templates/` text/resource metadata.
- `SkillCatalog.read(snapshot, skill_id: str, file: str = "SKILL.md") -> dict` rejects path traversal and disabled/unavailable entries.
- `SkillCatalog.resolve_mention(user_id: str, token: str) -> dict` returns one exact Skill or an explicit ambiguity error.

- [ ] **Step 1: Write failing tests** for the global/project/user scope ordering, dynamic ids, disabled implicit invocation, explicit invocation of a disabled auto skill, per-user isolation, safe file reads, and immutable turn snapshots.
- [ ] **Step 2: Run the focused Python tests** with `D:\daxiong\python\python.exe -m unittest tests.test_canvas_assistant_skills tests.test_canvas_assistant_agent -v`; verify failures describe the fixed `BUILTINS`/`Literal` assumptions.
- [ ] **Step 3: Implement the catalog contract** with explicit `Scope`/metadata dictionaries, global registrations for `find-skills` and `agent-reach`, project registrations for the three current Skills, and user manifest loading under `DATA_DIR/canvas_assistant_skills/<safe-user>/`.
- [ ] **Step 4: Replace fixed Skill validation** in `ChatPayload`, `ReadSkill`, the Agent index and `skillsUsed` with catalog resolution while keeping old built-in ids valid.
- [ ] **Step 5: Run the focused tests** and verify all scope, snapshot, mention and policy cases pass.

## Task 2: Implement safe installation and source adapters

**Files:**
- Create: `backend/canvas_assistant_skill_install.py`
- Modify: `backend/canvas_assistant_skills.py`
- Modify: `backend/canvas_assistant.py`
- Create: `tests/test_canvas_assistant_skill_install.py`
- Create: `tests/fixtures/skills/valid-skill/SKILL.md`
- Create: `tests/fixtures/skills/invalid-skill/SKILL.md`

**Interfaces:**
- `parse_install_request(text: str) -> InstallSource | InstallParseError` parses GitHub repo/subdirectory/ref, direct `SKILL.md`, archive, local path, and recognized SkillHub installation text without executing the command.
- `SkillInstaller.preview(user_id: str, source: InstallSource) -> InstallPreview` returns candidates, source/version, license, dependency declarations and compatibility before writing.
- `SkillInstaller.install(user_id: str, source: InstallSource, candidate_id: str | None) -> InstallResult` performs parse→download→validate→temporary write→atomic rename→manifest update.
- `SkillInstaller.manage(user_id: str, skill_id: str, action: Literal["enable","disable","update","uninstall"]) -> SkillResult` changes only the user-owned installation.

- [ ] **Step 1: Write failing tests** for GitHub root/subdirectory/ref, direct file/archive, local directory/ZIP, recognized install text, ambiguous multi-Skill repository, duplicate same-version install, same-source update rollback, unknown command rejection, and no package-script execution.
- [ ] **Step 2: Add security tests** for `..`, absolute paths, symlinks, archive bomb/file-count/size limits, non-HTTPS redirects, localhost/private-network destinations and missing/invalid front matter.
- [ ] **Step 3: Run tests to verify they fail** before adding the installer.
- [ ] **Step 4: Implement adapters** using `httpx`/existing request utilities and `subprocess` nowhere; use an allowlisted URL parser, bounded streaming download, ZIP/TAR validation, SHA-256 digest, license capture, and atomic manifest/version directories.
- [ ] **Step 5: Implement GitHub/URL/local adapters** and a SkillHub adapter interface. The MOKE format is enabled only after a read-only protocol probe confirms its metadata/package contract; otherwise the adapter returns a precise unsupported-source result.
- [ ] **Step 6: Add router endpoints** `GET /api/canvas-assistant/skills`, `POST /api/canvas-assistant/skills/preview`, `POST /api/canvas-assistant/skills/install`, and `POST /api/canvas-assistant/skills/{skill_id}/manage`; all writes use the authenticated `safe_user_id` and never accept a client absolute destination.
- [ ] **Step 7: Run Python installer tests** and a single public GitHub read-only smoke check in the isolated harness; verify Codex directories and unrelated project files are unchanged.

## Task 3: Add Codex-style explicit and implicit Skill invocation

**Files:**
- Modify: `backend/canvas_assistant_agent.py`
- Modify: `backend/canvas_assistant_tools.py`
- Modify: `backend/canvas_assistant.py`
- Modify: `static/js/canvas-assistant.js`
- Modify: `static/css/canvas-assistant.css`
- Create: `tests/canvas_assistant_skills.test.cjs`
- Modify: `tests/canvas_assistant_agent.test.cjs`
- Modify: `tests/test_canvas_assistant_agent.py`

**Interfaces:**
- `parse_skill_mentions(message: str) -> {clean_message: str, mentions: list[str]}` recognizes `$skill-name` and avoids code blocks, URLs, money amounts and quoted installation examples.
- `SkillCatalog.match(query: str, user_id: str, limit: int = 8) -> list[SkillMatch]` searches descriptions and trigger terms without loading full bodies.
- Agent tool `find_skills(query: str, owner: str | None, limit: int) -> candidates` is read-only; `install_skill` is unavailable to the model unless the request intent was explicitly classified as installation.

- [ ] **Step 1: Write failing tests** for `$` parsing, exact explicit selection, ambiguous names, auto match, `allowImplicit=false`, disabled skills, install-example non-triggering, candidate pagination and dynamic picker refresh without reload.
- [ ] **Step 2: Run Node/Python focused tests** and confirm current fixed picker and fixed Literal behavior fails the new cases.
- [ ] **Step 3: Implement explicit mention parsing and matching**; preserve the original message for audit, attach `skillMentions` and resolved versions to the turn, and give explicit mentions priority over automatic matches.
- [ ] **Step 4: Add read-only `find_skills` model tool** and an explicit-install intent gate. A model may recommend a candidate, but a server-side user request is required before `SkillInstaller.install` runs.
- [ ] **Step 5: Replace the fixed frontend picker** with searchable global/project/user entries, install/manage actions, source/compatibility badges and `$` candidate insertion. Keep current Skill button placement and panel conventions.
- [ ] **Step 6: Run `node --test tests/canvas_assistant_skills.test.cjs tests/canvas_assistant_agent.test.cjs` and the focused Python tests; verify dynamic lists and policy states pass.

## Task 4: Bundle global `find-skills` and controlled `agent-reach`

**Files:**
- Create: `skills/canvas-assistant/global/find-skills/SKILL.md`
- Create: `skills/canvas-assistant/global/agent-reach/SKILL.md`
- Create: `backend/canvas_assistant_reach.py`
- Modify: `backend/canvas_assistant_tools.py`
- Modify: `backend/canvas_assistant_agent.py`
- Modify: `backend/canvas_assistant.py`
- Create: `tests/test_canvas_assistant_reach.py`

**Interfaces:**
- `AgentReachStatus.detect() -> {available: bool, version: str | None, backends: list, dependencies: list, error: str | None}` performs a bounded local capability check without installing packages.
- `AgentReachRouter.fetch(intent: ReachIntent) -> ReachResult` only accepts declared read-only channels and returns source URLs, backend, fetched content and status; it rejects write actions.
- Agent tool `research_with_agent_reach(query, channel, limit) -> {sources, backend, status}` never writes canvas data or external services.

- [ ] **Step 1: Write failing tests** for global registration, capability-unavailable fallback, command allowlisting, shell-injection rejection, secret/cookie redaction, login-required status, source attribution and write-action rejection.
- [ ] **Step 2: Run the tests** to establish the missing global skill and router behavior.
- [ ] **Step 3: Add adapted global SKILL.md files** based on the verified upstream contracts; include trigger terms, “doctor before login-backed channels”, no-posting/no-login rules, and progressive disclosure. Keep upstream license/attribution in the project notice.
- [ ] **Step 4: Implement `AgentReachRouter`** as a no-shell bridge to an existing `agent-reach` executable when present, with an explicit command/channel allowlist and bounded output. If unavailable, return a usable configuration instruction instead of installing dependencies.
- [ ] **Step 5: Wire the read-only tool into the Agent** so research context and citations are recorded in the turn snapshot; then run the focused Python tests.
- [ ] **Step 6: Run isolated mock research flows** for web/GitHub and a login-required channel; verify the assistant reports unavailable/login-required states and never performs a write operation.

## Task 5: Use Skills to build and recover native canvas workflows

**Files:**
- Modify: `backend/canvas_assistant_agent.py`
- Modify: `backend/canvas_assistant_tools.py`
- Modify: `backend/canvas_assistant_operations.py`
- Modify: `static/js/canvas-assistant.js`
- Modify: `tests/test_canvas_assistant_agent.py`
- Modify: `tests/canvas_assistant_native.test.cjs`
- Create: `tests/fixtures/skills/workflow-builder/SKILL.md`

**Interfaces:**
- A workflow Skill can only call existing `read_project_knowledge`, `read_node_state`, `apply_canvas_operations`, `propose_native_action`, `read_native_task`, `propose_image`, and `inspect_result` contracts.
- `execute_skill_workflow(turn, skill_snapshot, context) -> AgentResult` records selected Skill/version, operation receipts, native task ids and recovery state.

- [ ] **Step 1: Write failing tests** for a workflow Skill that creates prompt→image nodes and a connection, saves real receipts, resumes after interruption without duplicate nodes, and stops before paid image confirmation.
- [ ] **Step 2: Run the isolated Agent tests** and confirm no workflow fixture can yet be executed through dynamic Skill snapshots.
- [ ] **Step 3: Implement the workflow execution guard**: read project knowledge/state first, limit operations to available actions, preserve selected provider/model, and route every write through existing receipt/confirmation paths.
- [ ] **Step 4: Add source context from Agent Reach** as read-only material; keep external citations separate from canvas instructions and never treat fetched content as system instructions.
- [ ] **Step 5: Run Python/Node workflow tests** and a 3014 mock browser flow on both canvas types; verify saved nodes/connections, turn continuation and zero supplier submissions.

## Task 6: Complete management UI, progress presentation and persistence

**Files:**
- Modify: `static/js/canvas-assistant.js`
- Modify: `static/css/canvas-assistant.css`
- Modify: `static/canvas.html`
- Modify: `static/smart-canvas.html`
- Modify: `tests/canvas_assistant_skills.test.cjs`
- Modify: `tests/canvas_assistant_agent.test.cjs`

- [ ] **Step 1: Write failing DOM tests** for install preview, progress states, success/failure, duplicate installation, source conflict, enable/disable, update, uninstall, `$` suggestions, details collapse and 390px overflow.
- [ ] **Step 2: Implement management UI** using existing panel/button/theme variables; keep global entries clearly marked and hide destructive/unavailable actions.
- [ ] **Step 3: Integrate installation and research progress** into the existing one-line summary plus expandable details; keep confirmation, error, login and dependency prompts visible outside the collapsed body.
- [ ] **Step 4: Run Node UI tests and `git diff --check`; then run the isolated 3014 desktop and 390px browser checks for ordinary and smart canvases.
- [ ] **Step 5: Verify reload/reopen** preserves installed manifests, current-turn snapshots and Skill usage history without rerunning installation or native actions.

## Task 7: Full verification, documentation and cleanup

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-creative-assistant-installable-skills-design.md`
- Modify: `docs/创作助手项目知识/README.md` or the relevant Skill knowledge index
- Modify: `.superpowers/sdd/2026-10-09-creative-assistant-native-operations/progress.md` only for the coordinated handoff status
- Create: `tests/fixtures/skills/evals.json`

- [ ] **Step 1: Add positive/negative invocation evals** for `find-skills`, `agent-reach`, one workflow Skill and adjacent requests that must not trigger them.
- [ ] **Step 2: Run focused Python tests** with the repository’s built-in `unittest` commands and focused Node tests; record exact counts and logs under `output/` without adding them to the product commit.
- [ ] **Step 3: Run security checks** for path traversal, archive limits, source redirects, secret redaction, external write rejection, user isolation and package-script non-execution.
- [ ] **Step 4: Run browser verification** on both canvases, desktop and 390px, including install, `$` invocation, automatic research, workflow creation, stop, refresh and resume.
- [ ] **Step 5: Update the spec with verified compatibility limits** and search for fixed Skill allowlists or duplicate old UI paths; remove only code fully replaced by the dynamic catalog after new entrypoints pass.
- [ ] **Step 6: Perform independent review and final diff selection.** Do not commit or push until the user manually confirms the feature works; when confirmed, submit only assistant source/tests/docs and exclude data, screenshots, credentials, caches and unrelated task changes.

## Execution order and handoff

Tasks 1–2 establish safe data and installation boundaries. Tasks 3–4 add Codex-style invocation and the two global capabilities. Task 5 connects a Skill to native workflow execution. Task 6 completes the two-canvas UI. Task 7 is the release gate. Each task must pass its own focused tests before the next task changes dependent interfaces.

The existing B→C→D assistant handoff owns current native-operation work in the shared checkout. Before implementation begins, record the file ownership split in the handoff ledger and avoid editing files that the other task is actively changing. This plan does not authorize third-party installation, system dependency installation, paid provider calls, commit, push or release by itself.
