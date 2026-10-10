# 循环节点

## overview

按轮次输出提示词与图片窗口，并驱动下游链路重复执行。当前普通画布不开放视频循环输入。

## controls

轮数、循环/并发、图片与提示词开关、起始计数、每轮图片数量、本地变量提示词、计数插入；有下游链路时显示开始/停止。renderLoopBody 将 videoInput 强制设为false，不显示视频输入开关。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: 循环节点
- button:
- generic: 次数
- spinbutton: "3"
- button "循环"
- button "并发"
- button "图片":
  - text: 图片
- button "提示词":
  - text: 提示词
- generic: 例如：现在生成第[计数]个卖点
- button "计数"
- generic: 起始
- spinbutton: "1"
- generic "连接到这里"
- generic "拖线连接"
- generic "调整大小"
```

## parameters

count 创建默认3，有效1～100；mode 默认serial。showPrompt/imageInput/videoInput 默认false；loopStart、imageBatchSize、videoBatchSize 默认1。图片/视频每轮数量限制1～100。variablePrompt、fixedPrompt 是保存文本，后者不能未经运行函数核对就宣称已生效。
当前渲染会强制 videoInput=false；videoBatchSize 是历史保存字段，不能据其存在宣称当前UI支持视频循环。loopStart UI范围1～9999。

- `count`：创建表达式 `3`。
- `imageBatchSize`：创建表达式 `1`。
- `imageInput`：创建表达式 `false`。
- `loopStart`：创建表达式 `1`。
- `mode`：创建表达式 `'serial'`。
- `showPrompt`：创建表达式 `false`。
- `videoBatchSize`：创建表达式 `1`。
- `videoInput`：创建表达式 `false`。

正文分页字段：variablePrompt, fixedPrompt

## inputs_outputs

提示词开关关闭时不输出文本；开启时上游提示词优先于本地 variablePrompt。以 (index-1)%items.length 轮换上游文本；替换《计数》《总数》《进度》。媒体窗口从 index-1 起截取 batchSize，超出媒体数量时返回空，不环回媒体。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

循环不是收费服务节点；通过 resolveCascadeLoop/runNodeCascade 影响下游执行。禁止只增大轮数就默认提交；实际额度按每轮下游生成节点计算。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

连接两个 prompt 到循环，count=3、showPrompt=true：三轮文本顺序为第一条、第二条、第一条。imageInput=false 时没有图片输入。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
