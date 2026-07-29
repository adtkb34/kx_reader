import { describe, expect, it } from 'vitest';
import {
  effectiveLeaves,
  expandSectionAllowlist,
  filterChapters,
  leavesUnder,
  lensLeafIds,
  lensQueryFromSelection,
  lensSelectionFromQuery,
  pageVisibleInSelection,
  resolveLensSwitchChapter,
  sectionAllowlistFor,
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
