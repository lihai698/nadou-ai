# 即梦协议与执行职责组

1. 38项纯解析/参数规则迁入jimeng_provider_protocol，保留main数据与异常类型注入。已完成，AST/依赖与35项专项通过；快照.git/modularization/jimeng-protocol-before。
2. 12项执行/存储/原任务查询迁入jimeng_execution_service，保持接收回调、pending异常身份、原编号查询和finally清理。已完成，AST/依赖与45项专项通过；快照.git/modularization/jimeng-execution-before。
3. 独立只读复核、当前最新源码全量核心、预检与diff检查。完成：独立复核、核心1116/828、预检和diff检查通过。

既有Codex完整检查仍运行独立公开代码快照；其结束后再对最新代码跑全量，不同时启动第二份完整核心。

登录、环境和WSL发现接口仍在应用适配层。禁止真实CLI、供应商、付费、私人配置读取、提交和发布。整体任务未完成。
