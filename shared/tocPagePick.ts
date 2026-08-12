import type { TocTreeNode } from './types';
import {
  expandOutlineKeySelection,
  toggleOutlineKeyId,
  topLevelOutlineKeyIds,
} from './outlineKeys';

export type TocPickItem = {
  id: string;
  level: number;
  type: 'group' | 'page';
};

/** Flatten TOC tree to pick items (groups + pages) in document order. */
export function flattenTocPickItems(
  nodes: TocTreeNode[],
  level = 1,
): TocPickItem[] {
  const out: TocPickItem[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, level, type: n.type });
    if (n.type === 'group') {
      out.push(...flattenTocPickItems(n.children, level + 1));
    }
  }
  return out;
}

/** Page ids covered by the current checkbox selection (group ⇒ all descendant pages). */
export function expandTocSelectionToPages(
  items: TocPickItem[],
  selectedIds: string[],
): string[] {
  const visible = new Set(expandOutlineKeySelection(items, selectedIds));
  return items.filter((i) => i.type === 'page' && visible.has(i.id)).map((i) => i.id);
}

export function toggleTocPickId(
  items: TocPickItem[],
  selectedIds: string[],
  id: string,
  checked: boolean,
): string[] {
  return toggleOutlineKeyId(items, selectedIds, id, checked);
}

export function topLevelTocPickIds(items: TocPickItem[]): string[] {
  return topLevelOutlineKeyIds(items);
}
