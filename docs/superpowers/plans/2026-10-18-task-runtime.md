# 任务结果应用与恢复执行 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline.

**Goal:** 迁出普通画布输出/结果应用和恢复轮询，以及智能画布结果收尾和恢复执行。
**Architecture:** CanvasTaskResults负责结果应用、CanvasTaskRuntime负责恢复执行；两者通过显式宿主接口使用当前节点、连线、任务去重集合和渲染/保存/通信；模块不复制画布状态，不改变归属/取消/未知恢复规则。原入口委托。
**Tech Stack:** 原生JS IIFE、Node合同与片段回归。
**Spec:** docs/模块化职责与验收清单-20261018.md 第10项。

- [x] 新模块合同先失败；迁出算法并保留字面量。
- [x] HTML加载、旧入口委托、原测试模块依赖适配。
- [x] 全量JS与核心、独立审查、隔离页面结果/重开验证。
- [x] 清理旧实现、知识摘要、证据与交接更新。
