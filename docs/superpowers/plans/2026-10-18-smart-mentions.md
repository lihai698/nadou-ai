# 智能画布引用选择迁移

25项引用候选、token文本、手动参考和定位迁入smart-mentions，保留原host接口与HTML接入。预设面板及按钮留待后续完整迁移。

验收：24项原AST等价；insertMentionToken原主体等价，并明确追加保存步骤。页面发现程序化插入不触发input，旧实现刷新丢token；先添加失败测试，再按正常input流程清preserve标记、savePromptDraftForCurrent、scheduleSave。真实DOM插入、服务端GET与刷新token计数1验证修复。

其他验证：转义/最长名称、手动引用去重和移除、缩放定位、词法/递归、完整核心及独立审查。不调用生成。
