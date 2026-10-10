# RunningHub 节点

## overview

RunningHub 模型、AI应用或工作流节点；动态参数来自当前应用/工作流 schema。

## controls

模式、平台配置项、应用/工作流编号、加载/导入工作流、实例、计费、动态文本/数字/选择/布尔/媒体、随机种子开关、参考图顺序、运行、原任务查询。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: RunningHub
- button:
- generic: RunningHub 配置
- combobox "RunningHub 配置":
  - option "请先在 API 设置里添加 RunningHub 配置" [selected]
- generic: Key
- combobox "Key":
  - option "RunningHub币 Key（未配置）" [selected]
  - option "账户余额 Key（未配置）"
- generic: 显存
- combobox "显存":
  - option "24G" [selected]
  - option "48G"
- generic: 输入素材
- generic: 拖入图片或提示词到此
- generic: RunningHub 参数
- generic: "0"
- generic: 输入 webappId 并拉取应用参数
- button "运行 RunningHub":
  - text: 运行 RunningHub
- generic "连接到这里"
- generic "拖线连接"
- generic "调整大小"
```

## parameters

创建 rhMode=app、rhPayment=free，webappId/workflowId/instanceType 为空；rhParams 默认空。原生参数键由 nodeId+fieldName 组成，保存 {value,sourceFromUpstream}。rhAppInfo/rhWorkflowInfo 中 nodeInfoList 是参数定义；不能透传供应商配置对象或API密钥。
rhRandomActive 决定哪些数字参数执行前随机替换；缺开关默认启用（仅schema标random_enabled的字段）。数字/slider保留数值、boolean保留布尔、选择项保留选项；schema未加载时不能猜默认/范围。
rhRandomValues保存运行生成的值。

- `count`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `customHeight`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `customRatio`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `customRatioHeight`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `customRatioWidth`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `customSize`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `customWidth`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `instanceType`：创建表达式 `''`。
- `model`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `outputEnabled`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `quality`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `ratio`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `resolution`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `rhConfigKey`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `rhMode`：创建表达式 `'app'`。
- `rhModel`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `rhPayment`：创建表达式 `'free'`。
- `webappId`：创建表达式 `''`。
- `workflowId`：创建表达式 `''`。

## inputs_outputs

rhActiveFields 选择当前有效字段；图片按 imageOrder 排序，按各媒体类型单独计数；sourceFromUpstream=false 才明确使用手选值。可选缺图字段可能剪裁工作流，不等同必填缺图。
助手 workflow_parameters 读取当前应用/工作流配置的公开字段，原生参数键为 nodeId::fieldName；通过 setCanvasWorkflowParameters 保存到 rhParams[key].value（字符串），保留 sourceFromUpstream 和其它字段。配置在确认与执行前复核；不改平台、模型、计费、媒体来源和仍开启的随机参数，缺完整选项时拒绝猜测。参数保存不代表服务执行完成。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

runRhNode 先验证应用/工作流及必填媒体；模型模式使用 runRhModelNode。app/workflow 的任务编号写入 run.request，当前仅在本次函数内查询，尚无受理即持久化和刷新后通用恢复保证。model 模式走 online-image 原任务链并保存编号，可按原编号恢复；不能泛称所有 RunningHub 模式均可刷新恢复，不能重新提交冒充恢复。助手 run 目前仅开放手选一致的 model 配置、count=1、outputEnabled=true 且连接已有 output 节点；确认后走原生 runRhModelNode，受理编号与动作归属先本地备份再保存，保存失败只恢复原任务。app/workflow、批量与无输出仍待接入。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(classic.runninghub,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。

动态参数 read_native_capabilities 支持 nodeId/offset/limit 补读，返回 total/nextOffset；不把首批50项当完整schema。素材字段的 editable 依据原生类型及RH媒体名称推断，选项数组完整读取，不允许猜测未读选项。
