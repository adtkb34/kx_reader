/** Merge adjacent equal body cells (rowspan + colspan); explode for filter/sort. */

import { planSameCellMerges, type MergeBlock } from '@shared/tableCellMergePlan';

const ATTR = 'data-cell-merge';

export function hasCellMerge(table: HTMLTableElement): boolean {
  return table.getAttribute(ATTR) === '1';
}

function logicalGrid(tbody: HTMLTableSectionElement): string[][] {
  const rows = Array.from(tbody.rows);
  const grid: string[][] = [];
  const occupied: boolean[][] = [];

  for (let r = 0; r < rows.length; r++) {
    if (!grid[r]) grid[r] = [];
    if (!occupied[r]) occupied[r] = [];
    let c = 0;
    for (const cell of Array.from(rows[r]!.cells)) {
      while (occupied[r]![c]) c += 1;
      const rs = cell.rowSpan || 1;
      const cs = cell.colSpan || 1;
      const text = cell.textContent?.trim() ?? '';
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (!grid[rr]) grid[rr] = [];
          if (!occupied[rr]) occupied[rr] = [];
          grid[rr]![cc] = text;
          occupied[rr]![cc] = true;
        }
      }
      c += cs;
    }
  }
  return grid;
}

type RowMeta = {
  id: string;
  className: string;
  label: string | null;
  display: string;
};

function readRowMeta(tr: HTMLTableRowElement): RowMeta {
  return {
    id: tr.id,
    className: tr.className,
    label: tr.getAttribute('data-ruler-label'),
    display: tr.style.display,
  };
}

function applyRowMeta(tr: HTMLTableRowElement, m: RowMeta | undefined): void {
  if (!m) return;
  if (m.id) tr.id = m.id;
  if (m.className) tr.className = m.className;
  if (m.label) tr.setAttribute('data-ruler-label', m.label);
  if (m.display) tr.style.display = m.display;
}

/**
 * Expand all rowspans/colspans in tbody into one cell per logical slot
 * (preserves row id / class / display / data-ruler-label).
 */
export function explodeAllRowspans(table: HTMLTableElement): void {
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const oldRows = Array.from(tbody.rows);
  if (oldRows.length === 0) return;

  const grid = logicalGrid(tbody);
  const meta = oldRows.map(readRowMeta);

  tbody.replaceChildren();
  const hasRuler = table.getAttribute('data-ruler-col') === '1';
  for (let r = 0; r < grid.length; r++) {
    const tr = document.createElement('tr');
    applyRowMeta(tr, meta[r]);
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const td = document.createElement('td');
      if (hasRuler && c === 0) td.className = 'table-ruler-cell';
      td.textContent = row[c]!;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

/**
 * Merge contiguous equal non-empty cells into rowspan/colspan rectangles.
 * Hidden rows act as barriers and stay 1×1. Empty cells are never merged.
 * Vertical merges are preferred over horizontal when both are possible.
 */
export function mergeSameCells(table: HTMLTableElement): void {
  const tbody = table.tBodies[0];
  if (!tbody || tbody.rows.length === 0) return;

  explodeAllRowspans(table);
  const rows = Array.from(tbody.rows);
  const n = rows.length;
  const cols = Math.max(0, ...rows.map((r) => r.cells.length));
  if (cols === 0) return;

  const values: string[][] = rows.map((tr) => {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(tr.cells[c]?.textContent?.trim() ?? '');
    }
    return row;
  });
  const hidden = rows.map((r) => r.style.display === 'none');
  const blocks: MergeBlock[] = planSameCellMerges(values, hidden);

  const meta = rows.map(readRowMeta);
  const hasRuler = table.getAttribute('data-ruler-col') === '1';
  tbody.replaceChildren();

  for (let r = 0; r < n; r++) {
    const tr = document.createElement('tr');
    applyRowMeta(tr, meta[r]);
    const starters = blocks.filter((b) => b.r === r).sort((a, b) => a.c - b.c);
    for (const b of starters) {
      const td = document.createElement('td');
      td.textContent = b.text;
      if (b.rs > 1) td.rowSpan = b.rs;
      if (b.cs > 1) td.colSpan = b.cs;
      if (hasRuler && b.c === 0) td.className = 'table-ruler-cell';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.setAttribute(ATTR, '1');
}

/** Apply same-cell merge to all markdown tables under root. */
export function enhanceTableCellMergeIn(root: HTMLElement | null): void {
  if (!root) return;
  root.querySelectorAll<HTMLTableElement>('.md-body table').forEach((table) => {
    if (!table.tHead || !table.tBodies[0]) return;
    mergeSameCells(table);
  });
}
