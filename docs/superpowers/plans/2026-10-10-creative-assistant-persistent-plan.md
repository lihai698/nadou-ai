# 创作助手 C 阶段持久计划核心

> 执行方式：superpowers:executing-plans + test-driven-development。已有总设计及双窗口分工授权覆盖实施，不重复询问，不提交或上传。

**Goal:** 交付可由现有 AssistantStore 原子保存的计划核心，保留依赖、累计预算、实际回执及原任务编号；不创建另一套存储或供应商队列。

**Architecture:** 新模块只处理 JSON 状态的校验与复制，不读写磁盘、不发请求。共享入口由 B 窗口统一接入；模型只能提出计划，领取执行、记账和完成回执由可信服务端调用。

**Spec:** docs/superpowers/specs/2026-10-09-creative-assistant-project-knowledge-design.md §6.1。

## 分工及边界

- 本聊天 01a121b4-a847-7113-9cfe-d37badc8c446：新增 backend/canvas_assistant_plan.py、tests/test_canvas_assistant_plan.py、本计划和独立 progress。
- B 聊天 01a120a7-8420-70c0-8265-ac351ca80500：助手路由/Agent/tools、画布和助手前端、PROJECT_STATE、3014 及最终集成。
- C 总目标还包括硬条件和视觉质量核验；此核心不宣称作品合格或整个 C 完成。
- 沿用 6 模型调用、8 工具调用、900 秒的现有回合默认上限；累计上限由可信后端提供，不由模型或恢复操作扩大。服务调用默认额度为 0，必须明确配置额度并按原生方案确认。
- 工作在现有 codex/creative-assistant-agent 原目录，只写明确归属的新增文件；不动既有脏改动、不重启 3000/3013/3014。

## Review Focus

跨画布/会话领取；循环/缺失依赖；双执行器；预算事件重复或改变；已开始但未收到受理编号；恢复后原任务重提；伪造或替换完成回执。每项纳入专项测试。

## Task 1：计划与依赖合同

- [x] 写失败测试并运行：create_plan 验证有限步骤、唯一 id、依赖 DAG、目标/保留内容/要求、预算，next_steps 只返回依赖已完成的步骤。
- [x] 实现纯 JSON 合同，拒绝未知执行字段，返回副本。

## Task 2：执行、预算与恢复

- [x] 写失败测试并运行：claim_plan 绑定画布/会话/执行编号；charge_budget 按事件幂等累计；start_step 等待确认后才预留真实服务调用上限；record_step 只登记可信回执。
- [x] 实现 stop_plan 与 claim_plan：断线保留原编号、无编号标 unknown；停止不自动续行；旧执行器失效；预算不重置；完成步骤不重新执行。
- [x] 在临时目录用真实 AssistantStore.transact 保存并重建 store 回读，再续行原任务，验证实际 JSON 落盘恢复。

## Task 3：交付及整合

- [x] 运行专项测试、相关 Agent/native/state 回归、Python 编译和本次文件差异检查；保存日志。25专项及82相关通过；扩大127项受知识漂移影响，整库180秒超时，详见独立progress。
- [x] 独立审查此核心，修复阻断问题；更新独立 progress，向 B 窗口回报精确接口/文件/证据。
- [ ] B 窗口将 plan 放入 turn.agent.plan，通过 checkpoint/transact 原子保存；调用模型/工具前累计预算，原生确认前 start_step，使用实际保存回执 record_step。领取/停止与已有 owner/executionId 同事务。
- [ ] 共享入口集成后才验证真实页面；集成前模块可测试不等于产品已接入。用户验收前不提交/上传。

## 共享入口接入进度（2026-10-10）

- 已接入create_plan / execute_plan_step，计划保存到turn.agent.plan；依赖、执行编号、模型/工具/活动时间累计预算、停止/续行与已有Store事务衔接。
- 原生方案确认后才执行，真实保存回执才完成步骤；查询/取消已有原任务保留原编号，不扣新生成额度。默认新服务额度仍为0，计划内生成不能越过额度和确认。
- 已修复并用路由回归验证：原生中间步骤续行、查询原任务回执、写入后断线的回执恢复、最后一步恰好耗尽预算仍完成，以及累计额度不足时暂停。最终完成无需额外模型请求。
- 独立只读审查发现4项问题，均已修复并完成对应RED→GREEN。专项37项通过；Agent/计划/native/state在受控知识来源边界下143项通过，日志output/assistant-plan-verification/integration-regression-controlled-sources.log。这不是未模拟来源的整库通过。
- 普通/智能3014实际页面已走读取→确认原生正文修改→保存回执；计划及正文保存证据output/assistant-plan-verification/two-canvas-plan-evidence.json。刷新界面证据另行核对，不把模型模拟当真实理解或作品验收。
- 历史canvas.js/smart-canvas.js等知识来源仍stale；生产门禁保留。本次只复核并更新AGENT_GUIDE来源及创作规则，未用全量重算摘要掩盖漂移。硬条件/视觉核验、全节点B覆盖、真实供应商D仍未完成。
- 沿用原目录与原生界面，没有新增存储、队列或另一个助手；旧Agent单回合保护仍需要，因此没有删除它。用户未最终确认，未提交/推送/发布。
