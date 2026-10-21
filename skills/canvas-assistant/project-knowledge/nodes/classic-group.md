# 素材分组

## overview

items 是当前画布成员编号，分组保留组织与输入顺序，不能跨画布引用。groupMode=frame 是画布工作组，原素材组和旧 workflow 组保留各自职责。
助手 group_members 调用 setCanvasGroupMembers，按原生 nodeBounds 更新外框并复用 handoffExistingInputsToGroup、输入同步；包含生成节点时保留 workflow 组织模式。核验实际 items 与成员节点存续，不通过分组删除原节点。嵌套分组和忙碌成员暂不开放。

## controls

创建空组、拖入/拖出成员、整组移动、复制/解除分组、预览、批量下载；输出节点也可复制或转换成输入分组。Ctrl/Cmd/R 框选只保留临时选区，工具栏提供打组、下载、宫格/整行水平/整列垂直布局；Ctrl+G 或打组创建 groupMode=frame 工作组。工作组保留独立成员和内部连线，支持颜色、整组执行、创建本地工作流、解组和两侧总端口。旧素材组的预览、缩略图和移交输入规则保留。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: Group
- button:
- generic: 1 个提示词 已成组
- generic "拖线连接"
- generic "调整大小"
- generic: Prompt
- button:
- button "模板库":
  - generic: 模板库
- generic: "8"
- generic: / 20,000
- textbox "输入提示词...": 公开节点验收文本
- generic "拖线连接"
- generic "调整大小"
```

## parameters

参数字段见下表，默认值/适用范围以当前原生创建及运行函数为依据；平台和工作流动态枚举需读取当前配置，不能硬编码。

- `groupMode`：创建表达式 `runtime：由当前节点/模型规则决定`。

## inputs_outputs

generatorSources 按 items 获取 image 和 audio 类型的媒体成员，保留 role；组中 prompt 合并为一个 groupPrompt。音频是否进入最终请求还取决于目标模型能力。普通组不会因包含一个任意生成器就自动读取其结果。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

素材组自身不提交生成。frame 工作组的手动整组执行按依赖顺序复用成员原生运行入口，循环链按轮执行，共享上游去重，失败/受理未知停止下游。总端口只保存一条组连线，运行时展开成员；解组展开成独立连线。临时框选连接成功后清空选区。助手的素材组 run/group_members 合同不适用于 frame，请使用画布工具栏。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(classic.group,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
