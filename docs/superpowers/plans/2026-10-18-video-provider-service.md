# 视频总入口与查询迁移

5项提交/查询候选地址、wait_for_video_task、query_video_task_once和完整canvas_video迁入video_provider_service。保持供应商分支、任务受理回调、状态未知语义和错误脱敏；原路由与调用签名保留。

验收：完整主体AST/签名/装饰器一致；生命周期/查询/取消/错误专项；公开隔离应用ASGI HTTP三条生成分支+MockTransport，真实合成MP4字节落盘；八项查询状态/失败/非法ID，查询无POST；完整核心和独立审查。
