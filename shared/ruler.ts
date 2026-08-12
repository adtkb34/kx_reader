import {
  filterChapters,
  leavesUnder,
  lensNodeTitle,
  pageVisibleInSelection,
  sectionAllowlistFor,
  sectionLensLeaves,
  sectionPassesShowLevel,
  effectiveShowLevel,
  type ReaderShowLevel,
} from './lenses';
import type {
  BookRuler,
  BookToc,
  LensAxisId,
  LensSelection,
  PageLayer,
  RulerPick,
  TocChapter,
  TocSection,
  TocTreeNode,
} from './types';

export interface RulerSectionRef {
  chapterId: string;
  sectionId: string;
  title: string;
  level: number;
}

export interface RulerDimensionGroup {
  /** Lens leaf on an axis ruler; null when index pick (flat hang-offs). */
  leaf: PageLayer | null;
  leafTitle: string;
  blocks: RulerSectionRef[];
}

export interface RulerKeyBlock {
  chapterId: string;
  sectionId: string;
  title: string;
  level: number;
  /**
   * Key section plus following body sections until the next key
   * (e.g. step heading + trailing body until next key).
   */
  bodySectionIds: string[];
  groups: RulerDimensionGroup[];
}

/** Sections on a keys page that appear before the first ruler key (e.g. flowchart). */
export interface RulerPreamble {
  chapterId: string;
  sectionIds: string[];
}

/** One leaf-directory module (pages only; no nested groups). */
export interface LeafModule {
  /** Leaf group id, or page id when top-level page. */
  id: string;
  title: string;
  /** Ancestor group titles outer → inner (excludes this leaf title). */
  groupPath: string[];
  /** Index / skeleton chapter id used for routing. */
  indexChapterId: string;
  /** All chapter ids in the module (index + dimension pages). */
  chapterIds: string[];
}

export interface RulerAssembleBucket {
  leaf: PageLayer | null;
  leafTitle: string;
  keys: RulerKeyBlock[];
}

export interface RulerAssembleView {
  preamble: RulerPreamble[];
  buckets: RulerAssembleBucket[];
}

function sectionIndex(
  chapters: TocChapter[],
): Map<string, { chapter: TocChapter; section: TocSection }> {
  const map = new Map<string, { chapter: TocChapter; section: TocSection }>();
  for (const ch of chapters) {
    for (const s of ch.sections) {
      if (!map.has(s.id)) map.set(s.id, { chapter: ch, section: s });
    }
  }
  return map;
}

function visibleSectionIds(
  chapters: TocChapter[],
  selection: LensSelection | null,
  toc: BookToc,
  readerShowLevel?: ReaderShowLevel,
): Set<string> {
  const out = new Set<string>();
  for (const ch of chapters) {
    const allow = sectionAllowlistFor(ch, selection, toc);
    const list = allow
      ? ch.sections.filter((s) => allow.includes(s.id))
      : ch.sections;
    const level = effectiveShowLevel(ch, readerShowLevel);
    for (const s of list) {
      if (!sectionPassesShowLevel(s, level)) continue;
      out.add(s.id);
    }
  }
  return out;
}

function layersAsList(raw: PageLayer | PageLayer[] | undefined): PageLayer[] {
  if (raw == null) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function leavesUnderAxis(toc: BookToc, axis: LensAxisId): PageLayer[] {
  const opts = toc.lenses?.[axis] ?? [];
  const out: PageLayer[] = [];
  for (const node of opts) {
    out.push(...leavesUnder(opts, node.id));
  }
  const seen = new Set<PageLayer>();
  return out.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Leaf option ids under a ruler axis, declaration order. */
export function rulerAxisLeaves(toc: BookToc, axis: LensAxisId): PageLayer[] {
  return leavesUnderAxis(toc, axis);
}

/** True when any page in the leaf module belongs to `leaf` on `axis`. */
export function moduleMatchesRulerLeaf(
  toc: BookToc,
  moduleIndexId: string,
  axis: LensAxisId,
  leaf: PageLayer,
): boolean {
  const mod = findLeafModule(toc, moduleIndexId);
  const chapterIds = mod?.chapterIds ?? [moduleIndexId];
  for (const cid of chapterIds) {
    const ch = toc.chapters.find((c) => c.id === cid);
    if (!ch) continue;
    if (ch.sections.length === 0) {
      if (layersAsList(ch.layers?.[axis]).includes(leaf)) return true;
      continue;
    }
    if (ch.sections.some((s) => sectionAxisLeaves(toc, axis, ch, s.id).includes(leaf))) {
      return true;
    }
  }
  return false;
}

/** Leaves whose raw (unexpanded) allowlist lists `sectionId` on any axis. */
export function sectionRawLensLeaves(
  chapter: TocChapter,
  sectionId: string,
  toc?: BookToc | null,
): PageLayer[] {
  if (!chapter.sectionAllowlists) return [];
  const found = new Set<PageLayer>();
  for (const byLeaf of Object.values(chapter.sectionAllowlists)) {
    if (!byLeaf) continue;
    for (const [leaf, list] of Object.entries(byLeaf)) {
      if (list?.includes(sectionId)) found.add(leaf);
    }
  }
  if (found.size === 0) return [];
  if (!toc?.lenses) return [...found];
  return sectionLensLeaves(chapter, sectionId, toc).filter((id) => found.has(id));
}

/** Leaves on `axis` that this section belongs to (page layers or allowlists). */
export function sectionAxisLeaves(
  toc: BookToc,
  axis: LensAxisId,
  chapter: TocChapter,
  sectionId: string,
): PageLayer[] {
  const axisLeaves = new Set(leavesUnderAxis(toc, axis));
  if (axisLeaves.size === 0) return [];

  const raw = sectionRawLensLeaves(chapter, sectionId, toc).filter((id) =>
    axisLeaves.has(id),
  );
  if (raw.length > 0) return raw;

  const pageLeaves = layersAsList(chapter.layers?.[axis]).filter((id) =>
    axisLeaves.has(id),
  );
  if (pageLeaves.length > 0) {
    const allow = chapter.sectionAllowlists?.[axis];
    if (!allow) return pageLeaves;
    // Page tagged for leaf but section not in that leaf's allowlist → not included
    // unless the leaf has no allowlist entry (whole page).
    const matched: PageLayer[] = [];
    for (const leaf of pageLeaves) {
      const list = allow[leaf];
      if (!list || list.includes(sectionId)) matched.push(leaf);
    }
    if (matched.length > 0) return matched;
  }

  return sectionLensLeaves(chapter, sectionId, toc).filter((id) => axisLeaves.has(id));
}

function isRulerSkeletonChapter(ch: TocChapter, keyIds: Set<string>): boolean {
  if (ch.role === 'ruler') return true;
  if (ch.role === 'page') return false;
  const bare = !ch.layers || Object.keys(ch.layers).length === 0;
  return bare && ch.sections.some((s) => keyIds.has(s.id));
}

function tocTree(toc: BookToc): TocTreeNode[] {
  return toc.tree?.length > 0
    ? toc.tree
    : toc.chapters.map(
        (c): TocTreeNode => ({
          type: 'page',
          id: c.id,
          title: c.title,
          file: c.file,
        }),
      );
}

/**
 * Key heading + following sections until the next ruler key (or next titled
 * sibling at the same/higher level, or a section that is itself a hang-off target).
 */
export function keyBodySectionIds(
  chapter: TocChapter,
  keyId: string,
  allKeyIds: Set<string>,
  hangOffIds: Set<string> = new Set(),
): string[] {
  const sections = chapter.sections;
  const start = sections.findIndex((s) => s.id === keyId);
  if (start < 0) return [keyId];
  const out = [keyId];
  const keyLevel = sections[start]!.level;
  for (let i = start + 1; i < sections.length; i++) {
    const s = sections[i]!;
    if (allKeyIds.has(s.id)) break;
    if (hangOffIds.has(s.id)) break;
    if (s.title && s.level <= keyLevel) break;
    out.push(s.id);
  }
  return out;
}

/** Dropdown options: always `index`, then `ruler.axes`. */
export function bookRulerPicks(toc: BookToc): RulerPick[] {
  if (!toc.ruler) return [];
  return ['index', ...(toc.ruler.axes ?? [])];
}

export function normalizeRulerPick(toc: BookToc, pick: string | null | undefined): RulerPick {
  const allowed = bookRulerPicks(toc);
  if (pick && allowed.includes(pick as RulerPick)) return pick as RulerPick;
  return 'index';
}

/** Leaf modules in DFS order (page-only directories + top-level pages). */
export function listLeafModules(toc: BookToc): LeafModule[] {
  const chapterById = new Map(toc.chapters.map((c) => [c.id, c]));
  const keyIds = new Set(Object.keys(toc.ruler?.links ?? {}));
  const out: LeafModule[] = [];

  function pickIndex(pageIds: string[]): string | null {
    const chapters = pageIds
      .map((id) => chapterById.get(id))
      .filter((c): c is TocChapter => !!c);
    if (chapters.length === 0) return null;
    const index = chapters.find((c) => isRulerSkeletonChapter(c, keyIds));
    return index?.id ?? chapters[0]!.id;
  }

  function walk(nodes: TocTreeNode[], ancestors: string[]): void {
    for (const node of nodes) {
      if (node.type === 'page') {
        out.push({
          id: node.id,
          title: node.title,
          groupPath: [...ancestors],
          indexChapterId: node.id,
          chapterIds: [node.id],
        });
        continue;
      }
      if (node.children.some((c) => c.type === 'group')) {
        walk(node.children, [...ancestors, node.title]);
        continue;
      }
      const pageIds = node.children.filter((c) => c.type === 'page').map((c) => c.id);
      const indexId = pickIndex(pageIds);
      if (!indexId) continue;
      out.push({
        id: node.id,
        title: node.title,
        groupPath: [...ancestors],
        indexChapterId: indexId,
        chapterIds: pageIds,
      });
    }
  }

  walk(tocTree(toc), []);
  return out;
}

export function findLeafModule(
  toc: BookToc,
  chapterId: string,
): LeafModule | undefined {
  return listLeafModules(toc).find((m) => m.chapterIds.includes(chapterId));
}

/**
 * Sidebar: one page per leaf module — always the index / skeleton chapter.
 */
export function rulerSidebarKeepIds(
  toc: BookToc,
  selection: LensSelection | null,
): Set<string> {
  const keep = new Set<string>();
  if (!toc.ruler) return keep;
  for (const mod of listLeafModules(toc)) {
    const index = toc.chapters.find((c) => c.id === mod.indexChapterId);
    if (!index) continue;
    // Module visible if index or any sibling page is visible under lenses.
    const anyVisible = mod.chapterIds.some((id) => {
      const ch = toc.chapters.find((c) => c.id === id);
      return ch && pageVisibleInSelection(ch, selection, toc);
    });
    if (anyVisible) keep.add(mod.indexChapterId);
  }
  return keep;
}

export function findRulerSkeletonChapter(toc: BookToc): TocChapter | undefined {
  if (!toc.ruler) return undefined;
  const keyIds = new Set(Object.keys(toc.ruler.links));
  return toc.chapters.find((c) => isRulerSkeletonChapter(c, keyIds));
}

/**
 * Ruler index page for the module that contains `chapterId`.
 */
export function findRulerModuleIndexId(
  toc: BookToc,
  chapterId: string,
): string | undefined {
  if (!toc.ruler) return undefined;
  return findLeafModule(toc, chapterId)?.indexChapterId;
}

/** After lens change: stay on module index when possible. */
export function resolveRulerLensSwitchChapter(
  toc: BookToc,
  currentId: string,
  nextSelection: LensSelection,
): string {
  if (!toc.ruler) {
    const visible = filterChapters(toc.chapters, nextSelection, toc);
    if (visible.some((c) => c.id === currentId)) return currentId;
    return visible[0]?.id ?? currentId;
  }
  const keep = rulerSidebarKeepIds(toc, nextSelection);
  const mod = findLeafModule(toc, currentId);
  if (mod && keep.has(mod.indexChapterId)) return mod.indexChapterId;
  if (keep.has(currentId)) return currentId;
  const first = [...keep][0];
  if (first) return first;
  const visible = filterChapters(toc.chapters, nextSelection, toc);
  return visible[0]?.id ?? currentId;
}

function resolveKeyIds(
  toc: BookToc,
  ruler: BookRuler,
  focusChapterId: string | null | undefined,
): string[] {
  // Skeleton keys = titled sections on the module index (in document order).
  // `ruler.links` only attaches hang-offs; missing link entries must not drop keys.
  const indexId =
    focusChapterId ??
    findRulerSkeletonChapter(toc)?.id ??
    toc.chapters.find((c) => c.role === 'ruler')?.id;
  if (!indexId) return [];
  const ch = toc.chapters.find((c) => c.id === indexId);
  if (!ch) return [];
  const fromIndex = ch.sections.filter((s) => s.title).map((s) => s.id);
  if (fromIndex.length > 0) return fromIndex;

  // Fallback: link keys only (legacy / empty index).
  const linkKeys = Object.keys(ruler.links);
  const keyOrder: string[] = [];
  const seenKeys = new Set<string>();
  for (const id of linkKeys) {
    if (seenKeys.has(id)) continue;
    seenKeys.add(id);
    keyOrder.push(id);
  }
  return keyOrder;
}

/** Topbar hang-data filter for ruler ticks (`all` = 不隐藏). */
export type RulerTickHangFilter = 'all' | 'content' | 'empty';

/** Titled skeleton section ids on the module index (ruler ticks), document order. */
export function listRulerTicks(toc: BookToc, moduleIndexId: string): string[] {
  if (!toc.ruler) return [];
  return resolveKeyIds(toc, toc.ruler, moduleIndexId);
}

/**
 * True when `keyId` has at least one hang-off section visible under the current lens.
 */
export function rulerTickHasHang(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel: ReaderShowLevel | undefined,
  keyId: string,
): boolean {
  const ruler = toc.ruler;
  if (!ruler) return false;
  const linked = ruler.links[keyId] ?? [];
  if (linked.length === 0) return false;
  const chapters = filterChapters(toc.chapters, selection, toc);
  const visible = visibleSectionIds(chapters, selection, toc, readerShowLevel);
  return linked.some((sid) => visible.has(sid));
}

/** Module has ≥1 tick with visible hang-off data. */
export function moduleHasHungTicks(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel: ReaderShowLevel | undefined,
  moduleIndexId: string,
): boolean {
  return listRulerTicks(toc, moduleIndexId).some((id) =>
    rulerTickHasHang(toc, selection, readerShowLevel, id),
  );
}

/** Module has ≥1 tick with no visible hang-off data. */
export function moduleHasEmptyTicks(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel: ReaderShowLevel | undefined,
  moduleIndexId: string,
): boolean {
  const ticks = listRulerTicks(toc, moduleIndexId);
  if (ticks.length === 0) return false;
  return ticks.some((id) => !rulerTickHasHang(toc, selection, readerShowLevel, id));
}

/** Drop key blocks that do not match the hang-data filter. */
export function filterRulerKeyBlocks(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel: ReaderShowLevel | undefined,
  keys: RulerKeyBlock[],
  mode: RulerTickHangFilter,
): RulerKeyBlock[] {
  if (mode === 'all') return keys;
  return keys.filter((k) => {
    const has = rulerTickHasHang(toc, selection, readerShowLevel, k.sectionId);
    return mode === 'content' ? has : !has;
  });
}

/** Filter assemble buckets by hang-data mode; drop empty axis leaf buckets. */
export function filterRulerAssembleView(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel: ReaderShowLevel | undefined,
  view: RulerAssembleView,
  mode: RulerTickHangFilter,
): RulerAssembleView {
  if (mode === 'all') return view;
  const buckets = view.buckets
    .map((b) => ({
      ...b,
      keys: filterRulerKeyBlocks(toc, selection, readerShowLevel, b.keys, mode),
    }))
    .filter((b) => b.keys.length > 0 || b.leaf == null);
  return { preamble: view.preamble, buckets };
}

/** Filter outline rows by hang-data mode; drop empty axis bucket headers. */
export function filterRulerOutlineEntries(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel: ReaderShowLevel | undefined,
  entries: RulerOutlineEntry[],
  mode: RulerTickHangFilter,
): RulerOutlineEntry[] {
  if (mode === 'all') return entries;
  const out: RulerOutlineEntry[] = [];
  let keepKey = true;
  let bucketStart = -1;
  let bucketHasKey = false;

  function flushBucket(): void {
    if (bucketStart < 0) return;
    if (!bucketHasKey) {
      // Drop synthetic bucket header and anything until here was already keyed…
      // Header is at bucketStart; remove it from out if no keys followed.
      out.splice(bucketStart, 1);
    }
    bucketStart = -1;
    bucketHasKey = false;
  }

  for (const e of entries) {
    if (e.anchorId?.startsWith('ruler-bucket-')) {
      flushBucket();
      bucketStart = out.length;
      bucketHasKey = false;
      out.push(e);
      continue;
    }
    if (e.isKey) {
      const has = rulerTickHasHang(toc, selection, readerShowLevel, e.sectionId);
      keepKey = mode === 'content' ? has : !has;
      if (keepKey) {
        out.push(e);
        if (bucketStart >= 0) bucketHasKey = true;
      }
      continue;
    }
    if (keepKey) out.push(e);
  }
  flushBucket();
  return out;
}

/**
 * Index chapter ids to keep under ruler hang-data TOC filter.
 * `content` → modules with hung ticks; `empty` → modules with empty ticks.
 */
export function filterRulerModuleIndexIds(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel: ReaderShowLevel | undefined,
  mode: 'content' | 'empty',
): Set<string> {
  const out = new Set<string>();
  if (!toc.ruler) return out;
  for (const mod of listLeafModules(toc)) {
    const ok =
      mode === 'content'
        ? moduleHasHungTicks(toc, selection, readerShowLevel, mod.indexChapterId)
        : moduleHasEmptyTicks(toc, selection, readerShowLevel, mod.indexChapterId);
    if (ok) out.add(mod.indexChapterId);
  }
  return out;
}

function buildKeyBlocks(
  toc: BookToc,
  ruler: BookRuler,
  selection: LensSelection | null,
  readerShowLevel: ReaderShowLevel | undefined,
  focusChapterId: string | null | undefined,
  axisFilter: LensAxisId | null,
  onlyLeaf: PageLayer | null,
): RulerKeyBlock[] {
  const chapters = filterChapters(toc.chapters, selection, toc);
  const visible = visibleSectionIds(chapters, selection, toc, readerShowLevel);
  const index = sectionIndex(toc.chapters);
  const chapterById = new Map(toc.chapters.map((c) => [c.id, c]));
  const keyOrder = resolveKeyIds(toc, ruler, focusChapterId);
  const allKeyIds = new Set(keyOrder);
  const hangOffIds = new Set(Object.values(ruler.links).flat());
  const out: RulerKeyBlock[] = [];

  for (const keyId of keyOrder) {
    if (!visible.has(keyId)) continue;
    const hit = index.get(keyId);
    if (!hit) continue;
    if (focusChapterId && hit.chapter.id !== focusChapterId) continue;

    const linkedIds = ruler.links[keyId] ?? [];
    const linked: RulerSectionRef[] = [];
    for (const sid of linkedIds) {
      if (!visible.has(sid)) continue;
      const target = index.get(sid);
      if (!target) continue;
      if (axisFilter && onlyLeaf) {
        const leaves = sectionAxisLeaves(toc, axisFilter, target.chapter, sid);
        if (!leaves.includes(onlyLeaf)) continue;
      }
      linked.push({
        chapterId: target.chapter.id,
        sectionId: sid,
        title: target.section.title,
        level: target.section.level,
      });
    }

    // Axis buckets: index shells always stay; hang-offs already filtered above.
    out.push({
      chapterId: hit.chapter.id,
      sectionId: keyId,
      title: hit.section.title,
      level: hit.section.level,
      bodySectionIds: keyBodySectionIds(hit.chapter, keyId, allKeyIds, hangOffIds).filter(
        (id) => visible.has(id),
      ),
      groups: [
        {
          leaf: onlyLeaf,
          leafTitle: onlyLeaf ? lensNodeTitle(toc, onlyLeaf) : '',
          blocks: linked,
        },
      ],
    });
  }
  return out;
}

export function buildRulerPreamble(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel?: ReaderShowLevel,
  focusChapterId?: string | null,
): RulerPreamble[] {
  const ruler = toc.ruler;
  if (!ruler) return [];
  const visibleChapters = filterChapters(toc.chapters, selection, toc);
  const visible = visibleSectionIds(visibleChapters, selection, toc, readerShowLevel);
  const keyIds = new Set(resolveKeyIds(toc, ruler, focusChapterId));
  const hangOffIds = new Set(Object.values(ruler.links).flat());
  const out: RulerPreamble[] = [];
  const seenChapter = new Set<string>();

  for (const ch of toc.chapters) {
    if (focusChapterId && ch.id !== focusChapterId) continue;
    const firstKeyIdx = ch.sections.findIndex((s) => keyIds.has(s.id) && visible.has(s.id));
    if (firstKeyIdx < 0) continue;
    seenChapter.add(ch.id);
    if (firstKeyIdx === 0) continue;
    const ids = ch.sections
      .slice(0, firstKeyIdx)
      .map((s) => s.id)
      .filter((id) => visible.has(id));
    if (ids.length === 0) continue;
    out.push({ chapterId: ch.id, sectionIds: ids });
  }

  // Always-visible pages in the same module only (when focused).
  const moduleIds = focusChapterId
    ? new Set(findLeafModule(toc, focusChapterId)?.chapterIds ?? [focusChapterId])
    : null;

  for (const ch of visibleChapters) {
    if (moduleIds && !moduleIds.has(ch.id)) continue;
    if (seenChapter.has(ch.id)) continue;
    if (ch.layers && Object.keys(ch.layers).length > 0) continue;
    const ids = ch.sections
      .map((s) => s.id)
      .filter((id) => visible.has(id) && !hangOffIds.has(id) && !keyIds.has(id));
    if (ids.length === 0) continue;
    seenChapter.add(ch.id);
    out.push({ chapterId: ch.id, sectionIds: ids });
  }
  return out;
}

/**
 * Assemble a module view under the current ruler pick.
 * Returns null when the book has no ruler config.
 */
export function assembleModuleView(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel: ReaderShowLevel | undefined,
  focusChapterId: string | null | undefined,
  rulerPick: RulerPick = 'index',
): RulerAssembleView | null {
  const ruler = toc.ruler;
  if (!ruler) return null;
  const pick = normalizeRulerPick(toc, rulerPick);
  const preamble = buildRulerPreamble(toc, selection, readerShowLevel, focusChapterId);

  if (pick === 'index') {
    const keys = buildKeyBlocks(
      toc,
      ruler,
      selection,
      readerShowLevel,
      focusChapterId,
      null,
      null,
    );
    return {
      preamble,
      buckets: [{ leaf: null, leafTitle: '', keys }],
    };
  }

  const leaves = leavesUnderAxis(toc, pick);
  const buckets: RulerAssembleBucket[] = [];
  for (const leaf of leaves) {
    const keys = buildKeyBlocks(
      toc,
      ruler,
      selection,
      readerShowLevel,
      focusChapterId,
      pick,
      leaf,
    );
    if (keys.length === 0) continue;
    buckets.push({
      leaf,
      leafTitle: lensNodeTitle(toc, leaf),
      keys,
    });
  }
  return { preamble, buckets };
}

/** @deprecated Prefer assembleModuleView; kept for outline helpers. */
export function buildRulerTree(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel?: ReaderShowLevel,
  focusChapterId?: string | null,
  rulerPick: RulerPick = 'index',
): RulerKeyBlock[] | null {
  const view = assembleModuleView(
    toc,
    selection,
    readerShowLevel,
    focusChapterId,
    rulerPick,
  );
  if (!view) return null;
  return view.buckets.flatMap((b) => b.keys);
}

export function rulerAnchorId(chapterId: string, sectionId: string): string {
  return `ruler-${chapterId}--${sectionId}`;
}

export function axisBucketAnchorId(leaf: PageLayer): string {
  return `ruler-bucket-${leaf}`;
}

export interface RulerOutlineEntry {
  chapterId: string;
  sectionId: string;
  title: string;
  level: number;
  /** True for ruler key rows; false for linked blocks / bucket headers. */
  isKey: boolean;
  leafTitle?: string;
  /** Synthetic outline id for axis bucket headers. */
  anchorId?: string;
}

export function rulerOutlineEntries(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel?: ReaderShowLevel,
  focusChapterId?: string | null,
  rulerPick: RulerPick = 'index',
): RulerOutlineEntry[] {
  const view = assembleModuleView(
    toc,
    selection,
    readerShowLevel,
    focusChapterId,
    rulerPick,
  );
  if (!view) return [];
  const out: RulerOutlineEntry[] = [];
  const multiBucket = view.buckets.length > 1 || !!view.buckets[0]?.leaf;

  for (const bucket of view.buckets) {
    const underAxis = multiBucket && !!bucket.leaf;
    if (underAxis && bucket.leaf) {
      out.push({
        chapterId: focusChapterId ?? bucket.keys[0]?.chapterId ?? '',
        sectionId: bucket.leaf,
        title: bucket.leafTitle,
        /** Level 1 so leaf is编号根；其下第一节应为 1.1（两位）. */
        level: 1,
        isKey: true,
        leafTitle: bucket.leafTitle,
        anchorId: axisBucketAnchorId(bucket.leaf),
      });
    }
    const titledKeys = bucket.keys.filter((k) => k.title);
    const minKeyLevel = titledKeys.length
      ? Math.min(...titledKeys.map((k) => k.level))
      : 2;
    for (const key of bucket.keys) {
      if (!key.title) continue;
      // Under axis: map markdown depth onto 2+ so ## keys become 1.1, not 1.1.1.
      const keyLevel = underAxis ? 2 + Math.max(0, key.level - minKeyLevel) : key.level;
      out.push({
        chapterId: key.chapterId,
        sectionId: key.sectionId,
        title: key.title,
        level: keyLevel,
        isKey: true,
      });
      for (const g of key.groups) {
        if (!g.blocks.length) continue;
        const labeled = g.blocks.filter((b) => b.title);
        for (const b of labeled) {
          const hangLevel = underAxis
            ? keyLevel + Math.max(1, b.level - key.level)
            : Math.max(b.level, key.level + 1);
          out.push({
            chapterId: b.chapterId,
            sectionId: b.sectionId,
            title: b.title,
            level: hangLevel,
            isKey: false,
            ...(g.leafTitle ? { leafTitle: g.leafTitle } : {}),
          });
        }
      }
    }
  }
  return out;
}

/** Reverse map: hang-off section/row id → ruler key section ids that link to it. */
export function hangIdToKeyIds(ruler: BookRuler): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [keyId, hangIds] of Object.entries(ruler.links)) {
    for (const hid of hangIds) {
      const list = out.get(hid);
      if (list) {
        if (!list.includes(keyId)) list.push(keyId);
      } else {
        out.set(hid, [keyId]);
      }
    }
  }
  return out;
}

/** Section id → outline title from TOC (first wins). */
export function sectionTitleById(toc: BookToc): Map<string, string> {
  const out = new Map<string, string>();
  for (const ch of toc.chapters) {
    for (const s of ch.sections) {
      if (!out.has(s.id) && s.title) out.set(s.id, s.title);
    }
  }
  return out;
}

/**
 * Hang-off id → display label for the auto「尺子」column
 * (key section titles joined with 、 when linked from multiple keys).
 */
export function hangIdToKeyTitles(toc: BookToc): Map<string, string> {
  const ruler = toc.ruler;
  const out = new Map<string, string>();
  if (!ruler) return out;
  const titles = sectionTitleById(toc);
  for (const [hangId, keyIds] of hangIdToKeyIds(ruler)) {
    const label = keyIds
      .map((id) => titles.get(id) ?? id)
      .filter(Boolean)
      .join('、');
    if (label) out.set(hangId, label);
  }
  return out;
}
