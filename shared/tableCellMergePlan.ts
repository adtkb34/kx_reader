/** Pure plan for merging contiguous equal non-empty cells (rowspan/colspan). */

export interface MergeBlock {
  r: number;
  c: number;
  rs: number;
  cs: number;
  text: string;
}

/**
 * Merge contiguous equal non-empty cells into rectangles.
 * Hidden rows are barriers and stay 1×1. Empty cells are never merged.
 * Prefer vertical growth (rowspan) before horizontal (colspan).
 */
export function planSameCellMerges(
  values: string[][],
  hidden: boolean[],
): MergeBlock[] {
  const n = values.length;
  const cols = n === 0 ? 0 : Math.max(0, ...values.map((row) => row.length));
  const covered: boolean[][] = Array.from({ length: n }, () =>
    Array.from({ length: cols }, () => false),
  );
  const blocks: MergeBlock[] = [];

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < cols; c++) {
      if (covered[r]![c]) continue;
      const text = values[r]![c] ?? '';

      if (hidden[r] || text === '') {
        covered[r]![c] = true;
        blocks.push({ r, c, rs: 1, cs: 1, text });
        continue;
      }

      let rs = 1;
      while (
        r + rs < n &&
        !hidden[r + rs] &&
        !covered[r + rs]![c] &&
        (values[r + rs]![c] ?? '') === text
      ) {
        rs += 1;
      }

      let cs = 1;
      outer: while (c + cs < cols) {
        for (let dr = 0; dr < rs; dr++) {
          if (
            covered[r + dr]![c + cs] ||
            (values[r + dr]![c + cs] ?? '') !== text
          ) {
            break outer;
          }
        }
        cs += 1;
      }

      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          covered[r + dr]![c + dc] = true;
        }
      }
      blocks.push({ r, c, rs, cs, text });
    }
  }

  return blocks;
}
