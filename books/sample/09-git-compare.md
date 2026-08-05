---
id: git-compare
title: 对比变更
---
一书一仓时，顶栏「对比变更」可按小节 id 对齐两个 Git 版本，审读内容怎么演进。

{#book-git}
## 一书一仓

每本书推荐在 `books/<book-id>/` 下独立 `git init`。内容改动由阅读器在该书仓库内自动 commit；标注仍在 reader 的 `data/`，不进书仓。

{#section-diff}
## 按小节对齐的 diff

可选 branch / tag / hash，支持 unified 与并排。对齐键是小节 id，不是行号——因此稳定 id 同样重要。

成对变更行会做**行内高亮**：相同前后缀与整词不高亮，只标出真正改动的字/词（数字整段替换，避免对上单个字符）。

{#auto-commit}
## 自动 commit

每次内容变更（小节编辑保存或 Agent 写盘成功），阅读器会在该书根目录：

1. 若无 `.git` 则 `git init`（并补本地 `user.name` / `user.email` 若缺失）；
2. `git add -A`；
3. 用 AI 根据 staged diff 生成一行 commit message（CLI 不可用则回退默认文案）；
4. `git commit`。

不自动 `push`。Agent 自身不要执行 git 命令。
