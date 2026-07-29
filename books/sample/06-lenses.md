---
id: lenses
title: 阅读透镜
---
本书顶栏的 **读法树**（可多选）就是透镜：同一本书、按轴勾选维度节点，目录与翻页只展示当前选择下可见的页与小节。透镜的 **轴与树由每本书自己声明**。选中写入 URL query（如 `?kind=scenario&kind=impl`），刷新与分享可还原。

## 为何需要透镜 {#why}

两类读者、两类任务常描述同一主题，但心智不同。同坐标内容应写在**同一页**，用 `page.lenses` 标哪些小节属于哪个**叶子**维度；切换透镜只过滤小节，**不换页**。

维度可有层级：选中父节点 = 展示其下全部叶子内容的并集；也可多选若干叶/父，并集去重。多轴时各轴独立，页要**同时**满足各轴归属才可见。

## 怎么声明 {#how}

在 `book.json` 声明 `lenses`（轴 → 树），并在每个 `page` 上用 `lenses` 挂**叶子**归属。页 frontmatter **只写** `id` / `title`（须与 manifest `id` 一致）。

```json
{
  "lenses": {
    "kind": [
      {
        "id": "read",
        "title": "读法",
        "children": [
          { "id": "scenario", "title": "场景" },
          { "id": "impl", "title": "实现" }
        ]
      }
    ]
  },
  "contents": [
    { "type": "page", "id": "overview", "file": "01-overview.md" },
    {
      "type": "page",
      "id": "auth",
      "file": "identity/01-auth.md",
      "lenses": {
        "kind": {
          "scenario": ["login", "register"],
          "impl": ["api", "db"]
        }
      }
    },
    {
      "type": "page",
      "id": "navigation",
      "file": "05-navigation.md",
      "lenses": { "kind": { "scenario": true } }
    }
  ]
}
```

| 写法 | 含义 |
| --- | --- |
| 省略 `page.lenses` | 各轴选择下都**常显**（如概览） |
| `option: true`（叶子） | 整页属于该叶子，无小节过滤 |
| `option: ["sec-a", …]`（叶子） | 该叶子下只显示所列小节（含子级展开） |
| `page.lenses` 挂父节点 id | **禁止**；只允许叶子 |
| 顶栏选中父节点 | 生效 = 其下全部叶子并集 |
| 顶栏多选 | 各选中节点展开后再并集 |
| 默认 | 每轴选中全部**根**节点（先看到整轴） |

约定：

- 透镜只过滤导航与小节显示，不改变标注键（仍是 `章节id#小节id`）。
- 节点 `id` 全书唯一、非空；轴 key 小写 kebab-case。
- 兼容：无 `children` 的扁平列表视为深度为 1 的树。
- 同坐标多维度写一页；已无 `correspondences`。

## 其它活样例 {#where}

本手册顶栏「读法」下挂场景 / 实现两叶；清单写法见 [book.json](03-format.md#manifest-tree)。
