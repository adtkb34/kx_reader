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
