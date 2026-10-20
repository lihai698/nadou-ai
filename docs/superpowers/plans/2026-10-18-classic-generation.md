# 普通画布直接生成 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline.

**Goal:** 迁出媒体生成、直接任务挂载/保存等待、Comfy、文本与Midjourney执行，保留提交校验/受理/归属/恢复语义。
**Architecture:** 各执行领域独立模块，宿主动态提供当前节点/连线/配置及效果；任务挂载协调与媒体/Comfy执行分开，公共通信/结果模块复用。旧入口只委托，未调用legacy函数非本轮替换对象。
**Tech Stack:** JS IIFE、Acorn提取/AST审计、Node与公开代码沙箱回归。
**Spec:** docs/模块化职责与验收清单-20261018.md 第10项。

- [x] 新模块合同先失败，核对完整调用与依赖。
- [x] AST按领域提取、真实入口/HTML接入，保留原字面量与归属语义。
- [x] 原测试适配、全量JS/核心、独立审查、隔离页面生成/恢复验证。
- [x] 清理被替代算法、SHA/交接/验收更新，不上传。
