# 普通画布级联执行 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline.

**Goal:** 迁出普通级联状态、停止/请求中断、清理及串行/并行循环编排。
**Architecture:** State模块管理宿主实例的上下文/集合/计时器，Runner模块调用State接口和原节点执行器；宿主显式提供当前节点、loopContext读写与刷新回调，不新增第二套状态。智能画布另批处理。
**Tech Stack:** JS IIFE、Node内置Acorn提取和AST比对、合同/既有测试。
**Spec:** docs/模块化职责与验收清单-20261018.md 第10、11项。

- [x] 先编写停止/清理/循环上下文/顺序合同并观察失败。
- [x] AST迁移状态和执行，保留真实入口与默认行为，加载模块。
- [x] 全量JS/核心、独立审查、隔离页面两级执行与停止验证。
- [x] 清理旧算法、更新来源摘要与报告，整体目标保持进行中。
