# 平台注册配置职责组

- 36项平台定义/默认/规范化/存储/公开视图迁出；快照provider-registry-before，AST/依赖/既有26专项通过。
- ai_config/save_providers原控制主体接入同一模块；快照provider-registry-entry-before，2主体AST等价，原36函数不变，7项服务测试通过。
- 工作流字段AST测试补载真实服务，原断言2项通过。
- 独立复核完成，无新增实质问题。最新完整核心Python1123/JavaScript834通过。

保持原GLOBAL_CONFIG_LOCK和write_json_atomic、save→env→reload顺序，凭据 getter/env适配仍由应用提供；禁止读取真实私人配置、调用CLI或付费服务、提交发布。整体未完成。
