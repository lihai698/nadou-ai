# 普通画布剪辑节点 Implementation Plan

> **For agentic workers:** 使用已确认设计和逐项验收表执行；独立模块可按 superpowers:dispatching-parallel-agents 分工，写入文件不得重叠。每项先写关键行为测试，再实现并验证。

**Goal:** 原生普通画布剪辑轴支持完整编辑、保存与有声/静音MP4输出。

**Architecture:** 独立帧模型＋原生节点UI＋服务端FFmpeg任务，由canvas.js和main.py注入现有数据/路径/保存入口。新代码独立编写，不复制AGPL代码。真实结果接入原有output和下载。

**Tech Stack:** 原生JavaScript、CSS主题变量、Lucide、Python/FastAPI、FFmpeg。

**Spec:** ../specs/2026-10-09-canvas-clip-node-design.md

## Global Constraints

- 用户已于本轮确认具体设计并授权开始；同一会话直接执行。
- 保持现有真实普通画布入口。当前工作区有本任务布局和其他任务脏改动；在现有codex开发分支精确修改，不切换/覆盖/提交其他改动。
- 用户验收前不commit/push；该规则优先于技能中的中间提交要求。
- 不调用收费模型，不覆盖/清理用户素材；测试用临时自制文件。
- 按CLIP-01–38逐项记录真实验收；不把界面可见当成导出成功。

## Review Focus

- A→B→A切画布不能使旧导入/导出回写新代次。
- 图片、无声视频与空隙不能让同序列有声视频失声。
- 跨画布共享素材受引用保护，片段删除不删除源文件。
- 源视频偏移及1帧裁剪边界在分割、复制、逐段导出后保持正确。
- 点击/拖动剪辑编辑不能触发画布拖动和全局删除快捷键。

## Task 1：独立帧模型

Files：新建static/js/canvas-clip-model.js、tests/canvas_clip_model.test.cjs。

接口：window.CanvasClipModel及CommonJS导出。createData()；addMedia(data,media,{manual})；syncSources(data,media[])；durationFrames(data)；split(data,id,frame)；duplicate(data,id)；remove(data,id)；move(data,id,start,{snapFrame,thresholdFrames,disableSnap})；trim(data,id,side,frame)；exportTasks(data,scope)；remap(data,idMap)；均返回新的JSON数据，不修改输入。media含kind/url/sourceNodeId/sourceResultId/durationSeconds/posterUrl/name/fromUpstream。片段使用规格里的帧字段，fps=30。

- [x] 先写测试：4/6秒默认、多结果去重、排除复加、2秒offset分割、端点不可分、复制避碰、删除收紧、源边界1帧、移动吸附/禁用、逐段保留offset、复制重映射。
- [x] 运行node --test tests/canvas_clip_model.test.cjs，确认新模块未实现时失败。
- [x] 完成独立原生实现，再运行该测试确认通过。

## Task 2：媒体导出服务

Files：新建backend/canvas_clip.py、tests/test_canvas_clip.py；修改main.py仅注册路由。

接口：POST /api/canvas-clip/export，JSON {canvas_id,node_id,clipData,scope:'full'|'segments',request_id}，返回{id,status,canvas_id,node_id}；GET /api/canvas-clip/tasks/{id}，返回{id,status:'queued'|'running'|'succeeded'|'failed',progress,error,results:[{url,durationSeconds,sourceClipId,name}],canvas_id,node_id}。后端固定保存到原生输出路径，依赖注入路径映射与输出URL生成；不反向import main。

- [x] 测试先行：无效帧/不存在路径/源越界、mixed有声保留、静音无音轨、空隙黑场、逐段offset、真实H2641080p30fps、同request去重及canvas归属。
- [x] 核对运行时FFmpeg位置；必要时使用官方可核验二进制置于本机工具缓存，源码不包含安装包。
- [x] 渲染前探测真实视频时长/音轨；图片和空隙补静音；严格参数验证；失败清理仅本任务临时文件。
- [x] 真实素材导出、ffprobe/音频能量/抽帧验收后接路由，记录具体命令和结果。

## Task 3：节点UI

Files：新建static/js/canvas-clip-node.js、static/css/canvas-clip.css；相关浏览器验收脚本用临时目录。

接口：CanvasClipNode.mount(el,node,host)；syncSources；dispose/close；host提供getCanvas/getNodes/getConnections/scale/commit/getMedia/pickAssets/upload/exportResult/download/readOnly。导出任务依Task2协议。运行态用独立Map，不进node JSON。

- [x] 按预览实现轴、片段数、全部按钮、素材picker、浮层播放器和两组导出选择/静音开关。
- [x] 实现缩放换算拖动、吸附、裁剪、取消、快捷键焦点隔离、播放偏移/跨片/空隙、filmstrip缓存并发2。
- [x] 实现上传保留File重试/互斥/上下文代次，导出忙/错误/部分结果/复用输出。
- [x] 验证浅深色、390px、禁用/错误、0.5×与2×操作、关闭停播、只读不修改。

## Task 4：原生接入与整体验收

Files：static/canvas.html、static/js/canvas.js及必要资源提取入口；更新设计说明验收记录。

- [x] 接右键创建、尺寸、renderNode、canConnect、输出同步、保存、撤销、复制重映射及嵌套URL收集。
- [x] 真实浏览器使用模拟独立画布API验证交互/保存重开/复制/导入导出/A→B→A，避免改用户画布。
- [x] 服务真实接口验证四种导出目标，output与下载都取得有效文件。
- [x] 运行相关既有快捷键/分组/保存测试及语法检查，完成一次独立源码审查并修复实质问题。
- [x] 更新CLIP-01–38结果与风险，提供真实界面截图和使用说明；等用户验收后按AGENTS.md同步源码。
