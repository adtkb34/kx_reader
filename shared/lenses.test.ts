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
  selectionToFlatIds,
} from './lenses';
import type { BookToc, TocChapter, TocSection } from './types';

const tocWithLenses: BookToc = {
  id: 'demo',
  title: 'Demo',
  chapters: [],
  tree: [],
  lenses: {
    kind: [
      {
        id: 'read',
        title: '读法',
        children: [
          { id: 'scenario', title: '场景' },
          { id: 'impl', title: '实现' },
        ],
      },
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
    expect(leavesUnder(tocWithLenses.lenses!.kind, 'read').sort()).toEqual([
      'impl',
      'scenario',
    ]);
    expect(leavesUnder(tocWithLenses.lenses!.kind, 'scenario')).toEqual(['scenario']);
  });

  it('unions leaves for multi-select', () => {
    expect(effectiveLeaves(tocWithLenses.lenses!.kind, ['scenario', 'impl']).sort()).toEqual([
      'impl',
      'scenario',
    ]);
    expect(effectiveLeaves(tocWithLenses.lenses!.kind, ['read']).sort()).toEqual([
      'impl',
      'scenario',
    ]);
  });

  it('lensLeafIds excludes parents', () => {
    expect([...lensLeafIds(tocWithLenses.lenses!.kind)].sort()).toEqual(['impl', 'scenario']);
  });

  it('effectiveAxisLeaves treats axis id as whole axis', () => {
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
      kind: ['read'],
      audience: ['tenant'],
    });
  });
});

describe('buildLensSelectTree', () => {
  it('puts axes at L1 and options underneath', () => {
    const tree = buildLensSelectTree(tocWithLenses);
    expect(tree.map((n) => n.id)).toEqual(['kind', 'audience']);
    expect(tree[0].children?.[0]?.id).toBe('read');
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
    expect(normalizeBranchLayerSelection(tree, ['audience', 'kind']).sort()).toEqual([
      'audience',
      'kind',
    ]);
  });

  it('clears ancestor when child is added', () => {
    expect(normalizeBranchLayerSelection(tree, ['kind', 'scenario'], ['kind'])).toEqual([
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
      kind: ['scenario'],
      audience: ['tenant'],
    });
  });

  it('accepts whole-axis selection', () => {
    expect(flatIdsToSelection(tocWithLenses, ['audience', 'kind'])).toEqual({
      kind: ['kind'],
      audience: ['audience'],
    });
  });
});

describe('collapseEachAxisToSingle', () => {
  it('keeps preferred id when an axis has several', () => {
    expect(
      collapseEachAxisToSingle(
        tocWithLenses,
        { kind: ['scenario', 'impl'], audience: ['tenant', 'admin'] },
        ['impl', 'admin'],
      ),
    ).toEqual({ kind: ['impl'], audience: ['admin'] });
  });

  it('falls back to the last id when nothing preferred', () => {
    expect(
      collapseEachAxisToSingle(tocWithLenses, { kind: ['scenario', 'impl'], audience: ['tenant'] }),
    ).toEqual({ kind: ['impl'], audience: ['tenant'] });
  });
});

describe('selectionToFlatIds', () => {
  it('flattens in axis order', () => {
    expect(selectionToFlatIds(tocWithLenses, { kind: ['scenario'], audience: ['tenant'] })).toEqual([
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
});

describe('pageVisibleInSelection', () => {
  const chapter: TocChapter = {
    id: 'p1',
    title: 'P1',
    file: 'p1.md',
    layers: { kind: ['scenario'] },
    sections: [],
  };

  it('hides pages whose layer does not match effective leaves', () => {
    expect(pageVisibleInSelection(chapter, { kind: ['impl'] }, tocWithLenses)).toBe(false);
    expect(pageVisibleInSelection(chapter, { kind: ['scenario'] }, tocWithLenses)).toBe(true);
    expect(pageVisibleInSelection(chapter, { kind: ['read'] }, tocWithLenses)).toBe(true);
    expect(pageVisibleInSelection(chapter, { kind: ['kind'] }, tocWithLenses)).toBe(true);
  });
});

describe('filterChapters', () => {
  it('filters by selection', () => {
    const chapters: TocChapter[] = [
      {
        id: 'rules-page',
        title: 'R',
        file: 'r.md',
        layers: { kind: ['scenario'] },
        sections: [],
      },
      {
        id: 'ui-page',
        title: 'U',
        file: 'u.md',
        layers: { kind: ['impl'] },
        sections: [],
      },
    ];
    expect(
      filterChapters(chapters, { kind: ['impl'] }, tocWithLenses).map((c) => c.id),
    ).toEqual(['ui-page']);
  });
});

describe('lensSelectionFromQuery', () => {
  it('reads multi-value axis from query', () => {
    expect(
      lensSelectionFromQuery({ kind: ['scenario', 'impl'], audience: 'admin' }, tocWithLenses),
    ).toEqual({ kind: ['scenario', 'impl'], audience: ['admin'] });
  });

  it('accepts whole-axis id in query', () => {
    expect(lensSelectionFromQuery({ kind: 'kind', audience: 'audience' }, tocWithLenses)).toEqual({
      kind: ['kind'],
      audience: ['audience'],
    });
  });

  it('returns null when no declared axis key is present', () => {
    expect(lensSelectionFromQuery({ foo: 'bar' }, tocWithLenses)).toBeNull();
    expect(lensSelectionFromQuery({}, tocWithLenses)).toBeNull();
  });

  it('accepts URLSearchParams repeated keys', () => {
    const q = new URLSearchParams();
    q.append('kind', 'impl');
    q.append('kind', 'scenario');
    q.append('audience', 'tenant');
    expect(lensSelectionFromQuery(q, tocWithLenses)).toEqual({
      kind: ['impl', 'scenario'],
      audience: ['tenant'],
    });
  });

  it('returns null for books without lenses', () => {
    const bare: BookToc = { id: 'x', title: 'X', chapters: [], tree: [] };
    expect(lensSelectionFromQuery({ kind: 'scenario' }, bare)).toBeNull();
  });
});

describe('lensQueryFromSelection', () => {
  it('serializes multi-select as array', () => {
    expect(
      lensQueryFromSelection({ kind: ['scenario', 'impl'], audience: ['tenant'] }, tocWithLenses),
    ).toEqual({ kind: ['scenario', 'impl'], audience: 'tenant' });
  });

  it('returns empty object without selection or lenses', () => {
    expect(lensQueryFromSelection(null, tocWithLenses)).toEqual({});
    const bare: BookToc = { id: 'x', title: 'X', chapters: [], tree: [] };
    expect(lensQueryFromSelection({ kind: ['scenario'] }, bare)).toEqual({});
  });
});

describe('resolveLensSwitchChapter', () => {
  const toc: BookToc = {
    id: 'demo',
    title: 'Demo',
    tree: [],
    lenses: tocWithLenses.lenses,
    chapters: [
      {
        id: 'auth',
        title: 'Auth',
        file: 'auth.md',
        layers: { kind: ['scenario', 'impl'] },
        sections: [],
      },
      {
        id: 'only-scenario',
        title: 'S',
        file: 's.md',
        layers: { kind: 'scenario' },
        sections: [],
      },
    ],
  };

  it('stays on the same page when still visible under next selection', () => {
    expect(resolveLensSwitchChapter(toc, 'auth', { kind: ['impl'] })).toBe('auth');
  });

  it('falls back to the first visible page when current is hidden', () => {
    expect(resolveLensSwitchChapter(toc, 'only-scenario', { kind: ['impl'] })).toBe('auth');
  });
});

describe('sectionAllowlistFor', () => {
  const chapter: TocChapter = {
    id: 'auth',
    title: 'Auth',
    file: 'auth.md',
    layers: { kind: ['scenario', 'impl'] },
    sections,
    sectionAllowlists: {
      kind: {
        scenario: ['a'],
        impl: ['b'],
      },
    },
  };

  it('unions allowlists for multi-selected leaves', () => {
    expect(sectionAllowlistFor(chapter, { kind: ['scenario', 'impl'] }, tocWithLenses)?.sort()).toEqual(
      ['a', 'a1', 'b'],
    );
  });

  it('expands parent selection to leaf union', () => {
    expect(sectionAllowlistFor(chapter, { kind: ['read'] }, tocWithLenses)?.sort()).toEqual([
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
    expect(sectionAllowlistFor(whole, { kind: ['scenario'] }, tocWithLenses)).toBeNull();
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
