import {
  filterChapters,
  leavesUnder,
  lensNodeTitle,
  pageVisibleInSelection,
  sectionAllowlistFor,
  sectionLensLeaves,
  sectionPassesShowLevel,
  effectiveShowLevel,
  effectiveAxisLeaves,
  normalizeAxisSelection,
  type ReaderShowLevel,
} from './lenses';
import type {
  BookRuler,
  BookToc,
  LensSelection,
  PageLayer,
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
  /** Lens leaf on the ruler axis; null when unknown. */
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
   * (e.g. step heading `460` + flow table `440`).
   */
  bodySectionIds: string[];
  groups: RulerDimensionGroup[];
}

/** Sections on a keys page that appear before the first ruler key (e.g. flowchart). */
export interface RulerPreamble {
  chapterId: string;
  sectionIds: string[];
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

/** Sections that may appear as ruler keys (under `ruler.keys` leaf when set). */
export function rulerKeyEligibleIds(toc: BookToc, ruler: BookRuler): Set<string> {
  const out = new Set<string>();
  const axis = ruler.axis;
  const keyLeaves =
    ruler.keys && toc.lenses?.[axis]
      ? leavesUnder(toc.lenses[axis] ?? [], ruler.keys)
      : null;

  for (const ch of toc.chapters) {
    if (!keyLeaves) {
      for (const s of ch.sections) out.add(s.id);
      continue;
    }
    const axisAllows = ch.sectionAllowlists?.[axis];
    if (!axisAllows) {
      for (const s of ch.sections) out.add(s.id);
      continue;
    }
    for (const leaf of keyLeaves) {
      const list = axisAllows[leaf];
      if (!list) {
        for (const s of ch.sections) out.add(s.id);
        continue;
      }
      // Raw allowlist only — do not expand shared parents (e.g. page h2)
      // into every child, or non-key sections become keys.
      for (const id of list) out.add(id);
    }
  }
  return out;
}

/** Leaves whose raw (unexpanded) allowlist lists `sectionId`. */
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

/** Primary leaf on the ruler axis for a section (prefer raw allowlist membership). */
export function sectionRulerLeaf(
  toc: BookToc,
  ruler: BookRuler,
  chapter: TocChapter,
  sectionId: string,
): PageLayer | null {
  const axisOptIds = new Set(leavesUnderAxis(toc, ruler.axis));
  const raw = sectionRawLensLeaves(chapter, sectionId, toc);
  for (const leaf of raw) {
    if (axisOptIds.has(leaf)) return leaf;
  }
  if (raw.length > 0) return raw[0] ?? null;
  const leaves = sectionLensLeaves(chapter, sectionId, toc);
  for (const leaf of leaves) {
    if (axisOptIds.has(leaf)) return leaf;
  }
  return leaves[0] ?? null;
}

function leavesUnderAxis(toc: BookToc, axis: string): PageLayer[] {
  const opts = toc.lenses?.[axis] ?? [];
  const out: PageLayer[] = [];
  for (const node of opts) {
    out.push(...leavesUnder(opts, node.id));
  }
  // Deduplicate while preserving order
  const seen = new Set<PageLayer>();
  return out.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function groupLinkedByDimension(
  toc: BookToc,
  ruler: BookRuler,
  linked: RulerSectionRef[],
  chapterById: Map<string, TocChapter>,
): RulerDimensionGroup[] {
  const byLeaf = new Map<PageLayer | '', RulerSectionRef[]>();
  for (const block of linked) {
    const ch = chapterById.get(block.chapterId);
    const leaf = ch ? sectionRulerLeaf(toc, ruler, ch, block.sectionId) : null;
    const key = leaf ?? '';
    const list = byLeaf.get(key) ?? [];
    list.push(block);
    byLeaf.set(key, list);
  }

  const axisOrder = leavesUnderAxis(toc, ruler.axis);
  const groups: RulerDimensionGroup[] = [];
  const used = new Set<PageLayer | ''>();

  for (const leaf of axisOrder) {
    const blocks = byLeaf.get(leaf);
    if (!blocks?.length) continue;
    used.add(leaf);
    groups.push({
      leaf,
      leafTitle: lensNodeTitle(toc, leaf),
      blocks,
    });
  }
  // Unknown leaf / no leaf — append in encounter order
  for (const [key, blocks] of byLeaf) {
    if (used.has(key) || blocks.length === 0) continue;
    groups.push({
      leaf: key === '' ? null : key,
      leafTitle: key === '' ? '' : lensNodeTitle(toc, key),
      blocks,
    });
  }
  return groups;
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

export function buildRulerPreamble(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel?: ReaderShowLevel,
): RulerPreamble[] {
  const ruler = toc.ruler;
  if (!ruler) return [];
  const visibleChapters = filterChapters(toc.chapters, selection, toc);
  const visible = visibleSectionIds(visibleChapters, selection, toc, readerShowLevel);
  const keyIds = new Set(Object.keys(ruler.links));
  const hangOffIds = new Set(Object.values(ruler.links).flat());
  const out: RulerPreamble[] = [];
  const seenChapter = new Set<string>();

  // On key pages (index): content before the first ruler key only.
  // Do not dump the whole index as preamble — keys are the skeleton.
  for (const ch of toc.chapters) {
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

  // Always-visible pages (no layers): intro only — skip hang-off / key sections
  // already assembled under the ruler.
  for (const ch of visibleChapters) {
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
 * Build the ruler reading tree: key sections (document order) with linked
 * blocks grouped by lens leaf on the ruler axis.
 * Returns null when the book has no ruler config.
 * Empty array when no visible keys under the current selection.
 */
export function buildRulerTree(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel?: ReaderShowLevel,
): RulerKeyBlock[] | null {
  const ruler = toc.ruler;
  if (!ruler) return null;

  const chapters = filterChapters(toc.chapters, selection, toc);
  const visible = visibleSectionIds(chapters, selection, toc, readerShowLevel);
  const eligible = rulerKeyEligibleIds(toc, ruler);
  const index = sectionIndex(toc.chapters);
  const chapterById = new Map(toc.chapters.map((c) => [c.id, c]));
  const allKeyIds = new Set(Object.keys(ruler.links));
  const hangOffIds = new Set(Object.values(ruler.links).flat());

  // Keys in chapter DFS / section order (not Object.keys order alone).
  const keyOrder: string[] = [];
  const seenKeys = new Set<string>();
  for (const ch of toc.chapters) {
    for (const s of ch.sections) {
      if (!ruler.links[s.id]) continue;
      if (seenKeys.has(s.id)) continue;
      seenKeys.add(s.id);
      keyOrder.push(s.id);
    }
  }
  for (const id of Object.keys(ruler.links)) {
    if (!seenKeys.has(id)) {
      seenKeys.add(id);
      keyOrder.push(id);
    }
  }

  const out: RulerKeyBlock[] = [];
  for (const keyId of keyOrder) {
    if (!eligible.has(keyId)) continue;
    if (!visible.has(keyId)) continue;
    const hit = index.get(keyId);
    if (!hit) continue;

    const linkedIds = ruler.links[keyId] ?? [];
    const linked: RulerSectionRef[] = [];
    for (const sid of linkedIds) {
      if (!visible.has(sid)) continue;
      const target = index.get(sid);
      if (!target) continue;
      linked.push({
        chapterId: target.chapter.id,
        sectionId: sid,
        title: target.section.title,
        level: target.section.level,
      });
    }

    out.push({
      chapterId: hit.chapter.id,
      sectionId: keyId,
      title: hit.section.title,
      level: hit.section.level,
      bodySectionIds: keyBodySectionIds(hit.chapter, keyId, allKeyIds, hangOffIds).filter((id) =>
        visible.has(id),
      ),
      groups: groupLinkedByDimension(toc, ruler, linked, chapterById),
    });
  }
  return out;
}

export function rulerAnchorId(chapterId: string, sectionId: string): string {
  return `ruler-${chapterId}--${sectionId}`;
}

/**
 * True when the book has a ruler and the current axis selection has more than
 * one effective leaf — multi-select always assembles under the ruler.
 * Single-select does not auto-enable ruler (show that dimension's pages only).
 */
export function selectionUsesRulerHang(
  toc: BookToc,
  selection: LensSelection | null,
): boolean {
  const ruler = toc.ruler;
  if (!ruler || !selection) return false;
  const chosen = effectiveAxisLeaves(
    toc,
    ruler.axis,
    normalizeAxisSelection(selection[ruler.axis]),
  );
  return chosen.length >= 2;
}

function isRulerSkeletonChapter(ch: TocChapter, keyIds: Set<string>): boolean {
  if (ch.role === 'ruler') return true;
  if (ch.role === 'page') return false;
  // Legacy: bare page that holds ruler keys (before role was declared).
  const bare = !ch.layers || Object.keys(ch.layers).length === 0;
  return bare && ch.sections.some((s) => keyIds.has(s.id));
}

function isDimensionChapter(ch: TocChapter): boolean {
  if (ch.role === 'ruler') return false;
  return !!(ch.layers && Object.keys(ch.layers).length > 0);
}

/** Prefer layered dimension pages; skip skeleton index when not hanging. */
export function preferRulerReadingChapters(
  toc: BookToc,
  selection: LensSelection | null,
  hang: boolean,
): TocChapter[] {
  const ruler = toc.ruler;
  if (!ruler || !selection) return filterChapters(toc.chapters, selection, toc);
  const keyIds = new Set(Object.keys(ruler.links));
  const visible = filterChapters(toc.chapters, selection, toc);
  if (hang) {
    const indexes = visible.filter((c) => isRulerSkeletonChapter(c, keyIds));
    return indexes.length ? indexes : visible;
  }
  const nonSkeleton = visible.filter((c) => !isRulerSkeletonChapter(c, keyIds));
  const layered = nonSkeleton.filter((c) => isDimensionChapter(c));
  if (layered.length) return layered;
  return nonSkeleton.length ? nonSkeleton : visible;
}

/**
 * After lens change on a ruler book: hang → index; single leaf → dimension page
 * (never stay on skeleton index just because it is always-visible).
 */
export function resolveRulerLensSwitchChapter(
  toc: BookToc,
  currentId: string,
  nextSelection: LensSelection,
): string {
  const hang = selectionUsesRulerHang(toc, nextSelection);
  const preferred = preferRulerReadingChapters(toc, nextSelection, hang);
  if (preferred.some((c) => c.id === currentId)) return currentId;
  if (preferred[0]) return preferred[0].id;
  const visible = filterChapters(toc.chapters, nextSelection, toc);
  if (visible.some((c) => c.id === currentId)) return currentId;
  return visible[0]?.id ?? currentId;
}

/** First ruler-skeleton chapter in the book (role or legacy bare+keys). */
export function findRulerSkeletonChapter(toc: BookToc): TocChapter | undefined {
  const ruler = toc.ruler;
  if (!ruler) return undefined;
  const keyIds = new Set(Object.keys(ruler.links));
  return toc.chapters.find((c) => isRulerSkeletonChapter(c, keyIds));
}

/**
 * Sidebar: one page per page-only module directory (index when hanging,
 * otherwise the preferred dimension page). Parent folders of groups unchanged.
 */
export function rulerSidebarKeepIds(
  toc: BookToc,
  selection: LensSelection | null,
  hang: boolean,
): Set<string> {
  const keep = new Set<string>();
  const ruler = toc.ruler;
  if (!ruler) return keep;
  const keyIds = new Set(Object.keys(ruler.links));
  const chapterById = new Map(toc.chapters.map((c) => [c.id, c]));
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

  function pickModulePage(pageIds: string[]): string | null {
    const chapters = pageIds
      .map((id) => chapterById.get(id))
      .filter((c): c is TocChapter => !!c)
      .filter((c) => pageVisibleInSelection(c, selection, toc));
    if (chapters.length === 0) return null;
    if (hang) {
      const index = chapters.find((c) => isRulerSkeletonChapter(c, keyIds));
      return index?.id ?? chapters[0].id;
    }
    const nonSkeleton = chapters.filter((c) => !isRulerSkeletonChapter(c, keyIds));
    const layered = nonSkeleton.filter((c) => isDimensionChapter(c));
    const pool = layered.length ? layered : nonSkeleton.length ? nonSkeleton : chapters;
    return pool[0]?.id ?? null;
  }

  function walk(nodes: TocTreeNode[]): void {
    for (const node of nodes) {
      if (node.type === 'page') {
        const ch = chapterById.get(node.id);
        if (ch && pageVisibleInSelection(ch, selection, toc)) keep.add(node.id);
        continue;
      }
      if (node.children.some((c) => c.type === 'group')) {
        walk(node.children);
        continue;
      }
      const pageIds = node.children.filter((c) => c.type === 'page').map((c) => c.id);
      const pick = pickModulePage(pageIds);
      if (pick) keep.add(pick);
    }
  }

  walk(tree);
  return keep;
}

export interface RulerOutlineEntry {
  chapterId: string;
  sectionId: string;
  title: string;
  level: number;
  /** True for ruler key rows; false for linked blocks. */
  isKey: boolean;
  leafTitle?: string;
}

export function rulerOutlineEntries(
  toc: BookToc,
  selection: LensSelection | null,
  readerShowLevel?: ReaderShowLevel,
): RulerOutlineEntry[] {
  const tree = buildRulerTree(toc, selection, readerShowLevel);
  if (!tree) return [];
  const out: RulerOutlineEntry[] = [];
  for (const key of tree) {
    // Skip untitled keys — never fall back to raw section ids in the outline.
    if (!key.title) continue;
    out.push({
      chapterId: key.chapterId,
      sectionId: key.sectionId,
      title: key.title,
      level: key.level,
      isKey: true,
    });
    for (const g of key.groups) {
      if (!g.blocks.length) continue;
      const labeled = g.blocks.filter((b) => b.title);
      if (labeled.length > 0) {
        for (const b of labeled) {
          out.push({
            chapterId: b.chapterId,
            sectionId: b.sectionId,
            title: b.title,
            level: Math.max(b.level, key.level + 1),
            isKey: false,
            ...(g.leafTitle ? { leafTitle: g.leafTitle } : {}),
          });
        }
        continue;
      }
      // Untitled hang-offs (table row chunks): one outline row per dimension.
      if (!g.leafTitle) continue;
      const first = g.blocks[0]!;
      out.push({
        chapterId: first.chapterId,
        sectionId: first.sectionId,
        title: g.leafTitle,
        level: key.level + 1,
        isKey: false,
        leafTitle: g.leafTitle,
      });
    }
  }
  return out;
}
