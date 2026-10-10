# 素材节点

## overview

素材输入节点，不是图片生成器。type=image 可承载图片或视频；旧音频素材在导入、填充及打开画布时通过 CanvasAudio.migrate 转为原生 type=audio。媒体种类仍需按 kind/MIME/URL 判断，不能把旧数据中的音频当图片。
带depthCapture的image是深度/姿态任务节点，不能当成已经完成的静态素材。灰度深度与骨骼姿态共享operationId/taskId，通过role区分；原视频保留。

## controls

空节点选择素材；可多选图片、视频、音频并形成分组；支持预览、图片编辑、复制与下载，视频可进入原生视频编辑。素材替换与重新生成是不同操作。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: Image
- button:
- generic: 点击/拖拽上传素材，或在空节点粘贴图片
- generic "拖线连接"
- generic "调整大小"
```

## parameters

参数字段见下表，默认值/适用范围以当前原生创建及运行函数为依据；平台和工作流动态枚举需读取当前配置，不能硬编码。

- `duration`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `height`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `kind`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `mime`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `role`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `width`：创建表达式 `runtime：由当前节点/模型规则决定`。

## inputs_outputs

url 是原素材；name、kind、role 保存名称、媒体类型及角色。图片可作为图像参考，视频/音频是否可输入取决于目标节点模型。不能只因节点 type=image 就当成图片。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

fillImageNode 负责导入，不提交生成请求。导入多个文件可创建原生 group。读取素材编号后再通过 inspect_result 发送真实图片。
视频编辑的深度动作捕捉创建两份对齐的视频参考和关节JSON，最长15秒；首次使用可能安装组件与模型。read_node_state返回原depthCapture任务、来源编号、角色、stage/progress/error和三种结果URL。读取不会创建、重试或下载组件。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。
depthCapture查询失败保留原taskId，不能调用retry冒充查询；retryCanvasDepthCapture会新建operationId、清空旧参考结果并重新提交，必须作为新的处理动作确认。没有taskId时，不把watchCanvasDepthCapture的自动提交分支当成只读恢复。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(classic.image,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
