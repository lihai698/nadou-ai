# 音频素材节点与现有 API 音频模式

日期：2026-10-09；实施更新：2026-10-10。状态：用户批准后的本地接入与隔离验证已完成，等待实际平台手动验收。

当前有效方案：[音频节点与API联动方案-20261009.md](../../音频节点与API联动方案-20261009.md)。

## 已确定边界

- 素材节点不含平台、模型或生成参数，模型全部在现有 API 节点／面板。
- 现有 API 图片生成逻辑完整保留，只增加独立音频分支；不增加手动模式按钮。
- 仅音频连接 API 生成节点时自动识别；平台、模型、参数、生成／转写仍手动，不增加全局自动路由或新的级联规则。
- 音频相关输入区称为“输入内容”，分别标注实际类型；混合素材沿用目标原有输入规则，模型由用户选择。
- 文本输出链路为音频→API（手动选识别模型）→现有 LLM；撤回音频直接连接 Prompt 及“转为文字”按钮，不新增文本节点。识别参数与生成参数按所选模型分开。
- 音频接入已有连接、输入预览、素材库、任务和保存数据链路。
- 先交付清晰完整的设计预览，再继续接入。

## 替代关系

原独立 `audio-generator` 方案和手动图片／音频按钮均撤回。普通画布复用 `generator` 自动识别输入与适配音频参数，智能画布使用现有 API 面板；生成结果进入原生输出，拖出变为音频素材节点。原图片请求、参数、并发、轮询、恢复和输出逻辑不重写。

## 当前状态

音频规则、持久任务、API 配置、普通与智能画布真实入口、API 识别文字到现有 LLM、素材操作和保存恢复已接入。原图片 API 分支保留；隔离页面验证了返回图片后的模型、尺寸与并发。真实供应商模型效果未验证，未提交或上传。

完整证据与使用方法见[音频节点本地接入验收-20261010.md](../../音频节点本地接入验收-20261010.md)。

下方保留批准时的设计预览。验收文档中的最新截图来自实际页面与实际控件，任务返回由隔离供应商模拟；播放器播放实际测试 WAV 文件。

## 预览

- [原图片模式对照](../../previews/api-audio-image-mode-comparison.png)
- [API 音频模式](../../previews/api-audio-final-preview.png)
- [音频→API识别→现有LLM](../../previews/audio-api-llm-preview.png)
- [导入与生成音频素材](../../previews/audio-material-final-preview.png)
- [上下游与原生输出](../../previews/audio-connection-final-preview.png)
- [多类型混合输入](../../previews/api-audio-recognition-preview.png)
- [更多参数展开](../../previews/api-audio-advanced-preview.png)
- [任务状态](../../previews/api-audio-states-preview.png)
- [浅色主题](../../previews/api-audio-light-preview.png)
- [390px 窄屏](../../previews/api-audio-narrow-preview.png)
