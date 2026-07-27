# 阅读器分层架构重写 · 设计说明

日期：2026-07-26  
状态：**已确认**  
分支：`refactor/layered-architecture`

## 背景

阅读器已具备书籍阅读、标注、透镜、Git 对比、本地 Agent 等能力。代码在 Express 入口、书籍加载与单体 CSS 上堆积，后续若部署到服务器并支持登录/多人协作，边界需要先清晰。

## 目标

- 按 **领域 / 应用 / 端口 / 适配器 / 传输** 重铺服务端边界。
- 客户端按 **功能域** 收拢，样式按区域拆分。
- `shared/` 仍为切章、透镜、diff、标注状态的唯一真相源。
- 补核心自动化测试；`typecheck` + 测试通过；**现有 HTTP API 与产品行为不变**。

## 非目标（本分支不做）

- 登录、用户表、鉴权实现
- 数据库、多租户隔离实现
- 多人实时协作 / CRDT / WebSocket
- UI 重设计、换前端/后端框架

## 架构

```text
server/src/
  domain/           # 纯规则与值对象（含 Actor；无 I/O）
  ports/            # BookRepository / AnnotationStore / …
  app/              # 组装依赖；用例可接受 Actor（今日恒为 local）
  adapters/
    file/           # 本地 books/ + data/ 实现
    agent/          # 本地 CLI Agent
  http/             # Express 路由（未来鉴权中间件挂点）
  index.ts          # createApp + listen
  config.ts         # 路径与端口

client/src/
  features/         # home / book / notes / compare / agent / orphans
  api/              # 唯一 HTTP 客户端
  shared-ui/        # 跨功能薄壳（若需要）
  styles/           # 分区 CSS，入口聚合
  stores/           # 状态（可逐步迁入 features）

shared/             # types、sections、lenses、sectionDiff、annotations
```

## 多人预留（只留缝）

- `Actor`：`{ kind: 'local' }` 或 `{ kind: 'user', userId }`；应用层可接收，文件适配器暂忽略。
- 标注按 `bookId` 隔离；不把「单一全局用户」写进存储键。
- HTTP 层预留挂载 `Authorization` 的位置；用例层不解析 cookie。

## 测试

- Vitest：优先 `shared/sections`、`shared/lenses`、`shared/sectionDiff`。
- 服务端：标注 store / 小节写回等可测路径按需补小集成测试。
- 不上沉重 E2E。

## 验收

1. 路由不再堆在单文件 `index.ts`
2. 书籍 I/O 落在 `adapters/file`，端口可替换
3. CSS 可按区域定位
4. 核心 shared 测试绿；`npm run typecheck` 绿
5. 现有 API 契约与阅读/标注/透镜/对比/Agent 流程行为不变

## 流程

1. `main` 上当前变动已提交（若有）
2. 本分支开发重构
3. 合并前人工点验示例手册主路径
