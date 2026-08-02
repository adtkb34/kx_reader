import type {
  BookLens,
  BookToc,
  LensAxisId,
  LensSelection,
  PageLayer,
  TocChapter,
  TocSection,
  TocTreeNode,
} from './types';

/** Axis title from book config; falls back to the id. */
export function axisLabel(toc: BookToc, axisId: LensAxisId): string {
  return toc.lensAxisTitles?.[axisId] ?? axisId;
}

export function lensAxisIds(toc: BookToc): LensAxisId[] {
  if (toc.lensAxisOrder?.length) return [...toc.lensAxisOrder];
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

export function walkLensNodes(
  nodes: BookLens[],
  visit: (node: BookLens, parent: BookLens | null) => void,
  parent: BookLens | null = null,
): void {
  for (const node of nodes) {
    visit(node, parent);
    if (node.children?.length) walkLensNodes(node.children, visit, node);
  }
}

export function isLensLeaf(node: BookLens): boolean {
  return !node.children || node.children.length === 0;
}

/** All node ids in the tree (parents + leaves). */
export function allLensNodeIds(nodes: BookLens[]): Set<PageLayer> {
  const out = new Set<PageLayer>();
  walkLensNodes(nodes, (n) => {
    out.add(n.id);
  });
  return out;
}

/** Leaf option ids only. */
export function lensLeafIds(nodes: BookLens[]): Set<PageLayer> {
  const out = new Set<PageLayer>();
  walkLensNodes(nodes, (n) => {
    if (isLensLeaf(n)) out.add(n.id);
  });
  return out;
}

export function findLensNode(nodes: BookLens[], id: PageLayer): BookLens | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children?.length) {
      const found = findLensNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Leaf ids under a node (itself if leaf). Empty if id unknown. */
export function leavesUnder(nodes: BookLens[], nodeId: PageLayer): PageLayer[] {
  const node = findLensNode(nodes, nodeId);
  if (!node) return [];
  if (isLensLeaf(node)) return [node.id];
  const out: PageLayer[] = [];
  walkLensNodes(node.children ?? [], (n) => {
    if (isLensLeaf(n)) out.push(n.id);
  });
  return out;
}

/** Union of leaves under each selected node id. */
export function effectiveLeaves(nodes: BookLens[], selected: PageLayer[]): PageLayer[] {
  const out = new Set<PageLayer>();
  for (const id of selected) {
    for (const leaf of leavesUnder(nodes, id)) out.add(leaf);
  }
  return [...out];
}

/**
 * Effective leaf option ids for one axis.
 * Selecting the axis id itself = all leaves under that axis's options.
 */
export function effectiveAxisLeaves(
  toc: BookToc,
  axis: LensAxisId,
  selected: PageLayer[],
): PageLayer[] {
  const opts = toc.lenses?.[axis] ?? [];
  const chosen = normalizeAxisSelection(selected);
  if (chosen.includes(axis)) return [...lensLeafIds(opts)];
  return effectiveLeaves(opts, chosen);
}

/** Toolbar tree: L1 = axes, L2+ = that axis's options. */
export function buildLensSelectTree(toc: BookToc): BookLens[] {
  if (!toc.lenses) return [];
  return lensAxisIds(toc).map((axis) => {
    const opts = toc.lenses![axis] ?? [];
    // Leaf axis (dimension with no children): option tree is [itself].
    const children =
      opts.length === 1 && opts[0]?.id === axis && !opts[0].children?.length
        ? undefined
        : opts;
    return {
      id: axis,
      title: axisLabel(toc, axis),
      ...(children?.length ? { children } : {}),
    };
  });
}

/** True if `ancestorId` is a strict ancestor of `descendantId` in the tree. */
export function isLensAncestor(
  nodes: BookLens[],
  ancestorId: PageLayer,
  descendantId: PageLayer,
): boolean {
  if (ancestorId === descendantId) return false;
  const ancestor = findLensNode(nodes, ancestorId);
  if (!ancestor?.children?.length) return false;
  return findLensNode(ancestor.children, descendantId) != null;
}

/**
 * Same branch: only one layer at a time; siblings at that layer may multi-select.
 * When `prev` is given, newly added ids win and clear ancestor/descendant conflicts.
 * Without `prev`, keep the deepest conflicting layer.
 */
export function normalizeBranchLayerSelection(
  nodes: BookLens[],
  next: PageLayer[],
  prev: PageLayer[] = [],
): PageLayer[] {
  const allowed = allLensNodeIds(nodes);
  const result = new Set(normalizeAxisSelection(next).filter((id) => allowed.has(id)));
  const prevSet = new Set(normalizeAxisSelection(prev));
  const added = [...result].filter((id) => !prevSet.has(id));

  const clearConflicts = (id: PageLayer): void => {
    for (const other of [...result]) {
      if (other === id) continue;
      if (isLensAncestor(nodes, id, other) || isLensAncestor(nodes, other, id)) {
        result.delete(other);
      }
    }
  };

  if (prevSet.size > 0 && added.length > 0) {
    for (const id of added) clearConflicts(id);
  } else {
    // Prefer deepest: drop any id that has a selected descendant.
    for (const id of [...result]) {
      for (const other of result) {
        if (other !== id && isLensAncestor(nodes, id, other)) {
          result.delete(id);
          break;
        }
      }
    }
  }

  return [...result];
}

/** Flatten LensSelection values (axis order). */
export function selectionToFlatIds(toc: BookToc, selection: LensSelection | null): PageLayer[] {
  if (!selection) return [];
  const out: PageLayer[] = [];
  for (const axis of lensAxisIds(toc)) {
    for (const id of normalizeAxisSelection(selection[axis])) out.push(id);
  }
  return out;
}

/**
 * Map flat select-tree ids back to per-axis LensSelection.
 * Applies branch-layer normalization on the full select tree.
 */
export function flatIdsToSelection(
  toc: BookToc,
  flatIds: PageLayer[],
  prevFlat: PageLayer[] = [],
): LensSelection | null {
  if (!toc.lenses) return null;
  const tree = buildLensSelectTree(toc);
  const normalized = normalizeBranchLayerSelection(tree, flatIds, prevFlat);
  const out: LensSelection = {};
  for (const axis of lensAxisIds(toc)) {
    out[axis] = [];
  }
  for (const id of normalized) {
    if (toc.lenses[id]) {
      out[id] = [id];
      continue;
    }
    for (const axis of lensAxisIds(toc)) {
      if (allLensNodeIds(toc.lenses[axis] ?? []).has(id)) {
        out[axis] = [...(out[axis] ?? []), id];
        break;
      }
    }
  }
  const fallback = defaultSelection(toc);
  for (const axis of lensAxisIds(toc)) {
    if (!out[axis]?.length && fallback?.[axis]?.length) {
      out[axis] = [...fallback[axis]];
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Keep at most one selected id per axis (for single-select mode). */
export function collapseEachAxisToSingle(
  toc: BookToc,
  selection: LensSelection,
  preferIds: PageLayer[] = [],
): LensSelection {
  const prefer = new Set(preferIds);
  const out: LensSelection = {};
  for (const axis of lensAxisIds(toc)) {
    const ids = normalizeAxisSelection(selection[axis]);
    if (ids.length <= 1) {
      out[axis] = [...ids];
      continue;
    }
    const hit = ids.find((id) => prefer.has(id));
    out[axis] = [hit ?? ids[ids.length - 1]];
  }
  return out;
}

/** Node ids allowed in an axis selection (option nodes + the axis id for "whole axis"). */
export function allowedAxisSelectionIds(toc: BookToc, axis: LensAxisId): Set<PageLayer> {
  const out = allLensNodeIds(toc.lenses?.[axis] ?? []);
  out.add(axis);
  return out;
}

export function normalizeAxisSelection(raw: unknown): PageLayer[] {
  if (typeof raw === 'string' && raw) return [raw];
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  return [];
}

export function pageVisibleInSelection(
  chapter: TocChapter,
  selection: LensSelection | null,
  toc?: BookToc | null,
): boolean {
  if (!selection || Object.keys(selection).length === 0) return true;
  const layers = chapter.layers;
  if (!layers) return true;
  for (const [axis, chosen] of Object.entries(selection)) {
    const opts = layerOptions(layers[axis]);
    if (opts.length === 0) continue;
    const leaves = toc?.lenses?.[axis]?.length
      ? effectiveAxisLeaves(toc, axis, normalizeAxisSelection(chosen))
      : normalizeAxisSelection(chosen);
    if (leaves.length === 0) return false;
    if (!leaves.some((leaf) => opts.includes(leaf))) return false;
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
 * Per axis: union of allowlists for effective leaves; if any leaf is whole-page
 * (no allowlist), that axis contributes no filter.
 * Across axes, intersecting lists still apply.
 */
export function sectionAllowlistFor(
  chapter: TocChapter,
  selection: LensSelection | null,
  toc?: BookToc | null,
): string[] | null {
  if (!selection || !chapter.sectionAllowlists) return null;
  const lists: string[][] = [];
  for (const [axis, chosen] of Object.entries(selection)) {
    const leaves = toc?.lenses?.[axis]?.length
      ? effectiveAxisLeaves(toc, axis, normalizeAxisSelection(chosen))
      : normalizeAxisSelection(chosen);
    if (leaves.length === 0) continue;

    const axisAllows = chapter.sectionAllowlists[axis];
    if (!axisAllows) continue;

    let wholePage = false;
    const union = new Set<string>();
    for (const leaf of leaves) {
      const allow = axisAllows[leaf];
      if (!allow) {
        wholePage = true;
        break;
      }
      for (const id of allow) union.add(id);
    }
    if (wholePage) continue;
    if (union.size > 0) lists.push([...union]);
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
  toc?: BookToc | null,
): TocChapter[] {
  if (!selection) return chapters;
  return chapters.filter((c) => pageVisibleInSelection(c, selection, toc));
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
  toc?: BookToc | null,
): Set<string> {
  return new Set(filterChapters(chapters, selection, toc).map((c) => c.id));
}

/** Default: first option root on each axis (not the axis node itself). */
export function defaultSelection(toc: BookToc): LensSelection | null {
  const axes = lensAxisIds(toc);
  if (axes.length === 0 || !toc.lenses) return null;
  const sel: LensSelection = {};
  for (const axis of axes) {
    const first = toc.lenses[axis]?.[0]?.id;
    if (first) sel[axis] = [first];
  }
  return Object.keys(sel).length > 0 ? sel : null;
}

/** Loose query bag (Vue Router query, URLSearchParams, or plain object). */
export type LensQueryInput =
  | URLSearchParams
  | Record<string, string | null | Array<string | null> | undefined>;

function queryValues(query: LensQueryInput, key: string): string[] {
  if (query instanceof URLSearchParams) {
    return query.getAll(key).filter((v) => v.length > 0);
  }
  const raw = query[key];
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  return raw === '' ? [] : [raw];
}

/**
 * Read lens selection from URL query (axis → node id list).
 * Returns null when no declared axis key is present.
 */
export function lensSelectionFromQuery(
  query: LensQueryInput,
  toc: BookToc,
): LensSelection | null {
  if (!hasLenses(toc) || !toc.lenses) return null;
  const out: LensSelection = {};
  let found = false;
  for (const axis of lensAxisIds(toc)) {
    const raw = queryValues(query, axis);
    if (raw.length === 0) continue;
    found = true;
    const allowed = allowedAxisSelectionIds(toc, axis);
    const pick = raw.filter((id) => allowed.has(id));
    if (pick.length > 0) out[axis] = pick;
  }
  return found ? out : null;
}

/** Serialize selection to query params (array values → repeated keys). */
export function lensQueryFromSelection(
  selection: LensSelection | null,
  toc: BookToc,
): Record<string, string | string[]> {
  if (!selection || !hasLenses(toc)) return {};
  const out: Record<string, string | string[]> = {};
  for (const axis of lensAxisIds(toc)) {
    const v = selection[axis];
    if (!v || v.length === 0) continue;
    out[axis] = v.length === 1 ? v[0] : [...v];
  }
  return out;
}

export function sameLensSelection(
  a: LensSelection | null | undefined,
  b: LensSelection | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const aa = normalizeAxisSelection(a[k]).slice().sort();
    const bb = normalizeAxisSelection(b[k]).slice().sort();
    if (aa.length !== bb.length) return false;
    if (aa.some((id, i) => id !== bb[i])) return false;
  }
  return true;
}

/**
 * After changing lens selection, stay on the current page if still visible;
 * otherwise go to the first visible page.
 */
export function resolveLensSwitchChapter(
  toc: BookToc,
  currentId: string,
  nextSelection: LensSelection,
): string {
  const visible = filterChapters(toc.chapters, nextSelection, toc);
  if (visible.some((c) => c.id === currentId)) return currentId;
  return visible[0]?.id ?? currentId;
}

/**
 * Deep-link adopt: ensure each axis selection includes a leaf that matches the page.
 */
export function selectionFromPageLayers(
  toc: BookToc,
  chapter: TocChapter,
  fallback: LensSelection,
): LensSelection {
  const sel: LensSelection = {};
  for (const [axis, ids] of Object.entries(fallback)) {
    sel[axis] = [...normalizeAxisSelection(ids)];
  }
  if (!chapter.layers || !toc.lenses) return sel;
  for (const [axis, membership] of Object.entries(chapter.layers)) {
    if (!toc.lenses[axis]) continue;
    const opts = layerOptions(membership);
    const leafSet = lensLeafIds(toc.lenses[axis]);
    const valid = opts.filter((o) => leafSet.has(o));
    if (valid.length === 0) continue;
    const current = normalizeAxisSelection(sel[axis]);
    const currentLeaves = effectiveAxisLeaves(toc, axis, current);
    if (currentLeaves.some((l) => valid.includes(l))) continue;
    sel[axis] = [valid[0]];
  }
  return sel;
}

/** TOC sections visible under the current lens selection. */
export function visibleTocSections(
  chapter: TocChapter,
  selection: LensSelection | null,
  toc?: BookToc | null,
): TocSection[] {
  return filterSectionsByAllowlist(
    chapter.sections,
    sectionAllowlistFor(chapter, selection, toc),
  );
}

/** Ancestor group titles for a page (outer → inner). Empty if top-level page. */
export function pageGroupPath(tree: TocTreeNode[], pageId: string): string[] {
  function walk(nodes: TocTreeNode[], ancestors: string[]): string[] | null {
    for (const node of nodes) {
      if (node.type === 'page') {
        if (node.id === pageId) return ancestors;
        continue;
      }
      const found = walk(node.children, [...ancestors, node.title]);
      if (found) return found;
    }
    return null;
  }
  return walk(tree, []) ?? [];
}

export interface DigestChapterGroup {
  /** Stable key for consecutive same-group merging. */
  groupKey: string;
  /** Innermost group title, or null when page has no group. */
  groupTitle: string | null;
  pages: TocChapter[];
}

/** Group filtered chapters by TOC path; consecutive same group share one header. */
export function groupChaptersForDigest(
  toc: BookToc,
  chapters: TocChapter[],
): DigestChapterGroup[] {
  const tree = toc.tree?.length
    ? toc.tree
    : toc.chapters.map((c) => ({
        type: 'page' as const,
        id: c.id,
        title: c.title,
        file: c.file,
      }));
  const out: DigestChapterGroup[] = [];
  for (const ch of chapters) {
    const path = pageGroupPath(tree, ch.id);
    const groupKey = path.join('/') || '';
    const groupTitle = path.length > 0 ? path[path.length - 1]! : null;
    const last = out[out.length - 1];
    if (last && last.groupKey === groupKey) {
      last.pages.push(ch);
    } else {
      out.push({ groupKey, groupTitle, pages: [ch] });
    }
  }
  return out;
}

/** Digest outline entries in reading order. */
export interface DigestOutlineEntry {
  chapterId: string;
  chapterTitle: string;
  groupTitle: string | null;
  sectionId: string;
  sectionTitle: string;
  level: number;
}

export function digestOutlineEntries(
  toc: BookToc,
  selection: LensSelection | null,
): DigestOutlineEntry[] {
  const chapters = filterChapters(toc.chapters, selection, toc);
  const grouped = groupChaptersForDigest(toc, chapters);
  const out: DigestOutlineEntry[] = [];
  for (const g of grouped) {
    for (const ch of g.pages) {
      for (const s of visibleTocSections(ch, selection, toc)) {
        out.push({
          chapterId: ch.id,
          chapterTitle: ch.title,
          groupTitle: g.groupTitle,
          sectionId: s.id,
          sectionTitle: s.title,
          level: s.level,
        });
      }
    }
  }
  return out;
}

export function digestAnchorId(chapterId: string, sectionId: string): string {
  return `digest-${chapterId}--${sectionId}`;
}
