# 音频素材与原任务只读状态

## overview

普通画布使用 type=audio 保存音频素材。智能画布仍使用 smart-image 容器保存音频结果。旧普通 image+mediaKind=audio 由 CanvasAudio.migrate 转换，节点编号和连线保留。音频素材不是图片生成器。

## controls

原生音频卡支持上传、播放、波形、下载与加入素材库。音频识别和生成在原 API 面板手动选择音频平台与模型。助手本次只开放 query、preview；不能创建、替换、修改或执行音频素材。

## parameters

读取素材 kind、mime、durationSeconds、sizeBytes、兼容 duration 及真实 url。生成节点音频配置可只读获取 audioProvider、audioModel、audioLyrics 等公开参数；模型不能改写平台、模型或任务字段。不得读取密钥或任意 audioRunSnapshot 嵌套配置。

## inputs_outputs

识别正文保存为 audioOutputText，音频文件沿用原生结果节点及素材引用。保存的 URL 和真实文件决定结果是否存在，不能用助手回复当作音频结果。

## connections

原手动音频连接规则继续有效。助手没有开放音频 connect 或 group_members；不要把音频当图片参考，也不要通过其它节点动作绕开未结束原任务保护。

## execution

原生提交前保存 audioTaskId。助手不提交音频服务请求，不自动重试或重新生成。需要操作音频时使用原手动入口。

## results

read_node_state 返回音频素材、识别正文与 audioTaskId、audioStatus、audioError、audioTaskOperation。runtime.busy 表示原任务未确认结束；runtime.running 仍反映原节点运行标志，两者意义不同。

## errors_recovery

queued、running、query-paused、unknown 和尚无确定结束状态的原任务都保持忙碌保护。running=false 不代表原任务已结束。保留原 audioTaskId，通过原音频界面的“查询原任务”恢复；不重新 POST。done、failed、cancelled、canceled 才解除这项保护，其它原任务仍可令节点忙碌。

## persistence

音频任务标识和状态由原生画布保存。查询暂停、刷新或断线后不能自动更换原编号；助手只读状态不改变节点、用户文件或供应商任务。

## examples

原 generator 保存 audioTaskId=original、audioStatus=query-paused、running=false 时，助手可以读取该任务，却必须拒绝 update、connect 和 export 等写入预检。用户在原界面确认该任务结束后再进行编辑。

## limitations

这是音频只读知识和未结束任务保护，不代表助手音频运行或模型音质已验收。现有三个内置创作 Skill 不变；新增本知识卡不会增加一个用户可选 Skill，也不会授权收费调用。
