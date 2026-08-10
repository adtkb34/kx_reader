import {
  filterChapters,
  pageVisibleInSelection,
} from './lenses';
import type { BookToc, LensSelection, TocChapter, TocTreeNode } from './types';

function isRulerSkeletonChapter(ch: TocChapter): boolean {
  return ch.role === 'ruler';
}

function isDimensionChapter(ch: TocChapter): boolean {
  if (ch.role === 'ruler') return false;
  return !!(ch.layers && Object.keys(ch.layers).length > 0);
}

/** Prefer layered dimension pages; skip skeleton index outside 尺子 mode. */
export function preferRulerReadingChapters(
  toc: BookToc,
  selection: LensSelection | null,
  rulerMode: boolean,
): TocChapter[] {
  if (!toc.ruler || !selection) return filterChapters(toc.chapters, selection, toc);
  const visible = filterChapters(toc.chapters, selection, toc);
  const indexes = visible.filter((c) => isRulerSkeletonChapter(c));
  if (rulerMode) {
    return indexes.length ? indexes : visible;
  }
  const nonSkeleton = visible.filter((c) => !isRulerSkeletonChapter(c));
  const layered = nonSkeleton.filter((c) => isDimensionChapter(c));
  if (layered.length) return layered;
  return nonSkeleton.length ? nonSkeleton : visible;
}

/**
 * After lens change on a ruler book: 尺子 → index; otherwise → dimension page
 * (never stay on skeleton index just because it is always-visible).
 */
export function resolveRulerLensSwitchChapter(
  toc: BookToc,
  currentId: string,
  nextSelection: LensSelection,
  rulerMode = false,
): string {
  const preferred = preferRulerReadingChapters(toc, nextSelection, rulerMode);
  if (preferred.some((c) => c.id === currentId)) return currentId;
  if (preferred[0]) return preferred[0].id;
  const visible = filterChapters(toc.chapters, nextSelection, toc);
  if (visible.some((c) => c.id === currentId)) return currentId;
  return visible[0]?.id ?? currentId;
}

/** First ruler-skeleton chapter in the book (`role: ruler`). */
export function findRulerSkeletonChapter(toc: BookToc): TocChapter | undefined {
  if (!toc.ruler) return undefined;
  return toc.chapters.find((c) => isRulerSkeletonChapter(c));
}

/**
 * Ruler index page for the module that contains `chapterId` (sidebar leaf group).
 */
export function findRulerModuleIndexId(
  toc: BookToc,
  chapterId: string,
): string | undefined {
  if (!toc.ruler) return undefined;
  const chapterById = new Map(toc.chapters.map((c) => [c.id, c]));
  const current = chapterById.get(chapterId);
  if (current && isRulerSkeletonChapter(current)) return current.id;

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

  function walk(nodes: TocTreeNode[]): string | undefined {
    for (const node of nodes) {
      if (node.type === 'page') continue;
      if (node.children.some((c) => c.type === 'group')) {
        const hit = walk(node.children);
        if (hit) return hit;
        continue;
      }
      const pageIds = node.children.filter((c) => c.type === 'page').map((c) => c.id);
      if (!pageIds.includes(chapterId)) continue;
      const chapters = pageIds
        .map((id) => chapterById.get(id))
        .filter((c): c is TocChapter => !!c);
      return chapters.find((c) => isRulerSkeletonChapter(c))?.id;
    }
    return undefined;
  }

  return walk(tree);
}

/**
 * Sidebar: one page per module directory.
 * 尺子 mode → index; otherwise preferred dimension page (or index if that is all).
 */
export function rulerSidebarKeepIds(
  toc: BookToc,
  selection: LensSelection | null,
  rulerMode: boolean,
): Set<string> {
  const keep = new Set<string>();
  if (!toc.ruler) return keep;
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
    const index = chapters.find((c) => isRulerSkeletonChapter(c));
    if (rulerMode) {
      return index?.id ?? chapters[0].id;
    }
    const nonSkeleton = chapters.filter((c) => !isRulerSkeletonChapter(c));
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
