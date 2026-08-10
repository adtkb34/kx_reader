/** Visible outline items in document order (ids unique preferred). */
export type OutlineItem = {
  id: string;
  /** Markdown heading level (h1–h6). */
  level: number;
};

/**
 * Hierarchical outline labels (`1`, `1.1`, `2.1`) from relative heading depth.
 * Skipped levels fill intermediate counters with 1 (e.g. h2→h4 → `1.1.1`).
 * First occurrence wins when `id` repeats; empty ids are ignored.
 */
export function outlineNumbers(items: OutlineItem[]): Map<string, string> {
  const titled = items.filter((i) => i.id);
  const out = new Map<string, string>();
  if (titled.length === 0) return out;

  const minLevel = Math.min(...titled.map((i) => i.level));
  const counters: number[] = [];

  for (const item of titled) {
    if (out.has(item.id)) continue;
    const depth = Math.max(0, item.level - minLevel);
    while (counters.length < depth) {
      counters.push(1);
    }
    counters.length = depth + 1;
    counters[depth] = (counters[depth] ?? 0) + 1;
    out.set(item.id, counters.join('.'));
  }

  return out;
}

/** Stable key for a TOC tree node in outline maps. */
export function tocOutlineKey(type: 'group' | 'page', id: string): string {
  return `${type}:${id}`;
}

/**
 * Outline numbers for a sidebar TOC tree (groups + pages).
 * Depth 1 = top-level siblings → `1`, `2`; children → `1.1`, `1.2`, …
 */
export function tocTreeOutlineNumbers(
  tree: { type: 'group' | 'page'; id: string; children?: unknown[] }[],
): Map<string, string> {
  const items: OutlineItem[] = [];
  function walk(
    nodes: { type: 'group' | 'page'; id: string; children?: unknown[] }[],
    level: number,
  ): void {
    for (const n of nodes) {
      items.push({ id: tocOutlineKey(n.type, n.id), level });
      if (n.type === 'group' && Array.isArray(n.children) && n.children.length) {
        walk(n.children as { type: 'group' | 'page'; id: string; children?: unknown[] }[], level + 1);
      }
    }
  }
  walk(tree, 1);
  return outlineNumbers(items);
}
