# Gemini/Antigravity执行协议适配

15项文本/模型解析、执行参数、图片和聊天请求适配迁入backend/gemini_cli_service.py，保留main同名入口与原默认参数。执行文件发现、env getter、登录/凭据仍由应用层提供；模块导入不访问这些接口。

原始快照.git/modularization/gemini-cli-service-before；15项body AST等价，词法依赖及独立复核通过。默认常量GEMINI_CLI_DEFAULT_TIMEOUT仅由main公共入口拥有并显式传给服务，避免模块导入读取宿主常量。新增5项真实入口/模拟进程测试通过，不启动CLI、不读配置。完整核心Python1116/JavaScript828、预检及diff检查通过。

只做内部职责迁移，保留既有工具权限和错误处理。不提交发布，不引入外部服务或新依赖。整体未完成。
