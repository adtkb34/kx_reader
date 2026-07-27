import { describe, expect, it } from 'vitest';
import {
  expandSectionAllowlist,
  filterChapters,
  pageVisibleInSelection,
} from './lenses';
import type { TocChapter, TocSection } from './types';

const sections: TocSection[] = [
  { id: 'a', title: 'A', level: 2 },
  { id: 'a1', title: 'A1', level: 3 },
  { id: 'b', title: 'B', level: 2 },
];

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
    layers: { kind: ['rules'] },
    sections: [],
  };

  it('hides pages whose layer does not match selection', () => {
    expect(pageVisibleInSelection(chapter, { kind: 'ui' })).toBe(false);
    expect(pageVisibleInSelection(chapter, { kind: 'rules' })).toBe(true);
  });
});

describe('filterChapters', () => {
  it('filters by selection', () => {
    const chapters: TocChapter[] = [
      {
        id: 'rules-page',
        title: 'R',
        file: 'r.md',
        layers: { kind: ['rules'] },
        sections: [],
      },
      {
        id: 'ui-page',
        title: 'U',
        file: 'u.md',
        layers: { kind: ['ui'] },
        sections: [],
      },
    ];
    expect(filterChapters(chapters, { kind: 'ui' }).map((c) => c.id)).toEqual(['ui-page']);
  });
});
