---
id: local-agent
title: 本地 AI
---
可选能力：在阅读器里调用本机 CLI（Cursor Agent / Claude Code 等）改书内 Markdown。默认关闭，仅适合本机单人。

{#when}
## 何时启用

设 `AGENT_ENABLED=1`（或 `npm run dev:agent`）后，顶栏「AI」才会接受请求。同一本书同时只能跑一个 agent；不会自动 git commit。

{#config}
## 配置要点

Agent 与行为在 reader 仓库的 `config/`（不进书仓）：`agents.json`、prompts、drivers。

:::details 占位符与路径
Prompt 会注入样例书路径作为写书规范目录（`books/sample`），以及 `bookId`、当前章节、用户指令等。详见仓库根目录 `README.md`「本地 AI」一节。
:::

写书规则仍以本手册「写作」域为准，不要绕开 [稳定 ID](03-format.md#stable-ids)。
