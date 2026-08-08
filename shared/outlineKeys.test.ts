import { describe, expect, it } from 'vitest';
import {
  applyOutlineKeyPick,
  buildOutlineKeyTree,
  expandOutlineKeySelection,
  filterRulerKeysBySelection,
  reconcileOutlineKeySelection,
  toggleOutlineKeyId,
  topLevelOutlineKeyIds,
} from './outlineKeys';

describe('topLevelOutlineKeyIds', () => {
  it('returns ids at the minimum level', () => {
    expect(
      topLevelOutlineKeyIds([
        { id: 'a', level: 2 },
        { id: 'a1', level: 3 },
        { id: 'b', level: 2 },
      ]),
    ).toEqual(['a', 'b']);
  });
});

describe('buildOutlineKeyTree', () => {
  it('nests by heading level in document order', () => {
    expect(
      buildOutlineKeyTree([
        { id: 'a', title: 'A', level: 2 },
        { id: 'a1', title: 'A1', level: 3 },
        { id: 'a2', title: 'A2', level: 3 },
        { id: 'b', title: 'B', level: 2 },
      ]),
    ).toEqual([
      {
        id: 'a',
        title: 'A',
        level: 2,
        children: [
          { id: 'a1', title: 'A1', level: 3 },
          { id: 'a2', title: 'A2', level: 3 },
        ],
      },
      { id: 'b', title: 'B', level: 2 },
    ]);
  });
});

describe('reconcileOutlineKeySelection', () => {
  const available = ['a', 'a1', 'b'];
  const tops = ['a', 'b'];

  it('defaults to all top-level keys in multi mode', () => {
    expect(reconcileOutlineKeySelection(available, tops, null, null, 'multi')).toEqual([
      'a',
      'b',
    ]);
  });

  it('defaults to first top-level key in single mode', () => {
    expect(reconcileOutlineKeySelection(available, tops, null, null, 'single')).toEqual(['a']);
  });

  it('keeps valid picks and auto-adds newly appeared top-level keys', () => {
    expect(
      reconcileOutlineKeySelection(
        ['a', 'a1', 'b', 'c'],
        ['a', 'b', 'c'],
        ['a'],
        ['a', 'a1', 'b'],
        'multi',
      ),
    ).toEqual(['a', 'c']);
  });

  it('falls back when nothing kept remains', () => {
    expect(
      reconcileOutlineKeySelection(available, tops, ['gone'], ['gone'], 'multi'),
    ).toEqual(['a', 'b']);
  });
});

describe('applyOutlineKeyPick', () => {
  it('enforces at least one selection', () => {
    expect(applyOutlineKeyPick(['a', 'b'], [], 'multi', ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('collapses to the preferred id in single mode', () => {
    expect(applyOutlineKeyPick(['a', 'b'], ['a', 'b'], 'single', ['a'], 'b')).toEqual(['b']);
  });
});

describe('expandOutlineKeySelection', () => {
  const items = [
    { id: 'a', level: 2 },
    { id: 'a1', level: 3 },
    { id: 'a2', level: 3 },
    { id: 'b', level: 2 },
  ];

  it('includes descendants when a parent is selected (children stay unchecked in UI)', () => {
    expect(expandOutlineKeySelection(items, ['a'])).toEqual(['a', 'a1', 'a2']);
  });

  it('includes ancestors when a child is selected (parent stays unchecked in UI)', () => {
    expect(expandOutlineKeySelection(items, ['a1'])).toEqual(['a', 'a1']);
  });

  it('does not pull in siblings of a selected child', () => {
    expect(expandOutlineKeySelection(items, ['a1'])).not.toContain('a2');
  });

  it('unions parent expansion with another top-level pick', () => {
    expect(expandOutlineKeySelection(items, ['a', 'b'])).toEqual(['a', 'a1', 'a2', 'b']);
  });
});

describe('toggleOutlineKeyId', () => {
  it('adds or removes without touching other ids', () => {
    expect(toggleOutlineKeyId(['a'], 'a1', true)).toEqual(['a', 'a1']);
    expect(toggleOutlineKeyId(['a', 'a1'], 'a1', false)).toEqual(['a']);
  });
});

describe('filterRulerKeysBySelection', () => {
  it('keeps selected keys and expands parent to descendants', () => {
    const keys = [
      { sectionId: 'a', title: 'A', level: 2 },
      { sectionId: 'a1', title: 'A1', level: 3 },
      { sectionId: 'b', title: 'B', level: 2 },
    ];
    expect(
      filterRulerKeysBySelection(keys, ['a']).map((k) => k.sectionId),
    ).toEqual(['a', 'a1']);
  });

  it('includes ancestor key when only a child is selected', () => {
    const keys = [
      { sectionId: 'a', title: 'A', level: 2 },
      { sectionId: 'a1', title: 'A1', level: 3 },
      { sectionId: 'b', title: 'B', level: 2 },
    ];
    expect(
      filterRulerKeysBySelection(keys, ['a1']).map((k) => k.sectionId),
    ).toEqual(['a', 'a1']);
  });

  it('returns all when selection is nullish', () => {
    const keys = [{ sectionId: 'a', title: 'A', level: 2 }];
    expect(filterRulerKeysBySelection(keys, null)).toEqual(keys);
  });
});
