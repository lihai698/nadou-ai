# 智能画布镜头表

## overview
原生类型 smart-shot-table，是从视频拆解入口产生的镜头分析与生成编排表，不是直接调用视频生成器。数据保存在 shotTableData。原视频 source 与分析 task、手工编辑 rows、generationMap 分开；知道已保存内容不等于分析/生成已经成功。

文本创作现也可通过 create_story_workflow 创建同一原生表：source.kind=text、nodeId指向真实故事文本、fingerprint绑定原文；productionData保存剧情/资产/声音/分镜引用，generationMap关联每镜配图链。文本表可编辑和生成所选镜头，视频重分析及语音转写不适用于它。声音字段为设计稿，未合成音频。

## controls
视频入口创建/打开镜头表，重复打开相同 nodeId/resultId/sourceUrl 复用原表。节点展开编辑；桌面表格/手机单镜编辑、上一镜/下一镜、选择本镜、全选/全不选、保存编辑。六内置列为景别 shotSize、运镜 motion、画面 visual、对白 dialogue、屏幕文字 onScreenText、情绪 mood。自定义列新增、改名、删除需确认；内置列不能改名/删除。重分析本镜、重试对白/改用云端、重新拆解、取消本批、生成所选镜头；画布只读时禁用写入。缩放>=0.8完整、>=0.4紧凑、其余摘要卡；展示缩放不改变请求。

## parameters
version=1；revision随编辑递增。最多121镜；最多36列（6内置+30自定义）。列名1–60字，单元格/imagePrompt/motionPrompt字符串最多12000字。镜头 startSeconds/endSeconds/durationSeconds 量化0.1秒；时间非负，end>=start。选中selectedRowIds去重并过滤不存在行。自定义列hint初始等于列名；改名只改表头，原分析hint保留。运镜单元格编辑会同步motionPrompt。analysisSettings.providerId/model为手选视觉平台模型，speech.mode为local或cloud，云端speech.providerId/model也手选。生成使用手选图片providerId/model与原生ratio/resolution/quality，不套用参考项目默认模型。

## inputs_outputs
source.nodeId/resultId/sourceUrl/title/fingerprint/durationSeconds定位原视频和结果。rows含id/index/时间/关键帧keyframeUrl/cells/imagePrompt/motionPrompt/carriedOver/visionFailed。对白跨镜由起点归属、后续carriedOver标识，不能把跨镜对白重复写入每镜。关键帧用于原片对照，不自动作为生成参考图。生成输出是原生smart-prompt→smart-image节点，结果保存在smart-image.images；motionPrompt/时长仅作为shotTableOrigin元信息，不能声称已经生成视频。

## connections
创建表时从原视频节点连到表。生成每镜创建smart-prompt→smart-image连接，kind=input；generatorId与outputId均指向smart-image，runSettings保留手选图片平台模型。generationMap按来源指纹（或sourceUrl）与rowId关联promptId/generatorId/outputId，重复转换复用已有generator；不得猜测归属或重跑已受理任务。

## execution

助手 export 工作流须明确 1 至 100 个当前节点（包含锚点）及 JSON 或 ZIP。JSON 保留资源引用；ZIP 复用原生导出接口打包可用本地素材，缺失素材必须报错。仅导出范围内的连线，不自动扩大范围，不调用生成服务。确认后锁定节点内容和画布，下载前再次核对；回执只证明已发起下载，文件请在浏览器下载列表查看。保存回执后刷新只查询，不再次下载。
本地prepare检测/抽音频产生整批quote，包含visionCalls、每镜3帧framesPerShot、audioCalls、到期expiresAt和quote id；UI将awaiting-confirmation映射为idle并显示确认卡。必须手选适用视觉/音频模型并确认本批，才允许调用。分析状态 queued/running/ready/failed/interrupted/cancelled；succeeded映射ready。重新拆解会替换分析结果和手工编辑，需单独确认。重新分析本镜/对白重试是新批次也需确认。取消保留已有表/素材；安装本地语音组件是独立操作，知识读取不安装。生成所选镜头须确认创建并生成，先保存新节点，再使用原生runGenerators；创建节点不是供应商已成功。

## results
task.taskId/status/phase/progress/progressDetail/error/failureKind/coverage/quote为分析批次状态，不用node.running推断。speech.status区分ready、no-audio、no-speech、failed、cancelled，segments含start/end/text；缺对白不能声称无人声。visionFailed表示单镜视觉失败。生成结果在generationMap关联output和实际任务中回读，不能由imagePrompt或关键帧充当生成结果。

## errors_recovery
原视频或画布切换/来源变化时拒绝落地旧结果，epoch/节点对象/table上下文保证归属。任务id变化拒绝旧回执；取消后不接受非取消回执。分析期间手工编辑按rowSnapshots对照保留；对白重试只更新成功对白、保留视觉/自定义/提示词，单镜视觉重试保留对白。查询失败记interrupted、保留任务id；刷新reconcile查询原任务，禁止重新提交。组件缺失/云端不支持时间戳/模型不适用/quote过期如实报错。
原生展示上下文allowDetached允许已保存行在来源离线或只读画布下继续打开，不能把此展示许可当新的分析执行许可；分析仍重新建立普通上下文核对原视频。单镜视觉失败的failureReason应与visionFailed一并读取。

已复核原生 host.context/isCurrent 与 UI.show/generate：保存表的编辑、展示和原生节点转换可使用 allowDetached 上下文（仍核对画布、节点对象和epoch；写入另查只读）。重新拆解、重试分析继续要求真实原视频身份。独立复制的已完成表可编辑并转换原生生成节点，失效来源不授权新的分析。自定义列手机按钮与表头入口在只读或分析中禁用。

## persistence

原生面板保存当前模型/对白模式的 selectionDraft，切换模型或模式后重绘继续使用当前选择；关闭抽帧面板在受理期间要求先取消抽图，不把关闭当重复提交。UI mount/updateScale 的缩放展示不替代业务保存回执。
保存shotTableData到当前原生画布，Undo由host.pushUndo管理。只读助手不改revision/选中行或画布。智能复制/导入共用 remapSmartDepthCopies → CanvasVideoDeconstructionModel.remapCopies：来源仅保留随复制节点的新编号，generationMap仅保留随复制的生成链，结果 shotTableOrigin 重映或清除；进行中的分析标 interrupted 并清旧 taskId，不能重放原任务。真实入口 VM 已核对整链与单节点复制，页面复制与保存重开继续单列待验收。source URL和关键帧URL参与原生媒体保留清单，不能删除共享文件。

## examples
读取项目规则→读取镜头表末页及cells分页→核对来源与选中镜头→整理每镜imagePrompt/motionPrompt→预览生成原生节点计划→手选图片模型并确认→保存后查询原任务→回读实际输出。分析对白失败时保留原内容并选择重试方式、核对本次批次报价，不重复整段视频分析。

## limitations
当前助手已登记知识与白名单读取，不代表镜头表全部操作已开放；可执行动作以工具注册表和原生处理器为准。真实视觉、音频、图片效果及作品质量尚未经收费供应商验收。分页cells为[{columnId,value}]，按pagination.arrays与fields补读完整正文，不能把首屏当全表。任意配置、凭据、本机路径、内部rowSnapshots不发送给模型。视频拆解表需要真实视频来源；文本创作表通过助手工具绑定已保存故事节点。

阶段B专门编辑通过 shot_edit/shot_column/shot_select 使用现有 host.editTable、model.editCell/editColumn；运镜正文同步 motionPrompt，改名保留原 hint，自定义列删除还删除各行同列正文，选择递增 revision。新增列编号由动作绑定，不让模型覆盖已有列。回执读取真实保存表并核验 revision 与关联字段。生成转换/分析调用仍按各自实际能力目录，不从编辑成功推断供应商已执行。
智能抽帧落到原生 smart-group.images，按来源 frameIndex 去重，保留原媒体；生成链由 smart-prompt→smart-image 承载，执行使用 shotTableRun 读取该节点草稿，避免批量读取其它选中节点草稿。共享处理器新增行为已复读，生成服务效果尚未验证。

助手 shot_materialize 调用原生 host.materializeRows，只转换选定镜头并复用 generationMap 已有链；不运行生成服务。模型参数只能来自用户手选并勾选的图片模型，不能由工具参数指定。创建默认一张，保留源镜头、运镜和时长；两画布分别使用 prompt→generator→output 与 smart-prompt→smart-image。真实回执逐链检查节点、连接、归属与新节点模型/提示词；实际生成仍须独立确认。特殊尺寸当前须在新节点手动设置，不假称已支持。助手传入 deferSave 防止 host 抢先保存造成保护冲突，普通面板默认保存行为保留。
