# 输出节点

## overview

生成结果集合及下游输入桥梁；images 可能包含图片、视频或音频，audioOutputText 保存音频处理的文本结果。必须按实际媒体类型读取和展示。

## controls

结果预览、下载全部、复制/转换成输入素材分组、打开生成参数/提示词、原任务等待与错误显示；转换和复制的节点/连线影响不同。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: Output
- button:
- generic "连接到这里"
- generic "拖线连接"
- generic "调整大小"
```

## parameters

参数字段见下表，默认值/适用范围以当前原生创建及运行函数为依据；平台和工作流动态枚举需读取当前配置，不能硬编码。



## inputs_outputs

images 保存实际结果；普通下游 generatorSources 对 output 默认取最新可用一项。LLM 文本输入可读取 audioOutputText，输出卡也显示该文本。_pending 是仍在等待的原任务信息，不是最终结果。输出为空时不能将预览占位当成媒体。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

自身不调用生成模型；上游成功结果追加到此节点。结果拷贝/转换须保留真实媒体类型和引用关系。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

普通图片任务完成后同步下游输入顺序和预览，再保存完成状态。下游复用实际输出图片；确认期间用户更改输入仍由原门禁拒绝，不自动重提。

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(classic.output,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
