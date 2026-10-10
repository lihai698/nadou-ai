# 提示词分组

## overview

由 connectSelectionToGenerator 的多提示词连接交互生成的 promptGroup，创建菜单之外的合法原生类型。items 按保存的节点编号引用提示词成员。

## controls

多提示词连接生成器可创建 promptGroup；Ctrl+G 和框选分组创建普通 group，不能混同。分组移动保留成员相对位置；复制时重映射成员编号，解除分组与删除成员的影响不同。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: Prompts
- button:
- generic: 1 个提示词 已成组
- generic "拖线连接"
- generic "调整大小"
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



## inputs_outputs

生成器按 items 顺序获取成员 text，滤掉空文本后以两个换行拼接。循环按成员 text 分别作为轮次候选。不能把 items 数组误当成正文。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

自身不调用模型，改变的是文本组合和成员组织。读取每个成员的正文才能解释最终输入。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(classic.prompt_group,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
