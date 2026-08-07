import { hangIdToKeyTitles } from '@shared/ruler';
import { SECTION_ROW_CLASS } from '@shared/tableRowId';
import type { BookToc } from '@shared/types';

const ATTR = 'data-ruler-col';
const LABEL_ATTR = 'data-ruler-label';
const HEADER = '尺子';

export function hasRulerColumn(table: HTMLTableElement): boolean {
  return table.getAttribute(ATTR) === '1';
}

function isMarkerRow(tr: HTMLTableRowElement): boolean {
  return tr.classList.contains(SECTION_ROW_CLASS) || tr.classList.contains('section-row-marker');
}

function rowGroups(tbody: HTMLTableSectionElement): HTMLTableRowElement[][] {
  const rows = Array.from(tbody.rows);
  const groups: HTMLTableRowElement[][] = [];
  let cur: HTMLTableRowElement[] = [];
  for (const tr of rows) {
    if (isMarkerRow(tr)) {
      if (cur.length) groups.push(cur);
      cur = [tr];
    } else if (cur.length) {
      cur.push(tr);
    } else {
      groups.push([tr]);
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function enhanceTable(
  table: HTMLTableElement,
  titleByHangId: Map<string, string>,
  opts: { forceSingle: boolean },
): void {
  if (hasRulerColumn(table)) return;
  const thead = table.tHead;
  const tbody = table.tBodies[0];
  if (!thead?.rows[0] || !tbody) return;

  const groups = rowGroups(tbody);
  const labels: string[] = [];
  const groupLabels: (string | null)[] = [];
  for (const g of groups) {
    const marker = g.find(isMarkerRow);
    const id = marker?.id ?? '';
    const label = id ? titleByHangId.get(id) ?? null : null;
    groupLabels.push(label);
    if (label) labels.push(label);
  }
  const unique = new Set(labels);
  if (unique.size === 0) return;
  if (unique.size < 2 && !opts.forceSingle) return;

  const th = document.createElement('th');
  th.className = 'table-ruler-cell';
  th.textContent = HEADER;
  thead.rows[0]!.insertBefore(th, thead.rows[0]!.firstChild);

  groups.forEach((g, gi) => {
    const label = groupLabels[gi] ?? '';
    for (const tr of g) {
      if (label) tr.setAttribute(LABEL_ATTR, label);
      const td = document.createElement('td');
      td.className = 'table-ruler-cell';
      td.textContent = label;
      tr.insertBefore(td, tr.firstChild);
    }
  });

  table.setAttribute(ATTR, '1');
  // Vertical merge (including 尺子) applied later by enhanceTableCellMergeIn
}

/**
 * Inject「尺子」column when a table's row groups hang under multiple keys.
 * Not used in ruler hang view (content is already under the key heading).
 */
export function enhanceTableRulerColIn(
  root: HTMLElement | null,
  toc: BookToc | null | undefined,
  opts?: { forceSingle?: boolean },
): void {
  if (!root || !toc?.ruler) return;
  const map = hangIdToKeyTitles(toc);
  if (map.size === 0) return;
  const forceSingle = opts?.forceSingle === true;
  root.querySelectorAll<HTMLTableElement>('.md-body table').forEach((table) => {
    enhanceTable(table, map, { forceSingle });
  });
}
