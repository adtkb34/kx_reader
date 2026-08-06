import { describe, expect, it } from 'vitest';
import {
  buildRulerPreamble,
  buildRulerTree,
  resolveRulerLensSwitchChapter,
  rulerKeyEligibleIds,
  rulerOutlineEntries,
  rulerSidebarKeepIds,
  sectionRulerLeaf,
  selectionUsesRulerHang,
} from './ruler';
import type { BookToc, TocChapter } from './types';

const chapter: TocChapter = {
  id: '202608051430',
  title: '账号登录',
  file: 'identity/register/02-flow-account.md',
  sections: [
    { id: '202608051438', title: '用户发起账号注册', level: 2 },
    { id: '202608051460', title: '账号密码', level: 3 },
    { id: '202608051440', title: '', level: 3 },
    { id: '202608051461', title: '基本信息', level: 3 },
    { id: '202608051441', title: '', level: 3 },
    { id: '202608051470', title: '', level: 3 },
    { id: '202608051473', title: '', level: 3 },
    { id: '202608051450', title: '', level: 3 },
  ],
  layers: {
    read: ['scenario', 'flow', 'entity'],
  },
  sectionAllowlists: {
    read: {
      scenario: ['202608051438'],
      flow: ['202608051460', '202608051440', '202608051461', '202608051441'],
      entity: ['202608051470', '202608051473', '202608051450'],
    },
  },
};

const toc: BookToc = {
  id: 'practice',
  title: '内容练习',
  tree: [{ type: 'page', id: chapter.id, title: chapter.title, file: chapter.file }],
  chapters: [chapter],
  lensAxisOrder: ['read'],
  lensAxisTitles: { read: '读法' },
  lenses: {
    read: [
      {
        id: 'biz',
        title: '业务',
        children: [
          { id: 'scenario', title: '场景', color: '#7a8a9a' },
          { id: 'flow', title: '流程', color: '#6d86a0' },
        ],
      },
      {
        id: 'spec',
        title: '规格',
        children: [
          { id: 'entity', title: '实体', color: '#6a9478' },
          { id: 'ui', title: '界面', color: '#a88b55' },
        ],
      },
    ],
  },
  ruler: {
    axis: 'read',
    keys: 'flow',
    links: {
      '202608051460': ['202608051470'],
      '202608051461': ['202608051473'],
    },
  },
};

describe('rulerKeyEligibleIds', () => {
  it('limits keys to sections under ruler.keys leaf', () => {
    const ids = rulerKeyEligibleIds(toc, toc.ruler!);
    expect(ids.has('202608051460')).toBe(true);
    expect(ids.has('202608051461')).toBe(true);
    expect(ids.has('202608051470')).toBe(false);
  });
});

describe('sectionRulerLeaf', () => {
  it('returns entity for linked field blocks', () => {
    expect(sectionRulerLeaf(toc, toc.ruler!, chapter, '202608051470')).toBe('entity');
  });
});

describe('buildRulerTree', () => {
  it('returns null without ruler config', () => {
    const { ruler: _r, ...rest } = toc;
    expect(buildRulerTree(rest, { read: ['flow'] })).toBeNull();
  });

  it('hangs linked entity blocks under flow keys', () => {
    const tree = buildRulerTree(toc, { read: ['flow', 'entity'] });
    expect(tree).toHaveLength(2);
    expect(tree![0].sectionId).toBe('202608051460');
    expect(tree![0].bodySectionIds).toEqual(['202608051460', '202608051440']);
    expect(tree![0].groups).toHaveLength(1);
    expect(tree![0].groups[0].leaf).toBe('entity');
    expect(tree![0].groups[0].blocks.map((b) => b.sectionId)).toEqual(['202608051470']);
    expect(tree![1].sectionId).toBe('202608051461');
    expect(tree![1].bodySectionIds).toEqual(['202608051461', '202608051441']);
    expect(tree![1].groups[0].blocks.map((b) => b.sectionId)).toEqual(['202608051473']);
  });

  it('omits linked blocks filtered out by lens', () => {
    const tree = buildRulerTree(toc, { read: ['flow'] });
    expect(tree).toHaveLength(2);
    expect(tree![0].groups).toHaveLength(0);
    expect(tree![1].groups).toHaveLength(0);
  });

  it('omits keys not visible under current lens', () => {
    const tree = buildRulerTree(toc, { read: ['entity'] });
    expect(tree).toEqual([]);
  });

  it('groups multiple dimensions in axis leaf order', () => {
    const withUi: TocChapter = {
      ...chapter,
      sections: [
        ...chapter.sections,
        { id: '202608051451', title: '', level: 3 },
      ],
      sectionAllowlists: {
        read: {
          ...chapter.sectionAllowlists!.read!,
          ui: ['202608051451'],
        },
      },
    };
    const toc2: BookToc = {
      ...toc,
      chapters: [withUi],
      ruler: {
        axis: 'read',
        keys: 'flow',
        links: {
          '202608051460': ['202608051451', '202608051470'],
        },
      },
    };
    const tree = buildRulerTree(toc2, { read: ['flow', 'entity', 'ui'] });
    expect(tree![0].groups.map((g) => g.leaf)).toEqual(['entity', 'ui']);
    expect(tree![0].groups.find((g) => g.leaf === 'ui')!.blocks[0].sectionId).toBe(
      '202608051451',
    );
    expect(tree![0].groups.find((g) => g.leaf === 'entity')!.blocks[0].sectionId).toBe(
      '202608051470',
    );
  });
});

describe('rulerOutlineEntries', () => {
  it('lists keys then dimension labels, never raw section ids', () => {
    const entries = rulerOutlineEntries(toc, { read: ['flow', 'entity'] });
    expect(entries.filter((e) => e.isKey).map((e) => e.title)).toEqual([
      '账号密码',
      '基本信息',
    ]);
    expect(entries.some((e) => /^\d{10,}$/.test(e.title))).toBe(false);
    expect(entries.filter((e) => !e.isKey).map((e) => e.title)).toEqual(['实体', '实体']);
  });
});

describe('selectionUsesRulerHang', () => {
  it('is true for multi-select (≥2 leaves), false for single-select', () => {
    expect(selectionUsesRulerHang(toc, { read: ['flow', 'entity'] })).toBe(true);
    expect(selectionUsesRulerHang(toc, { read: ['biz'] })).toBe(true); // biz → scenario+flow
    expect(selectionUsesRulerHang(toc, { read: ['flow'] })).toBe(false);
    expect(selectionUsesRulerHang(toc, { read: ['entity'] })).toBe(false);
  });
});

describe('buildRulerPreamble', () => {
  it('keeps always-visible intro but skips hang-off sections', () => {
    const index: TocChapter = {
      id: 'index',
      title: '账号注册',
      file: 'index.md',
      sections: [
        { id: 'k1', title: '开篇', level: 2 },
        { id: 'k2', title: '账号密码', level: 2 },
      ],
    };
    const scenario: TocChapter = {
      id: 'scenario',
      title: '注册场景',
      file: 'scenario.md',
      sections: [
        { id: 'intro', title: '', level: 2 },
        { id: 'scene', title: '用户发起账号注册', level: 2 },
      ],
    };
    const book: BookToc = {
      id: 'p',
      title: '练习',
      chapters: [index, scenario],
      tree: [],
      lensAxisOrder: ['read'],
      lensAxisTitles: { read: '读法' },
      lenses: {
        read: [
          { id: 'scenario', title: '场景' },
          { id: 'flow', title: '流程' },
        ],
      },
      ruler: {
        axis: 'read',
        links: {
          k1: ['scene'],
          k2: [],
        },
      },
    };
    const pre = buildRulerPreamble(book, { read: ['scenario', 'flow'] });
    expect(pre).toEqual([{ chapterId: 'scenario', sectionIds: ['intro'] }]);
  });
});

describe('resolveRulerLensSwitchChapter / rulerSidebarKeepIds', () => {
  const index: TocChapter = {
    id: 'idx',
    title: '账号注册',
    file: 'index.md',
    role: 'ruler',
    sections: [{ id: 'k1', title: '账号密码', level: 2 }],
  };
  const scenario: TocChapter = {
    id: 'sc',
    title: '注册场景',
    file: 'scenario.md',
    sections: [{ id: 's1', title: '场景', level: 2 }],
  };
  const entity: TocChapter = {
    id: 'ent',
    title: '实体',
    file: 'entity.md',
    sections: [{ id: 'e1', title: '', level: 2 }],
    layers: { read: ['entity'] },
  };
  const flow: TocChapter = {
    id: 'fl',
    title: '流程',
    file: 'flow.md',
    sections: [{ id: 'f1', title: '', level: 2 }],
    layers: { read: ['flow'] },
  };
  const book: BookToc = {
    id: 'p',
    title: '练习',
    chapters: [index, scenario, flow, entity],
    tree: [
      {
        type: 'group',
        id: 'identity',
        title: '身份',
        children: [
          {
            type: 'group',
            id: 'register',
            title: '账号注册',
            children: [
              { type: 'page', id: 'idx', title: '账号注册', file: 'index.md' },
              { type: 'page', id: 'sc', title: '注册场景', file: 'scenario.md' },
              { type: 'page', id: 'fl', title: '流程', file: 'flow.md' },
              { type: 'page', id: 'ent', title: '实体', file: 'entity.md' },
            ],
          },
        ],
      },
    ],
    lensAxisOrder: ['read'],
    lensAxisTitles: { read: '读法' },
    lenses: {
      read: [
        { id: 'scenario', title: '场景' },
        { id: 'flow', title: '流程' },
        { id: 'entity', title: '实体' },
      ],
    },
    ruler: {
      axis: 'read',
      links: { k1: ['s1', 'f1', 'e1'] },
    },
  };

  it('switches from index to the dimension page on single-select', () => {
    expect(resolveRulerLensSwitchChapter(book, 'idx', { read: ['entity'] })).toBe('ent');
    expect(resolveRulerLensSwitchChapter(book, 'idx', { read: ['flow'] })).toBe('fl');
  });

  it('switches to index when multi-select hangs', () => {
    expect(resolveRulerLensSwitchChapter(book, 'ent', { read: ['flow', 'entity'] })).toBe('idx');
  });

  it('keeps one sidebar page per module for page and hang modes', () => {
    expect([...rulerSidebarKeepIds(book, { read: ['entity'] }, false)]).toEqual(['ent']);
    expect([...rulerSidebarKeepIds(book, { read: ['flow', 'entity'] }, true)]).toEqual(['idx']);
  });
});

describe('showLevel filters ruler keys and hang-offs', () => {
  it('hides rank>showLevel keys and their links; unmarked ranks stay', () => {
    const index: TocChapter = {
      id: 'idx',
      title: '账号注册',
      file: 'index.md',
      showLevel: 1,
      sections: [
        { id: 'scene', title: '用户发起账号注册', level: 2, rank: 1 },
        { id: 'step', title: '账号密码', level: 2, rank: 2 },
      ],
    };
    const flow: TocChapter = {
      id: 'fl',
      title: '流程',
      file: 'flow.md',
      sections: [
        { id: 'chart', title: '', level: 2 },
        { id: 'form', title: '', level: 2 },
      ],
      layers: { read: ['flow'] },
    };
    const book: BookToc = {
      id: 'p',
      title: '练习',
      chapters: [index, flow],
      tree: [],
      lensAxisOrder: ['read'],
      lensAxisTitles: { read: '读法' },
      lenses: {
        read: [
          { id: 'flow', title: '流程' },
          { id: 'entity', title: '实体' },
        ],
      },
      ruler: {
        axis: 'read',
        links: {
          scene: ['chart'],
          step: ['form'],
        },
      },
    };
    const tree = buildRulerTree(book, { read: ['flow', 'entity'] });
    expect(tree?.map((k) => k.sectionId)).toEqual(['scene']);
    expect(tree?.[0].groups.flatMap((g) => g.blocks.map((b) => b.sectionId))).toEqual([
      'chart',
    ]);
  });
});
