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
import { tocTreeOutlineNumbers } from './outlineNumbers';

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
 * Prefer `axisSelectionIsOpen` when you need「父/轴 = 该维不筛选」.
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

/**
 * True when the axis selection includes a non-leaf (axis id or parent node).
 * Means「该维度不筛选」: show content whether or not it hangs on any child leaf.
 */
export function axisSelectionIsOpen(
  toc: BookToc,
  axis: LensAxisId,
  selected: PageLayer[],
): boolean {
  const opts = toc.lenses?.[axis] ?? [];
  const chosen = normalizeAxisSelection(selected);
  if (chosen.length === 0) return false;
  if (chosen.includes(axis)) return true;
  for (const id of chosen) {
    const node = findLensNode(opts, id);
    if (node && !isLensLeaf(node)) return true;
  }
  return false;
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
 * By default empty axes fall back to `defaultSelection`; pass `allowEmpty` for
 * ruler mode (skeleton index only, dims optional).
 */
export function flatIdsToSelection(
  toc: BookToc,
  flatIds: PageLayer[],
  prevFlat: PageLayer[] = [],
  opts?: { allowEmpty?: boolean },
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
  if (!opts?.allowEmpty) {
    const fallback = defaultSelection(toc);
    for (const axis of lensAxisIds(toc)) {
      if (!out[axis]?.length && fallback?.[axis]?.length) {
        out[axis] = [...fallback[axis]];
      }
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Keep at most one selected id per axis (single-pick: any depth, parent or leaf). */
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

/**
 * Collapse each axis to exactly one effective leaf (never a parent that
 * still expands to multiple leaves).
 */
export function collapseEachAxisToSingleLeaf(
  toc: BookToc,
  selection: LensSelection,
  preferIds: PageLayer[] = [],
): LensSelection {
  const collapsed = collapseEachAxisToSingle(toc, selection, preferIds);
  const prefer = new Set(preferIds);
  const out: LensSelection = {};
  for (const axis of lensAxisIds(toc)) {
    const ids = normalizeAxisSelection(collapsed[axis]);
    if (ids.length === 0) {
      out[axis] = [];
      continue;
    }
    const leaves = effectiveAxisLeaves(toc, axis, ids);
    if (leaves.length <= 1) {
      out[axis] = leaves.length === 1 ? [leaves[0]] : [...ids];
      continue;
    }
    const hit = leaves.find((id) => prefer.has(id));
    out[axis] = [hit ?? leaves[leaves.length - 1]];
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
  ctx?: SectionAllowlistContext,
): boolean {
  if (!selection || Object.keys(selection).length === 0) return true;
  // Module index / ruler skeleton: ticks stay visible under any leaf; hang-offs
  // are filtered later via section allowlists / assemble.
  if (chapter.role === 'ruler') return true;
  if (toc?.ruler && leafModuleIndexIds(toc).has(chapter.id)) return true;
  const layers = chapter.layers;
  if (!layers) return true;
  const moduleIndex =
    ctx?.moduleIndex && ctx.moduleIndex.id !== chapter.id ? ctx.moduleIndex : null;
  for (const [axis, chosen] of Object.entries(selection)) {
    if (toc?.lenses?.[axis]?.length && axisSelectionIsOpen(toc, axis, chosen)) {
      continue; // 父/轴 = 该维不筛选
    }
    const leaves = toc?.lenses?.[axis]?.length
      ? effectiveAxisLeaves(toc, axis, normalizeAxisSelection(chosen))
      : normalizeAxisSelection(chosen);
    const opts = layerOptions(layers[axis]);
    // Empty leaf selection: hide pages tagged on this axis; untagged pages pass.
    if (leaves.length === 0) {
      if (opts.length > 0) return false;
      continue;
    }
    if (axisOpenedByWholePageLayers(moduleIndex, axis, leaves)) continue;
    if (opts.length === 0) continue;
    if (!leaves.some((leaf) => opts.includes(leaf))) return false;
  }
  return true;
}

/**
 * Expand an allowlist so each listed section also includes following deeper
 * headings until the next heading at the same or higher level.
 * Untitled sections (no heading title) do not expand — their inherited level
 * must not swallow later titled sections that happen to use a deeper heading.
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
    out.add(id);
    const sec = sections[start];
    if (!sec.title) continue;
    const level = sec.level;
    for (let i = start + 1; i < sections.length; i++) {
      if (sections[i].level <= level) break;
      out.add(sections[i].id);
    }
  }
  return [...out];
}

/**
 * Leaf-module index chapter ids (mirrors `listLeafModules` index pick, without
 * importing ruler — lenses ↔ ruler would cycle).
 */
export function leafModuleIndexIds(toc: BookToc): Set<string> {
  const out = new Set<string>();
  if (!toc.ruler) return out;
  const chapterById = new Map(toc.chapters.map((c) => [c.id, c]));
  const keyIds = new Set(Object.keys(toc.ruler.links ?? {}));

  function isSkeleton(ch: TocChapter): boolean {
    if (ch.role === 'ruler') return true;
    if (ch.role === 'page') return false;
    const bare = !ch.layers || Object.keys(ch.layers).length === 0;
    return bare && ch.sections.some((s) => keyIds.has(s.id));
  }

  function walk(nodes: TocTreeNode[]): void {
    for (const node of nodes) {
      if (node.type === 'page') {
        out.add(node.id);
        continue;
      }
      if (node.children.some((c) => c.type === 'group')) {
        walk(node.children);
        continue;
      }
      const pageIds = node.children.filter((c) => c.type === 'page').map((c) => c.id);
      const chapters = pageIds
        .map((id) => chapterById.get(id))
        .filter((c): c is TocChapter => !!c);
      if (chapters.length === 0) continue;
      const index = chapters.find((c) => isSkeleton(c)) ?? chapters[0]!;
      out.add(index.id);
    }
  }

  const tree =
    toc.tree?.length > 0
      ? toc.tree
      : toc.chapters.map(
          (c): TocTreeNode => ({
            type: 'page',
            id: c.id,
            title: c.title,
            file: c.file,
          }),
        );
  walk(tree);
  return out;
}

/**
 * Index / ruler skeleton section ids on this chapter (shells that stay visible
 * under any leaf). Includes leaf-module indexes even without `role: "ruler"`
 * (e.g. a bare 检验能力 page that is its own module index).
 */
export function chapterIndexShellIds(
  chapter: TocChapter,
  toc?: BookToc | null,
): Set<string> {
  const out = new Set<string>();
  if (!toc?.ruler) return out;
  const linkKeys = new Set(Object.keys(toc.ruler.links));
  const isIndex =
    chapter.role === 'ruler' || leafModuleIndexIds(toc).has(chapter.id);
  if (isIndex) {
    for (const s of chapter.sections) {
      if (s.title) out.add(s.id);
    }
    return out;
  }
  for (const s of chapter.sections) {
    if (linkKeys.has(s.id)) out.add(s.id);
  }
  return out;
}

/** Section ids tagged on any leaf of this axis allowlist map. */
function axisTaggedSectionIds(
  axisAllows: Partial<Record<PageLayer, string[]>>,
): Set<string> {
  const tagged = new Set<string>();
  for (const list of Object.values(axisAllows)) {
    if (!list) continue;
    for (const id of list) tagged.add(id);
  }
  return tagged;
}

/** `display` = shells + selected hung; `hungOnly` =「仅有/仅无内容」判定. */
export type SectionAllowlistMode = 'display' | 'hungOnly';

/** Extra context for ruler assemble: module index whole-page layers open hang-offs. */
export type SectionAllowlistContext = {
  moduleIndex?: TocChapter | null;
};

function axisOpenedByWholePageLayers(
  chapter: TocChapter | null | undefined,
  axis: string,
  leaves: PageLayer[],
): boolean {
  if (!chapter) return false;
  const opts = layerOptions(chapter.layers?.[axis as LensAxisId]);
  return leaves.some((leaf) => opts.includes(leaf));
}

/**
 * Section ids to show for the current selection, or null = no filter (all).
 * Per axis:
 * - Non-leaf selected (axis id / parent) → 该维不筛选 (skip).
 * - Empty leaf selection → same as unmatched leaf: `display` = index shells only
 *   (尺子刻度常显；挂靠正文隐藏); `hungOnly` = empty. Untagged chapters also get
 *   shells-only (not `continue` / open-axis).
 * - Selected leaf with no allowlist on this page:
 *   - leaf in page `layers` → whole-page (no section filter).
 *   - or module index has matching whole-page layers → same (挂靠页跟随模块归属).
 *   - otherwise → `display` = index shells only; `hungOnly` = empty.
 * - Selected leaf with an allowlist:
 *   - `display` → that leaf's hung ∪ index shells (not untagged).
 *   - `hungOnly` → that leaf's hung only (for「仅有内容」/「仅无内容」).
 * Across axes, intersecting lists still apply.
 */
export function sectionAllowlistFor(
  chapter: TocChapter,
  selection: LensSelection | null,
  toc?: BookToc | null,
  mode: SectionAllowlistMode = 'display',
  ctx?: SectionAllowlistContext,
): string[] | null {
  if (!selection || Object.keys(selection).length === 0) return null;
  const shellIds = mode === 'display' ? chapterIndexShellIds(chapter, toc) : new Set<string>();
  const lists: string[][] = [];
  const moduleIndex =
    ctx?.moduleIndex && ctx.moduleIndex.id !== chapter.id ? ctx.moduleIndex : null;

  for (const [axis, chosen] of Object.entries(selection)) {
    if (toc?.lenses?.[axis]?.length && axisSelectionIsOpen(toc, axis, chosen)) {
      continue; // 父/轴 = 该维不筛选
    }

    const leaves = toc?.lenses?.[axis]?.length
      ? effectiveAxisLeaves(toc, axis, normalizeAxisSelection(chosen))
      : normalizeAxisSelection(chosen);

    const axisAllows = chapter.sectionAllowlists?.[axis];
    const layerOpts = layerOptions(chapter.layers?.[axis]);

    // Empty leaves = no leaf matched: keep index shells (ticks), hide hangs.
    if (leaves.length === 0) {
      lists.push(mode === 'display' ? [...shellIds] : []);
      continue;
    }

    const moduleOpens = axisOpenedByWholePageLayers(moduleIndex, axis, leaves);

    // No section table on this axis: whole-page leaf / module ownership → skip; else shells only.
    if (!axisAllows) {
      if (leaves.some((leaf) => layerOpts.includes(leaf)) || moduleOpens) {
        continue;
      }
      lists.push(mode === 'display' ? [...shellIds] : []);
      continue;
    }

    let wholePage = false;
    const selectedTagged = new Set<string>();
    for (const leaf of leaves) {
      const allow = axisAllows[leaf];
      if (!allow) {
        // 整页层匹配 / 模块 index 归属 → 整页；其它未配小节表的叶 → 无本叶挂靠。
        if (layerOpts.includes(leaf) || moduleOpens) {
          wholePage = true;
          break;
        }
        continue;
      }
      for (const id of allow) selectedTagged.add(id);
    }
    if (wholePage) continue;

    const taggedOnAxis = axisTaggedSectionIds(axisAllows);
    const hasAnyAxisTags = taggedOnAxis.size > 0;

    if (mode === 'hungOnly') {
      const allowed = [...selectedTagged];
      if (hasAnyAxisTags || allowed.length > 0) lists.push(allowed);
      else lists.push([]);
      continue;
    }

    // display: selected hung ∪ index shells only (未挂该轴的正文隐藏).
    const allowed = new Set<string>(selectedTagged);
    for (const id of shellIds) allowed.add(id);
    lists.push([...allowed]);
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

/** True when section has no rank, or rank ≤ page showLevel, or showLevel unset. */
export function sectionPassesShowLevel(
  section: { rank?: number } | undefined,
  showLevel: number | undefined,
): boolean {
  if (showLevel == null || !Number.isFinite(showLevel)) return true;
  if (section?.rank == null) return true;
  return section.rank <= showLevel;
}

/**
 * Reader topbar level vs page `showLevel`.
 * - `null` = 全部（不按 rank 过滤，忽略页配置）
 * - `number` = 强制该上限
 * - `undefined` = 未选顶栏，回退到页 `showLevel`
 */
export type ReaderShowLevel = number | null | undefined;

export function effectiveShowLevel(
  chapter: TocChapter | null | undefined,
  readerShowLevel?: ReaderShowLevel,
): number | undefined {
  if (readerShowLevel === null) return undefined;
  if (typeof readerShowLevel === 'number' && Number.isFinite(readerShowLevel)) {
    return readerShowLevel;
  }
  const page = chapter?.showLevel;
  return page != null && Number.isFinite(page) ? page : undefined;
}

/** Sorted unique content ranks present in the book (for topbar options). */
export function bookContentRanks(toc: BookToc): number[] {
  const ranks = new Set<number>();
  for (const ch of toc.chapters) {
    for (const s of ch.sections) {
      if (s.rank != null && Number.isFinite(s.rank)) ranks.add(s.rank);
    }
  }
  return [...ranks].sort((a, b) => a - b);
}

/** Drop sections whose rank exceeds the effective showLevel. */
export function filterSectionsByShowLevel<T extends { id: string }>(
  sections: T[],
  chapter: TocChapter | null | undefined,
  readerShowLevel?: ReaderShowLevel,
): T[] {
  const level = effectiveShowLevel(chapter, readerShowLevel);
  if (level == null) return sections;
  const byId = new Map((chapter?.sections ?? []).map((s) => [s.id, s]));
  return sections.filter((s) => sectionPassesShowLevel(byId.get(s.id), level));
}

/**
 * Leaves whose section allowlist (after expand) includes `sectionId`.
 * Ordered by lens tree walk when `toc` is provided.
 */
export function sectionLensLeaves(
  chapter: TocChapter,
  sectionId: string,
  toc?: BookToc | null,
): PageLayer[] {
  if (!chapter.sectionAllowlists) return [];
  const found = new Set<PageLayer>();
  for (const byLeaf of Object.values(chapter.sectionAllowlists)) {
    if (!byLeaf) continue;
    for (const [leaf, list] of Object.entries(byLeaf)) {
      if (!list?.length) continue;
      const expanded = expandSectionAllowlist(chapter.sections, list) ?? list;
      if (expanded.includes(sectionId)) found.add(leaf);
    }
  }
  if (found.size === 0) return [];
  if (!toc?.lenses) return [...found];
  const ordered: PageLayer[] = [];
  for (const axis of lensAxisIds(toc)) {
    for (const leaf of lensLeafIds(toc.lenses[axis] ?? [])) {
      if (found.has(leaf)) ordered.push(leaf);
    }
  }
  for (const id of found) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

/** Display title for a leaf (or any lens node) across axes. */
export function lensNodeTitle(toc: BookToc, nodeId: PageLayer): string {
  if (!toc.lenses) return nodeId;
  if (toc.lensAxisTitles?.[nodeId]) return toc.lensAxisTitles[nodeId]!;
  for (const axis of lensAxisIds(toc)) {
    const node = findLensNode(toc.lenses[axis] ?? [], nodeId);
    if (node) return node.title;
  }
  return nodeId;
}

/** Configured accent color for a lens node, if any. */
export function lensNodeColor(toc: BookToc, nodeId: PageLayer): string | undefined {
  if (!toc.lenses) return undefined;
  for (const axis of lensAxisIds(toc)) {
    const node = findLensNode(toc.lenses[axis] ?? [], nodeId);
    if (node?.color) return node.color;
  }
  return undefined;
}

/** leaf/option id → configured color (only nodes that declare `color`). */
export function lensColorMap(toc: BookToc): Record<string, string> {
  const map: Record<string, string> = {};
  if (!toc.lenses) return map;
  for (const axis of lensAxisIds(toc)) {
    walkLensNodes(toc.lenses[axis] ?? [], (n) => {
      if (n.color) map[n.id] = n.color;
    });
  }
  return map;
}

export interface LensLegendItem {
  id: PageLayer;
  title: string;
  color?: string;
}

/** Effective selected leaves for the legend (multi-select hint). */
export function selectionLegendLeaves(
  toc: BookToc,
  selection: LensSelection | null,
): LensLegendItem[] {
  if (!selection || !toc.lenses) return [];
  const out: LensLegendItem[] = [];
  const seen = new Set<PageLayer>();
  for (const axis of lensAxisIds(toc)) {
    const leaves = effectiveAxisLeaves(toc, axis, normalizeAxisSelection(selection[axis]));
    for (const id of leaves) {
      if (seen.has(id)) continue;
      seen.add(id);
      const color = lensNodeColor(toc, id);
      out.push({ id, title: lensNodeTitle(toc, id), ...(color ? { color } : {}) });
    }
  }
  return out;
}

/**
 * Visual cluster role for step-grouped sections.
 * Titled sections open a cluster; untitled sections nest under the previous block.
 */
export function sectionClusterRole(
  section: { title: string },
  index: number,
): 'start' | 'child' | null {
  if (index <= 0) return null;
  if (section.title) return 'start';
  return 'child';
}

export function filterChapters(
  chapters: TocChapter[],
  selection: LensSelection | null,
  toc?: BookToc | null,
): TocChapter[] {
  if (!selection) return chapters;
  return chapters.filter((c) => pageVisibleInSelection(c, selection, toc));
}

/** True when the chapter has at least one titled section under「仅有内容」rules. */
export function chapterHasVisibleLensSections(
  chapter: TocChapter,
  selection: LensSelection | null,
  toc?: BookToc | null,
  readerShowLevel?: ReaderShowLevel,
): boolean {
  return visibleTocSections(chapter, selection, toc, readerShowLevel, true).length > 0;
}

/**
 * Like `filterChapters`, then drop pages with no titled sections for the selection
 * (section allowlist + showLevel). Use when「仅有内容」mode is on.
 * Untagged pages (no `layers`) are treated as empty under an active selection.
 */
export function filterChaptersWithContent(
  chapters: TocChapter[],
  selection: LensSelection | null,
  toc?: BookToc | null,
  readerShowLevel?: ReaderShowLevel,
): TocChapter[] {
  return filterChapters(chapters, selection, toc).filter((c) =>
    chapterHasVisibleLensSections(c, selection, toc, readerShowLevel),
  );
}

/** Inverse of `filterChaptersWithContent` — pages visible in lens but without content. */
export function filterChaptersWithoutContent(
  chapters: TocChapter[],
  selection: LensSelection | null,
  toc?: BookToc | null,
  readerShowLevel?: ReaderShowLevel,
): TocChapter[] {
  return filterChapters(chapters, selection, toc).filter(
    (c) => !chapterHasVisibleLensSections(c, selection, toc, readerShowLevel),
  );
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

/**
 * When a directory's filtered children are a single page (no nested groups in
 * the original node), show only the directory: one page row with the group title.
 * Parent folders that only hold groups stay as groups.
 */
export function collapseSingletonGroups(nodes: TocTreeNode[]): TocTreeNode[] {
  const out: TocTreeNode[] = [];
  for (const node of nodes) {
    if (node.type === 'page') {
      out.push(node);
      continue;
    }
    const hadNestedGroup = node.children.some((c) => c.type === 'group');
    const children = collapseSingletonGroups(node.children);
    if (!hadNestedGroup && children.length === 1 && children[0].type === 'page') {
      const page = children[0];
      out.push({
        type: 'page',
        id: page.id,
        title: node.title,
        file: page.file,
      });
      continue;
    }
    out.push({ ...node, children });
  }
  return out;
}

function tocBaseTree(toc: BookToc): TocTreeNode[] {
  if (toc.tree?.length) return toc.tree;
  return toc.chapters.map(
    (c): TocTreeNode => ({
      type: 'page',
      id: c.id,
      title: c.title,
      file: c.file,
    }),
  );
}

/**
 * Stable TOC outline numbers for the sidebar.
 * Non-ruler: full book tree (lens filter must not renumber).
 * Ruler: module-index-only tree + singleton collapse — matches the sidebar shape
 * (hang-offs never appear), so「质量主据」wrapper → `3.1` not `3.1.1`.
 */
export function tocSidebarOutlineNumbers(toc: BookToc): Map<string, string> {
  const base = tocBaseTree(toc);
  if (!toc.ruler) return tocTreeOutlineNumbers(base);
  return tocTreeOutlineNumbers(
    collapseSingletonGroups(filterTree(base, leafModuleIndexIds(toc))),
  );
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

function queryHasAxisKey(query: LensQueryInput, axis: string): boolean {
  if (query instanceof URLSearchParams) return query.has(axis);
  return Object.prototype.hasOwnProperty.call(query, axis);
}

/**
 * Read lens selection from URL query (axis → node id list).
 * Present empty values (`axis=`) become `axis: []`; missing keys are omitted.
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
    if (!queryHasAxisKey(query, axis)) continue;
    found = true;
    const raw = queryValues(query, axis);
    const allowed = allowedAxisSelectionIds(toc, axis);
    const pick = raw.filter((id) => allowed.has(id));
    out[axis] = pick;
  }
  return found ? out : null;
}

/**
 * Serialize selection to query params (array values → repeated keys).
 * Empty axes are written as `axis=` so missing keys stay distinct from `[]`.
 */
export function lensQueryFromSelection(
  selection: LensSelection | null,
  toc: BookToc,
): Record<string, string | string[]> {
  if (!selection || !hasLenses(toc)) return {};
  const out: Record<string, string | string[]> = {};
  for (const axis of lensAxisIds(toc)) {
    if (!Object.prototype.hasOwnProperty.call(selection, axis)) continue;
    const list = normalizeAxisSelection(selection[axis]);
    if (list.length === 0) {
      out[axis] = '';
      continue;
    }
    out[axis] = list.length === 1 ? list[0] : [...list];
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
 * After changing lens selection, keep the current chapter whenever it still
 * exists in the book. Lens changes must not auto-jump to the first visible page
 * (that felt like “snap back to 第一章” when unchecking a lens).
 */
export function resolveLensSwitchChapter(
  toc: BookToc,
  currentId: string,
  _nextSelection: LensSelection,
  _prevSelection?: LensSelection | null,
): string {
  if (toc.chapters.some((c) => c.id === currentId)) return currentId;
  const visible = filterChapters(toc.chapters, _nextSelection, toc);
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

/** TOC sections visible under the current lens selection (untitled sections omitted).
 * When `explicitOnly`, untagged pages (no `layers`) yield no sections and allowlists
 * count hung-only — used by「仅有内容」/「仅无内容」.
 */
export function visibleTocSections(
  chapter: TocChapter,
  selection: LensSelection | null,
  toc?: BookToc | null,
  readerShowLevel?: ReaderShowLevel,
  explicitOnly?: boolean,
): TocSection[] {
  if (explicitOnly && selection) {
    const active = toc
      ? selectionToFlatIds(toc, selection).length > 0
      : Object.keys(selection).length > 0;
    if (active) {
      if (!chapter.layers) return [];
      if (!pageVisibleInSelection(chapter, selection, toc)) return [];
    }
  }
  return filterSectionsByShowLevel(
    filterSectionsByAllowlist(
      chapter.sections,
      sectionAllowlistFor(chapter, selection, toc, explicitOnly ? 'hungOnly' : 'display'),
    ),
    chapter,
    readerShowLevel,
  ).filter((s) => s.title.length > 0);
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
  /** Full ancestor path outer → inner (all group names). */
  groupPath: string[];
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
      out.push({ groupKey, groupPath: path, groupTitle, pages: [ch] });
    }
  }
  return out;
}

/**
 * Digest display level for a section.
 * With ancestor groups: demote by path depth (## under one group → level 3).
 * Without groups: keep markdown heading level.
 */
export function digestSectionDisplayLevel(
  groupPathLen: number,
  sectionLevel: number,
): number {
  if (groupPathLen <= 0) return sectionLevel;
  return groupPathLen + sectionLevel;
}

/** Module / page title level under a group path (pathLen+1, or 1 if ungrouped). */
export function digestPageDisplayLevel(groupPathLen: number): number {
  return groupPathLen + 1;
}

/** Digest outline entries in reading order. */
export interface DigestOutlineEntry {
  chapterId: string;
  chapterTitle: string;
  groupTitle: string | null;
  groupPath: string[];
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
          groupPath: g.groupPath,
          sectionId: s.id,
          sectionTitle: s.title,
          level: digestSectionDisplayLevel(g.groupPath.length, s.level),
        });
      }
    }
  }
  return out;
}

export function digestAnchorId(chapterId: string, sectionId: string): string {
  return `digest-${chapterId}--${sectionId}`;
}

/**
 * Stable DOM / outline id for a TOC group path key (`外层/内层`).
 * Must stay unique for non-ASCII titles — a bare `\w` strip would collapse
 * all Chinese paths to the same id and break outline numbering (1, 2, …).
 */
export function digestPathAnchorId(pathKey: string): string {
  const safe = encodeURIComponent(pathKey).replace(/%/g, '');
  return `digest-path-${safe || '_'}`;
}
