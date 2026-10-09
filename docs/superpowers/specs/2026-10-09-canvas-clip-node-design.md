# 普通画布剪辑节点：来源核对与接入设计

日期：2026-10-09。状态：已接入普通画布并完成本地验证；用户确认加号素材识别修复可以，按项目约定同步本功能源码。本文件记录实现边界及验证证据。

## 1. 已确认的目标

用户指定从对话 `01a11c62-abba-7a50-a0c6-3127fa2cce92` 的项目引用剪辑节点，逐项分析，不遗漏。界面全部采用本项目普通画布的主题、Lucide、按钮、节点、预览和面板元素。

用户已确认：导出默认保留原视频声音，并提供静音开关。当前范围为普通画布内的紧凑剪辑轴，输入已有图片/视频，剪辑后输出真实视频。接入智能画布不在本阶段内。

## 2. 来源与证据边界

- 项目：Nomi，`D:\资源\青云 AI 画布\Nomi`。
- 仓库：`https://github.com/aqm857886159/Nomi.git`。
- 版本：v0.23.1，commit `66d6eafed07ad6239acd765dd05c9eb0870cf849`。
- 来源许可为 AGPL-3.0-only，目标 LICENSE 为本项目自定义许可。本设计依据行为规格独立编写原生实现，不直接复制 Nomi 的代码或资源，不修改本项目许可证。若后来决定复制源码，须先另行解决许可证兼容及履约问题。
- 已阅读下表相关真实源码，使用 Node 内置 TypeScript 剥离和 VM 只读运行 13 个模块，21 项纯逻辑检查通过。探针仅替代 i18n 文案，不替代业务计算。
- 临时证据：`%TEMP%\nadou-layout-20261008\nomi-clip-audit-evidence.json`、`audit_nomi_clip.cjs`。
- 已验证的是时长、去重、帧计算、源偏移、分割、删除排除、轴延展、缩放换算和导出任务拆分。未验证 Nomi 的实际界面或真实 MP4 成片；本项目的实际导出也尚未实现。

以下来源路径以 `src/workbench/` 为根，`nodes/` 表示 `generationCanvas/nodes/`；媒体工具 `useFilmstrip.ts`、`videoDurationProbe.ts` 位于 `src/media/`。

## 3. 逐项功能对照

| ID | 入口、规则与原版默认值 | 真实来源 | 本项目接入与验收要求 |
|---|---|---|---|
| CLIP-01 | 节点菜单创建剪辑轴；默认 760×132；宽 560–960，高 120–180 | nodes/registry.ts、nodeSizing.ts、ClipNode.tsx | 普通画布右键及已有“更多→节点菜单”增加剪辑节点，沿用 addNode/createNodeByType；目标宽560–960，默认760×196，高188–260，为原生标题与可见操作说明留足空间；手机查看时适配排版 |
| CLIP-02 | 标题、片段数、总时长 mm:ss | ClipNode.tsx | 用现有 node-head，显示真实数量及最后片段结束帧；不把末尾留白计入成片时长 |
| CLIP-03 | 分割、复制、删除、导出；无选中片段/忙时禁用并提示 | ClipNodeActionToolbar.tsx | Lucide scissors/copy/trash-2/download，原生 tool-btn；触摸可达，不只靠 hover 说明 |
| CLIP-04 | ＋打开项目素材选择或本地上传，只收图片/视频 | ClipNodeTimeline.tsx、clipNodeModel.ts、clipNodeUpload.ts | 复用资产库与 /api/local-assets/upload；独立音频明确提示不支持，不默默丢弃 |
| CLIP-05 | 上游连线收集 image/video 的真实 result.url；空生成节点不是素材 | ClipNode.tsx、clipNodeModel.ts | 按真实输出媒体类型过滤，包括 output.images 和多结果；每个结果使用稳定来源身份，不凭节点标题判断 |
| CLIP-06 | 按 sourceNodeId 去重，分割/副本共用源身份 | clipNodeModel.ts、clipNodeSequence.ts | 本项目多结果采用来源节点 ID＋结果身份，避免同节点不同结果被误去重；普通单结果行为一致 |
| CLIP-07 | 删除最后实例写 excludedSourceNodeIds；手动加回解除排除 | clipNodeModel.ts、ClipNode.tsx | 保存排除列表；删除后同步、保存重开都不自动灌回 |
| CLIP-08 | 新上游素材追加；断连不删；已有来源结果变化不自动替换旧剪辑快照 | clipNodeModel.ts、ClipNode.tsx | 保留快照规则，必要时用户删除并手动重新添加，不能让成片悄悄变动 |
| CLIP-09 | 素材库图片默认 4 秒；视频真实 metadata 时长，探测超时 8 秒/失败回退 6 秒 | clipNodeModel.ts、videoDurationProbe.ts | 保持默认和超时，回退时显示“时长未确认”；正式导出前后端复核视频真实边界 |
| CLIP-10 | 上游缺 durationSeconds 时回退 6 秒，包含图片，与素材库图片 4 秒不同 | clipNodeModel.ts | 按来源保留这项原版差异并明确提示；不悄悄统一默认值 |
| CLIP-11 | 单视觉轨，图片/视频混排，固定 30fps，时间均为整数帧 | clipNodeSequence.ts、timeline/timelineTypes.ts | 原生独立帧模型，所有时长/偏移同一转换规则；至少 1 帧 |
| CLIP-12 | 保存实例 ID、来源、URL、poster、源时长、源偏移、时间线首尾、选中及排除 | clipNodeModel.ts、clipNodeSequence.ts | serializableCanvasNode 保存纯 JSON；移除运行时播放器、监听器和对象 URL；编辑历史纳入现有撤销 |
| CLIP-13 | 初始 30 秒窗口、10 秒刻度；超长横向延展，末尾 4 秒留白，不压缩片段 | clipNodeTimelineLayout.ts | 时间线独立横向滚动；小屏看到的是局部轴，不把帧精度随屏宽改变 |
| CLIP-14 | 片段图片缩略图、视频 poster；缺 poster 取 16 格 filmstrip，共享缓存，并发 2 | clipNodeVisual.ts、media/useFilmstrip.ts | 优先现有缩略图，无图按受控并发抽帧；失败占位，不用虚构缩略图；裁剪显示跟随源偏移 |
| CLIP-15 | 点击片段选择、定位播放头并打开浮动预览 | ClipNodeTimeline.tsx、ClipNodePreview.tsx | 编辑片段不触发画布节点拖动；预览按本项目图片/视频比例适配 |
| CLIP-16 | 空隙定位最近片段，成片预览黑场；尺子与播放头可拖 | ClipNodeTimeline.tsx、ClipNodePreview.tsx | 空隙不得拉长上一个素材冒充内容；黑场和静音与导出一致 |
| CLIP-17 | 拖片段允许空隙，防重叠，寻找合法位置 | clipNodeDragModel.ts、timeline/timelinePlacement.ts | 预览与提交一致，画布 0.5×/1×/2×都正确；手势结束只写一次历史 |
| CLIP-18 | 吸附到 0、播放头及其他片段首尾；Shift 临时关吸附；显示辅助线和标签 | timeline/snapping/*、ClipNodeTimeline.tsx | 复用主题提示，不误做逐秒吸附；屏幕像素吸附阈值换算到实际画布缩放 |
| CLIP-19 | 左右裁剪，视频受源边界与邻居限制，图片可拉长，至少 1 帧 | timeline/timelineEdit.ts、ClipNodeTimeline.tsx | 严守源 offset＋visible≤sourceDuration；原版疑似左扩越界行为不复制；显示改动秒数 |
| CLIP-20 | Esc/失焦/pointercancel/lostcapture取消；rAF处理移动，结束刷新最后坐标 | ClipNodeTimeline.tsx、clipNodeDragModel.ts | 清监听、capture与提示，不保存中间或取消状态；触摸上下滚动不误启动裁剪 |
| CLIP-21 | 播放头在所选片段内部才可分割；端点不可分；两个实例源偏移不同 | timeline/timelineEdit.ts、clipNodeSequence.ts | 例如已裁去 2 秒的视频在第 3 秒分割，右段从原片第 5 秒开始 |
| CLIP-22 | 复制独立片段实例，保留裁剪，落最近合法空位 | timeline/timelineEdit.ts、clipNodeSequence.ts | 副本 ID 更新、来源身份不变，不覆盖邻片 |
| CLIP-23 | 删除所选片段后全部剩余片段收紧到连续序列；不删素材文件 | clipNodeSequence.ts | 一次可撤销操作；删除最后实例同时写来源排除 |
| CLIP-24 | 预览浮窗：播放/暂停、默认静音、音量开关、当前/总时长、滑条、关闭 | ClipNodePreview.tsx、timeline/useTimelinePlaybackClock.ts | 预览初始静音遵循浏览器播放限制；“导出静音”是独立设置，默认关，不能因预览静音让成片无声 |
| CLIP-25 | 到末尾停止，重播从头；跨片按 offset播放；关闭、失焦/切节点清理 | ClipNodePreview.tsx | 检查视频解码/播放错误及恢复；空隙正确黑场；无后台残留声音 |
| CLIP-26 | 编辑态 Ctrl/Cmd+Z、Shift+Z；←/→播放头±1；Delete/Backspace删片段；S分割；Ctrl/Cmd+D复制；Shift+< / >微移1帧；Esc关 | timeline/timelineShortcuts.ts、ClipNode.tsx | 限剪辑编辑焦点内，与画布复制/删除/撤销隔离；输入框不劫持；手机都有按钮 |
| CLIP-27 | 共享解析器的 N/Q/W/+/-/0/ShiftDelete 未被此节点处理；片段上 Space 是选择 | timeline/timelineShortcuts.ts、ClipNode.tsx | 不把解析器能力列成实际节点功能，不额外扩张快捷键 |
| CLIP-28 | 导出 full完整成片/segments逐段 × canvas回画布/download，共4组合 | clipNodeExport.ts、ClipNode.tsx | 导出面板两组选项，默认完整成片＋回画布；确认键显示文件数量与目标 |
| CLIP-29 | 固定 16:9、1080p、30fps、standard、MP4 H.264 yuv420p；原静音 | export/renderManifest.ts、ClipNode.tsx | 保持画面规格；用户已确认默认保留声音，添加 AAC 48kHz 双声道；静音时无音轨；图片/无声片/空隙补静音，不使有声片失声 |
| CLIP-30 | full保留时间线空隙；segments逐段从0开始且保留源trim，顺序命名串行执行 | clipNodeExport.ts | 完整成片补黑场；分段数等于片段数；部分成功可见并可重试失败项，不伪报全部成功 |
| CLIP-31 | 回画布创建并连线视频结果，保存sourceClipNodeId/sourceClipId；重复导出复用同源结果 | clipNodeOutput.ts、ClipNode.tsx | output节点放真实URL、时长和来源，不套假生成任务；更新前保留旧有效结果，成功后替换当前来源的结果引用 |
| CLIP-32 | 原Electron下载完成showInFolder，不是浏览器下载 | export/exportApi.ts、ClipNode.tsx | 改用本项目 downloadUrl → /api/download-output；多段按结果清单逐项可下载，避免浏览器拦截导致“已下载”假提示 |
| CLIP-33 | 上传/导出绑定操作开始时的项目；切项目不写新项目；A→B→A也取消旧导入 | clipNodeUpload.ts、ClipNode.tsx | 捕获canvasId＋激活代次＋nodeId；后端任务以起始画布归属；失效结果保留为任务结果，不误回写 |
| CLIP-34 | 上传互斥，失败保留File便于重试，忙时不可关闭素材picker | clipNodeUpload.ts、ClipNode.tsx | 复用现上传入口，中文状态、重试；待上传File只留内存，不写画布JSON |
| CLIP-35 | 导出互斥、错误提示、finally恢复按钮；FFmpeg优先，必要时WebM录制转MP4回退 | ClipNode.tsx、export/exportApi.ts | 目标为服务端真实FFmpeg；缺失/不支持解码报具体错误并保留编辑；不把浏览器假录像当成成功MP4；来源的真实WebM回退单独记录，目标本阶段不承诺跨编码回退 |
| CLIP-36 | readOnly隐藏编辑入口，但回调禁写边界不够明确 | ClipNode.tsx、ClipNodeTimeline.tsx | 原生只读模式所有编辑/上传/保存都禁写，仍可观看 |
| CLIP-37 | 画布保存、复制、导入导出、撤销与恢复 | ClipNode.tsx、clipNodeModel.ts；目标canvas.js | 深拷贝片段并重映射节点/实例/输出来源；仅复制剪辑节点仍保留素材快照；刷新不重复灌入 |
| CLIP-38 | 上下游源素材与输出生命周期 | clipNodeOutput.ts；目标media_reference_rules.py | 嵌套片段URL参与缺失检查、引用保护、工作流资源收集，任何清理不删除仍被其他画布引用的原素材 |

### 不属于这个节点的能力

此紧凑节点不提供字幕轨、多轨音频、独立配乐、转场、调色、变速、关键帧、模型选择、生成参数、内置提示词或提示词模板替换。Nomi 完整时间线工作台是另一个入口，不把它的全部功能自动引进来。预览/静音/四种导出/重试/保存不是装饰，均在本设计内。

## 4. 界面设计及查看方式

推荐使用画布内原生横条节点。另一种方案是独立编辑工作台，会打断节点工作流且超过当前范围；一直展开的大预览节点会增加遮挡。因此本设计采用紧凑轴＋按需预览/导出。

- 沿用 `static/css/canvas.css` 的 --page、--panel、--card-solid、--soft、--line、--text、--muted、--strong，以及 node/node-head/tool-btn；不复制 Nomi 黑蓝外观。
- 标题左侧“剪辑轴 / 片段数 / 总时长”，右侧分割、复制、删除、导出。主体只放尺子、单轨和＋入口。
- 点击片段显示浮动预览，尺寸受视口约束，不拉伸图片；移动端用视口内面板。面板关闭可回到剪辑轴。
- 导出面板两组二选一：完整成片/逐段、回到画布/下载。另有“导出静音”开关，默认关闭，简短显示 MP4 / 1080p / 30fps。
- 手机不把整个节点等比缩到看不清：标题和操作按钮换行，时间线保持帧密度可横向滚动；完整功能仍可通过可见按钮使用。
- 预览为单一布局，用“有素材、空节点、成片预览、导出、错误”逐屏查看；有浅色/深色切换。素材画面为自制 SVG 示例，不读用户素材，不执行真实上传、下载、生成或导出。

## 5. 接入结构与数据流

新增原生模块，不引入 React/Electron 或另一套时间线框架：

| 位置 | 职责 |
|---|---|
| static/js/canvas-clip-model.js | 整数帧模型、同步去重/排除、分割/复制/删除/裁剪/吸附及导出任务拆分，不直接写画布 |
| static/js/canvas-clip-node.js | 节点渲染、焦点/手势、预览、素材选择和导出面板；由 canvas.js 注入保存/历史/输出/生命周期接口 |
| static/css/canvas-clip.css | 仅 clip-node 及所属浮层样式，全部用现有变量 |
| backend/canvas_clip.py | 输入验证、媒体探测、图片/视频/空隙渲染、音频补齐、真实导出任务；不反向导入main.py |
| main.py | 注册剪辑导出/状态路由，注入已有路径映射、输出存储和任务归属服务 |
| static/js/canvas.js、static/canvas.html | 真实节点入口、连接、撤销、复制重映射、持久化、资源引用、模块加载及销毁 |
| tests/canvas_clip_model.test.cjs、tests/test_canvas_clip.py | 边界逻辑及真实混合媒体导出验收 |

数据建议：`clipData:{version:1,fps:30,clips:[{id,sourceNodeId,sourceResultId,kind,url,posterUrl,sourceDurationFrames,sourceOffsetFrames,startFrame,endFrame}],selectedClipId,excludedSources,exportMuted:false}`。剪辑的源偏移与时间线位置分开；不保存DOM、File、播放时钟或运行中状态。

上传/连线 → 媒体快照 → clipData → 编辑预览 → 导出快照及任务 → 实际文件 → 原生output或下载。导出只能在后端确认文件有效后回写；前端进度文案不能作为成功凭证。

已核对目标关键缺口：

1. `canvasLocalAssetUrls` 目前只扫描顶层素材列表，需加剪辑嵌套URL。后端 `media_reference_rules.py` 已递归匹配，但工作流资源提取仍需逐入口验收。
2. `serializableCanvasNode` 当前排除若干运行时字段；剪辑实例应同样排除播放器等运行态。
3. `pasteNodes` 当前只重映射分组/深度节点，新剪辑来源及输出归属需显式重映射，避免复制后写原节点。
4. `/api/smart-canvas/minimax-export` 仅处理视频、720p且不保留空隙，不能拿它替代本节点。现有任一无声片可能使所有片段静音，不能继承该行为。
5. 当前Shell PATH 未找到 ffmpeg/ffprobe，需实施时核对应用运行时或已有工具缓存；确认来源和可用版本后才接真实导出。预览阶段不安装依赖。

## 6. 验收要求

- CLIP-01–38 每项记录“已实现/验证通过/限制”，没有真实验证的不得标完成。
- 模型测试：6秒回退、4秒图片、重复来源、多结果、排除复加、分割端点、2秒offset分割、左右裁剪边界、1帧、复制合法落位、删除收紧、30秒延展、空隙导出与逐段偏移。
- 界面：浅深色、390px、0.5×/1×/2×缩放；全部按钮、中文、正常/选中/禁用/加载/错误、拖动取消与最后一帧、输入框快捷键隔离、预览声音清理。
- 生命周期：保存重开、剪辑与来源一起复制/仅复制剪辑、工作流导入、撤销恢复、删除最后实例不灌回、只读、A→B→A上传取消及导出归属。
- 后端以自制测试素材验证“图片＋有声视频＋无声视频＋空隙”，实际用 ffprobe 检查1920×1080、30fps、H.264、时长；保留声时检查AAC及有声段能量，静音时确认无音轨；抽帧确认顺序/裁剪/黑场；四种导出结果真实可播放。
- 异常：不存在文件、越界offset、损坏媒体、FFmpeg缺失、任务失败/部分成功、重复提交、节点删除和画布切换，均不覆盖旧有效结果、不假报成功。
- 跨画布素材仍被引用时不可删；不对用户素材做测试性裁剪覆盖，不调用收费生成服务。

## 7. 交付与旧实现

本阶段已接入正式普通画布入口，没有保留脱离画布的产品副本，也没有删除其他旧功能。用户验收前不提交或推送；用户确认成功后，按 AGENTS.md 只提交本功能相关源码、测试和说明。其他未验收改动不能混入。

### 正式接入验收记录（2026-10-09）

- CLIP-01–38：已实现并按范围完成对应源码检查；其中画布交互、保存重开、复制重映射、只读、失败恢复、手机编辑面板由真实 Edge 普通画布隔离验收覆盖，最终脚本 31 项通过、页面错误 0。
- 模型/宿主/局部刷新：`node --test tests/canvas_clip_host.test.cjs tests/canvas_clip_integration.test.cjs` 10/10 通过；新增覆盖“视频时长探测期间第二批生成结果仍自动补入”。
- 前端与既有回归：全体 CJS 测试 280/280 通过；相关 JS `node --check`、Python 编译和 `git diff --check` 通过。
- 后端：`tests/test_canvas_clip.py` 12/12，通过图片、有声视频、无声视频、空隙、偏移、固定规格、静音/有声和任务归属检查；工作流资源、媒体引用、存储删除保护各 3/3 通过。
- 真实成片：四种组合（完整/逐段 × 回画布/下载）均生成并下载有效 MP4；ffprobe 核对 1920×1080、H.264、yuv420p、30fps；有声为 AAC 48kHz 双声道，静音无音轨。证据在 `%TEMP%\nadou-clip-qa-20261009\` 与 `C:\Users\Administrator\.codex\visualizations\2026\10\08\01a11b2c-7428-7f30-9fbb-cbf2a592d39c\`。
- 正式服务：已在确认空队列后重启并加载剪辑路由，`/` 返回 200，剪辑任务查询路由返回预期中文 404；当前服务 PID 5576。未修改用户画布或素材。
- 当前限制：未对超长视频和所有第三方编码组合做性能覆盖；正式用户数据仍需手动验收后才进入 Git 提交/同步。

### 用户确认后的源码同步检查（2026-10-09）

- 加号素材列表修复：先读取当前普通画布的图片、视频、输出及生成结果，再合并资产库/上传素材并按 URL 去重。真实 Edge 页面验证四类素材同时可见，页面错误 0；用户回复“可以”。
- 提交范围：剪辑模型、宿主、节点界面、样式、真实导出后端、正式入口、5 个相关测试及本设计/实施文档，共 15 个文件。共享 `canvas.js` 和 `canvas.html` 逐段筛选，不纳入尚未验收的布局、分组或创作助手修改。
- 待提交源码快照：相关前端测试 34/34，后端及资源引用测试 21/21，语法和编译检查通过；真实浏览器加号素材识别通过。
- 扩展检查：待提交快照全部 CJS 为 269/273；4 项失败均在未修改的 HEAD 基线上原样复现，是既有测试隔离缺口（智能画布深度恢复依赖、普通画布元数据合并依赖），未混入其他任务的测试修正。本剪辑相关检查全部通过。
- 采用正常推送到个人仓库主分支，提交前核对远程与本地基线一致；不创建发布标签或安装包。

### 本次预览验证记录

预览地址：`http://localhost:63722/`；源码：`C:\Users\Administrator\.codex\visualizations\2026\10\08\01a11b2c-7428-7f30-9fbb-cbf2a592d39c\clip-node-preview.html`。

使用真实 Edge 浏览器检查：27项通过，页面JavaScript错误0，素材/样式请求失败0。覆盖四种导出选择、默认保留声/静音切换、预览与导出声音设置独立、空态禁用、错误忙状态恢复、390px的五个页面均无整页横向溢出且操作按钮在视口内；已人工检视浅色桌面、深色导出、手机导出和手机成片预览截图。

截图及 `clip-preview-validation.json` 与预览放在同一临时产物目录。该记录只证明界面预览，不证明正式节点、拖动剪辑、持久化或真实MP4输出已完成。
