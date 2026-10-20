# Responses图片协议迁移验收（2026-10-18）

8项尺寸提示、输入参考图适配、无图错误提取、文本图片解析、HTTP结果封装、后台轮询及SSE聚合迁入backend/responses_service.py。main保留同名薄入口，供应商服务仍从真实入口进入；原主体移除。主程序持有轮询常量及媒体/诊断接口，按参数注入，模块不反向导入main、不读取应用配置。main15283→14997行。

验证：8项函数body AST等价、symtable依赖审计、独立静态复核通过。新增6项模拟HTTP/回调测试通过，其中后台POST→GET测试单独提取真实main入口执行，不导入真实main。完整核心退出码0：Python1105、JavaScript828（.git/modularization/responses-service-core.log）。测试初次一个AsyncMock误用于同步reference_to_data_url，改为同步回调，生产逻辑未为测试改变。服务随后只去掉两项无用导入并修正文档，最新6项专项仍通过。

覆盖后台按原编号轮询、503不回退、422按原body回退、SSE partial合入、上传失败内联和图片/尺寸解析。保留原有传输异常回退策略；不宣称所有异常均避免重复提交。全部使用MockTransport，无实际HTTP供应商调用，无个人配置读取、提交或发布。

整体未完成，后续继续上游响应解析、CLI/配置/启动等后端职责与前端其余领域，最后做整体边界审计。
