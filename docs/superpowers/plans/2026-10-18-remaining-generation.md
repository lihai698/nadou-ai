# 剩余前端生成执行 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline.

**Goal:** 迁出普通RH/Modelscope与智能生成入口、API视频、供应商、Comfy及任务协调。
**Architecture:** 按执行/协议/任务协调分模块，跨边界通过动态宿主接口；保留当前节点/设置单一所有者、默认参数、可选回调和信号构造器，不改请求/受理/恢复语义。
**Tech Stack:** JS IIFE、Acorn标识符提取/AST审计、Node与公开代码沙箱回归。
**Spec:** docs/模块化职责与验收清单-20261018.md 第10项。

- [x] 新合同先失败，核对请求映射与受理状态。
- [x] AST迁移、入口/HTML接入、原测试保留业务断言。
- [x] 全JS/核心、独立审查及原生页面模拟执行验证。
- [x] 清理被替代算法、SHA和交接更新；剩余参数/编辑/渲染领域继续开放。
