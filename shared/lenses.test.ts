import { describe, expect, it } from 'vitest';
import {
  buildLensSelectTree,
  collapseEachAxisToSingle,
  defaultSelection,
  digestAnchorId,
  effectiveAxisLeaves,
  effectiveLeaves,
  expandSectionAllowlist,
  filterChapters,
  flatIdsToSelection,
  groupChaptersForDigest,
  leavesUnder,
  lensLeafIds,
  lensQueryFromSelection,
  lensSelectionFromQuery,
  normalizeBranchLayerSelection,
  pageGroupPath,
  pageVisibleInSelection,
  resolveLensSwitchChapter,
  sectionAllowlistFor,
  sectionClusterRole,
  sectionLensLeaves,
  selectionLegendLeaves,
  selectionToFlatIds,
} from './lenses';
import type { BookToc, TocChapter, TocSection } from './types';

const tocWithLenses: BookToc = {
  id: 'demo',
  title: 'Demo',
  chapters: [],
  tree: [],
  lensAxisOrder: ['read', 'audience'],
  lensAxisTitles: { read: '读法', audience: '视角' },
  lenses: {
    read: [
      { id: 'scenario', title: '场景' },
      { id: 'impl', title: '实现' },
    ],
    audience: [
      { id: 'tenant', title: '租户端' },
      { id: 'admin', title: '运营后台' },
    ],
  },
};

const sections: TocSection[] = [
  { id: 'a', title: 'A', level: 2 },
  { id: 'a1', title: 'A1', level: 3 },
  { id: 'b', title: 'B', level: 2 },
];

describe('lens tree helpers', () => {
  it('lists leaf ids under a parent', () => {
    expect(leavesUnder(tocWithLenses.lenses!.read, 'scenario')).toEqual(['scenario']);
    expect(leavesUnder(tocWithLenses.lenses!.read, 'impl')).toEqual(['impl']);
  });

  it('unions leaves for multi-select', () => {
    expect(effectiveLeaves(tocWithLenses.lenses!.read, ['scenario', 'impl']).sort()).toEqual([
      'impl',
      'scenario',
    ]);
  });

  it('lensLeafIds excludes parents', () => {
    expect([...lensLeafIds(tocWithLenses.lenses!.read)].sort()).toEqual(['impl', 'scenario']);
  });

  it('effectiveAxisLeaves treats axis id as whole axis', () => {
    expect(effectiveAxisLeaves(tocWithLenses, 'read', ['read']).sort()).toEqual([
      'impl',
      'scenario',
    ]);
    expect(effectiveAxisLeaves(tocWithLenses, 'audience', ['audience']).sort()).toEqual([
      'admin',
      'tenant',
    ]);
    expect(effectiveAxisLeaves(tocWithLenses, 'audience', ['tenant'])).toEqual(['tenant']);
  });
});

describe('defaultSelection', () => {
  it('selects the first option root on each axis', () => {
    expect(defaultSelection(tocWithLenses)).toEqual({
      read: ['scenario'],
      audience: ['tenant'],
    });
  });
});

describe('buildLensSelectTree', () => {
  it('puts axes at L1 and options underneath', () => {
    const tree = buildLensSelectTree(tocWithLenses);
    expect(tree.map((n) => n.id)).toEqual(['read', 'audience']);
    expect(tree[0].title).toBe('读法');
    expect(tree[0].children?.map((c) => c.id)).toEqual(['scenario', 'impl']);
    expect(tree[1].title).toBe('视角');
    expect(tree[1].children?.map((c) => c.id)).toEqual(['tenant', 'admin']);
  });
});

describe('normalizeBranchLayerSelection', () => {
  const tree = buildLensSelectTree(tocWithLenses);

  it('keeps same-layer siblings', () => {
    expect(normalizeBranchLayerSelection(tree, ['tenant', 'admin']).sort()).toEqual([
      'admin',
      'tenant',
    ]);
    expect(normalizeBranchLayerSelection(tree, ['audience', 'read']).sort()).toEqual([
      'audience',
      'read',
    ]);
  });

  it('clears ancestor when child is added', () => {
    expect(normalizeBranchLayerSelection(tree, ['read', 'scenario'], ['read'])).toEqual([
      'scenario',
    ]);
  });

  it('clears descendants when parent is added', () => {
    expect(normalizeBranchLayerSelection(tree, ['read', 'scenario'], ['scenario'])).toEqual([
      'read',
    ]);
  });

  it('without prev, keeps deepest on conflict', () => {
    expect(normalizeBranchLayerSelection(tree, ['read', 'scenario']).sort()).toEqual(['scenario']);
  });
});

describe('flatIdsToSelection', () => {
  it('partitions flat ids and fills missing axes from default', () => {
    expect(flatIdsToSelection(tocWithLenses, ['tenant', 'scenario'])).toEqual({
      read: ['scenario'],
      audience: ['tenant'],
    });
  });

  it('accepts whole-axis selection', () => {
    expect(flatIdsToSelection(tocWithLenses, ['audience', 'read'])).toEqual({
      read: ['read'],
      audience: ['audience'],
    });
  });
});

describe('collapseEachAxisToSingle', () => {
  it('keeps preferred id when an axis has several', () => {
    expect(
      collapseEachAxisToSingle(
        tocWithLenses,
        { read: ['scenario', 'impl'], audience: ['tenant', 'admin'] },
        ['impl', 'admin'],
      ),
    ).toEqual({ read: ['impl'], audience: ['admin'] });
  });

  it('falls back to the last id when nothing preferred', () => {
    expect(
      collapseEachAxisToSingle(tocWithLenses, { read: ['scenario', 'impl'], audience: ['tenant'] }),
    ).toEqual({ read: ['impl'], audience: ['tenant'] });
  });
});

describe('selectionToFlatIds', () => {
  it('flattens in axis order', () => {
    expect(selectionToFlatIds(tocWithLenses, { read: ['scenario'], audience: ['tenant'] })).toEqual([
      'scenario',
      'tenant',
    ]);
  });
});

describe('expandSectionAllowlist', () => {
  it('includes nested deeper headings under an allowlisted parent', () => {
    expect(expandSectionAllowlist(sections, ['a'])).toEqual(['a', 'a1']);
  });

  it('returns null when allowlist is null', () => {
    expect(expandSectionAllowlist(sections, null)).toBeNull();
  });

  it('does not expand untitled sections into later deeper headings', () => {
    const mixed: TocSection[] = [
      { id: 'parent', title: 'Parent', level: 2 },
      { id: 'flow', title: '', level: 2 },
      { id: 'entity', title: 'Entity', level: 3 },
    ];
    expect(expandSectionAllowlist(mixed, ['flow'])).toEqual(['flow']);
  });
});

describe('pageVisibleInSelection', () => {
  const chapter: TocChapter = {
    id: 'p1',
    title: 'P1',
    file: 'p1.md',
    layers: { read: ['scenario'] },
    sections: [],
  };

  it('hides pages whose layer does not match effective leaves', () => {
    expect(pageVisibleInSelection(chapter, { read: ['impl'] }, tocWithLenses)).toBe(false);
    expect(pageVisibleInSelection(chapter, { read: ['scenario'] }, tocWithLenses)).toBe(true);
    expect(pageVisibleInSelection(chapter, { read: ['scenario'] }, tocWithLenses)).toBe(true);
    expect(pageVisibleInSelection(chapter, { read: ['read'] }, tocWithLenses)).toBe(true);
  });
});

describe('filterChapters', () => {
  it('filters by selection', () => {
    const chapters: TocChapter[] = [
      {
        id: 'rules-page',
        title: 'R',
        file: 'r.md',
        layers: { read: ['scenario'] },
        sections: [],
      },
      {
        id: 'ui-page',
        title: 'U',
        file: 'u.md',
        layers: { read: ['impl'] },
        sections: [],
      },
    ];
    expect(
      filterChapters(chapters, { read: ['impl'] }, tocWithLenses).map((c) => c.id),
    ).toEqual(['ui-page']);
  });
});

describe('lensSelectionFromQuery', () => {
  it('reads multi-value axis from query', () => {
    expect(
      lensSelectionFromQuery({ read: ['scenario', 'impl'], audience: 'admin' }, tocWithLenses),
    ).toEqual({ read: ['scenario', 'impl'], audience: ['admin'] });
  });

  it('accepts whole-axis id in query', () => {
    expect(lensSelectionFromQuery({ read: 'read', audience: 'audience' }, tocWithLenses)).toEqual({
      read: ['read'],
      audience: ['audience'],
    });
  });

  it('returns null when no declared axis key is present', () => {
    expect(lensSelectionFromQuery({ foo: 'bar' }, tocWithLenses)).toBeNull();
    expect(lensSelectionFromQuery({}, tocWithLenses)).toBeNull();
  });

  it('accepts URLSearchParams repeated keys', () => {
    const q = new URLSearchParams();
    q.append('read', 'impl');
    q.append('read', 'scenario');
    q.append('audience', 'tenant');
    expect(lensSelectionFromQuery(q, tocWithLenses)).toEqual({
      read: ['impl', 'scenario'],
      audience: ['tenant'],
    });
  });

  it('returns null for books without lenses', () => {
    const bare: BookToc = { id: 'x', title: 'X', chapters: [], tree: [] };
    expect(lensSelectionFromQuery({ read: 'scenario' }, bare)).toBeNull();
  });
});

describe('lensQueryFromSelection', () => {
  it('serializes multi-select as array', () => {
    expect(
      lensQueryFromSelection({ read: ['scenario', 'impl'], audience: ['tenant'] }, tocWithLenses),
    ).toEqual({ read: ['scenario', 'impl'], audience: 'tenant' });
  });

  it('returns empty object without selection or lenses', () => {
    expect(lensQueryFromSelection(null, tocWithLenses)).toEqual({});
    const bare: BookToc = { id: 'x', title: 'X', chapters: [], tree: [] };
    expect(lensQueryFromSelection({ read: ['scenario'] }, bare)).toEqual({});
  });
});

describe('resolveLensSwitchChapter', () => {
  const toc: BookToc = {
    id: 'demo',
    title: 'Demo',
    tree: [],
    lenses: tocWithLenses.lenses,
    lensAxisTitles: tocWithLenses.lensAxisTitles,
    lensAxisOrder: tocWithLenses.lensAxisOrder,
    chapters: [
      {
        id: 'auth',
        title: 'Auth',
        file: 'auth.md',
        layers: { read: ['scenario', 'impl'] },
        sections: [],
      },
      {
        id: 'only-scenario',
        title: 'S',
        file: 's.md',
        layers: { read: 'scenario' },
        sections: [],
      },
    ],
  };

  it('stays on the same page when still visible under next selection', () => {
    expect(resolveLensSwitchChapter(toc, 'auth', { read: ['impl'] })).toBe('auth');
  });

  it('falls back to the first visible page when current is hidden', () => {
    expect(resolveLensSwitchChapter(toc, 'only-scenario', { read: ['impl'] })).toBe('auth');
  });
});

describe('sectionAllowlistFor', () => {
  const chapter: TocChapter = {
    id: 'auth',
    title: 'Auth',
    file: 'auth.md',
    layers: { read: ['scenario', 'impl'] },
    sections,
    sectionAllowlists: {
      read: {
        scenario: ['a'],
        impl: ['b'],
      },
    },
  };

  it('unions allowlists for multi-selected leaves', () => {
    expect(sectionAllowlistFor(chapter, { read: ['scenario', 'impl'] }, tocWithLenses)?.sort()).toEqual(
      ['a', 'a1', 'b'],
    );
  });

  it('expands parent selection to leaf union', () => {
    expect(sectionAllowlistFor(chapter, { read: ['read'] }, tocWithLenses)?.sort()).toEqual([
      'a',
      'a1',
      'b',
    ]);
  });

  it('returns null when option has no allowlist (whole page)', () => {
    const whole: TocChapter = {
      ...chapter,
      sectionAllowlists: undefined,
    };
    expect(sectionAllowlistFor(whole, { read: ['scenario'] }, tocWithLenses)).toBeNull();
  });
});

describe('sectionLensLeaves', () => {
  const chapter: TocChapter = {
    id: 'auth',
    title: 'Auth',
    file: 'auth.md',
    sections,
    sectionAllowlists: {
      read: {
        scenario: ['a'],
        impl: ['b', 'shared'],
      },
    },
  };

  it('returns leaves that list the section (expanded)', () => {
    expect(sectionLensLeaves(chapter, 'a', tocWithLenses)).toEqual(['scenario']);
    expect(sectionLensLeaves(chapter, 'a1', tocWithLenses)).toEqual(['scenario']);
    expect(sectionLensLeaves(chapter, 'b', tocWithLenses)).toEqual(['impl']);
  });

  it('returns multiple leaves for shared sections', () => {
    const multi: TocChapter = {
      ...chapter,
      sections: [...sections, { id: 'shared', title: 'Shared', level: 2 }],
      sectionAllowlists: {
        read: {
          scenario: ['shared'],
          impl: ['shared'],
        },
      },
    };
    expect(sectionLensLeaves(multi, 'shared', tocWithLenses)).toEqual(['scenario', 'impl']);
  });

  it('returns empty when section is not listed', () => {
    expect(sectionLensLeaves(chapter, 'missing', tocWithLenses)).toEqual([]);
  });
});

describe('selectionLegendLeaves / sectionClusterRole', () => {
  it('lists effective leaves with titles', () => {
    expect(selectionLegendLeaves(tocWithLenses, { read: ['scenario', 'impl'] })).toEqual([
      { id: 'scenario', title: '场景' },
      { id: 'impl', title: '实现' },
    ]);
  });

  it('assigns cluster roles from title, index, and leaves', () => {
    expect(sectionClusterRole({ title: '账号密码' }, 0)).toBeNull();
    expect(sectionClusterRole({ title: '账号密码' }, 1)).toBe('start');
    expect(sectionClusterRole({ title: '' }, 1, ['flow'])).toBe('child');
    expect(sectionClusterRole({ title: '' }, 1, ['ui', 'fallback'])).toBe('child');
    expect(sectionClusterRole({ title: '' }, 1, ['entity'])).toBeNull();
    expect(sectionClusterRole({ title: '' }, 1, [])).toBeNull();
  });
});

describe('pageGroupPath / groupChaptersForDigest', () => {
  const toc: BookToc = {
    id: 'demo',
    title: 'Demo',
    chapters: [
      { id: 'login', title: '登录', file: 'login.md', sections: [] },
      { id: 'register', title: '注册', file: 'register.md', sections: [] },
      { id: 'home', title: '首页壳', file: 'home.md', sections: [] },
      { id: 'overview', title: '概览', file: 'overview.md', sections: [] },
    ],
    tree: [
      {
        type: 'group',
        id: 'identity',
        title: '身份',
        children: [
          { type: 'page', id: 'login', title: '登录', file: 'login.md' },
          { type: 'page', id: 'register', title: '注册', file: 'register.md' },
        ],
      },
      {
        type: 'group',
        id: 'nav',
        title: '导航',
        children: [{ type: 'page', id: 'home', title: '首页壳', file: 'home.md' }],
      },
      { type: 'page', id: 'overview', title: '概览', file: 'overview.md' },
    ],
  };

  it('returns ancestor group titles', () => {
    expect(pageGroupPath(toc.tree, 'login')).toEqual(['身份']);
    expect(pageGroupPath(toc.tree, 'overview')).toEqual([]);
  });

  it('merges consecutive pages under the same group', () => {
    const grouped = groupChaptersForDigest(toc, toc.chapters);
    expect(grouped.map((g) => ({ title: g.groupTitle, pages: g.pages.map((p) => p.id) }))).toEqual([
      { title: '身份', pages: ['login', 'register'] },
      { title: '导航', pages: ['home'] },
      { title: null, pages: ['overview'] },
    ]);
  });

  it('builds digest anchor ids', () => {
    expect(digestAnchorId('login', 'flow')).toBe('digest-login--flow');
  });
});
