# RunningHub 模型注册与字段接线迁移验收（2026-10-18）

本记录在北京时间17:24:16完整核心检查结束后写入。本批迁移在公开代码沙箱及模拟供应商范围内通过；三个大文件整体模块化仍未完成。

## 职责、数据和实际入口

- `backend/runninghub_model_registry_service.py` 接管10个原主体：内置兜底目录、回包列表提取、模型条目构造、LLM列表查询、注册表查询合并、ID与中文名解析、公开列表组装、列表来源说明和模型定义解析。
- `backend/runninghub_fields.py` 追加3个原主体：工作流字段类型推断、连线值识别、nodeInfoList组装；既有字段排序及种子规则保持。
- `backend/runninghub_protocol.py` 追加任务端点选择和模型端点别名2个原主体。
- `backend/runninghub_config_service.py` 追加模型对应已保存工作流配置选择1个原主体，继续使用应用原有锁与配置读取边界。

main保留16个原参数和默认值的薄委托，并显式注入实时常量、锁、路径、HTTP客户端和回调。实际供应商模型探测、图像/视频执行、应用/工作流入口继续调用这些原入口。原业务主体已从main清除；没有新增第二套常量、配置状态或锁，没有模块反向导入main，也未新增依赖。

注册服务只拥有本次查询的局部列表及元数据，不在导入时读取配置、文件或网络；运行时文件位置和凭据头回调由应用边界提供。原有公开`chat_models`只取fallback的行为保持，未顺手改变供应商算法或接口。

## 失败恢复与验证证据

统一证据目录：`.git/modularization/video-continuation-20261018/`。

- `rh-registry-before/` 为迁移前实际源码及16主体/依赖清单；已执行的迁移脚本未重跑。`rh-registry-before-v2.log`、`rh-registry-after.log`各51项通过；交接前独立审查新增8项通过，不冒充完整核心。
- 原扩大验证`rh-registry-expanded.log`退出1：573项、34失败、26错误、跳过2，永久保留。首错为助手原生动作列表为空。
- 本窗先用`rh-registry-index-red.log`复现助手首错和知识来源一致性失败。确认`classic.midjourney`、`classic.msgen`的main来源摘要失效，知识写保护因此拦截写入。
- 核对后执行元数据工具`sync-main-knowledge.py`，只更新索引两处main来源SHA；原索引备份`rh-registry-index-before.json`，精确语义差异`rh-registry-index-fix.json`。其他JSON值保持，没有关闭或绕过知识写保护。
- `rh-registry-index-green.log`两个原失败用例通过。扩大复测`rh-registry-expanded-after-index.log`退出0：同一组573项，无失败或错误，跳过2；`rh-registry-expanded-comparison.json`确认前后用例ID及重复次数完全相同。这一结果支持本轮原失败由失效索引触发，不代表真实供应商已验证。
- `verify-rh-registry.py`再次核对16个原主体AST、签名、main无关语句、三份既有模块原语句和词法依赖，全部通过。`rh-registry-wiring-audit.json`补充确认唯一入口、原位置参数和全部实时依赖逐项转发；四模块无反向main依赖。
- 已清除`runninghub_protocol.py`新增EOF空行。`rh-registry-diff-check.log`差异格式检查退出0；`rh-registry-preflight.log`公开发布预检1144个文件通过，仅预检，未打包或发布。
- **最终完整核心**：`rh-registry-checkpoint-core.log`，北京时间17:16:38开始、17:24:16结束，退出码0；**Python1178 / JavaScript905**，JS逐文件语法和中英文词条/页面引用通过。
- `rh-registry-core-source-sha256.json`、`rh-registry-core-result.json`记录719个公开源码文件检查前后摘要一致，`source_unchanged=true`、`changed_sources=[]`。

恢复点使用独立目录`checkpoint-rh-registry-core-verified/`，脚本先验证本批核心成功及源码仍与冻结清单一致，再复制公开源码和选定文档，并在临时目录逐文件恢复核对。实际范围和恢复核对结果记录于`checkpoint-rh-registry-core-verified.json`；不覆盖图片尺寸阶段或其他历史恢复点。

## 验证边界

未读取私人配置，未直接导入真实仓库main；main仅在临时公开代码沙箱中运行。网络和配置测试使用自制输入及模拟边界，没有真实RunningHub生成、账号登录、私人工作流或收费调用；本轮未新增页面手动验收。没有提交、推送或发布。

本批结论为职责迁移及模拟边界回归通过，不承诺测试范围之外绝无问题。剩余工作流导入/智能上传晚回、编辑器事件、智能视图、运行配置以及后端媒体/协议边界继续按实际源码审计。
