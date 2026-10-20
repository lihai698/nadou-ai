# 已受理任务恢复拆分 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline.

**Goal:** 迁出两画布的未保存受理编号备份、清理、恢复和重复提交保护。
**Architecture:** CanvasAcceptedTaskRecovery拥有存储格式/恢复算法，宿主通过显式接口提供当前画布、节点、连线、存储、错误展示和保存调度。保留现有存储key和助手运行归属；不重提任务或另建缓存。
**Tech Stack:** 原生JS IIFE，Node合同和原片段测试。
**Spec:** docs/模块化职责与验收清单-20261018.md 第10项。

- [x] 新增模块合同并确认缺模块失败。
- [x] 迁入普通/智能恢复函数，真实入口与HTML接入，删除旧算法。
- [x] 原测试加载适配、完整JS与核心回归、独立审查。
- [x] 隔离页面验证保存失败后的编号保留和恢复；更新证据与交接，不上传。

页面验证范围及既有缺失节点限制见迁移验收，不扩大完成声明。
