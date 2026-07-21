---
id: lenses
title: 阅读透镜
---
本书顶栏的 **场景 / 实现** 就是透镜：同一本书、两类阅读任务，目录与翻页只展示当前类型。透镜的 **id 与显示名由每本书自己声明**，不是全局固定枚举——例如 Now Order 用「规则 / 界面」。

## 为何需要透镜 {#why}

两类读者、两类任务常描述同一主题，但心智不同。硬塞一页会导致维度混杂。切换透镜后，只看到当前任务需要的页；可用 `pair` 把成对页在切换时互跳（如 [结构思想](02-structure.md#thesis) ↔ [内容格式规范](03-format.md#layout)）。

## 怎么声明 {#how}

在 `book.json` 声明 `lenses` 后，每页 frontmatter 写归属（`layer` 必须是本书某个透镜 id，或省略表示常显）：

```markdown
---
id: structure
title: 结构思想
layer: scenario
pair: format
---
```

| 字段 | 含义 |
| --- | --- |
| `layer` | 本书某个 `lenses[].id`。省略 = **常显**。 |
| `pair` | 成对页的章节 `id`。切换透镜时若该页在新透镜下可见，则跳过去。 |

约定：

- 透镜只过滤导航，不改变标注键（仍是 `章节id#小节id`）。
- 成对主题目录相邻；场景写判断与操作，实现写合同与机制，互相链接。
- 本书：`scenario` / `impl`；其它书可自定（如 `rules` / `ui`）。

## 其它活样例 {#where}

书架上的 Now Order：顶栏「规则 / 界面」，身份组里对照规则页与界面页。清单写法见实现透镜的 [book.json](03-format.md#manifest-tree)。
