import { describe, expect, it } from 'vitest';
import {
  buildLensSelectTree,
  collapseEachAxisToSingle,
  collapseEachAxisToSingleLeaf,
  collapseSingletonGroups,
  defaultSelection,
  digestAnchorId,
  digestPageDisplayLevel,
  digestPathAnchorId,
  digestSectionDisplayLevel,
  effectiveAxisLeaves,
  effectiveLeaves,
  expandSectionAllowlist,
  axisSelectionIsOpen,
  filterChapters,
  filterChaptersWithContent,
  filterChaptersWithoutContent,
  filterSectionsByShowLevel,
  filterTree,
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
import type { BookToc, TocChapter, TocSection, TocTreeNode } from './types';

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

  it('axisSelectionIsOpen is true for axis id or non-leaf parent', () => {
    expect(axisSelectionIsOpen(tocWithLenses, 'read', ['read'])).toBe(true);
    expect(axisSelectionIsOpen(tocWithLenses, 'read', ['scenario'])).toBe(false);
    const nested = {
      ...tocWithLenses,
      lenses: {
        ...tocWithLenses.lenses!,
        status: [
          {
            id: 'lifecycle',
            title: '生命周期',
            children: [
              { id: 'draft', title: '草稿' },
              { id: 'published', title: '发布' },
            ],
          },
        ],
      },
    };
    expect(axisSelectionIsOpen(nested, 'status', ['lifecycle'])).toBe(true);
    expect(axisSelectionIsOpen(nested, 'status', ['status'])).toBe(true);
    expect(axisSelectionIsOpen(nested, 'status', ['draft'])).toBe(false);
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

  it('allowEmpty keeps axes empty instead of defaulting', () => {
    expect(flatIdsToSelection(tocWithLenses, [], [], { allowEmpty: true })).toEqual({
      read: [],
      audience: [],
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

  it('keeps a non-leaf parent as the single pick (does not force a leaf)', () => {
    const nested: BookToc = {
      ...tocWithLenses,
      lenses: {
        read: [
          {
            id: 'biz',
            title: '业务',
            children: [
              { id: 'scenario', title: '场景' },
              { id: 'flow', title: '流程' },
            ],
          },
        ],
        audience: tocWithLenses.lenses!.audience,
      },
    };
    expect(collapseEachAxisToSingle(nested, { read: ['biz'], audience: ['tenant'] })).toEqual({
      read: ['biz'],
      audience: ['tenant'],
    });
    // Contrast: leaf-collapse would narrow biz → one child
    expect(collapseEachAxisToSingleLeaf(nested, { read: ['biz'], audience: ['tenant'] })).toEqual({
      read: ['flow'],
      audience: ['tenant'],
    });
  });
});

describe('collapseEachAxisToSingleLeaf', () => {
  it('narrows a parent node to one effective leaf', () => {
    expect(
      collapseEachAxisToSingleLeaf(tocWithLenses, { read: ['read'], audience: ['audience'] }),
    ).toEqual({ read: ['impl'], audience: ['admin'] });
  });

  it('keeps an already-single leaf', () => {
    expect(
      collapseEachAxisToSingleLeaf(tocWithLenses, { read: ['scenario'], audience: ['tenant'] }),
    ).toEqual({ read: ['scenario'], audience: ['tenant'] });
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

describe('filterChaptersWithContent', () => {
  const chapters: TocChapter[] = [
    {
      id: 'empty-allow',
      title: 'Empty under lens',
      file: 'e.md',
      layers: { read: ['scenario', 'impl'] },
      sections: [
        { id: 'a', title: 'A', level: 2 },
        { id: 'b', title: 'B', level: 2 },
      ],
      sectionAllowlists: {
        read: {
          // Both sections tagged; scenario points at a missing id → no visible content.
          scenario: ['missing-id'],
          impl: ['a', 'b'],
        },
      },
    },
    {
      id: 'whole-page',
      title: 'Whole page',
      file: 'w.md',
      layers: { read: ['scenario', 'impl'] },
      sections: [
        { id: 'x', title: 'X', level: 2 },
        { id: 'y', title: 'Y', level: 2 },
      ],
      // scenario has no allowlist entry → whole page for that leaf (via layers)
      sectionAllowlists: {
        read: {
          impl: ['y'],
        },
      },
    },
    {
      id: 'has-content',
      title: 'Has content',
      file: 'h.md',
      layers: { read: ['scenario', 'impl'] },
      sections: [
        { id: 'flow', title: 'Flow', level: 2 },
        { id: 'other', title: 'Other', level: 2 },
      ],
      sectionAllowlists: {
        read: {
          scenario: ['flow'],
          impl: ['other'],
        },
      },
    },
  ];

  it('drops chapters whose allowlist leaves no titled sections', () => {
    expect(
      filterChaptersWithContent(chapters, { read: ['scenario'] }, tocWithLenses).map((c) => c.id),
    ).toEqual(['whole-page', 'has-content']);
  });

  it('keeps whole-page chapters (no allowlist for the leaf)', () => {
    expect(
      filterChaptersWithContent([chapters[1]], { read: ['scenario'] }, tocWithLenses).map(
        (c) => c.id,
      ),
    ).toEqual(['whole-page']);
  });

  it('keeps chapters with matching section content', () => {
    expect(
      filterChaptersWithContent(chapters, { read: ['impl'] }, tocWithLenses).map((c) => c.id),
    ).toEqual(['empty-allow', 'whole-page', 'has-content']);
  });

  it('drops always-visible pages that have no layers', () => {
    const untagged: TocChapter = {
      id: 'overview',
      title: 'Overview',
      file: 'o.md',
      sections: [{ id: 'intro', title: 'Intro', level: 2 }],
    };
    expect(
      filterChaptersWithContent(
        [untagged, chapters[2]],
        { read: ['scenario'] },
        tocWithLenses,
      ).map((c) => c.id),
    ).toEqual(['has-content']);
  });
});

describe('filterChaptersWithoutContent', () => {
  it('keeps pages that lack lens content and drops those with content', () => {
    const untagged: TocChapter = {
      id: 'overview',
      title: 'Overview',
      file: 'o.md',
      sections: [{ id: 'intro', title: 'Intro', level: 2 }],
    };
    const tagged: TocChapter = {
      id: 'has-content',
      title: 'Has content',
      file: 'h.md',
      layers: { read: ['scenario'] },
      sections: [{ id: 'flow', title: 'Flow', level: 2 }],
      sectionAllowlists: { read: { scenario: ['flow'] } },
    };
    expect(
      filterChaptersWithoutContent(
        [untagged, tagged],
        { read: ['scenario'] },
        tocWithLenses,
      ).map((c) => c.id),
    ).toEqual(['overview']);
  });
});

describe('filterTree empty groups', () => {
  it('drops groups whose children are all filtered out', () => {
    const tree: TocTreeNode[] = [
      {
        type: 'group',
        id: 'g-empty',
        title: 'Empty group',
        children: [{ type: 'page', id: 'gone', title: 'Gone', file: 'g.md' }],
      },
      {
        type: 'group',
        id: 'g-keep',
        title: 'Keep group',
        children: [
          { type: 'page', id: 'keep', title: 'Keep', file: 'k.md' },
          { type: 'page', id: 'gone2', title: 'Gone2', file: 'g2.md' },
        ],
      },
    ];
    const visible = new Set(['keep']);
    expect(filterTree(tree, visible)).toEqual([
      {
        type: 'group',
        id: 'g-keep',
        title: 'Keep group',
        children: [{ type: 'page', id: 'keep', title: 'Keep', file: 'k.md' }],
      },
    ]);
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
        id: 'overview',
        title: '项目概览',
        file: 'overview.md',
        sections: [],
      },
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
      {
        id: 'only-impl',
        title: '账号基础',
        file: 'impl.md',
        layers: { read: 'impl' },
        sections: [],
      },
    ],
  };

  it('stays on the same page when still visible under next selection', () => {
    expect(resolveLensSwitchChapter(toc, 'auth', { read: ['impl'] })).toBe('auth');
  });

  it('stays on the current page when selecting a lens that would hide it', () => {
    expect(
      resolveLensSwitchChapter(toc, 'only-scenario', { read: ['impl'] }, { read: ['scenario'] }),
    ).toBe('only-scenario');
  });

  it('does not jump to the first chapter when only unchecking a lens', () => {
    // on impl-only page with scenario+impl selected; uncheck impl → must stay
    expect(
      resolveLensSwitchChapter(
        toc,
        'only-impl',
        { read: ['scenario'] },
        { read: ['scenario', 'impl'] },
      ),
    ).toBe('only-impl');
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

  it('parent / axis selection means no filter on that axis', () => {
    expect(sectionAllowlistFor(chapter, { read: ['read'] }, tocWithLenses)).toBeNull();
  });

  it('returns null when option has no allowlist (whole page)', () => {
    const whole: TocChapter = {
      ...chapter,
      sectionAllowlists: undefined,
    };
    expect(sectionAllowlistFor(whole, { read: ['scenario'] }, tocWithLenses)).toBeNull();
  });

  it('leaf selection keeps untagged; hides other-leaf hung sections', () => {
    // Page has no layers on biz — only section tags.
    const process: TocChapter = {
      id: 'process',
      title: '工艺',
      file: 'p.md',
      sections: [
        { id: 'flow-a', title: 'A', level: 2 },
        { id: 'flow-b', title: 'B', level: 2 },
        { id: 'stub', title: 'Stub', level: 2 },
      ],
      sectionAllowlists: {
        biz: { flow: ['flow-a', 'flow-b'] },
      },
    };
    const toc = {
      ...tocWithLenses,
      lenses: {
        ...tocWithLenses.lenses!,
        biz: [
          { id: 'overview', title: '概览' },
          { id: 'flow', title: '流程' },
          { id: 'permission', title: '权限' },
        ],
      },
    };
    // 概览 = whole-page overview of the module (index / hang-offs stay visible).
    expect(sectionAllowlistFor(process, { biz: ['overview'] }, toc)).toBeNull();
    // 选流程叶：挂流程的 + 未挂靠 stub。
    expect(sectionAllowlistFor(process, { biz: ['flow'] }, toc)?.sort()).toEqual([
      'flow-a',
      'flow-b',
      'stub',
    ]);
    // 权限无表叶：只留未挂靠；其它叶挂靠隐藏。
    expect(sectionAllowlistFor(process, { biz: ['permission'] }, toc)?.sort()).toEqual(['stub']);
    // 选父「biz」轴 = 该维不筛选 → stub 与 flow 都显示。
    expect(sectionAllowlistFor(process, { biz: ['biz'] }, toc)).toBeNull();
  });

  it('intermediate parent selection also opens the axis', () => {
    const process: TocChapter = {
      id: 'process',
      title: '工艺',
      file: 'p.md',
      sections: [
        { id: 'flow-a', title: 'A', level: 2 },
        { id: 'stub', title: 'Stub', level: 2 },
      ],
      sectionAllowlists: {
        status: { draft: ['flow-a'] },
      },
    };
    const toc = {
      ...tocWithLenses,
      lenses: {
        ...tocWithLenses.lenses!,
        status: [
          {
            id: 'lifecycle',
            title: '生命周期',
            children: [
              { id: 'draft', title: '草稿' },
              { id: 'published', title: '发布' },
            ],
          },
        ],
      },
    };
    // 未挂靠 stub 常显；其它叶挂靠隐藏；选父不筛选。
    expect(sectionAllowlistFor(process, { status: ['draft'] }, toc)?.sort()).toEqual([
      'flow-a',
      'stub',
    ]);
    expect(sectionAllowlistFor(process, { status: ['published'] }, toc)?.sort()).toEqual(['stub']);
    expect(sectionAllowlistFor(process, { status: ['lifecycle'] }, toc)).toBeNull();
    expect(sectionAllowlistFor(process, { status: ['status'] }, toc)).toBeNull();
  });

  it('index shell sections stay visible even when tagged to another leaf', () => {
    const index: TocChapter = {
      id: 'idx',
      title: '骨架',
      file: 'index.md',
      role: 'ruler',
      sections: [
        { id: 'archive', title: '建档', level: 2 },
        { id: 'route', title: '路线', level: 2 },
      ],
      sectionAllowlists: {
        read: { scenario: ['archive'] },
      },
    };
    const toc: BookToc = {
      ...tocWithLenses,
      ruler: { links: { archive: ['flow-sec-1'], route: [] } },
      chapters: [index],
      lenses: {
        read: [
          { id: 'scenario', title: '场景' },
          { id: 'impl', title: '实现' },
        ],
      },
    };
    // 选实现：index 壳仍在；场景挂靠小节本身若也在 index 上仍当壳保留。
    expect(sectionAllowlistFor(index, { read: ['impl'] }, toc)?.sort()).toEqual([
      'archive',
      'route',
    ]);
    expect(sectionAllowlistFor(index, { read: ['scenario'] }, toc)?.sort()).toEqual([
      'archive',
      'route',
    ]);
  });
});

describe('filterSectionsByShowLevel', () => {
  it('hides sections with rank above page showLevel on any page', () => {
    const chapter: TocChapter = {
      id: 'flow',
      title: '流程',
      file: 'flow.md',
      showLevel: 1,
      sections: [
        { id: 'a', title: '概览', level: 2, rank: 1 },
        { id: 'b', title: '细节', level: 2, rank: 2 },
        { id: 'c', title: '无等级', level: 2 },
      ],
    };
    expect(
      filterSectionsByShowLevel(chapter.sections, chapter).map((s) => s.id),
    ).toEqual(['a', 'c']);
  });

  it('reader topbar level overrides page showLevel; null means 全部', () => {
    const chapter: TocChapter = {
      id: 'flow',
      title: '流程',
      file: 'flow.md',
      showLevel: 1,
      sections: [
        { id: 'a', title: '概览', level: 2, rank: 1 },
        { id: 'b', title: '细节', level: 2, rank: 2 },
      ],
    };
    expect(filterSectionsByShowLevel(chapter.sections, chapter, 2).map((s) => s.id)).toEqual([
      'a',
      'b',
    ]);
    expect(filterSectionsByShowLevel(chapter.sections, chapter, null).map((s) => s.id)).toEqual([
      'a',
      'b',
    ]);
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

  it('includes configured lens colors', () => {
    const colored: BookToc = {
      ...tocWithLenses,
      lenses: {
        read: [
          { id: 'scenario', title: '场景', color: '#7a8a9a' },
          { id: 'impl', title: '实现', color: '#6d86a0' },
        ],
        audience: tocWithLenses.lenses!.audience,
      },
    };
    expect(selectionLegendLeaves(colored, { read: ['scenario', 'impl'] })).toEqual([
      { id: 'scenario', title: '场景', color: '#7a8a9a' },
      { id: 'impl', title: '实现', color: '#6d86a0' },
    ]);
  });

  it('assigns cluster roles from title and index', () => {
    expect(sectionClusterRole({ title: '账号密码' }, 0)).toBeNull();
    expect(sectionClusterRole({ title: '账号密码' }, 1)).toBe('start');
    expect(sectionClusterRole({ title: '' }, 1)).toBe('child');
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
    expect(grouped.map((g) => ({ title: g.groupTitle, path: g.groupPath, pages: g.pages.map((p) => p.id) }))).toEqual([
      { title: '身份', path: ['身份'], pages: ['login', 'register'] },
      { title: '导航', path: ['导航'], pages: ['home'] },
      { title: null, path: [], pages: ['overview'] },
    ]);
  });

  it('demotes section levels by group depth', () => {
    expect(digestSectionDisplayLevel(0, 2)).toBe(2);
    expect(digestSectionDisplayLevel(1, 2)).toBe(3);
    expect(digestSectionDisplayLevel(2, 2)).toBe(4);
    expect(digestPageDisplayLevel(1)).toBe(2);
  });

  it('builds digest anchor ids', () => {
    expect(digestAnchorId('login', 'flow')).toBe('digest-login--flow');
  });

  it('keeps Chinese group paths unique for numbering', () => {
    expect(digestPathAnchorId('计划调度')).not.toBe(digestPathAnchorId('资源支撑'));
    expect(digestPathAnchorId('计划调度')).toMatch(/^digest-path-/);
  });
});

describe('collapseSingletonGroups', () => {
  it('promotes a page-only directory with one page to the directory title', () => {
    const tree = collapseSingletonGroups([
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
              { type: 'page', id: 'index', title: '账号注册', file: 'index.md' },
            ],
          },
        ],
      },
    ]);
    expect(tree).toEqual([
      {
        type: 'group',
        id: 'identity',
        title: '身份',
        children: [
          { type: 'page', id: 'index', title: '账号注册', file: 'index.md' },
        ],
      },
    ]);
  });

  it('keeps a page-only directory when multiple pages remain', () => {
    const tree = collapseSingletonGroups([
      {
        type: 'group',
        id: 'register',
        title: '账号注册',
        children: [
          { type: 'page', id: 'scenario', title: '注册场景', file: 'scenario.md' },
          { type: 'page', id: 'entity', title: '实体', file: 'entity.md' },
        ],
      },
    ]);
    expect(tree[0]).toMatchObject({ type: 'group', id: 'register', title: '账号注册' });
    expect(tree[0].type === 'group' && tree[0].children).toHaveLength(2);
  });
});
