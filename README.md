# 文档书阅读器（Doc Book Reader）

把项目文档变成一本可翻页的书：目录导航、章节翻页、内容跳转、细节折叠；每个小节可标记状态（未读 / 已读 / 疑问 / 确认，默认未读）、可添加多条备注，全部持久化为本地 JSON 文件。内容由 AI 按照书架上的《示例手册：文档书阅读器》（`books/sample`，尤其是「写作」域）生成，标注与内容物理分离，内容重新生成后标注不丢。

## 快速开始

要求 Node.js 20+。

```bash
npm install
npm run dev
```

浏览器打开 http://localhost:5173（前端），API 服务运行在 4730 端口。仓库自带一本示例书《示例手册：文档书阅读器》，本身就是全部功能的演示。

单端口运行（可选）：`npm run build && npm start` 后直接访问 http://localhost:4730。

自动化测试：`npm test`（Vitest，覆盖 `shared/` 切章 / 透镜 / diff）。

## 使用工作流

1. 让 AI 阅读《示例手册》的「写作」域与文末自检（`books/sample`），按规范在 `books/<book-id>/` 下生成或更新一本书；
2. 打开阅读器翻阅：← / → 翻页，目录点击跳转，折叠块按需展开；
3. 对每个小节标记状态、写备注；目录实时汇总每章未读数与疑问数；
4. 标注保存在 `data/annotations/<book-id>.json`（可读 JSON，建议纳入 git）；
5. 内容重新生成后，只要小节 id 未变，标注自动跟随；失联的标注进入顶栏「孤立标注」面板，可回收或删除。
6. 小节工具条「编辑」可直接改该段 Markdown（排版与阅读态一致），保存写回该书文件；须保持开头独占行 `{#id}` 不变。
7. （可选）每本书独立 `git init` 并 commit 后，顶栏「对比变更」可按小节 id 对比任意 branch / tag / hash。
8. （可选）顶栏「AI」调用本地 Cursor Agent CLI 改书内 Markdown，写盘后自动重载；默认关闭，见下方「本地 AI」。

## 本地 AI（Cursor Agent CLI）

默认关闭。启用后，阅读器会在本书根目录以非交互方式跑本地 `agent`（`--print --trust --force`），**直接改磁盘文件**，仅适合本机单人使用。

```bash
# 先登录一次（本机）
agent login

# 启用 AI 的开发启动（推荐）
npm run dev:agent

# 或手动：
AGENT_ENABLED=1 npm run dev
```

可选环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AGENT_ENABLED` | 关 | 设为 `1` 才接受 `/agent/runs` |
| `AGENT_MODEL` | （CLI 默认） | 传给 `--model`（若面板未选具体模型） |
| `AGENT_TIMEOUT_MS` | `600000` | 单次超时（毫秒） |
| `CURSOR_API_KEY` | — | 若不用 `agent login`，可透传密钥 |

同一本书同时只能跑一个 agent；并发请求返回 409。内容写盘成功后，阅读器会在该书目录自动 `git init`（如需要）并 `git add` / `git commit`（message 由 AI 生成；失败则回退到默认文案）。不自动 `git push`。

### Agent 配置

Agent、行为与可选模型在 reader 仓库（不进书仓）：

```text
config/agents.json                      # agents[]（bin + args + 说明）+ behaviors[]
config/prompts/_common.md               # 共用硬规则
config/prompts/drivers/cursor-cli.md    # Cursor 调用说明
config/prompts/drivers/claude-code.md   # Claude Code 调用说明
config/prompts/doc-edit.md              # 行为：改文档
config/prompts/doc-review.md            # 行为：审读挑错
```

每条 **agent**（同类 CLI 主要改配置即可）：

| 字段 | 含义 |
| --- | --- |
| `id` / `title` | 面板显示名 |
| `driver` | 标签（`cursor-cli` / `claude-code`…），spawn 走统一 runner |
| `bin` | **本机可执行文件名或绝对路径** |
| `args` | **CLI 参数模板**；占位符 `{{bookRoot}}` `{{readerRoot}}`；有模型时追加 `--model`；最后追加 prompt |
| `promptFile` | 该 agent 的调用说明（注入 behavior 的 `{{driver}}`） |
| `defaultModel` | 默认模型 id（须在 `models[]` 里；可空 = CLI 默认） |
| `models[]` | `{ id, title }`，`id` 空 = CLI 默认 |

**behaviors[]** 全局共享：`id` / `title` / `promptFile`。

最终 prompt = 渲染 behavior；`{{driver}}` 来自该 agent 的 `promptFile`。  
其它占位符：`{{common}}` `{{authoringPath}}` `{{bookId}}` `{{chapterFile}}` `{{scope}}` `{{userPrompt}}`。

加同类 CLI agent：在 `agents.json` 加一条并写好 `bin` / `args` / `promptFile`（必要时新建 driver md）。HTTP/SDK 类接入仍需改代码。

## 目录结构

```text
books/<book-id>/          一本书：book.json 清单 + 若干 Markdown 章节
books/sample/             示例手册 = 产品说明 + 写书唯一规范
data/annotations/         标注数据（阅读器写入，生成器禁止触碰）
config/                   Agent / 行为 / prompt 模板
server/                   分层 API：domain / ports / app / adapters / http
client/                   Vue 3：features/ + api/ + styles/
shared/                   共用类型、切章、透镜、diff（唯一真相源）
docs/superpowers/specs/   架构等设计说明
```

## API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/books` | 书籍列表 |
| GET | `/api/books/:bookId` | 目录（章节 + 小节树） |
| GET | `/api/books/:bookId/chapters/:chapterId` | 章节 Markdown |
| GET | `/api/books/:bookId/assets/*` | 书内 `assets/` 照片（扩展名白名单） |
| GET | `/api/books/:bookId/annotations` | 全书标注 |
| PUT | `/api/books/:bookId/annotations/status` | 设置小节状态 `{sectionId, status}` |
| POST | `/api/books/:bookId/annotations/notes` | 添加备注 `{sectionId, text}` |
| PUT | `/api/books/:bookId/annotations/notes/:noteId` | 编辑备注 |
| DELETE | `/api/books/:bookId/annotations/notes/:noteId?sectionId=` | 删除备注 |
| DELETE | `/api/books/:bookId/annotations/section?sectionId=` | 删除整条标注（孤立标注清理） |
| GET | `/api/books/:bookId/git/status` | 该书根目录是否含 `.git` |
| GET | `/api/books/:bookId/git/refs` | 本地 branch / tag 列表 |
| GET | `/api/books/:bookId/git/history` | 全书 `git log`（`?limit=`，默认 100） |
| GET | `/api/books/:bookId/chapters/:chapterId/history` | 该章节文件的 `git log` |
| GET | `/api/books/:bookId/chapters/:chapterId/compare?from=&to=&mode=` | 两 ref 间按小节 id 对齐的 diff（`mode=unified\|sideBySide`） |
| GET | `/api/books/:bookId/chapters/:chapterId/sections/:sectionId` | 小节 Markdown 原文 |
| PUT | `/api/books/:bookId/chapters/:chapterId/sections/:sectionId` | 写回小节 `{ markdown }`（须保持 `{#id}`） |
| GET | `/api/agent/status` | `{ enabled, defaultAgent, defaultBehavior }` |
| GET | `/api/agents/catalog` | `{ agents（含 bin/binOk）, behaviors, defaults }` |
| POST | `/api/books/:bookId/agent/runs` | body `{ prompt, chapterId?, agentId?, behaviorId?, model? }`；SSE |

## 设计要点

- **稳定 ID**：标注以 `章节id#小节id` 为键。示例手册要求每个可标记小节以独占行 `{#id}` 开头且永不改变，这是标注能在内容重新生成后存活的根基。
- **标注与内容分离**：标注存于 `data/`，内容存于 `books/`，重新生成内容不可能覆盖标注。
- **孤立标注兜底**：id 失联的标注进入专门面板，绝不静默丢失。
- **一书一仓 + Git 对比**：每本书应是独立 Git 仓库（`books/<book-id>/.git`）。内容变更后阅读器自动 commit（无仓则先 init；message 由 AI 生成）。顶栏「对比变更」可选 branch / tag / hash。不自动 push。
- **本地 AI 对话框**：可选调用本机 CLI（Cursor Agent / Claude Code 等）；在 `config/agents.json` 配置 `bin`、`args`、调用说明与模型，以及共享行为；默认 `AGENT_ENABLED` 关闭。
- **服务端/客户端一致性**：目录抽取与正文切分共用 `shared/sections.ts` 的同一套 slug 与分组规则。
- **可扩展为团队服务**：所有读写走 REST API，文件存储实现在 `AnnotationStore` 接口之后；换成数据库 + 登录即可多人使用，前端无需改动。

## 键盘

- `←` / `→`：上一章 / 下一章
- `⌘ + Enter`：备注输入框内快速提交
