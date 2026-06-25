---
title: 内存碎片检测与处理 memory_fragmentation_detection_and_handing
pubDate: '2026-06-22'
description: '描述啥'
category: '技术随笔'
tags: 
  - linux
---

Valgrind

- 子工具 `memcheck` 可用于内存泄漏和使用错误检查。（常用）
- 子工具 `massif` 可检测堆内存的使用情况，有助于识别碎片。
- 子工具 `DHAT`（heap profiler）可分析堆使用效率
