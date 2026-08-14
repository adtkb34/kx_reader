---
id: lenses
title: 阅读透镜
---
本书顶栏的 **透镜树**（可多选）就是透镜：同一本书、在一棵树里按轴勾选维度节点，目录与翻页只展示当前选择下可见的页与小节。透镜由 `book.json` 的 `lenses` **数组**声明（每节点自带 `title`）。选中写入 URL query（如 `?read=scenario&read=impl`），刷新与分享可还原。

{#why}
## 为何需要透镜

两类读者、两类任务常描述同一主题，但心智不同。同坐标内容应写在**同一页**，用 contents 页项上的 `lenses` 标哪些小节属于哪个**叶子**维度；切换透镜只过滤小节，**不换页**。

维度可有层级：选中**叶子** = 只显示该叶挂靠正文 ∪ **index 刻度壳**（未挂该轴的正文隐藏）；选中**非叶**（父 / 轴）= 去掉挂在「不是这棵子树下」的子叶上的内容，本子树挂靠与未挂任何子叶的仍显示。也可多选若干同层叶。**同一分支同时只能选一层**（父与子不可并存）；跨轴 / 不同分支互不影响。多轴时页要**同时**满足各轴约束才可见。

{#how}
## 怎么声明

在 `book.json` 用 `lenses: [...]` 声明轴树（顶层 = 轴，节点含 `id` / `title` / 可选 `children`），并在 `contents` 页项上用 `lenses` 挂**叶子**归属。页 frontmatter **只写** `id` / `title`（须与 manifest `id` 一致）。顶栏把各轴合成 **一棵** 选择树。轴标题写在配置里，代码不写死 `kind` / `audience`。

```json
{
  "lenses": [
    {
      "id": "read",
      "title": "读法",
      "children": [
        { "id": "scenario", "title": "场景" },
        { "id": "impl", "title": "实现" }
      ]
    },
    {
      "id": "priority",
      "title": "优先级",
      "children": [
        { "id": "p0", "title": "P0" },
        { "id": "p1", "title": "P1" }
      ]
    }
  ],
  "ruler": {
    "axes": ["priority"],
    "links": {
      "index-sec-a": ["flow-sec-1", "entity-sec-1"]
    }
  },
  "contents": [
    {
      "id": "mod",
      "title": "模块",
      "children": [
        { "id": "idx", "file": "mod/index.md", "role": "ruler" },
        {
          "id": "flow",
          "file": "mod/flow.md",
          "lenses": { "read": { "scenario": true }, "priority": { "p0": true } }
        }
      ]
    }
  ]
}
```

| 写法 | 含义 |
| --- | --- |
| 省略页项 `lenses` | 各轴选择下都**常显**（如概览） |
| `option: true`（叶子） | 整页属于该叶子（约束目录可见性），无小节过滤；**`role: "ruler"` 的 index 页例外**：整页层不隐藏，刻度壳常显；且 index 上的整页归属会放开**同模块挂靠正文**给对应叶（如角色=工艺员） |
| `option: ["sec-a", …]`（叶子） | 选中该叶时显示这些小节；不把整页绑死在该叶 |
| 顶栏选中 `overview`（概览） | 与其它叶子相同：只显示挂 `overview` 的页/小节；未挂该叶的隐藏 |
| 顶栏选中其它无表叶（如权限） | 该叶无挂靠正文 → 只留 index 壳；未挂该轴与其它叶挂靠都隐藏 |
| 页项 `lenses` 挂父节点 id | **禁止**；只允许叶子 |
| 顶栏选中父节点 / 轴节点 | 去掉挂在其它子树子叶上的内容；本子树挂靠与未挂任何子叶的仍显示。轴本身覆盖全部子叶 ≡ 这维不藏挂靠 |
| 顶栏选中叶子 | 该叶挂靠 ∪ index 壳；未挂该轴的正文隐藏。index 刻度壳常显 |
| 顶栏同层多选 | 各选中叶的挂靠并集（顶栏「多选」模式） |
| 顶栏单选 | 每轴最多一个节点（默认；顶栏「单选」模式） |
| 顶栏单页 / 汇总 | **单页** = 叶目录（下面只有 md）整模块；**汇总** = 全书可见模块拼一篇，分组路径上页、标题按深度降级编号 |
| 顶栏尺子 | 独立下拉（不是读法）：默认「按 index」挂靠；`ruler.axes` 里的轴可选（如优先级 → 先 P0 再 P1）。换尺子轴时同样：**index 壳常显**，挂靠正文按叶筛 |
| `ruler.links` | key = `index.md` 小节 id；value = 其它文档挂靠小节 id（未写入 links 的 index 标题小节仍显示为骨架） |
| 同分支跨层 | 不允许；勾子取消父，勾父取消子 |
| 默认 | 每轴选中**第一个选项根**（如 `tenant` + `scenario`） |

约定：

- 透镜只过滤导航与小节显示，不改变标注键（仍是 `章节id#小节id`）；汇总同样复用该键。
- 节点 `id` 全书唯一、非空；每个透镜节点必须自带 `title`。
- 同坐标多维度写一页；已无 `correspondences`。
- 汇总模式下左侧书目录仍显示；点某模块切回「单页」。
- 汇总正文显示全部祖先分组名，无分割线；有分组时小节标题级自动降级并编号。

{#ruler}
## 尺子读法

相对透镜「在固定排版上过滤」，尺子是**组装顺序**：默认按各模块 **`index.md` 骨架**（`role: "ruler"`）+ `ruler.links` 挂靠其它 md 小节；也可选 `ruler.axes` 中的轴，按叶声明顺序分桶（如 P0 → P1）。

顶栏读法只有「单页 / 汇总」；有 `ruler` 配置或 `role: "ruler"` 页时出现「尺子」下拉。

### 刻度与挂靠

刻度 = 模块 `index.md` 里带标题的骨架小节。`ruler.links` **只挂靠**，不必为每个刻度登记；未写入 links 的标题仍显示为空骨架。

例：index 有「建档 / 路线 / 参数 / 版本 / 下发」五格，links 只挂前两格 → 选「按 index」且顶栏为「不隐藏」时五格都在；后三格无正文。

顶栏内容过滤（**只有**这两种才会按挂靠隐藏刻度与左侧章节；「不隐藏」下选叶 / 换尺子轴仍保留 index 壳与侧栏模块）：

| 选项 | 刻度 | 单页左侧 |
| --- | --- | --- |
| 不隐藏 | 全部刻度（壳常显；挂靠正文仍按叶筛） | 不按挂靠裁剪 |
| 仅有内容 | 只显示其下有可见挂靠的刻度 | 模块若没有「有挂靠」刻度则不显示 |
| 仅无内容 | 只显示其下没有挂靠的刻度 | 模块若没有「无挂靠」刻度则不显示 |

`{#id}` 有两种写法：独占行 = 块区间起点（可写 `rank=N`）；**表行尾** `{#id}` = 行组起点（到下一标记行前；无 id 行并入上一标记）。任意页可用 `rank` + 页 `showLevel` 控制详略（见 [格式 · 稳定 ID](03-format.md#stable-ids)）。

{#export-api}
## 导出接口（给 AI）

阅读器顶栏「导出」与下列 HTTP **同一套组装**（透镜 + 尺子挂靠 + 刻度勾选）。默认 JSON（字段 `markdown`，`assets` 为正文引用到的图片）；`format=md` 或 `Accept: text/markdown` 直接返回 Markdown；文中有图时 `format=auto`（顶栏按钮）或 `format=zip` 下载 zip（md + `assets/`）。

未出现的透镜轴**不过滤**。要与阅读器默认（每轴第一项）一致时加 `defaults=1`。挂靠页 id 会解析到模块 `index`。

```text
GET /api/books/:bookId/export
GET /api/books/:bookId/chapters/:chapterId/export
```

常用 query：`modules`（模块或挂靠页 id）、各轴 id（与阅读器 URL 相同，如 `define=biz`）、`keys`（刻度 `{#id}`）、`ruler`、`hang=all|content|empty`、`showLevel`、`format=md|zip|json`、`images=embed`（把图写成 data URI，单文件 Markdown）。

例：`GET http://localhost:4730/api/books/metoak-mes/export?format=zip&modules=<index页id>&define=biz&keys=<刻度id>`

{#where}
## 其它活样例

本手册顶栏「读法」下挂场景 / 实现两叶。练习书 / 客诉书用叶目录 + index 骨架；MES 书可把优先级 / 状态轴挂进 `ruler.axes`。
