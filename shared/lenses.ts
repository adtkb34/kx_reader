import type {
  BookToc,
  LensAxisId,
  LensCorrespondence,
  LensSelection,
  PageLayer,
  TocChapter,
  TocTreeNode,
} from './types';

/** Display labels for known axis keys in the toolbar. */
export const AXIS_LABELS: Record<string, string> = {
  kind: '读法',
  audience: '视角',
};

export function axisLabel(axisId: LensAxisId): string {
  return AXIS_LABELS[axisId] ?? axisId;
}

export function lensAxisIds(toc: BookToc): LensAxisId[] {
  return toc.lenses ? Object.keys(toc.lenses) : [];
}

export function hasLenses(toc: BookToc): boolean {
  return lensAxisIds(toc).length > 0;
}

export function pageVisibleInSelection(
  chapter: TocChapter,
  selection: LensSelection | null,
): boolean {
  if (!selection || Object.keys(selection).length === 0) return true;
  const layers = chapter.layers;
  if (!layers) return true;
  for (const [axis, chosen] of Object.entries(selection)) {
    const membership = layers[axis];
    if (membership != null && membership !== chosen) return false;
  }
  return true;
}

export function filterChapters(
  chapters: TocChapter[],
  selection: LensSelection | null,
): TocChapter[] {
  if (!selection) return chapters;
  return chapters.filter((c) => pageVisibleInSelection(c, selection));
}

/** Drop pages not in lens; drop groups with no remaining leaves. */
export function filterTree(nodes: TocTreeNode[], visibleIds: Set<string>): TocTreeNode[] {
  const out: TocTreeNode[] = [];
  for (const node of nodes) {
    if (node.type === 'page') {
      if (visibleIds.has(node.id)) out.push(node);
      continue;
    }
    const children = filterTree(node.children, visibleIds);
    if (children.length > 0) {
      out.push({ ...node, children });
    }
  }
  return out;
}

export function visibleIdSet(
  chapters: TocChapter[],
  selection: LensSelection | null,
): Set<string> {
  return new Set(filterChapters(chapters, selection).map((c) => c.id));
}

export function defaultSelection(toc: BookToc): LensSelection | null {
  const axes = lensAxisIds(toc);
  if (axes.length === 0 || !toc.lenses) return null;
  const sel: LensSelection = {};
  for (const axis of axes) {
    const first = toc.lenses[axis]?.[0]?.id;
    if (first) sel[axis] = first;
  }
  return Object.keys(sel).length > 0 ? sel : null;
}

/** Find the correspondence row on one axis that contains `chapterId`. */
export function findCorrespondence(
  rows: LensCorrespondence[] | undefined,
  chapterId: string,
): LensCorrespondence | undefined {
  if (!rows) return undefined;
  return rows.find((row) => Object.values(row).includes(chapterId));
}

/**
 * After changing one axis to `nextOption`, pick the chapter to navigate to
 * using that axis's correspondences and the full multi-axis selection.
 */
export function resolveAxisSwitchTarget(
  toc: BookToc,
  currentId: string,
  axisId: LensAxisId,
  nextOption: PageLayer,
  selection: LensSelection,
): string {
  const nextSel: LensSelection = { ...selection, [axisId]: nextOption };
  const visible = filterChapters(toc.chapters, nextSel);
  const visibleIds = new Set(visible.map((c) => c.id));
  const row = findCorrespondence(toc.correspondences?.[axisId], currentId);
  const mapped = row?.[nextOption];
  if (mapped && visibleIds.has(mapped)) return mapped;
  if (visibleIds.has(currentId)) return currentId;
  return visible[0]?.id ?? currentId;
}

/** Which axes claim this page; used when deep-linking to adopt membership. */
export function selectionFromPageLayers(
  toc: BookToc,
  chapter: TocChapter,
  fallback: LensSelection,
): LensSelection {
  const sel = { ...fallback };
  if (!chapter.layers || !toc.lenses) return sel;
  for (const [axis, option] of Object.entries(chapter.layers)) {
    if (toc.lenses[axis]?.some((l) => l.id === option)) {
      sel[axis] = option;
    }
  }
  return sel;
}
