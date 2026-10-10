# 智能提示词节点

## overview

保存 text 并可选择文本拆分或LLM改写的智能提示词节点。

## controls

正文、拆分开关和分隔符、LLM开关、平台/模型、System开关/正文、改写指令和运行。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- combobox:
  - option "API生成" [selected]
  - option "火山引擎"
  - option "Modelscope生成"
  - option "ComfyUI生成"
  - option "RunningHub"
- button "图片":
  - generic: 图片
- button "视频":
  - generic: 视频
- generic: 描述你想生成或编辑的图片...
- button "模板库":
  - generic: 模板库
- generic "拖拽调整文本框高度"
- button "隔离模拟平台":
  - generic: 隔离模拟平台
- button "image-user":
  - generic: image-user
- button "尺寸 1:1 · 4K":
  - generic: 尺寸
  - generic: 1:1 · 4K
- button "自动":
  - generic: 自动
- button "1 张":
  - generic: 1 张
- button "运行" [disabled]:
  - generic: 运行
- button "删除节点":
- textbox "输入提示词...": 公开节点验收文本
- button "模板库":
  - generic: 模板库
- button "分隔符":
  - generic: 分隔符
- button "LLM":
  - generic: LLM
- generic "input"
- generic "output"
```

## parameters

创建 promptSeparator=;、promptSplitEnabled=false、llmEnabled=false、llmSystemEnabled=false；llmSystemPrompt=You are a helpful prompt assistant.；llmProvider/llmModel 从后台聊天平台列表解析。

- `llmEnabled`：创建表达式 `false`。
- `llmModel`：创建表达式 `resolveChatModel(''`。
- `llmProvider`：创建表达式 `providerId`。
- `llmSystemEnabled`：创建表达式 `false`。
- `promptSeparator`：创建表达式 `';'`。
- `promptSplitEnabled`：创建表达式 `false`。

正文分页字段：text, llmSystemPrompt, llmInstruction, outputText。outputText 仅为兼容读取字段；原生 runPromptLLMNode 将改写结果写回 text 并保存，不写 outputText。

## inputs_outputs

promptNodePromptItems 依拆分开关输出一项或多项；分隔符不能默认解释为换行。runPromptLLMNode 的改写与图片生成是两次不同模型调用。
上游智能图片节点的 audioOutputText 可经 promptTextItemsForNode/textForNode 作为识别或分析正文；音频媒体与识别正文是不同输入事实，不以空 images 判定没有内容。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

仅开启并配置 LLM 时允许原生文本改写；不能用创作助手选择的图片模型替代节点文本模型。
助手原生 run 已接入 runPromptLLMNode：maxCalls 必须为 1，保留节点手选 llmProvider/llmModel；用户确认后在真实请求前再次检查画布、正文和上游。结果写回 text，assistantNativeRun 保存原动作编号及输出正文。空返回或异常保留原文；恢复只读取已保存回执，不重放同一调用。这里只证明入口规则，真实模型效果另行验收。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(smart.prompt,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
