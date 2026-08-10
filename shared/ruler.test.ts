import { describe, expect, it } from 'vitest';
import {
  findRulerModuleIndexId,
  findRulerSkeletonChapter,
  preferRulerReadingChapters,
  resolveRulerLensSwitchChapter,
  rulerSidebarKeepIds,
} from './ruler';
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
  ruler: true,
  lensAxisOrder: ['read'],
  lensAxisTitles: { read: '读法' },
  lenses: {
    read: [
      { id: 'flow', title: '流程' },
      { id: 'entity', title: '实体' },
    ],
  },
  tree: [
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
      layers: { read: 'flow' },
      sections: [{ id: 'f1', title: '流程块', level: 2 }],
    }),
    page({
      id: 'ent',
      title: '实体',
      file: 'entity.md',
      layers: { read: 'entity' },
      sections: [{ id: 'e1', title: '实体块', level: 2 }],
    }),
  ],
};

describe('findRulerSkeletonChapter / findRulerModuleIndexId', () => {
  it('finds role=ruler index', () => {
    expect(findRulerSkeletonChapter(book)?.id).toBe('idx');
    expect(findRulerModuleIndexId(book, 'ent')).toBe('idx');
    expect(findRulerModuleIndexId(book, 'idx')).toBe('idx');
  });

  it('returns undefined without toc.ruler', () => {
    const { ruler: _r, ...rest } = book;
    expect(findRulerSkeletonChapter(rest)).toBeUndefined();
    expect(findRulerModuleIndexId(rest, 'ent')).toBeUndefined();
  });
});

describe('preferRulerReadingChapters / resolveRulerLensSwitchChapter', () => {
  it('尺子 mode prefers index pages', () => {
    expect(
      preferRulerReadingChapters(book, { read: ['entity'] }, true).map((c) => c.id),
    ).toEqual(['idx']);
    expect(resolveRulerLensSwitchChapter(book, 'ent', { read: ['entity'] }, true)).toBe(
      'idx',
    );
  });

  it('page mode prefers matching dimension pages', () => {
    expect(
      preferRulerReadingChapters(book, { read: ['entity'] }, false).map((c) => c.id),
    ).toEqual(['ent']);
    expect(resolveRulerLensSwitchChapter(book, 'idx', { read: ['entity'] }, false)).toBe(
      'ent',
    );
  });
});

describe('rulerSidebarKeepIds', () => {
  it('keeps index in 尺子 mode', () => {
    expect([...rulerSidebarKeepIds(book, { read: ['entity'] }, true)]).toEqual(['idx']);
  });

  it('keeps dimension page outside 尺子 mode', () => {
    expect([...rulerSidebarKeepIds(book, { read: ['entity'] }, false)]).toEqual(['ent']);
  });

  it('keeps index when module is skeleton-only', () => {
    const skeleton: BookToc = {
      ...book,
      tree: [
        {
          type: 'group',
          id: 'mod',
          title: '模块',
          children: [{ type: 'page', id: 'idx', title: '骨架', file: 'index.md' }],
        },
      ],
      chapters: [book.chapters[0]!],
    };
    expect([...rulerSidebarKeepIds(skeleton, { read: ['entity'] }, false)]).toEqual([
      'idx',
    ]);
  });
});
