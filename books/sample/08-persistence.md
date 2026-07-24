---
id: persistence
title: 持久化与孤立标注
---
标注挂在稳定地址上，不挂在易变正文里。这是「留得住」的根基。怎么标记与写备注，见场景透镜的 [标记与备注](07-annotations.md#statuses)。

## 存储位置 {#storage}

所有标记与备注实时写入 `data/annotations/<书籍id>.json`，与内容物理分离；文件是可读的 JSON，适合纳入 git 管理。生成器**禁止**读写该目录。

:::details 标注文件的实际结构
```json
{
  "version": 1,
  "bookId": "sample",
  "sections": {
    "overview#problem": {
      "status": "question",
      "statusUpdatedAt": "2026-07-15T02:00:00.000Z",
      "notes": [
        {
          "id": "…",
          "text": "备注内容",
          "createdAt": "2026-07-15T02:00:00.000Z",
          "updatedAt": "2026-07-15T02:00:00.000Z"
        }
      ]
    }
  }
}
```

键是 `章节id#小节id`。恢复为「未读」且没有备注的小节会被自动清理出文件。
:::

## 内容变更与 hash {#content-hash}

每次打开本书（拉取标注）时，服务端会为全书小节正文计算 hash：若某小节此前标记为**已读**或**确认**，而正文 hash 已变，则自动打回**未读**（疑问状态保留）。首次遇到尚无 hash 的旧标注只补写 hash，不改状态。

## 孤立标注 {#orphans}

内容重新生成后，如果某个小节 id 消失（违反 [稳定 ID](03-format.md#stable-ids) 或小节确实被删除），它的标注会进入顶栏的「孤立标注」面板：可以等内容修复后自动归位，也可以手动删除。本书预置了一条孤立标注用于演示——点开顶栏的「孤立标注」即可看到。
