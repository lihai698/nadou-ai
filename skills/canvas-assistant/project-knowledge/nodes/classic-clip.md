# 剪辑节点

## overview

本项目原生单轨剪辑节点，非生成模型；clipData 是真实剪辑工程。

## controls

导入上游/手动素材、播放、选片段、分割、复制、移除、移动、两端裁剪、全片/分段导出、导出静音。复制/移除/移动采用原生不重叠放置规则。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: 剪辑轴
- generic: 0 个片段 · 00:00
- button "分割" [disabled]:
  - generic: 分割
- button "复制" [disabled]:
  - generic: 复制
- button "删除" [disabled]:
  - generic: 删除
- button "预览":
  - generic: 预览
- button "导出" [disabled]:
  - generic: 导出
- button "删除剪辑节点":
- generic: 00:00
- generic: 00:10
- generic: 00:20
- generic: 00:30
- button "添加图片或视频":
- generic: 连接素材节点，或点 ＋ 添加图片 / 视频
- status: 支持图片、视频；不支持独立音频 · 时间线可横向滚动
- generic "连接到这里"
- generic "拖线连接"
- generic "调整大小"
```

## parameters

clipData.version=1、fps=30、clips=[]、selectedClipId=null、excludedSources=[]、exportMuted=false。时间字段 startFrame/endFrame/sourceOffsetFrames/sourceDurationFrames 均为30fps整数帧；区间长度=endFrame-startFrame。



## inputs_outputs

支持图片/视频。时长未知的手动图片默认4秒，上游图片/未知视频回退6秒并标记 durationUnconfirmed；回退值不是真实探测结果。素材按 sourceNodeId/sourceResultId 去重；excludedSources 防止已移除素材自动重新导入。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

CanvasClipModel 只产生工程快照；exportTasks 生成全片或分段导出任务，FFmpeg/FFprobe 执行与探测。助手 clip_edit 已接 remove/move/trim，media_export 已接全片或逐段导出；其它原生剪辑按钮不因这两个合同开放而自动可执行。
阶段B已接入待确认clip_edit，复用原生remove/move/trim；remove经过普通画布真实助手确认、保存和回读。移除保留excludedSources的JSON键，刷新和syncSources不能自动重导入；手动addMedia(manual=true)才取消对应排除。membership.clipData.excludedSources按原生字符串键分页，不能直接改写排除数组或素材元数据。其它剪辑按钮和供应商效果仍按逐项验收，不能将remove通过算作全部通过。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(classic.clip,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

助手 `media_export` 已接原剪辑任务入口：明确 `scope=full/segments`、`destination=canvas/download`，可指定 `exportMuted`。只使用已保存的本地素材；确认前绑定文件与帧范围，结果核验真实 H.264、1920×1080、30fps、音轨及时长。刷新只查原任务，不重新导出。画布去向复用原生剪辑输出节点；下载只登记 download_started，不能声称用户磁盘落盘。中断交付保留记录，不自动重放下载。已生成下载文件在执行详情内保留逐个下载按钮，用户可以补下载浏览器漏存的片段；按钮只读取已有文件，不重新剪辑或生成。

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
