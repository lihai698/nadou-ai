# 通用图片生成节点

## overview

原生 API 生成节点；图片平台/模型必须来自后台已配置列表。手选音频、上游含音频或仍有活动音频原任务时会进入原生音频分支；下述图片尺寸、数量和助手 image 回执规则仅适用于图片分支。助手尚未开放音频运行确认，不能用图片确认提交音频任务。

## controls

平台、图片模型、比例、分辨率、自定义比例/宽高、质量、参考图输入顺序、生成、链尾一键运行和错误重试/查询。比例与分辨率决定最终请求尺寸，预览不代表模型效果。上游音频分析时原生模型下拉将后台文本模型放在“文本模型”分组内，这不改变模型编号或图片运行范围。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: API生成
- button:
- generic: Images
- generic: 把图片或图片组连到这里
- combobox:
  - option "隔离模拟平台" [selected]
- combobox:
  - option "image-user" [selected]
- combobox:
  - option "自动" [disabled]
  - option "1K" [selected]
  - option "2K"
  - option "4K"
  - option "自定义"
- combobox:
  - option "1:1" [selected]
  - option "2:3"
  - option "3:2"
  - option "3:4"
  - option "4:3"
  - option "9:16"
  - option "16:9"
  - option "21:9"
  - option "9:21"
  - option "适配比例"
  - option "自定义"
- combobox:
  - option "Q auto" [selected]
  - option "Q low"
  - option "Q med"
  - option "Q high"
- button "减少生成数量":
- textbox: "1"
- button "增加生成数量":
- button "API生成":
  - text: API生成
- generic "连接到这里"
- generic "拖线连接"
- generic "调整大小"
```

## parameters

阶段B的尺寸编辑复用setCanvasGeneratorSizeFields，与原生尺寸控件共用入口。自定义像素同步customWidth/Height/customSize、resolution=custom、ratio为空和用户选择标志；自定义比例同步customRatioWidth/Height/customRatio与ratio=custom。后端回执同时核对关联字段，不能只以一个宽高值保存相等判断成功；模型不直接写customSize或customRatio。比例/分辨率支持范围还服从所选模型的原生规范化与禁用状态。

参数字段见下表，默认值/适用范围以当前原生创建及运行函数为依据；平台和工作流动态枚举需读取当前配置，不能硬编码。

- `apiProvider`：创建表达式 `providerId`。
- `count`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `customHeight`：创建表达式 `''`。
- `customRatio`：创建表达式 `''`。
- `customRatioHeight`：创建表达式 `''`。
- `customRatioWidth`：创建表达式 `''`。
- `customSize`：创建表达式 `''`。
- `customWidth`：创建表达式 `''`。
- `model`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `outputEnabled`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `quality`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `ratio`：创建表达式 `'square'`。
- `resolution`：创建表达式 `defaultApiImageResolution(model)`。

正文分页字段：viewAdjustPrompt

## inputs_outputs

从 generatorSources 收集上游 prompt、group、loop、LLM 及媒体；orderedSources 先保留 inputs 已有顺序，再追加新来源。上游 output 默认取最后一个可用媒体，生成节点的结果可多项输出。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

上游含音频且选择后台文本模型时，runGenerator 调用 runAudioAnalysisGenerator 分析音频；这是独立文本调用。助手图片确认（原生 run 或 assistantProposal）拒绝这个分支；acceptedTask 恢复已有图片时跳过音频分派，只消费原图片编号。手动音频处理保持原生行为。

runGenerator 调用原生 API 任务链路；普通节点不能将自己的 prompt 字段当上游提示词。链路中间节点默认不创建 Output，链尾/手动开启/已连接输出时才输出。
助手 run 仅调用此节点的 runGenerator，不执行整个上游级联。需原节点已经手选 apiProvider/model，maxCalls 必须等于当前 count（1至8）；提交前再次核对输入与确认状态。原生受理编号保存于 assistantNativeRun，并沿用原任务轮询；服务端查询这些原编号且核对真实媒体已经保存后才完成。没有编号、部分受理未知、仅 running=false 或空返回都不代表成功，不自动重新提交。
最终异步确认返回后再次核对当前画布、只读状态和上游输入，等待期间的编辑不能继续提交。服务记录声明的画布、节点、平台和模型须与原运行一致。无输出节点的已受理任务恢复先走 materializeCanvasDirectTasks，再用原生完成入口回填，不能将空处理当作同步成功。
助手运行时输入排序和沿用来源比例的尺寸派生使用节点副本，避免编译自身改写触发确认漂移；真实用户输入变化仍拒绝。请求发出前的本地预检拒绝明确为未受理，网络或响应无法确认才保留提交未知。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(classic.generator,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
