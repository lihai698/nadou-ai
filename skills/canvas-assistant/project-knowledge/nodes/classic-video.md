# 视频生成节点

## overview

视频 API 节点，能力取决于当前选择的模型和平台。

## controls

平台/视频模型、时长、比例、分辨率、提示词增强、升采样、水印、固定镜头、音频、首尾帧角色、多模态；媒体顺序、云上传/手动外链、生成和原任务查询。

默认状态UI核对（隔离公开样例，不代表供应商执行已验证）：
```text
- generic: 视频生成
- button:
- generic: Media
- button "输入网址":
  - generic: 输入网址
- button "上传云端":
  - generic: 上传云端
- generic: 拖入图片或提示词到此
- combobox:
  - option "隔离模拟平台" [selected]
- combobox:
  - option "video-user" [selected]
- generic: 时长
- spinbutton "时长": "5"
- generic: 比例
- combobox "比例":
  - option "16:9" [selected]
  - option "9:16"
  - option "1:1"
  - option "4:3"
  - option "3:4"
  - option "21:9"
  - option "9:21"
  - option "keep"
  - option "adapt"
- generic: 分辨率
- combobox "分辨率":
  - option "Auto" [selected]
  - option "480p"
  - option "720p"
  - option "1080p"
  - option "780P"
- button "优化提示词": 优化提示词
- button "提升到 1080p": 提升到 1080p
- button "水印": 水印
- button "固定镜头": 固定镜头
- button "生成音频": 生成音频
- button "全能参考": 全能参考
- button "首尾帧": 首尾帧
- button "视频生成":
  - text: 视频生成
- generic "连接到这里"
- generic "拖线连接"
- generic "调整大小"
```

## parameters

创建 duration=5、aspectRatio=16:9、resolution为空；enhancePrompt/enableUpsample/watermark/cameraFixed/generateAudio/useFrameRoles/multimodal 默认false。具体模型可用范围由原生能力规则决定，不把5秒当所有模型固定时长。

- `apiProvider`：创建表达式 `providerId`。
- `aspectRatio`：创建表达式 `'16:9'`。
- `cameraFixed`：创建表达式 `false`。
- `duration`：创建表达式 `5`。
- `enableUpsample`：创建表达式 `false`。
- `enhancePrompt`：创建表达式 `false`。
- `generateAudio`：创建表达式 `false`。
- `model`：创建表达式 `models[0] || videoModels[0] || DEFAULT_VIDEO_MODELS[0]`。
- `multimodal`：创建表达式 `false`。
- `outputEnabled`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `resolution`：创建表达式 `''`。
- `useFrameRoles`：创建表达式 `false`。
- `watermark`：创建表达式 `false`。

## inputs_outputs

输入可含图片/视频/音频，模型不支持的输入不能擅自发送；首尾帧与普通参考角色不同。结果以 generatedImages/Output 中的实际 kind=video 判断，不能根据 images 字段名判图片。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

runVideoNode 构造原生视频任务；可能要求公网可访问的媒体链接，后台导入/上传规则处理，不向任意URL发请求。

助手 run 仅开放已手选有效视频平台/模型、单任务 maxCalls=1、outputEnabled=true 且连接唯一已有 output。沿用原生编译与任务入口，不级联执行上游；最终确认及提交开始保存后复核输入、停止、模型和原输出。预分配 canvas_video 编号不是受理证明，丢响应只 GET 同编号，强核对画布/节点/动作/输入摘要/平台/模型，不自动重新提交。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

受理后立即备份 video 种类、原输出、动作/模型/输入摘要，保存成功才轮询。恢复不另建助手输出；回填须保持原连接，原 output.images 真实保存视频才核对完成，节点 generatedOutputs 单独存在不能作为完成证明。其它视频引擎和批量仍按能力目录待接入。

## examples

先 read_project_knowledge(classic.video,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
