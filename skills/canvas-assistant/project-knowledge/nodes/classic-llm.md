# LLM 节点

## overview

文本模型节点，node 模式改写上游内容；chat 模式保留对话。

## controls

平台与模型、节点/聊天模式、System 开关与系统提示词、输入/输出正文、运行、聊天发送和历史。默认系统提示词为 You are a helpful assistant. Rewrite the input into a concise image prompt. 仅 showSystem 开启才发送。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: LLM
- button:
- combobox:
  - option "隔离模拟平台" [selected]
- combobox:
  - option "chat-user" [selected]
- button "节点"
- button "聊天"
- button "System"
- generic: Input
- textbox "直接输入，或连接提示词节点…"
- generic "拖动调整输入/输出高度"
- generic: Output
- button "复制":
- generic: 运行后会输出文本，可连到生成卡片
- button "Run LLM":
  - text: Run LLM
- generic "连接到这里"
- generic "拖线连接"
- generic "调整大小"
```

## parameters

参数字段见下表，默认值/适用范围以当前原生创建及运行函数为依据；平台和工作流动态枚举需读取当前配置，不能硬编码。

- `llmProvider`：创建表达式 `providerId`。
- `mode`：创建表达式 `'node'`。
- `model`：创建表达式 `resolveChatModel(''`。
- `showSystem`：创建表达式 `runtime：由当前节点/模型规则决定`。

正文分页字段：systemPrompt, chatInput, userInput, outputText

## inputs_outputs

llmInputText 优先上游内容，回退 userInput；上游 generator/output 的音频文本取 audioOutputText，不把音频文件当文本。图片和视频分别经过 llmInputImages/llmInputVideos。node 模式的 outputText 可被下游作为提示词，chat 模式不能等同于节点输出。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

runLLMNode 通过 /api/canvas-llm 使用用户后台平台列表；缺少输入不会调用模型。普通画布助手的原生 `run` 已接入：确认后只执行一次用户手选的 LLM 平台/模型，保存 `outputText` 和 `assistantNativeRun` 完成回执，后续图片动作仍需单独确认。成功保存 outputText；runStatus/runError 是当次状态，存储时会清除，不能当作刷新后的成功凭据。聊天使用 messages，需读取实际历史。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

助手运行返回空文本或报错时保留原 `outputText`；仅取得有效文本后替换正文，并复用原生输入预览同步更新下游展示。失败不执行依赖该结果的后续步骤。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(classic.llm,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。LLM 原生 run 已开放但真实模型效果、下游图片组合和视觉质量仍需 D 阶段逐案验收；未登记动作保持 pending。
