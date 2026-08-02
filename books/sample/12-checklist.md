---
id: checklist
title: 收束与自检
---
生成或大幅改写一本书之前，用本页收束（实现透镜）。规范正文在「写作」域；场景侧读 [结构思想](02-structure.md#thesis)，实现侧读 [内容格式规范](03-format.md#layout)；本页是可勾选合同。

## 给 AI 与作者 {#for-ai}

以本手册为准，尤其是：

- [结构思想](02-structure.md#thesis)
- [内容格式规范](03-format.md#layout)
- [细节折叠演示](04-details.md#basics)（写法活样例）
- 本页自检清单

不要在仓库其它位置另立平行规范；以本手册为准。

## 生成前自检 {#preflight}

- [ ] 全书结构：总分总清晰；垂直域边界清楚；同级标题同维度；本义自述（见 [结构自检](02-structure.md#checklist-structure)、[本义自述](02-structure.md#affirmative)）
- [ ] `book.json` 的 `contents` 页项含 `id` + `file`，且与 frontmatter `id` 一致；组项含 `id` + `title` + `children`；组 / 页 id 全书唯一
- [ ] 若声明 `lenses`：为带 `title` 的树数组（顶层 = 轴）；页项 `lenses` 只挂**叶子**（`true` 或小节列表）；无 `correspondences`；页 frontmatter 不含 `layer` / `pair`；节点 id 非空且全书唯一
- [ ] 每章 frontmatter 含 `id`、`title`，且 `id` 不与历史冲突（含不与 group id 冲突）；**新建章节 / 新建小节** `id` 均为时间戳（如 `YYYYMMDDHHmm`），不带业务含义
- [ ] 所有 h2–h6 均有显式 `{#id}` 且章内唯一
- [ ] 修改既有章节时，未改动任何既有 id（含不把旧章节/小节 id 改成时间戳）
- [ ] 细节内容已收入 `:::details`，主干保持可速读
- [ ] 架构/流程/目录图使用 Mermaid，无 ASCII 方框图
- [ ] 所有内部链接的文件名与 `#id` 均真实存在
- [ ] 未触碰 `data/` 目录
- [ ] 若该书已是 Git 仓：内容改动已 commit（阅读器「对比变更」才能看到新版本）
