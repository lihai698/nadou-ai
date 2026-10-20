# 上游响应解析职责迁移

14项聊天/图片响应与任务编号解析迁入backend/upstream_response_codec.py，保留main同名薄入口，递归由真实入口注入，hint常量仍由main提供，HTTPException保持原类身份。模块只使用base64/re/json，无I/O和配置读取。

迁移前快照.git/modularization/upstream-codec-before；14函数body AST等价及词法依赖审计通过。新增6项基于真实main纯入口的解析测试通过，未导入真实应用。独立复核无新增实质问题。完整核心Python1111/JavaScript828、预检和diff检查通过。

禁止提交发布、真实CLI/供应商调用及私人配置读取。整体未完成，继续其余职责与最终边界审计。
