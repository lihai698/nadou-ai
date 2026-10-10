# 智能分组节点

## overview

智能画布可组织混合成员的 smart-group；不能套用普通group仅素材成员的读取规则。

## controls

拖入/拖出、整组移动/选择、尺寸调整、整理排列、预览、宫格拼接、批量下载、解散分组。预览/拼接/下载在没有可用媒体时禁用；items 保存成员顺序。

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
- button "整理排列":
  - generic: 整理排列
- button "预览" [disabled]:
  - generic: 预览
- button "宫格拼接" [disabled]:
  - generic: 宫格拼接
- button "批量下载" [disabled]:
  - generic: 批量下载
- button "解散分组":
  - generic: 解散分组
- generic: 1 提示词
- generic "input"
- generic "output"
- textbox "输入提示词...": 公开节点验收文本
- generic "拖动移出分组"
```

## parameters

参数字段见下表，默认值/适用范围以当前原生创建及运行函数为依据；平台和工作流动态枚举需读取当前配置，不能硬编码。



## inputs_outputs

imagesForNode 解析组中可用媒体，textForNode/promptTextItemsForNode 解析文本。常规 items 成员为 smart-prompt、smart-loop；原生 addNodeToSmartGroup 会将图片吸收到 group.images、删除原图片节点并重接连线，不能假定图片仍是 items 中的存续节点。读取 images、items 与连接的实际状态后再推断组输出。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

分组不代表成员已生成；复合链路仍依赖原生连接与实际生成任务。

助手 run 已接入分组聚合的 API 图片入口：使用原分组手选 runSettings，明确确认 1 至 8 项实际请求；原生编译成员正文和参考图，创建独立 smart-image 结果分支，保留组中原图片。先保存动作、输入绑定和预分配结果编号，再逐项提交；每个 taskId 立即备份及保存，刷新只恢复原结果分支和原编号。最终确认期间成员/模型改变、只读、停止或分支归属变化必须拒绝。受理未知不重提，旧图不能充当本次成果。包含循环/分镜或其它生成引擎的分组 run 尚待接入，使用原手动入口，不将此子集当作完整批量执行支持。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(smart.group,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
助手 group_members 仅开放 smart-prompt、smart-loop 成员，通过 setSmartGroupMemberIds 复用 addNodeToSmartGroup 的成员缩放和顺序，再调用 arrangeSmartGroupMembers 自动排列，保证远处成员进入组框。智能图片吸收会删除原图片节点并迁移媒体、连线，此动作继续由用户手动操作，不能借成员编辑扩大删除权限；组内已有 images 保留。
