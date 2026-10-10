# ComfyUI 节点

## overview

本地或配置 ComfyUI 的文本生成、增强、编辑和动态工作流节点。

## controls

模式、工作流选择、宽高、增强强度、超分开关/分辨率、编辑模型、比例/尺寸、动态参数、随机参数、生成、原队列查询。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: ComfyUI
- button:
- button "文生图"
- button "细节增强"
- button "图片编辑"
- button "自定义"
- generic: 宽度
- spinbutton "宽度": "1024"
- generic: 高度
- spinbutton "高度": "1024"
- button "Run ComfyUI":
  - text: Run ComfyUI
- generic "连接到这里"
- generic "拖线连接"
- generic "调整大小"
```

## parameters

创建 mode=text、width/height=1024、enhanceStrength=0.5、enhanceUpscale/editUpscale=false、对应超分分辨率=2048、count=1、comfyParams={}；comfyWorkflow 空表示尚未选择动态工作流。动态字段默认/上下限/选项来自工作流 fields。
comfyRandomActive 决定哪些数字参数执行前随机替换；缺开关默认启用（仅schema标random_enabled的字段）。数字/slider保留数值、boolean保留布尔、选择项保留选项；schema未加载时不能猜默认/范围。
Comfy随机结果写入comfyParams，不使用comfyRandomValues作为原生运行凭据。
助手 workflow_parameters 从已手选 comfyWorkflow 的真实 config.fields 读取可编辑字段，保存到 comfyParams；不接受节点自报 comfyFields。配置摘要在确认与执行前复核，原生 UI 和助手共用 setCanvasWorkflowParameters。只开放 setting 类公开标量；media 和 prompt 类字段仍走原生上游输入，拒绝写入不会被请求使用的 prompt 参数。缺选项、类型不符、越界或固定值仍开启随机时拒绝修改。参数保存成功不代表已经生成。

- `comfyMode`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `comfyWorkflow`：创建表达式 `''`。
- `count`：创建表达式 `1`，兼容字段；当前 runComfyNode 不按该字段循环提交。
- `customHeight`：创建表达式 `''`。
- `customRatio`：创建表达式 `''`。
- `customRatioHeight`：创建表达式 `''`。
- `customRatioWidth`：创建表达式 `''`。
- `customSize`：创建表达式 `''`。
- `customWidth`：创建表达式 `''`。
- `editModel`：创建表达式 `allImageModels(imageApiProviders()[0]?.id || 'comfly')[0] || models.gpt`。
- `editUpscale`：创建表达式 `false`。
- `editUpscaleRes`：创建表达式 `2048`。
- `enhanceStrength`：创建表达式 `0.5`。
- `enhanceUpscale`：创建表达式 `false`。
- `enhanceUpscaleRes`：创建表达式 `2048`。
- `height`：创建表达式 `1024`。
- `mode`：创建表达式 `'text'`。
- `outputEnabled`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `quality`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `ratio`：创建表达式 `'square'`。
- `resolution`：创建表达式 `'1k'`。
- `width`：创建表达式 `1024`。

## inputs_outputs

读取保存的正文、原生inputs/成员顺序、上游连接、任务和结果，三者不能互相替代。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

text、enhance、edit 和 custom 的输入要求不同；增强/编辑需要图片。runQueuedComfyGenerate 保留原任务队列信息，query-paused/task-lost 不能当失败后自动重生成。
助手 run 已接入原生 runComfyNode，并非仅 custom 模式；确认实际任务预算 maxCalls 后执行。每次运行一个工作流任务，增强或编辑开启超分时再提交一个任务，maxCalls 分别为 1 或 2，不乘兼容字段 count；工作流一次可返回多媒体，媒体数量不等于服务调用次数。每次提交前检查停止及预算，保留实际受理 taskIds，未知受理状态不重放。custom 的动态参数编辑仅在已手选工作流且 schema 复核后开放，不等同于其它模式的参数编辑。

## results

开启超分时第一个原任务产出中间图，第二个产出最终媒体；原生入口只将最终媒体保存到结果节点。助手仍查询并核对两个原任务均成功、均有真实结果，以及最终媒体已保存，不要求把中间图显示为成品。

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(classic.comfy,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。

动态参数 read_native_capabilities 支持 nodeId/offset/limit 补读，返回 total/nextOffset；不把首批50项当完整schema。素材字段的 editable 依据原生类型及RH媒体名称推断，选项数组完整读取，不允许猜测未读选项。
