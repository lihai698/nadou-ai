# 聊天执行迁移

12项聊天图片引用/数量/提示词拆分/意图规则、决策与文本回复、chat/chat-agent/chat-stream迁入chat_execution_service。保留Header默认值和原路由，依赖显式注入；嵌套流生成器主体原样迁出。

验证：原主体/签名/装饰器一致；聊天错误/空回复/CLI隐私专项；MockTransport实际HTTP文本、图片、Agent、流式成功及空回复/错误，失败不追加助手消息；页面回复刷新恢复；完整核心、发布预检和独立审查。
