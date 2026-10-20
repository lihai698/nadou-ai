# 节点尺寸与参数规则 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline.

**Goal:** 迁出两画布尺寸/模式/旧节点参数规则；相同算法共用，差异保留。
**Architecture:** CanvasImageParams共享五组相同算法；ClassicNodeParams/SmartNodeParams处理各自归一化与参数写入；两个parseSizeValue入口复用已有OnlineImageSizeRules。宿主提供表格与模型/素材读取，模块不操作DOM。
**Tech Stack:** JS IIFE、Acorn结构化迁移及原/新AST对应、Node/页面请求验证。
**Spec:** docs/模块化职责与验收清单-20261018.md 第11项及参数边界。

- [x] 合同先失败，核实共同算法AST相同及差异行为。
- [x] AST迁移与旧解析复用、HTML/测试入口接入。
- [x] 全JS/核心、独立审查和参数保存/请求页面验证。
- [x] 清理旧算法、来源摘要、证据/交接更新，整体目标继续。
