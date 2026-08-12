import { describe, expect, it } from 'vitest';
import {
  assembleModuleView,
  bookRulerPicks,
  filterRulerAssembleView,
  filterRulerKeyBlocks,
  filterRulerModuleIndexIds,
  findLeafModule,
  findRulerModuleIndexId,
  findRulerSkeletonChapter,
  hangIdToKeyTitles,
  listLeafModules,
  listRulerTicks,
  moduleHasEmptyTicks,
  moduleHasHungTicks,
  moduleMatchesRulerLeaf,
  normalizeRulerPick,
  resolveRulerLensSwitchChapter,
  rulerAxisLeaves,
  rulerOutlineEntries,
  rulerSidebarKeepIds,
  rulerTickHasHang,
  sectionAxisLeaves,
} from './ruler';
import { outlineNumbers } from './outlineNumbers';
import type { BookToc, TocChapter } from './types';

function page(
  partial: Pick<TocChapter, 'id' | 'title' | 'file'> &
    Partial<Pick<TocChapter, 'role' | 'layers' | 'sections'>>,
): TocChapter {
  return {
    sections: [],
    ...partial,
  };
}

const book: BookToc = {
  id: 'demo',
  title: 'Demo',
  ruler: {
    axes: ['priority'],
    links: {
      k1: ['f1'],
      k2: ['e1'],
    },
  },
  lensAxisOrder: ['read', 'priority'],
  lensAxisTitles: { read: '读法', priority: '优先级' },
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
            { type: 'page', id: 'ent', title: '实体', file: 'entity.md' },
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
    page({
      id: 'ent',
      title: '实体',
      file: 'entity.md',
      layers: { read: 'entity', priority: 'p1' },
      sections: [{ id: 'e1', title: '实体块', level: 2 }],
    }),
  ],
};

describe('bookRulerPicks / normalizeRulerPick', () => {
  it('lists index then configured axes', () => {
    expect(bookRulerPicks(book)).toEqual(['index', 'priority']);
    expect(normalizeRulerPick(book, 'priority')).toBe('priority');
    expect(normalizeRulerPick(book, 'nope')).toBe('index');
  });
});

describe('listLeafModules / findRulerModuleIndexId', () => {
  it('enumerates leaf directories with group path', () => {
    const mods = listLeafModules(book);
    expect(mods).toHaveLength(1);
    expect(mods[0]).toMatchObject({
      id: 'mod',
      title: '模块',
      groupPath: ['外层'],
      indexChapterId: 'idx',
    });
    expect(findRulerModuleIndexId(book, 'ent')).toBe('idx');
    expect(findLeafModule(book, 'flow')?.title).toBe('模块');
  });

  it('returns undefined without toc.ruler', () => {
    const { ruler: _r, ...rest } = book;
    expect(findRulerSkeletonChapter(rest)).toBeUndefined();
    expect(findRulerModuleIndexId(rest, 'ent')).toBeUndefined();
  });
});

describe('rulerSidebarKeepIds / resolveRulerLensSwitchChapter', () => {
  it('always keeps module index', () => {
    expect([...rulerSidebarKeepIds(book, { read: ['entity'], priority: ['p1'] })]).toEqual([
      'idx',
    ]);
  });

  it('lens switch stays on module index', () => {
    expect(
      resolveRulerLensSwitchChapter(book, 'ent', { read: ['entity'], priority: ['p1'] }),
    ).toBe('idx');
  });
});

describe('assembleModuleView', () => {
  it('index pick hangs linked blocks under keys', () => {
    const view = assembleModuleView(
      book,
      { read: ['flow', 'entity'], priority: ['p0', 'p1'] },
      undefined,
      'idx',
      'index',
    );
    expect(view).not.toBeNull();
    expect(view!.buckets).toHaveLength(1);
    const keys = view!.buckets[0]!.keys;
    expect(keys.map((k) => k.sectionId)).toEqual(['k1', 'k2']);
    expect(keys[0]!.groups[0]!.blocks.map((b) => b.sectionId)).toEqual(['f1']);
    expect(keys[1]!.groups[0]!.blocks.map((b) => b.sectionId)).toEqual(['e1']);
  });

  it('keeps index skeleton keys that have no ruler.links entry', () => {
    const withStub: BookToc = {
      ...book,
      chapters: book.chapters.map((c) =>
        c.id === 'idx'
          ? {
              ...c,
              sections: [
                ...c.sections,
                { id: 'stub', title: '未挂靠占位', level: 2 },
              ],
            }
          : c,
      ),
    };
    const view = assembleModuleView(
      withStub,
      { read: ['flow', 'entity'], priority: ['p0', 'p1'] },
      undefined,
      'idx',
      'index',
    );
    expect(view!.buckets[0]!.keys.map((k) => k.sectionId)).toEqual(['k1', 'k2', 'stub']);
    expect(view!.buckets[0]!.keys[2]!.groups[0]!.blocks).toEqual([]);
  });

  it('axis pick buckets by priority leaf order', () => {
    const view = assembleModuleView(
      book,
      { read: ['flow', 'entity'], priority: ['p0', 'p1'] },
      undefined,
      'idx',
      'priority',
    );
    expect(view!.buckets.map((b) => b.leaf)).toEqual(['p0', 'p1']);
    // 壳常显：每个叶桶都保留全部 index 刻度；挂靠正文仍按叶筛。
    expect(view!.buckets[0]!.keys.map((k) => k.sectionId)).toEqual(['k1', 'k2']);
    expect(view!.buckets[1]!.keys.map((k) => k.sectionId)).toEqual(['k1', 'k2']);
    expect(view!.buckets[0]!.keys.find((k) => k.sectionId === 'k1')!.groups[0]!.blocks.map((b) => b.sectionId)).toEqual([
      'f1',
    ]);
    expect(view!.buckets[0]!.keys.find((k) => k.sectionId === 'k2')!.groups[0]!.blocks).toEqual([]);
    expect(view!.buckets[1]!.keys.find((k) => k.sectionId === 'k2')!.groups[0]!.blocks.map((b) => b.sectionId)).toEqual([
      'e1',
    ]);
    expect(view!.buckets[1]!.keys.find((k) => k.sectionId === 'k1')!.groups[0]!.blocks).toEqual([]);
  });

  it('axis pick keeps bare index shells with no hang-offs for that leaf', () => {
    const withStub: BookToc = {
      ...book,
      chapters: book.chapters.map((c) =>
        c.id === 'idx'
          ? {
              ...c,
              sections: [
                ...c.sections,
                { id: 'stub', title: '未挂靠占位', level: 2 },
              ],
            }
          : c,
      ),
    };
    const view = assembleModuleView(
      withStub,
      { read: ['flow'], priority: ['p0'] },
      undefined,
      'idx',
      'priority',
    );
    const p0 = view!.buckets.find((b) => b.leaf === 'p0');
    expect(p0!.keys.map((k) => k.sectionId)).toEqual(['k1', 'k2', 'stub']);
    expect(p0!.keys.find((k) => k.sectionId === 'stub')!.groups[0]!.blocks).toEqual([]);
  });
});

describe('rulerOutlineEntries', () => {
  it('puts axis leaf at level 1 and first key at level 2 (两位编号 1.1)', () => {
    const entries = rulerOutlineEntries(
      book,
      { read: ['flow', 'entity'], priority: ['p0', 'p1'] },
      undefined,
      'idx',
      'priority',
    );
    const p0 = entries.find((e) => e.anchorId === 'ruler-bucket-p0');
    expect(p0?.level).toBe(1);
    const underP0 = entries.find((e) => e.sectionId === 'k1');
    expect(underP0?.level).toBe(2);
    const nums = outlineNumbers(
      entries.filter((e) => e.title).map((e) => ({
        id: e.anchorId ?? e.sectionId,
        level: e.level,
      })),
    );
    expect(nums.get('ruler-bucket-p0')).toBe('1');
    expect(nums.get('k1')).toBe('1.1');
  });
});

describe('ruler tick hang filter', () => {
  const sel = { read: ['flow', 'entity'], priority: ['p0', 'p1'] };
  const withStub: BookToc = {
    ...book,
    chapters: book.chapters.map((c) =>
      c.id === 'idx'
        ? {
            ...c,
            sections: [
              ...c.sections,
              { id: 'stub', title: '未挂靠占位', level: 2 },
            ],
          }
        : c,
    ),
  };

  it('lists all index titled sections as ticks', () => {
    expect(listRulerTicks(withStub, 'idx')).toEqual(['k1', 'k2', 'stub']);
  });

  it('detects hang vs empty ticks under current lens', () => {
    expect(rulerTickHasHang(withStub, sel, undefined, 'k1')).toBe(true);
    expect(rulerTickHasHang(withStub, sel, undefined, 'stub')).toBe(false);
    expect(moduleHasHungTicks(withStub, sel, undefined, 'idx')).toBe(true);
    expect(moduleHasEmptyTicks(withStub, sel, undefined, 'idx')).toBe(true);
  });

  it('content mode keeps hung keys; empty mode keeps bare ticks', () => {
    const view = assembleModuleView(withStub, sel, undefined, 'idx', 'index')!;
    const keys = view.buckets[0]!.keys;
    expect(filterRulerKeyBlocks(withStub, sel, undefined, keys, 'content').map((k) => k.sectionId)).toEqual([
      'k1',
      'k2',
    ]);
    expect(filterRulerKeyBlocks(withStub, sel, undefined, keys, 'empty').map((k) => k.sectionId)).toEqual([
      'stub',
    ]);
    const filtered = filterRulerAssembleView(withStub, sel, undefined, view, 'content');
    expect(filtered.buckets[0]!.keys.map((k) => k.sectionId)).toEqual(['k1', 'k2']);
  });

  it('TOC keep-set follows hang filter mode', () => {
    expect([...filterRulerModuleIndexIds(withStub, sel, undefined, 'content')]).toEqual(['idx']);
    expect([...filterRulerModuleIndexIds(withStub, sel, undefined, 'empty')]).toEqual(['idx']);
    // Base book: every tick has a hang-off → empty-mode keep-set is empty.
    expect([...filterRulerModuleIndexIds(book, sel, undefined, 'empty')]).toEqual([]);
    expect(moduleHasEmptyTicks(book, sel, undefined, 'idx')).toBe(false);
  });
});

describe('sectionAxisLeaves', () => {
  it('uses page layer membership', () => {
    const flow = book.chapters[1]!;
    expect(sectionAxisLeaves(book, 'priority', flow, 'f1')).toEqual(['p0']);
  });
});

describe('rulerAxisLeaves / moduleMatchesRulerLeaf', () => {
  it('lists priority leaves in declaration order', () => {
    expect(rulerAxisLeaves(book, 'priority')).toEqual(['p0', 'p1']);
  });

  it('matches module by any page layer in the leaf directory', () => {
    expect(moduleMatchesRulerLeaf(book, 'idx', 'priority', 'p0')).toBe(true);
    expect(moduleMatchesRulerLeaf(book, 'idx', 'priority', 'p1')).toBe(true);
    expect(moduleMatchesRulerLeaf(book, 'flow', 'priority', 'p0')).toBe(true);
    expect(moduleMatchesRulerLeaf(book, 'flow', 'priority', 'p1')).toBe(true);
    expect(moduleMatchesRulerLeaf(book, 'ent', 'priority', 'p1')).toBe(true);
  });
});

describe('hangIdToKeyTitles', () => {
  it('maps hang-off ids to key section titles', () => {
    const t: BookToc = {
      id: 't',
      title: 't',
      chapters: [
        page({
          id: 'idx',
          title: 'index',
          file: 'index.md',
          role: 'ruler',
          sections: [
            { id: 'k1', title: '受理建单', level: 2 },
            { id: 'k2', title: '分类派单', level: 2 },
          ],
        }),
        page({
          id: 'flow',
          title: 'flow',
          file: 'flow.md',
          layers: ['flow'],
          sections: [
            { id: 'r1', title: '', level: 2 },
            { id: 'r2', title: '', level: 2 },
          ],
        }),
      ],
      tree: [{ type: 'page', id: 'idx' }],
      ruler: {
        axes: [],
        links: {
          k1: ['r1'],
          k2: ['r2', 'r1'],
        },
      },
    };
    const map = hangIdToKeyTitles(t);
    expect(map.get('r2')).toBe('分类派单');
    expect(map.get('r1')).toBe('受理建单、分类派单');
  });
});
