import { describe, expect, it } from 'vitest';
import {
  assembleDigestExport,
  buildDigestMarkdown,
  digestExportOptionsFromQuery,
  exportSectionHeadingTitle,
  formatBlockMarkdown,
  listDigestExportChapterIds,
  mergeAdjacentGfmTables,
  prepareExportSectionBody,
  resolveExportFocusModuleIds,
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

describe('mergeAdjacentGfmTables', () => {
  it('merges a header-only table with a body table that recopied the header', () => {
    const md = `| 场景 | 操作 | 系统 | |
| --- | --- | --- | --- |

| 场景 | 操作 | 系统 |
| --- | --- | --- |
| 查看 | 打开列表 | 列出 |
`;
    expect(mergeAdjacentGfmTables(md)).toBe(
      `| 场景 | 操作 | 系统 | |
| --- | --- | --- | --- |
| 查看 | 打开列表 | 列出 |
`,
    );
  });

  it('merges when one header has a trailing empty id column', () => {
    const md = `| 场景 | 操作 | 系统 |
| --- | --- | --- |
| 查看 | 打开列表 | 列出 |

| 场景 | 操作 | 系统 | |
| --- | --- | --- | --- |
| 新增 | 填写 | 建档 |
| 修改 | 编辑 | 保存 |
`;
    const out = mergeAdjacentGfmTables(md);
    expect(out.match(/\| 场景 \|/g)).toHaveLength(1);
    expect(out).toContain('| 查看 | 打开列表 | 列出 |');
    expect(out).toContain('| 新增 | 填写 | 建档 |');
    expect(out).toContain('| 修改 | 编辑 | 保存 |');
  });

  it('does not merge tables with different headers', () => {
    const md = `| 场景 | 操作 |
| --- | --- |
| 查看 | 打开 |

| 字段 | 类型 |
| --- | --- |
| 名称 | 文本 |
`;
    expect(mergeAdjacentGfmTables(md)).toBe(md);
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

  it('emits body without a heading when title is empty', () => {
    expect(formatBlockMarkdown(4, '3.1.1.1', '', '| 查看 | 打开 |\n', { sourceLevel: 2 })).toBe(
      '| 查看 | 打开 |',
    );
  });
});

describe('exportSectionHeadingTitle', () => {
  it('uses the section title and does not fall back to lens names', () => {
    const ch = page({
      id: 'flow',
      title: '流程',
      file: 'flow.md',
      layers: { read: 'flow', priority: 'p0' },
      sections: [{ id: 'row1', title: '', level: 2 }],
    });
    expect(exportSectionHeadingTitle(book, ch, 'row1', '')).toBe('');
    expect(exportSectionHeadingTitle(book, ch, 'row1', '  已有标题  ')).toBe('已有标题');
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

  it('untitled hang sections omit lens names from headings', () => {
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
    expect(md).not.toMatch(/流程 · P0/);
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

  it('single-module export omits TOC groups and uses page-local outline numbers', () => {
    const md = buildDigestMarkdown(book, chapterMarkdown, {
      selection: { read: ['flow'], priority: ['p0'] },
      rulerPick: 'index',
      hangFilter: 'all',
      focusModuleIds: ['idx'],
    });
    expect(md).not.toContain('外层');
    expect(md).toMatch(/^# 模块$/m);
    expect(md).not.toMatch(/^# \d+ /m);
    expect(md).toMatch(/^## 1 步骤一/m);
    expect(md).toMatch(/^### 1\.1 流程块/m);
    expect(md).toMatch(/^## 2 步骤二/m);
  });

  it('single-module export numbers from 1 even when the module is not first in the book', () => {
    const toc: BookToc = {
      ...book,
      tree: [
        {
          type: 'group',
          id: 'first',
          title: '甲组',
          children: [
            {
              type: 'group',
              id: 'moda',
              title: '模块甲',
              children: [{ type: 'page', id: 'idxa', title: '骨架甲', file: 'a.md' }],
            },
          ],
        },
        {
          type: 'group',
          id: 'second',
          title: '乙组',
          children: [
            {
              type: 'group',
              id: 'modb',
              title: '模块乙',
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
          id: 'idxa',
          title: '骨架甲',
          file: 'a.md',
          role: 'ruler',
          layers: { priority: ['p0'] },
          sections: [{ id: 'ka', title: '甲步骤', level: 2 }],
        }),
        ...book.chapters,
      ],
    };
    const md = buildDigestMarkdown(
      toc,
      new Map([
        ...chapterMarkdown,
        [
          'idxa',
          `---
id: idxa
title: 骨架甲
---

{#ka}
## 甲步骤

甲正文。
`,
        ],
      ]),
      {
        selection: { read: ['flow'], priority: ['p0'] },
        rulerPick: 'index',
        hangFilter: 'all',
        focusModuleIds: ['idx'],
      },
    );
    expect(md).not.toContain('甲组');
    expect(md).not.toContain('乙组');
    expect(md).not.toContain('模块甲');
    expect(md).toMatch(/^# 模块乙$/m);
    expect(md).toMatch(/^## 1 步骤一/m);
    expect(md).not.toMatch(/2\.1/);
  });

  it('single-module axis export keeps page buckets, not book-level axis groups', () => {
    const md = buildDigestMarkdown(book, chapterMarkdown, {
      selection: { read: ['flow'], priority: ['p0'] },
      rulerPick: 'priority',
      hangFilter: 'all',
      focusModuleIds: ['idx'],
    });
    expect(md).not.toContain('外层');
    expect(md).toMatch(/^# 模块$/m);
    expect(md).not.toMatch(/^# 1 P0/m);
    expect(md).toMatch(/^## 1 P0/m);
    expect(md).toMatch(/^### 1\.1 步骤一/m);
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

const chapterMarkdown = new Map<string, string>([
  ['idx', idxMd],
  ['flow', flowMd],
]);

describe('digestExportOptionsFromQuery', () => {
  it('maps hang-off page ids to the module index and applies keys', () => {
    const opts = digestExportOptionsFromQuery(book, {
      modules: 'flow',
      read: 'flow',
      hang: 'content',
      keys: 'k1',
    });
    expect(opts.focusModuleIds).toEqual(['idx']);
    expect(opts.hangFilter).toBe('content');
    expect(opts.selection).toEqual({ read: ['flow'] });
    expect(opts.outlineKeyIdsByModule).toEqual({ idx: ['k1'] });
  });

  it('omits unmentioned lens axes (no default filter)', () => {
    const opts = digestExportOptionsFromQuery(book, { modules: 'idx' });
    expect(opts.selection).toBeNull();
    expect(opts.hangFilter).toBe('all');
  });

  it('defaults=1 fills missing axes from defaultSelection', () => {
    const opts = digestExportOptionsFromQuery(book, { defaults: '1', modules: 'idx' });
    expect(opts.selection).toEqual({ read: ['flow'], priority: ['p0'] });
  });

  it('splits comma-separated modules', () => {
    const opts = digestExportOptionsFromQuery(book, { modules: 'idx,flow' });
    expect(opts.focusModuleIds).toEqual(['idx']);
  });

  it('keeps empty outline key lists (export none of the ticks)', () => {
    const opts = digestExportOptionsFromQuery(book, {
      modules: 'idx',
      outlineKeys: '{"idx":[]}',
    });
    expect(opts.outlineKeyIdsByModule).toEqual({ idx: [] });
  });
});

describe('resolveExportFocusModuleIds', () => {
  it('keeps unknown ids and unique-preserves', () => {
    expect(resolveExportFocusModuleIds(book, ['flow', 'idx', 'flow', 'missing'])).toEqual([
      'idx',
      'missing',
    ]);
  });
});

describe('assembleDigestExport', () => {
  it('matches buildDigestMarkdown for the same options', async () => {
    const opts = {
      selection: { read: ['flow'], priority: ['p0'] },
      rulerPick: 'index' as const,
      hangFilter: 'all' as const,
      focusModuleIds: ['flow'],
    };
    const assembled = await assembleDigestExport(
      book,
      async (id) => chapterMarkdown.get(id),
      opts,
    );
    expect(assembled.filename).toBe('Demo-骨架.md');
    expect(assembled.chapterIds.sort()).toEqual(['flow', 'idx']);
    expect(assembled.markdown).toBe(buildDigestMarkdown(book, chapterMarkdown, opts));
    expect(assembled.markdown).toContain('挂靠正文');
  });
});
