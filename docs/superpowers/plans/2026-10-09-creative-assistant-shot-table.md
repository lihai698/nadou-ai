# 创作助手镜头表知识与状态接入计划

> 执行使用 superpowers:executing-plans 与 test-driven-development，沿用用户指定的原目录；未验收前不提交或推送。

**Goal:** 将新增普通画布 shot-table 纳入真实助手知识、白名单状态及子功能验收，保留视频拆解主体。

**Architecture:** 复用 ProjectKnowledge 的 Markdown/JSON 单源与 read_node_state 的分页投影；镜头表只读状态不触发检测、模型或生成。后续动作另由阶段B计划接入原生入口。

**Spec:** docs/superpowers/specs/2026-10-09-creative-assistant-project-knowledge-design.md

## 全局约束

- 原目录 D:\daxiong，保留其它任务改动；不修改视频拆解 model/host/ui/backend。
- 只读正式服务，不终止PID24128；验收隔离数据、模拟模型、禁止收费调用。
- 读取不等于操作/供应商验收。镜头表最多121镜、36列（6内置/30自定义），正文分页，任意配置/凭据不透传。
- 原生手选双模型、分析批次确认和生成确认保持。

## 审查重点

来源节点/结果归属、行及列分页、手改与分析结果区分、未确认批次状态、复制后归属和任务中断、未知/恶意字段与本机路径。

## Task 1：状态白名单与分页

**Files:** backend/canvas_assistant_state.py；新增 tests/test_canvas_assistant_shot_table.py。

**Interfaces:** read_node_state(canvas, node_id, text_offset, text_limit, item_offset, item_limit, array_path) 保持现签名；parameters.shotTableData 为版本/来源/分析选项；membership.shotTableData.rows/columns/selectedRowIds/generationMap 可分页；行正文进入 pagination.fields；runtime.shotTableTask 来源真实task，不能用节点running推断。

- [ ] 写测试：121镜末页读取、按 rows.120.cells 补读嵌套列、12000字提示词分页、真实分析task/quote/speech读取、不泄露凭据/路径/rowSnapshots/任意嵌套对象、不修改输入。
- [ ] RED：python/python.exe -m unittest tests.test_canvas_assistant_shot_table -v；预期现类型unknown、字段缺失。
- [ ] 接入显式字段投影，复用 bounded_array/bounded_text，不增加并行状态实现。
- [ ] GREEN：同专项命令，加知识/状态旧专项；预期全部通过。

## Task 2：知识、公开样例与子功能验收

**Files:** skills/canvas-assistant/project-knowledge/index.json、nodes/classic-shot-table.md；tests/fixtures/canvas_assistant_knowledge/classic.json；docs/创作助手项目知识/验收清单.json、README.md；专项测试。

**Interfaces:** capabilityId=classic.shot_table，nativeType=shot-table，沿用11章节与四层coverage；来源真实model/host/ui/backend摘要。既有21类不改为全操作已通过。

- [ ] RED：登记/正文读取测试；预期缺classic.shot_table。
- [ ] 逐项写创建、六内置列/自定义列、编辑、选择、重分析/对白重试、模型确认、取消/恢复、批量生成归属/复制/保存说明；加入公开样例；子功能行分别记录说明/读取/操作/UI/供应商状态。
- [ ] 跑知识/状态/Agent/引用专项与原生视频拆解回归；来源再次核对，漂移保留stale。
- [ ] 用隔离服务真实Agent读新节点及页面截图；不执行真实供应商。
- [ ] 回读记录真实数字，更新接续状态；随后写阶段B计划继续。

## 收尾

全库核心检查失败逐项报告，不删除其它任务测试；未用户确认不提交、不上传，保留本计划ledger及截图。
