# 智能图片节点

## overview

智能画布的素材、图片/视频结果及可执行输入主体。smart-container 或旧smart节点缺type 规范化为 smart-image；普通画布缺type不套用此规则。

## controls

素材预览/选择、添加/移除引用、编辑提示词草稿、原生创作面板引擎与平台/模型、比例/尺寸/质量/数量、生成、链路运行、扩图/图片编辑等原生工具；每个工具的按钮权限由真实界面决定。

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
- generic: 上传节点
- button "删除节点":
- generic: 上传节点
- generic: 拖拽 / 粘贴 / 点击上传
- generic: 支持图片 / 视频 / 音频，也可直接文生图
- generic "input"
- generic "output"
```

## parameters

创建仅有 images/title/created_at/scale 等素材字段；有效模型参数由 smartSettingsForNode 合并画布默认、最近设置、节点runSettings。runSettings 是本次保存设置，不是请求已经成功的证明。API、视频、ModelScope、RunningHub、ComfyUI 是不同引擎，不能只读取 model 字段。

- `apiProvider`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `engine`：创建表达式 `runtime：由当前节点/模型规则决定`。
- `model`：创建表达式 `runtime：由当前节点/模型规则决定`。

runSettings 中已可读取字段：apiKind, apiProvider, aspectRatio, cameraFixed, comfyMode, comfyWorkflow, count, customHeight, customRatio, customRatioHeight, customRatioWidth, customSize, customWidth, duration, editModel, editUpscale, editUpscaleRes, enableUpsample, engine, enhancePrompt, enhanceStrength, enhanceUpscale, enhanceUpscaleRes, fitImage, generateAudio, guidance, height, imageStrength, instanceType, jimengUpscaleRes, mode, model, msCustomHeight, msCustomModel, msCustomRatio, msCustomRatioHeight, msCustomRatioWidth, msCustomSize, msCustomWidth, msHeight, msLoraEnabled, msLoraId, msLoraStrength, msRatio, msResolution, msWidth, msgenModel, multimodal, outpaintCustomHeight, outpaintCustomWidth, outpaintEnabled, outpaintRatio, outpaintResolution, provider_id, quality, ratio, resolution, rhConfigKey, rhInstanceType, rhMode, rhModel, rhPayment, seed, steps, strength, useFrameRoles, videoAspect, videoCameraFixed, videoDuration, videoEnableUpsample, videoEnhancePrompt, videoGenerateAudio, videoModel, videoMultimodal, videoProvider, videoResolution, videoTrustedAsset, videoTrustedSource, videoUseFrameRoles, videoWatermark, watermark, webappId, width, workflowId；动态comfyParams/rhParams按类型保留，凭据和任意嵌套供应商对象不转发。

正文分页字段：prompt, promptDraftText, promptDraftHtml, lastPrompt, runPrompt, runModelPrompt

## inputs_outputs

promptDraftText/promptDraftHtml 是下一次生成草稿，与 images 已生成作品分开。images.kind 可为视频；上游引用依 inputNodesFor 和原生角色规则。生成后的结果/待查询任务保存到原生结果节点。

## connections

普通画布 canConnect / 智能画布原生连接规则先验证类型、角色和自连；目标inputs顺序与连接列表必须同时检查。组的成员不是连接。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。

助手 `run` 当前仅开放空 `smart-image` 的 API 图片分支，必须保留节点 `runSettings` 中手选平台和模型，明确确认实际 1 至 8 个服务任务。原生 `runGeneration` 接入受控执行入口，复用 `buildPromptRequestForNode`、`runApiGeneration`、保存受理编号和 `resumeSmartPendingNode`；提交前不修改原输入或全局设置，每次请求复核确认。已有结果、扩图、循环/分组/分镜上游、其它引擎和音视频输入仍须使用原入口，不因目录中列出 run 而视为全部开放。
批量部分受理保留全部已取得原任务编号；响应未知记录未知项，继续只查原任务。保存失败不先轮询，不重提；模型/画布/输入变化或停止拒绝未提交项。自动检查和隔离模拟只能证明执行边界，不能证明实际模型效果。
每项受理立即进入原生本地恢复备份，包含助手动作编号和本批确认上限；同批其它请求仍在等待时刷新，能够恢复已知编号，未取得编号的剩余项保持未知并阻止重提。旧画布 inputNodeIds 和当前 connections 都用于上游范围检查。

generateUrlsForCurrentSettings 依 engine/apiKind 分派；querying、pendingTasks 与 acceptedTasks 记录真实任务。read_node_state 只读，不会提交生成；助手图像方案仍须用户点击生成。
音频上游时原生 API 参数显示文本模型，隐藏图片/视频切换、尺寸、质量和张数，提示词显示可选音频分析指令；generateUrlsForCurrentSettings 在 API 非视频分支、音频引用和文本模型同时成立时调用 canvas-llm，返回 text 并保存 audioOutputText，不提交图片任务。显式音频模型走 runSmartApiAudio。音频识别/分析正文可经 promptTextItemsForNode、textForNode 继续进入下游文本链；新图片结果清理旧 audioOutputText。上述音频分支不能套用助手图片运行确认；助手 smart-image run 已开放下述 API 图片子集，音频分支仍使用原手动入口。
带depthCapture的节点来自视频编辑的深度/姿态处理，创建成对智能图片节点（输出images.kind实际为video），灰度和姿态通过role区分并共享operationId/taskId。runtime.depthCapture返回原任务、来源和进度，results.depthCapture包含灰度/姿态视频和关节JSON；最长15秒，首次处理可能安装组件与模型。读取不是处理或重试。

## results

读取真实结果媒体和原任务状态。running=false不代表succeeded；没有权威状态时为unknown。字符串URL或结果对象都须保留真实媒体类型。
runPrompt是原提交显示文本，runModelPrompt是原请求文本，runPromptRefs/runInputRefs保留原提交引用；runAt/sourceNodeId说明提交时间与来源，不能用新promptDraftText替代。videoTaskId/videoTaskStatus/videoTaskError/taskFailureNotice记录视频查询或失效状态，query-paused不能重提交冒充恢复。
阶段B草稿编辑复用setPromptDraftForNode，同时保存promptDraftHtml/Text/Touched；明确修改过的草稿在loadPromptDraft和buildPromptRequestForNode中优先用于下一次请求。原提交、结果与引用保持只读；已有mention-image-token HTML仍按原生引用规则加载，空草稿也不回退成旧提交。上述原生setter/请求包装器已专项核验，收费模型效果另行验收。

## errors_recovery

执行前检查输入/模型配置；冲突时重读画布，不覆盖新改动。query-paused先查询已受理的原任务；task-lost需查明原因，不自动重提交。
深度query-error继续保留原taskId；retrySmartDepthCapture清空成对images并新建operationId重新处理，须作为新动作确认。watchSmartDepthCapture在缺taskId时会提交，不能把它当成只读查询；单纯查询只能读取原任务。

## persistence

原生 scheduleSave 保存节点字段和连线。复制/导入须重映射成员/连接编号。知识和节点状态工具只读，不修改工程。

## examples

先 read_project_knowledge(smart.image,parameters)，再 read_node_state(实际nodeId)，必要时补读上游节点；按实际工具目录规划可执行步骤。

## limitations

本卡提供源码规则；逐按钮UI验收和供应商实际效果分别记录。当前助手尚不能自动完成本节点所有原生动作，未登记动作保持pending。
