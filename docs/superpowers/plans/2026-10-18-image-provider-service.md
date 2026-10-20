# 图片供应商执行迁移

迁出generate_ai_image完整请求分发/通用OpenAI兼容链路及ModelScope/Gemini/火山原生请求和规则共10项，复用现有image_generation_dispatch，不重写协议。显式注入HTTP客户端、凭据获取、请求构建和结果解析函数。

验收：原主体AST/签名一致；协议/分发/查询专项；MockTransport隔离在线图片路由JSON/multipart/原生/ModelScope轮询及受理回调，输出字节解码；完整核心与独立审查。不读取真实凭据或调用付费上游。
