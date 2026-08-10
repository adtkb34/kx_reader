import { hangIdToKeyIds, sectionTitleById } from '@shared/ruler';
import { SECTION_ROW_CLASS } from '@shared/tableRowId';
import type { BookToc } from '@shared/types';

const ATTR = 'data-ruler-col';
const LABEL_ATTR = 'data-ruler-label';
const KEY_ATTR = 'data-ruler-key-id';
const HEADER = '尺子';

export function hasRulerColumn(table: HTMLTableElement): boolean {
  return table.getAttribute(ATTR) === '1';
}

function isMarkerRow(tr: HTMLTableRowElement): boolean {
  return tr.classList.contains(SECTION_ROW_CLASS);
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

/** Current hang key under which this table is shown (hang view); omit self from「尺子」. */
function hangKeyIdForTable(table: HTMLTableElement): string | null {
  const host = table.closest(`[${KEY_ATTR}]`);
  const id = host?.getAttribute(KEY_ATTR)?.trim();
  return id || null;
}

function labelForHang(
  hangId: string,
  keyIdsByHang: Map<string, string[]>,
  titles: Map<string, string>,
  excludeKeyId: string | null,
): string | null {
  const keyIds = (keyIdsByHang.get(hangId) ?? []).filter((id) => id !== excludeKeyId);
  const label = keyIds
    .map((id) => titles.get(id) ?? id)
    .filter(Boolean)
    .join('、');
  return label || null;
}

function enhanceTable(
  table: HTMLTableElement,
  keyIdsByHang: Map<string, string[]>,
  titles: Map<string, string>,
  opts: { forceSingle: boolean },
): void {
  if (hasRulerColumn(table)) return;
  const thead = table.tHead;
  const tbody = table.tBodies[0];
  if (!thead?.rows[0] || !tbody) return;

  const excludeKeyId = hangKeyIdForTable(table);
  const groups = rowGroups(tbody);
  const labels: string[] = [];
  const groupLabels: (string | null)[] = [];
  for (const g of groups) {
    const marker = g.find(isMarkerRow);
    const id = marker?.id ?? '';
    const label = id
      ? labelForHang(id, keyIdsByHang, titles, excludeKeyId)
      : null;
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
 * Under hang view (`data-ruler-key-id`), the current key is omitted from labels.
 */
export function enhanceTableRulerColIn(
  root: HTMLElement | null,
  toc: BookToc | null | undefined,
  opts?: { forceSingle?: boolean },
): void {
  if (!root || !toc?.ruler) return;
  const keyIdsByHang = hangIdToKeyIds(toc.ruler);
  if (keyIdsByHang.size === 0) return;
  const titles = sectionTitleById(toc);
  const forceSingle = opts?.forceSingle === true;
  root.querySelectorAll<HTMLTableElement>('.md-body table').forEach((table) => {
    enhanceTable(table, keyIdsByHang, titles, { forceSingle });
  });
}
