---
id: lenses
title: 阅读透镜
---
本书顶栏的 **场景 / 实现** 就是透镜：同一本书、按轴切换阅读任务，目录与翻页只展示当前选择下可见的页。透镜的 **轴与选项由每本书自己声明**。Now Order 有两轴：读法（场景 / 界面 / 实现）与视角（租户端 / 运营后台）。

## 为何需要透镜 {#why}

两类读者、两类任务常描述同一主题，但心智不同。硬塞一页会导致维度混杂。切换透镜后，只看到当前任务需要的页；成对主题在 `book.json` 的 `correspondences` 里互指，切换时跳到对侧页（如 [结构思想](02-structure.md#thesis) ↔ [内容格式规范](03-format.md#layout)）。

多轴时（如读法 × 视角）各轴独立选择，页要**同时**满足各轴归属才可见。

## 怎么声明 {#how}

在 `book.json` 声明 `lenses`（对象：轴 → 选项列表），并用同构的 `correspondences` 写清归属与互跳。页 frontmatter **只写** `id` / `title`，不要写 `layer` / `pair`。

```json
{
  "lenses": {
    "kind": [
      { "id": "scenario", "title": "场景" },
      { "id": "impl", "title": "实现" }
    ]
  },
  "correspondences": {
    "kind": [
      { "scenario": "structure", "impl": "format" },
      { "scenario": "navigation" },
      { "impl": "architecture" }
    ]
  }
}
```

多轴示例（Now Order）：

```json
{
  "lenses": {
    "kind": [
      { "id": "scenario", "title": "场景" },
      { "id": "ui", "title": "界面" },
      { "id": "impl", "title": "实现" }
    ],
    "audience": [
      { "id": "tenant", "title": "租户端" },
      { "id": "admin", "title": "运营后台" }
    ]
  },
  "correspondences": {
    "kind": [{ "scenario": "ops" }, { "impl": "architecture" }],
    "audience": [{ "admin": "ops" }]
  }
}
```

| 写法 | 含义 |
| --- | --- |
| 轴下多键一行 | 该主题在该轴各选项下的页 id；切换**该轴**时跳到目标键对应的页 |
| 轴下单键一行 | 仅归属该选项，无对侧 |
| 未出现在某轴任何行 | **该轴常显** |
| 未出现在任何轴 | 各轴选择下都常显（如概览） |

页文件仍只需：

```markdown
---
id: structure
title: 结构思想
---
```

约定：

- 透镜只过滤导航，不改变标注键（仍是 `章节id#小节id`）。
- 选项 `id` 全书唯一、非空；轴 key 小写 kebab-case。
- 兼容：旧版 `lenses` / `correspondences` 写成**数组**时，自动当作单轴 `kind`。
- 同一章节 id 在同一轴内只能出现在一行 `correspondences` 里。

## 其它活样例 {#where}

书架上的 Now Order：顶栏两个下拉（读法 + 视角）；本义自述见 [结构思想](02-structure.md#affirmative)；系统架构在实现；运营后台在场景且仅运营视角。清单写法见 [book.json](03-format.md#manifest-tree)。
