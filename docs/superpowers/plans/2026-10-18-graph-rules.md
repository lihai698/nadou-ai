# 节点连线图规则 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline.

**Goal:** 迁出两画布连接合法性、环检测、上下游遍历、连通分量与级联图计算。
**Architecture:** CanvasGraphRules只读宿主节点/连线及类型/循环规则，不操作DOM、不提交生成、不持有第二份图状态。原入口委托，归一化依赖后AST须与快照一致。
**Tech Stack:** 原生JS IIFE、Node内置Acorn迁移与AST审计、Node测试。
**Spec:** docs/模块化职责与验收清单-20261018.md 第11项。

- [x] 合同先失败；AST提取与依赖注入，检查字面量与结构一致。
- [x] 真实入口和HTML接入，原测试加载适配，不删除业务断言。
- [x] 全量JS/核心、独立审查、原生画布连线或工作流验证。
- [x] 清理旧算法、SHA和进度更新，保留未完成领域。
