import type { BookToc, PageLayer, TocChapter, TocTreeNode } from './types';

export function pageVisibleInLens(chapter: TocChapter, lens: PageLayer | null): boolean {
  if (!lens) return true;
  if (!chapter.layer) return true;
  return chapter.layer === lens;
}

export function filterChapters(chapters: TocChapter[], lens: PageLayer | null): TocChapter[] {
  if (!lens) return chapters;
  return chapters.filter((c) => pageVisibleInLens(c, lens));
}

/** Drop pages not in lens; drop groups with no remaining leaves. */
export function filterTree(
  nodes: TocTreeNode[],
  visibleIds: Set<string>,
): TocTreeNode[] {
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

export function visibleIdSet(chapters: TocChapter[], lens: PageLayer | null): Set<string> {
  return new Set(filterChapters(chapters, lens).map((c) => c.id));
}

export function defaultLens(toc: BookToc): PageLayer | null {
  if (!toc.lenses || toc.lenses.length === 0) return null;
  return toc.lenses[0].id;
}

export function resolveLensSwitchTarget(
  toc: BookToc,
  currentId: string,
  nextLens: PageLayer,
): string {
  const visible = filterChapters(toc.chapters, nextLens);
  const visibleIds = new Set(visible.map((c) => c.id));
  const current = toc.chapters.find((c) => c.id === currentId);
  if (current?.pair && visibleIds.has(current.pair)) return current.pair;
  if (visibleIds.has(currentId)) return currentId;
  return visible[0]?.id ?? currentId;
}
