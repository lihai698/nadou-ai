# 普通画布视频拆解 Implementation Plan

当前状态（2026-10-09）：Task1–7的产品实现、相关自动检查及普通/智能画布实际界面验收已完成。详细逐项证据见 [验收记录](../../视频拆解接入验收-20261009.md)；用户确认后只提交本功能并上传。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 推荐本次由当前执行者使用 executing-plans 连续实施；用户选择执行方式后开始。AGENTS.md 的本地验收和用户确认后提交约定优先于技能的频繁提交建议。

**Goal:** 完整接入视频右键→编辑里的按镜头拆和拆成镜头表，统一普通画布 UI，支持对白、编辑、重试、保存和生成所选镜头。

**Architecture:** 后端媒体引擎、任务编排及语音适配通过依赖注入接入 main；前端纯数据模型、原生画布桥和界面分开。切点任务先本地完成；模型请求必须经过整批确认，分析结果与生成节点各自保存自己的数据。保留原视频、预览、深度和剪辑。

**Tech Stack:** 现有 Python/FastAPI、FFmpeg/FFprobe、原生 JavaScript/CSS、Lucide、unittest、node:test；本地语音按需安装 whisper.cpp 多语言/VAD组件，云端走已配置平台。

**Spec:** [已确认设计](../specs/2026-10-09-canvas-video-deconstruction-design.md)。来源 HEAD `66d6eafed07ad6239acd765dd05c9eb0870cf849`；37 项 CUT/TABLE 是逐项验收依据。

## Global Constraints

- 入口：普通画布视频右键→编辑。样式复用 `--card/--soft/--line/--text/--muted/--strong/--strong-text` 与现有面板/Lucide。
- CUT 检测阈值 0.1；滑杆 0.10–0.70、步长 0.05、默认 0.30；检测 2 帧去重，界面 0.2 秒聚簇。
- 最多 120 切点，同分按时间均匀补齐；联系表 8 列、格高 90、按整数 PTS 点名。
- 一镜到底 N=round(duration/2.5)，限制 3–8；点位 duration*(i+1)/(N+1)，小数 3 位；落图 4 列、间隔 32、右偏 96。
- 镜头时间 0.1 秒量化，N+1 镜；默认每镜 3 帧，8%/50%/92%，取点 .001；并发 4、temperature .2、max_tokens 4000。
- 音轨 16kHz、单声道、64kbps MP3，50 分钟/25MB；本地 300 秒分段+30 秒尾巴、每段重试一次、游标至少前进 1 秒、多语言自动检测、VAD开启。
- 状态 idle/running/ready/failed/interrupted/cancelled；画布縮放 full≥.8、compact≥.4、card<.4。
- provider/model 复用本项目后台、手选、保存选择；不加入参考项目模型默认值。无可信价格写“费用以平台为准”。
- 不调用真实收费模型，不读写真实用户验收素材；测试使用独立数据及端口；本地语音真实安装/转写只限自制验收媒体并记录实际结果。
- 正式代码在真实入口；不复制 AGPL 项目源文件或外观。现有 dirty 布局/分组/助手不进入本功能提交。用户确认功能成功后才提交上传，不发布。

## Review Focus

1. output 同节点多视频及源替换：素材身份按实际结果/URL快照区分，旧视频分析保留；任务1/3/7固定测试。
2. VFR、旋转和非方形画面：PTS原图格不串位，缩略图/抽帧比例正确；任务2真素材测试。
3. 静音长片、中英混说和跨镜跨段：不幻听，不截句，不重复，对白有归属和进度；任务5分段测试及自制语音验证。
4. 同时编辑与模型迟到：单镜重试只更改目标分析结果，其余手工内容保留；取消/撤销/A→B→A拒旧写回；任务3/4/6测试。
5. 只读/无模型/凭据变化/费用授权重放：看表可以，写表和发模型必须拒绝；引用目录与输出不泄密、不访问内网；任务2/4/7测试。

## 文件职责与接口总览

|文件|职责|
|---|---|
|`backend/canvas_video_media.py`（新）|本地路径/安全远程缓存、probe、detect、PTS联系表、真实抽帧；复用 canvas_clip 工具定位/下载，不复制其实现|
|`backend/canvas_video_deconstruction.py`（新）|持久任务、确认批次、逐镜读图、结果解析与路由工厂；不反向导入 main|
|`backend/canvas_video_speech.py`（新）|本地组件安装/健康/分段/VAD，云端时间戳转写；统一 segments 返回|
|`backend/canvas_video_speech_assets.json`（新）|开放上游的已核对版本、大小、哈希、许可；独立核对，非直接复制 Nomi 清单|
|`static/js/canvas-video-deconstruction-model.js`（新）|纯切点/镜头表规则、数据校验、版本/复制映射|
|`static/js/canvas-video-deconstruction-host.js`（新）|原生节点落地、编辑/撤销、选行、异步代次保护、生成节点身份映射|
|`static/js/canvas-video-deconstruction-ui.js`（新）|视频编辑扩展、选帧、表节点和固定屏幕编辑面板、轮询/释放事件|
|`static/css/canvas-video-deconstruction.css`（新）|仅 `.video-deconstruction-*` / `.shot-table-*` 作用域，复用原生主题|
|`main.py`|注入用户/画布/存储/provider/模型调用依赖，注册新路由；按需增加可选LLM参数和音频配置字段|
|`static/js/canvas.js`|真实媒体入口、节点render/mount、保存/URL引用/复制/导出/删除桥、原生批生成调用|
|`static/js/canvas-depth-capture.js`|增加可选扩展菜单/内容host；旧调用方不传扩展仍保持原行为|
|`static/canvas.html`|按 model→host→ui 顺序加载及新 CSS，不改页面布局|
|`static/js/api-settings.js`、`static/api-settings.html`|原生后台模型配置增音频列表及时间戳兼容设置；复用现有平台凭据|

数据约定：`Source={canvasId,nodeId,resultId,sourceUrl,title,fingerprint}`；image结果 resultId=primary，output/generatedOutputs 使用显式 resultId 或实际 URL，不能用数组下标。任务启动时后端核对保存画布中的源及规范化 URL，生成不可篡改 `fingerprint`。

表节点 `type:'shot-table'`、`shotTableData={version:1,source,columns,rows,selectedRowIds,revision,analysisSettings,generationMap,task}`。row 为 `{id,index,startSeconds,endSeconds,durationSeconds,keyframeUrl,cells,imagePrompt,motionPrompt,carriedOver,visionFailed,failureReason}`。columns 用内部稳定 id、kind builtin/custom、label、hint。task 有 operationId/taskId/status/phase/progressDetail/error/failureKind/coverage；复制不继承在飞授权。

后端统一 `TaskContext={user_id,canvas_id,node_id,result_id,source_url,source_fingerprint,operation_id,table_revision}`；路由公开目录不返回密钥或内部配置摘要。任务记录只保存必要身份与选择，不保存 API 密钥。

## Task 1：纯模型和数据格式

**Files:** Create `static/js/canvas-video-deconstruction-model.js`; Test `tests/canvas_video_deconstruction_model.test.cjs`。

**Interfaces:** Produces `CanvasVideoDeconstructionModel`，同时支持 browser 全局与 CJS：`filterCuts(cuts,threshold)`, `defaultSensitivity(cuts)`, `evenFrameSeconds(duration)`, `buildShotRows(cuts,duration)`, `assignDialogue(rows,segments)`, `sampleSeconds(row,framesPerShot=3)`, `createTable(source)`, `normalizeTable(data)`, `editCell(data,rowId,columnId,value)`, `editColumn(data,action,payload)`, `remapCopies(nodes,idMap)`。函数返回新数据，不原地修改传入对象。

- [ ] 写失败测试：弱 .161 切点默认 .15；.2秒余震保留原 index；18秒均匀7帧首点2.25；0/1.46/1.468126/3切点3秒片得到2镜、边界1.5；10秒镜3帧 .8/5/9.2；跨镜整句归起点且标承接。
- [ ] 写表测试：六 builtin、custom 新增/改名仅 label/删除值、空名称拒绝、时间不可当可编辑 cells、rowId 去重和非有限值拒绝、selectedRowIds剔除失效行。复制重映射源/生成节点、清空运行task/grant、保留结果。
- [ ] 运行 `node --test tests/canvas_video_deconstruction_model.test.cjs`，确认缺少新模块等预期失败。
- [ ] 实现以上接口，固定所有全局约束；提示词仅在规定分析列编辑范围内变动。
- [ ] 同命令应全部通过，记录对应 CUT-02/03/04/07/08、TABLE-03/04/14/17/18/19 的结果。

## Task 2：本地检测与真实抽图

**Files:** Create `backend/canvas_video_media.py`; Test `tests/test_canvas_video_media.py`。

**Interfaces:** Consumes `find_media_tools(data_dir)`, `download_public_media(url,destination)`（canvas_clip）；注入 `resolve_local(url)`、允许存储根、输出/cache路径与 URL生成器。Produces `VideoMedia.detect(source,*,cancelled,on_progress)->{durationSeconds,fps,hasAudio,cuts,sheetUrl,sheetColumns,sheetRows,sheetTileHeight,coverage}`，cuts携带 seconds/score/index/pts；`VideoMedia.extract_frames(source,seconds,*,cancelled,on_progress)->{frames,failures,cancelled}`；`extract_audio(source)->{hasAudio,url,path,durationSeconds}`。

- [ ] 写失败测试：自制红白蓝三镜检测 1s/2s，联系表前两格白/蓝；201个同分切点 cap120覆盖末段；同一刀两帧去重，不合并独立快剪；图生成失败仍有有效 cuts。
- [ ] 写媒体边界测试：一镜到底抽图时刻、逐帧失败保留成功、取消后不继续启动FFmpeg、工具缺失和损坏视频明确失败；VFR/90度旋转/竖图比例；整数PTS点名，不按打印 score 重新筛图。
- [ ] 写读取测试：越界路径、`file:`、data/任意内网URL拒绝；只能解析允许根、下载复用安全重定向/DNS与体积限制。用户视频绝不删除或覆盖；cache失败只清本任务中间文件。
- [ ] 运行 `D:/daxiong/python/python.exe -m unittest discover -s tests -p test_canvas_video_media.py`，确认新增模块缺失失败。
- [ ] 实现媒体接口；FFmpeg subprocess用参数数组和可取消process，不拼shell；局部失败带明细，真实文件产出后才返回URL。
- [ ] 同命令全部通过；输出图片probe尺寸与像素断言，记录 CUT-01/04/05/06/09、TABLE-02/09/25。

## Task 3：原生落图、表节点和保存边界

**Files:** Create `static/js/canvas-video-deconstruction-host.js`; Modify `static/js/canvas.js` 的媒体编辑入口、renderNode、切画布/撤销/复制/URL引用路径；Test `tests/canvas_video_deconstruction_host.test.cjs`, `tests/canvas_video_deconstruction_integration.test.cjs`。

**Interfaces:** Consumes Task1模型；Produces `CanvasVideoDeconstructionHost.create(adapter)`，adapter为 `{getState,uid,pushUndo,save,render,select,readSource,createGroup,runGenerators}`。返回 `begin()`, `context(source)`, `isCurrent(ctx)`, `landFrames(ctx,result)`, `ensureTable(source)`, `editTable(id,change)`, `applyTask(ctx,task)`, `materializeRows(id,selectedIds,settings)`。getState 返回 canvas/nodes/connections/generation/scale；表的异步判断同时比较源fingerprint、节点对象身份/执行代次，不只canvasId。

- [ ] 写失败测试：选帧只生成image真URL，4列gap32源右96，组 items 是所有成功图，未创建任何图不建空组；一张成功允许按拆镜规格显式组，不改变普通单节点默认分组规则。
- [ ] 写来源测试：output两视频分别建表、删除首结果不变第二结果身份、替换源保留旧表、新源可重新分析、同源复用表并连线。
- [ ] 写状态测试：只读不写、删除/撤销后迟到结果拒写、A→B→A拒旧写回、单行重试保留别行编辑及实测字段、重复终态响应幂等，进度不占用户撤销步。
- [ ] 写复制/保存测试：引用source/keyframes纳入URL扫描；复制映射row和生成来源、清taskId/grant；保存重开未知任务进入interrupted；已有成功结果完整读回。
- [ ] 运行两项CJS测试，确认缺少桥接或入口失败后实施上述接口。`canvas.js` 仅加真实桥接，分组复用原数据格式，不改其他任务dirty实现。
- [ ] 两项测试全部通过；给真实页面装载一个独立测试画布，确认表节点、图片组和连线存在且保存读回一致。覆盖 CUT-10/11/12、TABLE-01/08/19/21/22。

## Task 4：持久任务、模型确认和多帧分析

**Files:** Create `backend/canvas_video_deconstruction.py`; Modify `main.py` 注入/注册、`CanvasLLMRequest`及 canvas_llm 可选参数；Test `tests/test_canvas_video_deconstruction.py`。

**Interfaces:** Consumes Task2 `VideoMedia`，注入 `{load_canvas,resolve_user,providers,call_vision,transcribe,storage_context}`。`VideoDeconstructionManager.prepare(context,mode,options)->Task`, `confirm(task_id,user_id,selection,expected_quote_id)->Task`, `get(task_id,user_id)->Task`, `cancel(task_id,user_id)->Task`。mode为 detect/frames/table/retry-shot/retry-speech。table准备完成后停在 `awaiting-confirmation`，仅此任务阶段为内部状态，表节点对外仍用idle/running等规范状态。

路由工厂 `create_video_deconstruction_router(dependencies)` 产生：POST `/api/canvas-video-deconstruction/prepare`; GET `/tasks/{id}`; POST `/tasks/{id}/confirm`; POST `/tasks/{id}/cancel`; GET `/models`。frames指定已检测的cut索引或均匀抽帧，不信任任意输入视频地址。Task含quote `{id,sourceFingerprint,tableRevision,columns,visionCalls,audioCalls,providersRevision}`，确认后服务器绑定provider/model、一次授权，逐次消耗，拒重放/多余请求。局部retry只报价目标镜或对白。

- [ ] 写失败测试：检测后未confirm时视觉调用0；7镜确认后7次，每次3帧、.2/4000；无音轨0次转写；用户取消确认0次；重复confirm/过期quote/换源/改provider配置/跨用户任务拒绝，不将授权错误折叠成逐镜失败。
- [ ] 写请求测试：多帧同镜/六字段/动态custom hint、中文规范；裸JSON/围栏/外部文本可解析，数组/错类型/空结果标单镜失败；记录真实usage不伪造费用；无读图能力模型禁用。
- [ ] 写任务测试：并发上限4，cancel后未发镜不调用；单镜失败保其他镜、retry仅目标；原task迟到不得覆盖cancelled；中途服务重启收敛interrupted；同operation不同payload409。
- [ ] 写main回归测试：CanvasLLMRequest增加可选 temperature/max_tokens，旧请求不传仍保持原请求body；新分析请求参数进入实际上游适配；不支持这类参数的协议按原协议明确适配或禁用，不静默假称参数生效。
- [ ] 运行 `D:/daxiong/python/python.exe -m unittest discover -s tests -p test_canvas_video_deconstruction.py`，预期失败后实现；后台保存使用atomic_json，不存密钥；异步请求由取消事件阻止后续派发。
- [ ] 同命令通过；全部读图和云端mock，无付费调用。覆盖 TABLE-05/06/07/08/15/16/21/22/25、权限审计。

## Task 5：本地与云端对白转写

**Files:** Create `backend/canvas_video_speech.py`, `backend/canvas_video_speech_assets.json`; Modify `main.py` 的 ApiProviderPayload/normalize_provider/public_provider/provider保存与读取；Modify `static/js/api-settings.js`, `static/api-settings.html` 的原生模型配置；Test `tests/test_canvas_video_speech.py`, `tests/test_canvas_video_speech_settings.py`。

**Interfaces:** Produces `VideoSpeech.transcribe(audio,selection,*,cancelled,on_progress)->{segments,hasSpeech,detectedLanguage}`；selection为 `{mode:'local'}`或`{mode:'cloud',providerId,model}`。统一segments `{start,end,text}`（秒）。`installation_status()->{installed,totalBytes,deviceNotice}`；`install(*,cancelled,on_progress)`按需运行。后台音频字段 `audio_models:[]`, `audio_timestamp_models:[]`（明确兼容时间戳的子集）默认空；不自动填外来模型。

- [ ] 写分段测试：660秒按300秒名义段+30秒尾巴；290–310秒整句只收一次、下段从310秒续接；静音每段至少前进300秒；最后尾段不丢；分段失败重试恰1次后明示段号。
- [ ] 写本地测试：只接受多语言权重，VAD开启、language auto，空语音输出空segments而非伪对白；损坏hash/DLL缺失/健康失败明确原因，安装下载有真实MB进度；用户未触发本地安装不下载。
- [ ] 写云端测试：现有provider凭据解析、不向前端发key、只允许已配置audio+timestamp模型；使用协议 `/audio/transcriptions` + verbose_json，供应商另有协议由适配表明确实现，非兼容项禁止选择；无segments不能猜镜头归属；取消阻止未发请求。
- [ ] 写设置兼容测试：旧配置无audio字段读成空列表，现有chat/image/video/model_names及密钥保留；关闭平台的音频模型不出现；本地失败绝不自动发云端，explicit cloud确认后才发。
- [ ] 运行两项unittest确认失败后实现；独立核对官方开放组件版本/大小/哈希/许可证写manifest，不复制Nomi文件；压缩包校验、解包范围校验、原子安装、复验成员；本地服务仅监听127.0.0.1。
- [ ] mock检查通过后，用自制短语音/静音验证本地引擎真实健康及timestamps；仅按需下载开放组件，不读取用户媒体。真实安装或转写无法运行时报告具体阻碍，不宣称对白功能完整，不用删功能替代。
- [ ] 两项unittest通过、配置UI实际保存重开确认；覆盖 TABLE-09/10/11/12/13/14/15，记录本机速度与安装体积，避免引用参考机器数字。

## Task 6：视频编辑面板、表节点和手机界面

**Files:** Create `static/js/canvas-video-deconstruction-ui.js`, `static/css/canvas-video-deconstruction.css`; Modify `static/js/canvas-depth-capture.js`, `static/canvas.html`, `static/js/canvas.js`; Test `tests/canvas_video_deconstruction_ui.test.cjs`。

**Interfaces:** Consumes Task1/3/4/5。Produces `CanvasVideoDeconstructionUI.openCuts(source,host)`, `openTable(tableId,host)`, `mount(element,node,host)`, `reconcile(context,visibleIds)`, `closeAll()`。CanvasDepthCapture.open 新增可选 `extensions:{onOpenCuts,onOpenTable}`，菜单以该扩展决定显示，老深度调用仍可独立使用。

- [ ] 写失败测试：视频编辑新菜单两项；检测中/失败/单镜/过滤空/cap提示/提交done-total/部分抽图失败；默认全选，空选禁用，Esc/遮罩非提交关闭，运行中关闭/取消含义明确。
- [ ] 写表界面测试：六列/只读缩略图/时间/状态；双击编辑与手机编辑同源；custom表头右键/⋯改名删除；提示词查看/编辑、选行保存、单镜重试、本地失败显式云端/配置入口；ready入口只聚焦不重跑。
- [ ] 写交互隔离测试：textarea/input/select/button/表横滚不触发画布拖动与Ctrl+G；重复open/close无重复事件；删除节点/切画布清面板与轮询；错误/进度分开；所有自由文本用转义或textContent防XSS。
- [ ] 运行 `node --test tests/canvas_video_deconstruction_ui.test.cjs` 确认失败后实现。固定面板复用depth面板外壳，新增选择/表格类有统一前缀，不能复用全局 `.hint` 等易冲突类名。
- [ ] 该测试通过后实际打开普通画布的编辑入口；桌面与390px窄屏、浅深主题、.8/.4缩放边界检查。表完整桌面横滚、窄屏逐镜卡片、操作栏可见，中文/禁用/错误不溢出。
- [ ] 切换现有预览与深度动作捕捉各操作一次，剪辑节点仍能打开；记录 CUT全项、TABLE-17/18/19/20/21/22 UI截图和结果，mock数据标记仅限测试，不进入真实运行。

## Task 7：生成所选镜头与原生批生成

**Files:** Modify `static/js/canvas-video-deconstruction-host.js`, `static/js/canvas-video-deconstruction-ui.js`, `static/js/canvas.js`; Test `tests/canvas_video_deconstruction_generation.test.cjs`。

**Interfaces:** `materializeRows(tableId,selectedIds,settings)->{generatorIds,createdIds,reusedIds}`；settings与原生API generator一致，明确provider/model/ratio/resolution/quality。adapter `runGenerators(generatorIds)` 用现有 `runNodeCascade(generatorId)` 的原生任务链和并发控制，不另起生图API。节点链为 prompt→`type:'generator'`→output（本项目真实API生图节点类型是generator，不是api）。映射key为table sourceFingerprint+rowId，保存到generationMap。

- [ ] 写失败测试：只生成选行；imagePrompt优先visual兜底；保留镜头时长和motionPrompt元信息；provider/model必须手选且属于后台启用图片列表；空选不建节点。
- [ ] 写素材与身份测试：原片帧不自动连generator/不进入图片请求；用户商品参考复用原生引用；再次生成复用原节点；手工prompt/model编辑不被分析结果覆盖；复制表后映射新节点或解除不存在节点归属。
- [ ] 写批次测试：取消确认不创建/提交；确认后只提交所选节点，走原生失败/重试/任务恢复，单镜失败不阻碍其他镜；切画布期间不提交新源；原输出多视频身份维持Task3规则。
- [ ] `node --test tests/canvas_video_deconstruction_generation.test.cjs` 确认失败后实施接口，沿用现有图像节点尺寸参数及批任务渠道。
- [ ] 测试全部通过，在独立画布mockprovider真实页面确认节点、连线、输出任务和去重；不调用付费模型。覆盖 TABLE-23/24。

## Task 8：整体验收、旧路径清理和源码同步

**Files:** Create `docs/视频拆解接入验收-20261009.md`; Update 本计划及spec中的实现状态；仅清理本次被完全替代的重复路径和测试fixture。

- [ ] 对照37项逐项记录实现文件、逻辑测试、UI操作证据与任何未验证项；非测试模拟的关键能力缺失时不得标整体验收成功。
- [ ] 跑相关CJS、Python全新模块检查，`node --check`新JS，Python编译检查；再跑现有剪辑、深度、保存/复制/分组/原生快捷键回归。测试数据根用temp目录；导入来源打印__file__以确认没有误测主数据副本。
- [ ] 主页面独立端口63725与独立数据运行，自制媒体完成本地拆镜→落图/分组→镜头表保存/重开→mock读图+转写→编辑→单镜重试→原生生成。真实本地转写与mock云端分开记录，不称真实云端质量通过。
- [ ] 用cua_repl检查实际UI并保存截图；桌面/390px、浅深、正常/选中/禁用/处理中/错误、弹窗与横滚遮挡检查。恢复临时浏览器viewport，不移动/删除用户节点。
- [ ] 检索真实新入口与旧引用，确认新实现可用后清除本任务重复旧代码，再跑相关检查；原预览/深度/剪辑不属于被替代实现。
- [ ] 按用户所选执行方式完成独立代码审阅：直接实施时，在整批实现及检查后由独立审阅者检查完整差异；子代理方式按任务审阅后再整体审阅。缺陷先修复并复验，再交用户验收。
- [ ] 给用户本地验收入口与操作步骤、关键文件、测试结果和限制。此时不push；用户明确确认“手动测试可以”等才按AGENTS挑选本功能差异提交，并正常推个人main。
- [ ] 上传前核对待提交差异/远程、排除素材/cache/用户配置及其他dirty任务；正常推送后核对remote hash，失败如实报告，不发布tag/Release/安装包。

## 计划自查与执行交接

覆盖：Task1→CUT02/03/04/07/08、TABLE03/04/14/17/18/19；Task2→CUT01/04/05/06/09、TABLE02/09/25；Task3→CUT10/11/12、TABLE01/08/19/21/22；Task4→TABLE05/06/07/08/15/16/21/22/25；Task5→TABLE09–15；Task6→两条完整UI链与TABLE17–22；Task7→TABLE23/24；Task8→真实入口、兼容回归与源码同步。全部37项有owner，无额外来源功能。

依赖：1/2提供纯规则和真实媒体→3/4建立原生数据与任务→5补齐对白→6界面串接→7生成→8验收。实施者不得因中间画面可见就跳过对白、自定义列、单镜重试、复制/保存或生成所选。

本计划尚未执行。下一步需用户审阅并选择：当前执行者直接连续实施、完成后独立整体审阅（推荐，模块共享接口多，避免跨执行者反复交接）；或分任务子代理实施与逐任务独立审阅。执行前使用所选对应技能，保持当前已确认设计范围。
