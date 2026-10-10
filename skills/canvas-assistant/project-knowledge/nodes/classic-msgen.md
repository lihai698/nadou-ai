# ModelScope 图片节点

## overview

ModelScope 多模型图片节点，默认 zimage；qwen_edit、klein_edit 需要参考图，custom 使用配置模型。

## controls

模型/自定义模型、图片比例和分辨率、自定义尺寸、按参考图尺寸适配、数量、LoRA 开关/选择/强度、生成和链尾一键运行。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: Modelscope生成
- button:
- button "ZImage"
- button "Qwen Edit"
- button "Klein"
- button "自定义"
- combobox:
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
  - option "自定义"
- button "减少生成数量":
- textbox: "1"
- button "增加生成数量":
- generic: 当前模型暂无绑定 LoRA，可在 API 设置 · Modelscope · LoRA 管理中添加。
- button "Modelscope生成":
  - text: Modelscope生成
- generic "连接到这里"
- generic "拖线连接"
- generic "调整大小"
```

## parameters

count 创建默认1、限制1～8；msRatio=square、msResolution=1k，msWidth/msHeight=1024；自定义尺寸写入 msCustomWidth/msCustomHeight/msCustomSize；LoRA 强度来自所选后台条目，不能替换为外部项目默认值。

原生尺寸控件与助手共同调用 setCanvasMsSizeFields；修改像素字段同步 msCustomSize、msResolution=custom、msRatio空值，修改比例同步 msCustomRatio。组合字段与旧 msWidth/msHeight 不作为助手直接编辑入口。保存后的关联字段必须一起核验，不能仅凭输入字段改变宣称生成尺寸已修改。

- `count`：创建表达式 `1`。
- `fitImage`：创建表达式 `false`。
- `msCustomHeight`：创建表达式 `''`。
- `msCustomModel`：创建表达式 `modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo'`。
- `msCustomRatio`：创建表达式 `''`。
- `msCustomRatioHeight`：创建表达式 `''`。
- `msCustomRatioWidth`：创建表达式 `''`。
- `msCustomSize`：创建表达式 `''`。
- `msCustomWidth`：创建表达式 `''`。
- `msHeight`：创建表达式 `1024`。
- `msLoraEnabled`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `msLoraId`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `msLoraStrength`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `msRatio`：创建表达式 `'square'`。
- `msResolution`：创建表达式 `'1k'`。
- `msWidth`：创建表达式 `1024`。
- `msgenModel`：创建表达式 `'zimage'`。
- `outputEnabled`：创建表达式 `runtime：由当前节点/模型规则决定`。

## inputs_outputs

读取保存的正文、原生inputs/成员顺序、上游连接、任务和结果，三者不能互相替代。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

zimage → /generate；qwen_edit → /api/angle/generate；klein_edit/custom → /api/ms/generate。runMsGenNode 在需要图片的模型无图、无提示词或LoRA绑定缺失时拒绝执行。count 次请求并行，不是单个服务任务的默认批量。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(classic.msgen,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

助手run已接原生魔搭四个模型页签的单任务合同：保留手选模型、尺寸与已绑定LoRA，count=1且唯一原输出；直接连接已保存prompt/image/output/llm。确认后先保存启动状态，受理立即备份原本地任务编号并保存再查询，刷新只查询原编号。供应商请求复用以上原生入口，不代选模型或LoRA，不扩量；复杂链路仍使用原入口。配置/上游/输出变化拒绝，未知受理不重提；后续实际供应商效果另行验收。

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
