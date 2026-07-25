import type {
  BookToc,
  CorrespondenceTarget,
  LensAxisId,
  LensCorrespondence,
  LensSelection,
  PageLayer,
  TocChapter,
  TocSection,
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

/** Normalize layer membership to a list of option ids. */
export function layerOptions(membership: PageLayer | PageLayer[] | undefined): PageLayer[] {
  if (membership == null) return [];
  return Array.isArray(membership) ? membership : [membership];
}

export function correspondencePageId(target: CorrespondenceTarget): string {
  return typeof target === 'string' ? target : target.page;
}

export function pageVisibleInSelection(
  chapter: TocChapter,
  selection: LensSelection | null,
): boolean {
  if (!selection || Object.keys(selection).length === 0) return true;
  const layers = chapter.layers;
  if (!layers) return true;
  for (const [axis, chosen] of Object.entries(selection)) {
    const opts = layerOptions(layers[axis]);
    if (opts.length > 0 && !opts.includes(chosen)) return false;
  }
  return true;
}

/**
 * Expand an allowlist so each listed section also includes following deeper
 * headings until the next heading at the same or higher level.
 */
export function expandSectionAllowlist(
  sections: TocSection[],
  allowlist: string[] | null,
): string[] | null {
  if (!allowlist) return null;
  const byId = new Map(sections.map((s, i) => [s.id, i]));
  const out = new Set<string>();
  for (const id of allowlist) {
    const start = byId.get(id);
    if (start == null) continue;
    const level = sections[start].level;
    out.add(id);
    for (let i = start + 1; i < sections.length; i++) {
      if (sections[i].level <= level) break;
      out.add(sections[i].id);
    }
  }
  return [...out];
}

/**
 * Section ids to show for the current selection, or null = no filter (all).
 * Allowlists from different axes are intersected when more than one applies.
 * Listed ids include nested deeper headings in document order.
 */
export function sectionAllowlistFor(
  chapter: TocChapter,
  selection: LensSelection | null,
): string[] | null {
  if (!selection || !chapter.sectionAllowlists) return null;
  const lists: string[][] = [];
  for (const [axis, chosen] of Object.entries(selection)) {
    const allow = chapter.sectionAllowlists[axis]?.[chosen];
    if (allow) lists.push(allow);
  }
  if (lists.length === 0) return null;
  const expanded = lists.map((list) => expandSectionAllowlist(chapter.sections, list) ?? list);
  if (expanded.length === 1) return expanded[0];
  const first = new Set(expanded[0]);
  return expanded.slice(1).reduce((acc, list) => acc.filter((id) => list.includes(id)), [...first]);
}

export function filterSectionsByAllowlist<T extends { id: string }>(
  sections: T[],
  allowlist: string[] | null,
): T[] {
  if (!allowlist) return sections;
  const allowed = new Set(allowlist);
  return sections.filter((s) => allowed.has(s.id));
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
  return rows.find((row) =>
    Object.values(row).some((t) => correspondencePageId(t) === chapterId),
  );
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
  const mappedId = mapped ? correspondencePageId(mapped) : undefined;
  if (mappedId && visibleIds.has(mappedId)) return mappedId;
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
  for (const [axis, membership] of Object.entries(chapter.layers)) {
    if (!toc.lenses[axis]) continue;
    const opts = layerOptions(membership);
    const allowed = new Set(toc.lenses[axis].map((l) => l.id));
    const valid = opts.filter((o) => allowed.has(o));
    if (valid.length === 0) continue;
    if (sel[axis] && valid.includes(sel[axis])) continue;
    sel[axis] = valid[0];
  }
  return sel;
}

/** TOC sections visible under the current lens selection. */
export function visibleTocSections(
  chapter: TocChapter,
  selection: LensSelection | null,
): TocSection[] {
  return filterSectionsByAllowlist(chapter.sections, sectionAllowlistFor(chapter, selection));
}
