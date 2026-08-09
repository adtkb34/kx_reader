# Figma 原型嵌入设计

## Goal

让书里能展示**可交互**的 Figma Prototype：读者在阅读器内直接点流程，不必另开设计工具。首版只支持公开或「任何人有链接可看」的原型；假定读者有网且能访问 `figma.com`。

## Decisions

| 项 | 选择 |
| --- | --- |
| 展示形态 | iframe 嵌入可点原型（非静态导出） |
| 写作语法 | 专用 \`\`\`figma 块（与 wireframe / mermaid 并列） |
| 默认版式 | 放在 \`:::details 原型\`；正文仍写结构 / 屏表 |
| 与 wireframe | 并存：结构示意用 wireframe，可点流程用 figma |
| 权限 | 公开 / anyone-with-link；不做私有文件与登录态 |
| Embed API | 不做 OAuth / postMessage 遥控；只要能点 |

## Author workflow

1. Figma 做好 Prototype → Share → **Anyone with the link** → 复制链接（`https://www.figma.com/proto/...`，可带 `node-id`）。
2. 章节正文写结构或屏表；需要可点流程时，在 `:::details 原型` 中加入 \`\`\`figma 块。
3. 同一屏可同时保留 wireframe（结构）与 figma（交互），互不替代。

## Markdown contract

块内第一行必须是 URL；可选第二行作为图下标题：

````markdown
:::details 原型
```figma
https://www.figma.com/proto/FILEKEY/Name?node-id=1-2
登录流程
```
:::
````

### Allowed URLs

- `https://www.figma.com/proto/...`
- `https://figma.com/proto/...`
- `https://embed.figma.com/proto/...`（已是嵌入 URL 时原样归一化参数）

### Rejected

- `design` / `board` / `slides` / `deck` 等非原型链接
- 非 `figma.com` / `www.figma.com` / `embed.figma.com` 域
- 空块、多行杂讯（除可选标题外）

非法 URL：**不**渲染 iframe；显示简短错误文案，并保留可点击的原文链接（新窗口）。

### Format doc

更新 `books/sample/03-format.md`：

- 在「图表与 UI 线框」下新增 Figma 小节
- 照片/插图分工表增加：可交互原型用 \`\`\`figma
- 约定默认放在 `:::details 原型`

## Reader rendering

在 `client/src/markdown.ts` 的 `highlight`（或等价围栏处理）中识别 `lang === 'figma'`：

1. 解析第一行 URL、可选第二行标题。
2. 校验域与路径为 `/proto/`。
3. 归一化为 Embed Kit 2.0 URL：
   - 将 `www.figma.com` / `figma.com` 换成 `embed.figma.com`
   - 保留 `node-id` 等已有 query
   - 写入或覆盖 `embed-host=kx-reader`
4. 输出容器 HTML，例如：

```html
<div class="figma-embed">
  <iframe
    src="https://embed.figma.com/proto/..."
    title="..."
    loading="lazy"
    allowfullscreen
    referrerpolicy="no-referrer"
  ></iframe>
  <!-- optional caption -->
</div>
```

### Layout

- 宽 `100%`
- 高约 `70vh`（或固定下限约 `560px`，以免折叠内过矮）
- 可选标题用与图片 caption 相近的样式（如 `.md-figcaption`）

### Security

- 仅允许上述 Figma 宿主；禁止任意 URL 进 iframe
- iframe 不依赖阅读器同源脚本；首版可不加复杂 `sandbox` 若会阻断原型点击（若加，须保留脚本与同源能力以便原型可用）
- 外链失败时降级为链接，不抛崩章节渲染

## Out of scope

- 私有文件、Figma 登录态、离线静态预览
- 嵌入 Design / FigJam / Slides
- 普通 Markdown 链接自动变成嵌入
- 原型与 wireframe 同步、自动导出进 `assets/`
- Embed Kit OAuth、`client-id`、前进/后退遥控 API

## Acceptance

- sample 格式页有写法说明与至少一处示例块（可用占位 URL 或真实公开原型）
- 合法 proto URL → 章内可见可点 iframe
- 非法 URL → 无 iframe，有错误提示 + 外链
- 现有 wireframe / mermaid / 图片行为不变
