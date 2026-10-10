# 智能循环节点

## overview

智能画布按轮次选择输入文本和本地文本，并驱动串行/并行链路。与普通loop的提示词组合规则不同。

## controls

轮数、模式、起始计数、提示词/图片输入开关、每轮图数、多条本地变量提示词、计数/总数/进度插入；链尾整链运行。

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
- button "循环"
- button "并发"
- button "图片":
  - generic: 图片
- button "提示词":
  - generic: 提示词
- generic: "1"
- text: 现在生成第
- generic: 计数
- button "删除": ×
- text: 张卖点图片
- button "删除" [disabled]: ×
- button "计数"
- generic: 可使用 [计数] 作为变量
- button "新增":
- button "起始计数 1":
  - generic: 起始计数
  - strong: "1"
- button "次数 1":
  - generic: 次数
  - strong: "1"
- button "一键运行":
  - generic: 一键运行
- generic "input"
- generic "output"
```

## parameters

创建 count=1、mode=serial、showPrompt=false、imageInput=false、loopStart=1、imageBatchSize=1、variablePrompt为空；count/每轮图片数量有效1～100。variablePrompts 是编辑后保存的多项文本，优先于兼容 variablePrompt。

- `count`：创建表达式 `1`。
- `imageBatchSize`：创建表达式 `1`。
- `imageInput`：创建表达式 `false`。
- `loopStart`：创建表达式 `1`。
- `mode`：创建表达式 `'serial'`。
- `showPrompt`：创建表达式 `false`。
- `videoBatchSize`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `videoInput`：创建表达式 `runtime：由当前节点/模型规则决定`。

正文分页字段：variablePrompt, fixedPrompt
variablePrompts保留每个输入框的内部换行和空字段；setter 清理每项首尾空白，空数组归一为 ['']，空项保存但执行时跳过。read_node_state的membership.variablePrompts与pagination.arrays.variablePrompts可逐项补读；单项长正文使用pagination.fields.variablePrompts.N与textOffset补读。不能按variablePrompt的换行重新分割字段。fixedPrompt 仅为兼容可读字段，不参与当前 smartLoopPrompt 组合。B的loop_prompts动作调用setSmartLoopPromptFieldValues保存数组和兼容正文。助手 run 已接入有限 API 图片轮槽合同，供应商效果另行验收。

## inputs_outputs

showPrompt 开启时，上游与有效本地文本以两个换行拼接；本地默认卖点模板遇到上游文本时省略。两组文本分别按 (index-1)%length 轮换。媒体仍取 index-1 起的连续窗口，不回绕。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

runSmartCascade 负责手动依赖和轮次执行。助手 runSmartAssistantNativeLoop 复用原轮槽、smartLoopRoundSettings、buildPromptRequestForNode 和原任务查询；每轮图片数强制1，真实预算按逐轮 DAG 的生成边计算，复制同级分支不计调用。支持原入口选中的直接叶节点，以及单根 API 图片 DAG；多根 DAG、嵌套循环/分组、音视频、扩图及其它引擎仍须手动核对，不猜测范围。原模板、原图与手选模型保持；每个生成/复制步骤保存独立结果轮槽和 round/source/step/task 映射。顺序执行或最多6轮并行查询，下一项提交必须等待前项受理编号已保存。
确认绑定全部真实源节点、上游、成员、参数、原图与内部连接，新轮槽不成为输入。轮槽先保存；提交边界先保存 submitting，失联保持 unknown，不重提。受理编号立即写浏览器恢复备份并保存画布，只查原编号；停止后保留已完成轮槽与已受理任务。刷新不自动提交剩余轮次；原确认仍有效时点击“继续未提交轮次”，跳过已完成轮槽，已受理槽只查询。助手整轮已取消、只读、输入/连接/归属变化或存在受理未知状态时拒绝继续。不得将普通loop的上游优先替换规则搬来智能画布。
原生手动级联和循环在实际音频上游时允许没有图片提示词；文本模型音频分析结果保存为 audioOutputText，清理 pending 并进入下游正文，不作为图片输出计数。助手有限循环 run 拒绝音视频输入；编辑循环字段不授权执行模型，运行另需明确确认实际预算。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

上游文本为产品要点，本地文本为镜头1/镜头2，count=2：每轮组合产品要点和对应镜头；默认卖点文本例外会被省略。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
