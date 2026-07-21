---
id: git-compare
title: 对比变更
layer: impl
---
一书一仓时，顶栏「对比变更」可按小节 id 对齐两个 Git 版本，审读内容怎么演进。

## 一书一仓 {#book-git}

每本书推荐在 `books/<book-id>/` 下独立 `git init`。内容改动在该书仓库内 commit；标注仍在 reader 的 `data/`，不进书仓。

## 按小节对齐的 diff {#section-diff}

可选 branch / tag / hash，支持 unified 与并排。对齐键是小节 id，不是行号——因此稳定 id 同样重要。

## 阅读器不 commit {#non-goals}

阅读器只读 Git 历史。不会自动 `git add` / `git commit`；本地 Agent 改文件后也由人决定是否提交。
