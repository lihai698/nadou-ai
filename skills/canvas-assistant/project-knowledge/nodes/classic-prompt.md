# 提示词节点

## overview

保存 text 的文本输入节点；普通生成器从上游 prompt 获取提示词。

## controls

正文编辑、复制、提示词库/模板填入、正向/反向模板选择和字数预览；编辑会保存 text，并延迟同步下游预览以避免每次敲字重建界面。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: Prompt
- button:
- button "模板库":
  - generic: 模板库
- generic: "8"
- generic: / 20,000
- textbox "输入提示词...": 公开节点验收文本
- generic "拖线连接"
- generic "调整大小"
```

## parameters

参数字段见下表，默认值/适用范围以当前原生创建及运行函数为依据；平台和工作流动态枚举需读取当前配置，不能硬编码。



正文分页字段：text

## inputs_outputs

输出 text；生成器直接采用全文，多个 prompt 按原生输入顺序以两个换行拼接。接到循环时，每个 prompt 整段作为一项，不将一个 prompt 的多行自动拆成多轮。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

本节点没有独立的图片生成请求。应连到生成器，或给 LLM/循环提供文本。提示词模板是现有共享提示词库，不另建一套。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(classic.prompt,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
