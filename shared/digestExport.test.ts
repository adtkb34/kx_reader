import { describe, expect, it } from 'vitest';
import {
  buildDigestMarkdown,
  exportSectionHeadingTitle,
  formatBlockMarkdown,
  listDigestExportChapterIds,
  prepareExportSectionBody,
  shiftAtxHeadingLevels,
  stripSectionIdsFromMarkdown,
} from './digestExport';
import type { BookToc, TocChapter } from './types';

function page(
  partial: Pick<TocChapter, 'id' | 'title' | 'file'> &
    Partial<Pick<TocChapter, 'role' | 'layers' | 'sections' | 'sectionAllowlists'>>,
): TocChapter {
  return { sections: [], ...partial };
}

const book: BookToc = {
  id: 'demo',
  title: 'Demo',
  ruler: {
    axes: ['priority'],
    links: {
      k1: ['f1'],
      k2: [],
    },
  },
  lensAxisOrder: ['read', 'priority'],
  lenses: {
    read: [
      { id: 'flow', title: '流程' },
      { id: 'entity', title: '实体' },
    ],
    priority: [
      { id: 'p0', title: 'P0' },
      { id: 'p1', title: 'P1' },
    ],
  },
  tree: [
    {
      type: 'group',
      id: 'outer',
      title: '外层',
      children: [
        {
          type: 'group',
          id: 'mod',
          title: '模块',
          children: [
            { type: 'page', id: 'idx', title: '骨架', file: 'index.md' },
            { type: 'page', id: 'flow', title: '流程', file: 'flow.md' },
          ],
        },
      ],
    },
  ],
  chapters: [
    page({
      id: 'idx',
      title: '骨架',
      file: 'index.md',
      role: 'ruler',
      layers: { priority: ['p0'] },
      sections: [
        { id: 'k1', title: '步骤一', level: 2 },
        { id: 'k2', title: '步骤二', level: 2 },
      ],
    }),
    page({
      id: 'flow',
      title: '流程',
      file: 'flow.md',
      layers: { read: 'flow', priority: 'p0' },
      sections: [{ id: 'f1', title: '流程块', level: 2 }],
    }),
  ],
};

const idxMd = `---
id: idx
title: 骨架
---

{#k1}
## 步骤一

刻度一正文。

{#k2}
## 步骤二

刻度二正文。
`;

const flowMd = `---
id: flow
title: 流程
---

{#f1}
## 流程块

挂靠正文。
`;

describe('stripSectionIdsFromMarkdown / ensureTableHeaderInBody', () => {
  it('drops standalone {#id} lines and strips table-row ids', () => {
    expect(stripSectionIdsFromMarkdown('{#sec1}\n## 标题\n')).toBe('## 标题\n');
    expect(stripSectionIdsFromMarkdown('| 查看 | 打开 | 列出 | {#rid}')).toBe(
      '| 查看 | 打开 | 列出 |',
    );
  });

  it('drops trailing empty id-placeholder column from header/separator', () => {
    const md = `| 场景 | 操作 | 系统 | |
| --- | --- | --- | --- |
| 查看 | 打开列表 | 列出 | {#r1}
`;
    expect(stripSectionIdsFromMarkdown(md)).toBe(
      `| 场景 | 操作 | 系统 |
| --- | --- | --- |
| 查看 | 打开列表 | 列出 |
`,
    );
  });

  it('prepends GFM header for table-row section slices', () => {
    const chapter = `| 场景 | 操作 | 系统 | |
| --- | --- | --- | --- |
| 查看 | 打开列表 | 列出 | {#r1}
| 新增 | 填写 | 建档 |
| 修改 | 编辑 | 保存 | {#r2}
`;
    const body = `| 查看 | 打开列表 | 列出 | {#r1}
| 新增 | 填写 | 建档 |`;
    const prepared = prepareExportSectionBody(chapter, { id: 'r1', body });
    expect(prepared).toContain('| 场景 | 操作 | 系统 |');
    expect(prepared).not.toContain('| 场景 | 操作 | 系统 | |');
    expect(prepared).toContain('| --- | --- | --- |');
    expect(prepared).not.toContain('| --- | --- | --- | --- |');
    expect(prepared).toContain('| 查看 | 打开列表 | 列出 |');
    expect(prepared).not.toContain('{#');
  });
});

describe('shiftAtxHeadingLevels', () => {
  it('shifts and clamps heading depths', () => {
    expect(shiftAtxHeadingLevels('## A\n### B', 1)).toBe('### A\n#### B');
    expect(shiftAtxHeadingLevels('# A', 10)).toBe('###### A');
    expect(shiftAtxHeadingLevels('###### A', -10)).toBe('# A');
  });
});

describe('formatBlockMarkdown', () => {
  it('prefixes number and demotes first heading', () => {
    const out = formatBlockMarkdown(3, '1.1.1', '步骤一', '{#k1}\n## 步骤一\n\n正文', {
      sourceLevel: 2,
    });
    expect(out).toMatch(/^### 1\.1\.1 步骤一/m);
    expect(out).toContain('正文');
  });

  it('emits synthetic heading when body empty', () => {
    expect(formatBlockMarkdown(2, '1.1', '模块', '', { synthetic: true })).toBe('## 1.1 模块');
  });
});

describe('exportSectionHeadingTitle', () => {
  it('falls back to page-layer lens titles when section title is empty', () => {
    const ch = page({
      id: 'flow',
      title: '流程',
      file: 'flow.md',
      layers: { read: 'flow', priority: 'p0' },
      sections: [{ id: 'row1', title: '', level: 2 }],
    });
    expect(exportSectionHeadingTitle(book, ch, 'row1', '')).toBe('流程 · P0');
    expect(exportSectionHeadingTitle(book, ch, 'row1', '  已有标题  ')).toBe('已有标题');
  });

  it('prefers section allowlist leaves over page layers', () => {
    const ch = page({
      id: 'flow',
      title: '流程',
      file: 'flow.md',
      layers: { read: 'flow', priority: 'p0' },
      sectionAllowlists: { read: { flow: ['row1'] }, priority: { p1: ['row1'] } },
      sections: [{ id: 'row1', title: '', level: 2 }],
    });
    expect(exportSectionHeadingTitle(book, ch, 'row1', '')).toBe('流程 · P1');
  });
});

describe('buildDigestMarkdown', () => {
  const chapterMarkdown = new Map([
    ['idx', idxMd],
    ['flow', flowMd],
  ]);

  it('index ruler: path / page / section levels and numbers match digest', () => {
    const md = buildDigestMarkdown(book, chapterMarkdown, {
      selection: { read: ['flow'], priority: ['p0'] },
      rulerPick: 'index',
      hangFilter: 'all',
    });
    // leaf module groupPath=['外层'] → path L1; page L2; ## section → L3
    expect(md).toMatch(/^# 1 外层/m);
    expect(md).toMatch(/^## 1\.1 模块/m);
    expect(md).toMatch(/^### 1\.1\.1 步骤一/m);
    expect(md).toContain('刻度一正文');
    expect(md).toMatch(/流程块/);
    expect(md).toContain('挂靠正文');
    expect(md).not.toContain('{#');
  });

  it('axis ruler: leaf is H1 and nested content is boosted', () => {
    const md = buildDigestMarkdown(book, chapterMarkdown, {
      selection: { read: ['flow'], priority: ['p0', 'p1'] },
      rulerPick: 'priority',
      hangFilter: 'all',
    });
    expect(md).toMatch(/^# 1 P0/m);
    expect(md).toMatch(/^## 1\.1 外层/m);
    expect(md).toMatch(/^### 1\.1\.1 模块/m);
  });

  it('leaf with no hangs still exports bare tick headings', () => {
    const md = buildDigestMarkdown(book, chapterMarkdown, {
      selection: { read: ['entity'], priority: ['p0'] },
      rulerPick: 'index',
      hangFilter: 'all',
    });
    // flow hang hidden; k1/k2 shells remain
    expect(md).toMatch(/步骤一/);
    expect(md).toMatch(/步骤二/);
    expect(md).not.toContain('挂靠正文');
  });

  it('untitled hang sections use lens titles in headings', () => {
    const toc: BookToc = {
      ...book,
      chapters: [
        book.chapters[0]!,
        page({
          id: 'flow',
          title: '流程',
          file: 'flow.md',
          layers: { read: 'flow', priority: 'p0' },
          sections: [{ id: 'f1', title: '', level: 2 }],
        }),
      ],
      ruler: {
        ...book.ruler!,
        links: { k1: ['f1'], k2: [] },
      },
    };
    const hangMd = `---
id: flow
title: 流程
---

{#f1}
| 场景 | 操作 |
| --- | --- |
| 查看 | 打开 |
`;
    const md = buildDigestMarkdown(
      toc,
      new Map([
        ['idx', idxMd],
        ['flow', hangMd],
      ]),
      {
        selection: { read: ['flow'], priority: ['p0'] },
        rulerPick: 'index',
        hangFilter: 'all',
      },
    );
    expect(md).toMatch(/流程 · P0/);
    expect(md).toContain('| 查看 | 打开 |');
  });

  it('listDigestExportChapterIds includes index and hang chapters', () => {
    const ids = listDigestExportChapterIds(book, {
      selection: { read: ['flow'], priority: ['p0'] },
      rulerPick: 'index',
    });
    expect(ids.sort()).toEqual(['flow', 'idx']);
  });

  it('focusModuleIds limits export to listed modules', () => {
    const md = buildDigestMarkdown(book, chapterMarkdown, {
      selection: { read: ['flow'], priority: ['p0'] },
      rulerPick: 'index',
      hangFilter: 'all',
      focusModuleIds: ['idx'],
    });
    expect(md).toMatch(/步骤一/);
    expect(md).toContain('刻度一正文');
    const ids = listDigestExportChapterIds(book, {
      selection: { read: ['flow'], priority: ['p0'] },
      rulerPick: 'index',
      focusModuleIds: ['idx'],
    });
    expect(ids.sort()).toEqual(['flow', 'idx']);
  });

  it('outlineKeyIdsByModule keeps only selected ruler keys', () => {
    const md = buildDigestMarkdown(book, chapterMarkdown, {
      selection: { read: ['flow'], priority: ['p0'] },
      rulerPick: 'index',
      hangFilter: 'all',
      outlineKeyIdsByModule: { idx: ['k1'] },
    });
    expect(md).toMatch(/步骤一/);
    expect(md).toContain('刻度一正文');
    expect(md).toContain('挂靠正文');
    expect(md).not.toMatch(/步骤二/);
    expect(md).not.toContain('刻度二正文');
  });
});
