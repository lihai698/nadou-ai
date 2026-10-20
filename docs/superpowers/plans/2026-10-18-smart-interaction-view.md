# 智能交互视图协调迁移计划

本批从图片编辑器最终检查点续接，只处理智能拖动/缩放/分组成员DOM同步和每帧合并刷新。既有节点整体render、业务坐标计算、保存与撤销算法保持。

1. 精确基线保留在 .git/modularization/video-continuation-20261018/smart-interaction-view-before/；全局核对 pointer、layout、node-view、bindings 调用。
2. 三个同步主体并入既有 smart-node-view；main保留薄委托和窄host。刷新控制器也归该模块，仅拥有待执行帧与监听生命周期，不复制画布业务状态。
3. 先以原入口复现离页/切换后的旧帧，再接入取消、身份检查和既有媒体输入capture；同ID正常保存不误取消。pagehide暂停，pageshow恢复，dispose解除。
4. 保持拖动位置、缩放骨架/宫格/分组内边距、选中composer跟随和缺DOM回退。专项行为回归、AST等价/无关语句审计、独立只读审查、真实公开沙箱页面检查。
5. 更新128处智能来源SHA；新完整核心通过后再补验收、总记录和恢复点。失败不写完成；不提交、发布或调用供应商。
