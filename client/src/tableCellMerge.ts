/** Vertical merge of consecutive same-valued body cells; explode for filter/sort. */

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
  const meta = oldRows.map((tr) => ({
    id: tr.id,
    className: tr.className,
    label: tr.getAttribute('data-ruler-label'),
    display: tr.style.display,
  }));

  tbody.replaceChildren();
  const hasRuler = table.getAttribute('data-ruler-col') === '1';
  for (let r = 0; r < grid.length; r++) {
    const tr = document.createElement('tr');
    const m = meta[r];
    if (m?.id) tr.id = m.id;
    if (m?.className) tr.className = m.className;
    if (m?.label) tr.setAttribute('data-ruler-label', m.label);
    if (m?.display) tr.style.display = m.display;
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
 * Merge consecutive visible body cells with identical non-empty text (per column).
 * Call after explode / after filter visibility updates.
 */
export function mergeSameCells(table: HTMLTableElement): void {
  const tbody = table.tBodies[0];
  if (!tbody || tbody.rows.length === 0) return;

  explodeAllRowspans(table);
  const rows = Array.from(tbody.rows);
  const cols = Math.max(0, ...rows.map((r) => r.cells.length));

  for (let col = cols - 1; col >= 0; col--) {
    let i = 0;
    while (i < rows.length) {
      if (rows[i]!.style.display === 'none') {
        i += 1;
        continue;
      }
      const cell = rows[i]!.cells[col];
      if (!cell) {
        i += 1;
        continue;
      }
      const text = cell.textContent?.trim() ?? '';
      if (text === '') {
        i += 1;
        continue;
      }
      let j = i + 1;
      while (j < rows.length) {
        if (rows[j]!.style.display === 'none') break;
        const other = rows[j]!.cells[col];
        if (!other || (other.textContent?.trim() ?? '') !== text) break;
        j += 1;
      }
      const span = j - i;
      if (span > 1) {
        cell.rowSpan = span;
        for (let k = i + 1; k < j; k++) {
          rows[k]!.cells[col]?.remove();
        }
      } else {
        cell.removeAttribute('rowspan');
      }
      i = j;
    }
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
