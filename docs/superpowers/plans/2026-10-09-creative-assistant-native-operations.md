# 创作助手阶段B原生操作覆盖实施计划

> 执行使用 superpowers:executing-plans、test-driven-development；沿用已批准整体设计，不重复询问实施许可。未用户验收不提交或上传。

**Goal:** 两种画布的受控动作从真实助手请求进入原生处理器，保存实际回执、执行前检查、调用确认与原任务恢复。

**Architecture:** 现有apply_canvas_operations继续承担已验证结构操作；新增原生动作合同和待确认动作，不让模型运行任意JS或供应商请求。后端绑定画布版本与动作范围，前端适配器复用实际创建/执行/分组/时间线处理器；记录已执行动作id，重开读取原回执。功能目录按每类动作明示available/unavailable与限制。

**Spec:** docs/superpowers/specs/2026-10-09-creative-assistant-project-knowledge-design.md

## 全局约束

- 保留用户手选文本/图片模型；节点原选择不由模型覆盖。创建默认值从原生工厂取得，不引入参考项目模型。
- 所有服务调用/批量运行需要确认，前端原生参数验证、上游展开与任务服务保持；未受理或不确定提交不自动重试。
- 当前画布范围、只读/忙碌/版本冲突、来源漂移、停止、重复动作与凭据过滤必须拒绝或恢复真实状态。
- 不执行任意代码、任意文件/媒体URL、删除节点/素材、安装组件、修改供应商设置或发布。
- 原目录保留其它任务，视频拆解主体只读；正式3000不重启，隔离验证/模拟边界。

## Review Focus

确认后画布/上游改变；两标签重复执行；保存成功但回执响应丢失；原生函数以toast返回而未执行；模型试图修改结果/taskId/供应商；恢复时误提交已受理任务；动态工作流参数身份和类型；无结果或不支持视觉时不得标记作品合格。

## Task 1：能力合同、参数与预检

**Files:** 新增backend/canvas_assistant_native.py、tests/test_canvas_assistant_native.py；扩展canvas_assistant_tools.py。

**Interfaces:** native_catalog(kind)返回类型/动作/字段的真实支持范围；prepare_native_action(canvas,args,action_id)返回{ id, action, nodeId, arguments, canvasId, updatedAt, canvasHash, nodeType, chargeable, state:'pending' }；不写画布、不调用服务。工具read_native_capabilities/propose_native_action。

- [ ] RED：非法类型/字段、私密字段/结果/model改写、缺节点、busy/readonly、数值/枚举范围、相同id与漂移/版本变动；全22类逐项目录检查。
- [ ] 实现显式合同：create/update/connect/group/run/query/preview及对应类型专用动作（镜头行/列、剪辑/分镜参数）分别登记；缺处理器明确不可执行。
- [ ] GREEN：专项测试；不以知识documented推断available。

## Task 2：前端原生动作适配

**Files:** 新增static/js/canvas-assistant-native.js及tests/canvas_assistant_native.test.cjs；canvas.js/smart-canvas.js仅助手适配区域与必要共享原生入口。

**Interfaces:** CanvasAssistantNative.create(adapter).execute(proposal)返回真实nodeIds/taskIds/status/保存版本；adapter检查当前canvasId、保存版本/目标签名、只读/忙碌与原动作receipt。复用createNodeByType/createImageNodeAt/createPromptNode/createLoopNode/createSmartGroupNode/createMinimaxNode，runCanvasGenerate/runPromptLLMNode/runGeneration/runMinimaxNode及现有任务查询。

- [ ] RED：重复id不再创建/执行、保存失败不假回执、模型字段不覆盖、错误原样返回、切画布拒绝；每类执行入口对照测试。
- [ ] 接入原生创建/字段/连接/分组/执行/结果读取；动态RH/Comfy参数与时间线必须走原生规范化/实际配置，不能猜测schema。
- [ ] GREEN：模块测试与旧原生规则回归。

## Task 3：待确认动作与持久回执

**Files:** canvas_assistant.py、canvas_assistant_agent.py、tests/test_canvas_assistant_agent.py；main.py复用既有依赖。

**Interfaces:** Agent保存nativeActions；propose工具仅预检保存pending。/native/action按confirm/query/finish操作，绑定turn/owner/canvas/lease/版本；finish对照实际保存画布和固定receipt，不接受客户端自称已成功。模型后续读取实际回执；未知提交只读查询原状态。

- [ ] RED：真实路由模型提议→待确认→原生保存→回执→后续请求；跨会话/取消/并发/丢响应/冲突/失效原模型拒绝。
- [ ] 整合现有waiting_confirmation/continue和执行编号，不建立新供应商队列，不删既有图片闭环。
- [ ] GREEN：助手Agent/知识/引用/操作相关测试。

## Task 4：原生助手确认卡与实际页面

**Files:** canvas-assistant.js、必要局部CSS、普通/智能HTML脚本引用；output隔离页面/截图不入库。

**Interfaces:** 复用现有步骤/图片方案确认卡风格，显示动作范围、节点、预计调用数、保存/任务状态；用户确认调用后才进入原生处理器。query只查询；continue消费已保存回执。

- [ ] 先渲染桌面与390px预览并查看，再生产改动。
- [ ] 接入正常/禁用/执行中/等待/失败/恢复与停止，手选模型保持。
- [ ] 真实隔离页面逐类操作、保存重开/重复/错误/窄屏截图；不能用字符串包含或mock存在代替实际行为。

## Task 5：逐类覆盖和组合验收

**Files:** docs/创作助手项目知识/验收清单.json、README.md；专项/组合公开样例及output证据。

- [ ] 普通17类、智能5类逐类记录创建/字段/输入展开/连接/预检/执行/查询/结果/保存/复制；未依赖配置/真实供应商标pending，不冒称全通过。
- [ ] 重点组合：提示词/分组/循环/LLM→图片→结果复用，RH/Comfy动态工作流，视频/分镜，剪辑导出，镜头表生成归属。
- [ ] 运行相关测试/真实页面后全库check-core/data formats/diff；其它任务失败逐项报告不关闭检查。
- [ ] 最终独立审查/回归；更新真实状态，继续阶段C。

## 后续完整目标

C计划将用户目标/依赖步骤/预算/节点任务编号/验收要求持久化，按阶段执行，停止/断线仅恢复原任务，读取真实作品再评价。D先完成可审阅真实模型逐类及组合验收方案，具体供应商/模型/最大费用未经批准时停在该唯一边界；模拟不能证明模型理解或作品质量。B/C/D均保留，不能以此计划或镜头表补核替代完成。
