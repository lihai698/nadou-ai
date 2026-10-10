# Midjourney 节点

## overview

保存 Midjourney 原任务及后续动作的专用节点，不是普通图片API的别名。

## controls

平台、imagine 等模式、size、version、speed、提交；原任务后续放大/变体、Modal 提示词及蒙版编辑由 runMidjourneyAction/runMidjourneyModal 处理。

原任务动态动作：
- `upscale`：四宫格U1～U4放大选图。
- `variation`：四宫格V1～V4弱变体。
- `reroll`：重新生成原任务。
- `low_variation`：单图弱变体。
- `high_variation`：单图强变体。
- `zoom.2`：action=zoom,zoom_ratio=2，单图扩图2倍。
- `zoom.1_5`：action=zoom,zoom_ratio=1.5，单图扩图1.5倍。
- `pan.left`：action=pan,direction=left，向左扩展。
- `pan.right`：action=pan,direction=right，向右扩展。
- `pan.up`：action=pan,direction=up，向上扩展（当前没有向下按钮）。
- `inpaint`：局部重绘取得Modal任务。
- `remix_subtle`：v8四宫格轻微重塑R1～R4。
- `remix_strong`：v8四宫格强烈重塑R+1～R+4。
- `modal`：连接遮罩并提交局部重绘。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: Midjourney
- button:
- generic: 参考图片
- generic: 最多 4 张
- generic: 把图片或图片组连到这里
- combobox:
  - option "生成" [selected]
  - option "融合"
  - option "编辑"
- combobox:
  - option "请先配置 APIMart 平台" [disabled] [selected]
- combobox:
  - option "v8.2"
  - option "v8.1"
  - option "v7"
  - option "v6.1" [selected]
  - option "v5.2"
  - option "v5.1"
- combobox:
  - option "1:1" [selected]
  - option "3:4"
  - option "4:3"
  - option "9:16"
  - option "16:9"
  - option "21:9"
- combobox:
  - option "Relax" [selected]
  - option "Fast"
  - option "Turbo"
- generic: 生成四宫格后可选图
- button "生成四宫格" [disabled]:
  - text: 生成四宫格
- generic "连接到这里"
- generic "拖线连接"
- generic "调整大小"
```

## parameters

创建默认 mode=imagine、size=1:1、version=6.1、speed=relax。lastTaskId/lastTaskStatus/lastAction/lastImageCount/lastPrompt 是已提交任务信息，mjModalTaskId/mjModalPrompt 是后续编辑任务信息。平台适用列表由 resolveMidjourneyProviderId 读取。

- `apiProvider`：创建表达式 `resolveMidjourneyProviderId('')`。
- `count`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `lastAction`：创建表达式 `''`。
- `lastImageCount`：创建表达式 `0`。
- `mode`：创建表达式 `'imagine'`。
- `outputEnabled`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `size`：创建表达式 `'1:1'`。
- `speed`：创建表达式 `'relax'`。
- `version`：创建表达式 `'6.1'`。

正文分页字段：lastPrompt, mjModalPrompt

## inputs_outputs

读取保存的正文、原生inputs/成员顺序、上游连接、任务和结果，三者不能互相替代。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

后续动作依赖真实 lastTaskId，不能猜编号；模型版本与速度参数进入 MJ 请求。请求成功受理之后查询原任务，避免重新 imagine 造成重复费用。
midjourneyContinuationHtml：无lastTaskId、已有mjModalTaskId或lastAction为blend/edit时不展示后续动作；多图v8.1/v8.2显示轻微/强烈重塑，其它版本显示U/V，单图显示变体/扩图/方向扩展/局部重绘。inpaint取得Modal后须maskRef和非running才能提交。所有动作依赖真实原任务编号，不等同免费显示操作。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(classic.midjourney,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

助手run已接首次imagine/blend/edit单任务合同：原手选APIMart平台、版本、速度、画幅和直接连接的prompt/image/output/llm，count=1且唯一原输出。请求复用submit_midjourney，受理后保存本地编号和原远端编号，刷新只查询原任务，完成须在原输出保存本轮结果。融合须2至4图，编辑须图与正文；U/V、remix、Modal、局部重绘等续作仍为原手动入口，每次都是新服务调用，不自动追加。配置或输入变化拒绝；未知受理不重提。

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
当前原生入口要求适用的APIMart平台；没有平台时生成四宫格按钮禁用。最多4张参考图；支持生成/融合/编辑模式，后续动作取决于原任务状态。
