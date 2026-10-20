# 画布任务通信拆分 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** 将两画布图片、视频、Comfy任务提交、查询/刷新与等待逻辑移入独立通信模块，原入口真实委托。
**Architecture:** CanvasTaskTransport只拥有单次请求与等待状态；fetch、级联取消、错误解释、归属校验和恢复信号由宿主显式传入。去重注册表、节点状态和结果回填留在编辑器生命周期内；不新增全局状态或兼容副本。
**Tech Stack:** 原生JavaScript、现有IIFE加载模式、Node测试。
**Spec:** docs/模块化职责与验收清单-20261018.md 第10项。

- [x] 新增通信模块合同，验证缺模块失败。
- [x] 迁移14项提交/刷新/等待入口，保留两画布现有轮询差异；HTML先加载模块。
- [x] 迁移受影响测试的模块加载，保留原业务断言；运行全部JS回归。
- [x] 独立审查、完整核心、隔离页面模拟任务和重开验证。
- [x] 旧实现引用检查、知识摘要及交接更新；不提交上传。
