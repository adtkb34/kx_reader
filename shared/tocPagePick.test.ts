import { describe, expect, it } from 'vitest';
import type { TocTreeNode } from './types';
import {
  expandTocSelectionToPages,
  flattenTocPickItems,
  toggleTocPickId,
  topLevelTocPickIds,
} from './tocPagePick';

const tree: TocTreeNode[] = [
  {
    type: 'group',
    id: 'g1',
    title: '账号组织',
    children: [
      {
        type: 'group',
        id: 'g1a',
        title: '账号基础',
        children: [
          { type: 'page', id: 'p1', title: '骨架', file: 'a.md' },
          { type: 'page', id: 'p2', title: '概览', file: 'b.md' },
        ],
      },
      { type: 'page', id: 'p3', title: '其它', file: 'c.md' },
    ],
  },
  { type: 'page', id: 'p4', title: '顶页', file: 'd.md' },
];

describe('flattenTocPickItems', () => {
  it('assigns levels to groups and pages in tree order', () => {
    expect(flattenTocPickItems(tree)).toEqual([
      { id: 'g1', level: 1, type: 'group' },
      { id: 'g1a', level: 2, type: 'group' },
      { id: 'p1', level: 3, type: 'page' },
      { id: 'p2', level: 3, type: 'page' },
      { id: 'p3', level: 2, type: 'page' },
      { id: 'p4', level: 1, type: 'page' },
    ]);
  });
});

describe('toggleTocPickId', () => {
  const items = flattenTocPickItems(tree);

  it('checking a group clears descendants', () => {
    expect(toggleTocPickId(items, ['p1', 'p4'], 'g1a', true).sort()).toEqual(['g1a', 'p4']);
  });

  it('checking a page clears ancestor groups', () => {
    expect(toggleTocPickId(items, ['g1'], 'p1', true)).toEqual(['p1']);
  });
});

describe('expandTocSelectionToPages', () => {
  const items = flattenTocPickItems(tree);

  it('expands a selected group to descendant pages', () => {
    expect(expandTocSelectionToPages(items, ['g1a'])).toEqual(['p1', 'p2']);
  });

  it('keeps a selected page as itself', () => {
    expect(expandTocSelectionToPages(items, ['p4'])).toEqual(['p4']);
  });
});

describe('topLevelTocPickIds', () => {
  it('returns root groups and pages', () => {
    expect(topLevelTocPickIds(flattenTocPickItems(tree))).toEqual(['g1', 'p4']);
  });
});
