import { explodeAllRowspans, hasCellMerge, mergeSameCells } from '@/tableCellMerge';

/** Excel-like column filter + sort for markdown tables in .md-body. */

const EMPTY_LABEL = '（空）';
const ATTR = 'data-table-filter';

type SortDir = 'asc' | 'desc';

interface ColFilter {
  /** null = all values selected */
  selected: Set<string> | null;
}

interface TableState {
  sortCol: number | null;
  sortDir: SortDir | null;
  filters: Map<number, ColFilter>;
  openCol: number | null;
}

interface PanelRefs {
  panel: HTMLDivElement;
  btn: HTMLButtonElement;
  table: HTMLTableElement;
  col: number;
  ascBtn: HTMLButtonElement;
  descBtn: HTMLButtonElement;
  search: HTMLInputElement;
  list: HTMLDivElement;
  refreshList: () => void;
  syncSortBtns: () => void;
}

const states = new WeakMap<HTMLTableElement, TableState>();
const panelByBtn = new WeakMap<HTMLButtonElement, PanelRefs>();
let docCloseBound = false;
let openPanel: HTMLDivElement | null = null;
let btnSeq = 0;

const ICON_FILTER =
  '<svg class="table-filter-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2.2 3.1A1 1 0 0 1 3 2.5h10a1 1 0 0 1 .8 1.6L10 9.2V13a1 1 0 0 1-1.5.8l-2-1.2A1 1 0 0 1 6 12V9.2L2.2 4.1a1 1 0 0 1 0-1z"/></svg>';
const ICON_ASC =
  '<svg class="table-filter-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 3.2 4.4 7.2h2.3V12.5h2.6V7.2h2.3L8 3.2z"/></svg>';
const ICON_DESC =
  '<svg class="table-filter-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 12.8 11.6 8.8H9.3V3.5H6.7v5.3H4.4L8 12.8z"/></svg>';

function cellRaw(tr: HTMLTableRowElement, col: number): string {
  return (tr.cells[col]?.textContent ?? '').trim();
}

function cellKey(tr: HTMLTableRowElement, col: number): string {
  return cellRaw(tr, col);
}

function displayKey(raw: string): string {
  return raw === '' ? EMPTY_LABEL : raw;
}

function parseNum(s: string): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function compareValues(a: string, b: string): number {
  const na = parseNum(a);
  const nb = parseNum(b);
  if (na != null && nb != null) return na - nb;
  return a.localeCompare(b, 'zh');
}

function uniqueKeys(tbody: HTMLTableSectionElement, col: number): string[] {
  const table = tbody.closest('table');
  const merged = table instanceof HTMLTableElement && hasCellMerge(table);
  if (merged) explodeAllRowspans(table);
  try {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tr of Array.from(tbody.rows)) {
      const k = cellKey(tr, col);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    out.sort((a, b) => compareValues(a, b));
    return out;
  } finally {
    if (merged) mergeSameCells(table);
  }
}

function ensureState(table: HTMLTableElement): TableState {
  let st = states.get(table);
  if (!st) {
    st = { sortCol: null, sortDir: null, filters: new Map(), openCol: null };
    states.set(table, st);
  }
  return st;
}

function isRowVisible(tr: HTMLTableRowElement, st: TableState): boolean {
  for (const [col, f] of st.filters) {
    if (!f.selected) continue;
    const k = cellKey(tr, col);
    if (!f.selected.has(k)) return false;
  }
  return true;
}

function applyVisibility(table: HTMLTableElement, st: TableState): void {
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const merged = hasCellMerge(table);
  if (merged) explodeAllRowspans(table);
  for (const tr of Array.from(tbody.rows)) {
    tr.style.display = isRowVisible(tr, st) ? '' : 'none';
  }
  if (merged) mergeSameCells(table);
}

function applySort(table: HTMLTableElement, st: TableState): void {
  const tbody = table.tBodies[0];
  if (!tbody || st.sortCol == null || !st.sortDir) return;
  const merged = hasCellMerge(table);
  if (merged) explodeAllRowspans(table);
  const col = st.sortCol;
  const dir = st.sortDir === 'asc' ? 1 : -1;
  const rows = Array.from(tbody.rows);
  rows.sort((a, b) => dir * compareValues(cellKey(a, col), cellKey(b, col)));
  for (const r of rows) tbody.appendChild(r);
  // leave flat; applyVisibility remmerges
}

function colHasActiveFilter(st: TableState, col: number): boolean {
  const f = st.filters.get(col);
  return !!(f && f.selected);
}

function updateBtnChrome(table: HTMLTableElement, st: TableState): void {
  const thead = table.tHead;
  if (!thead) return;
  const ths = thead.querySelectorAll<HTMLTableCellElement>('th');
  ths.forEach((th, col) => {
    const btn = th.querySelector<HTMLButtonElement>('.table-filter-btn');
    if (!btn) return;
    const filtering = colHasActiveFilter(st, col);
    const sorting = st.sortCol === col ? st.sortDir : null;
    btn.classList.toggle('is-active', filtering || !!sorting);
    btn.classList.toggle('is-sort-asc', sorting === 'asc');
    btn.classList.toggle('is-sort-desc', sorting === 'desc');
    btn.classList.toggle('is-filtering', filtering);
    if (sorting === 'asc') btn.innerHTML = ICON_ASC;
    else if (sorting === 'desc') btn.innerHTML = ICON_DESC;
    else btn.innerHTML = ICON_FILTER;
  });
}

function placePanel(panel: HTMLDivElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const pad = 8;
  const width = Math.min(260, Math.max(220, panel.offsetWidth || 240));
  let left = r.left;
  let top = r.bottom + 6;
  if (left + width > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - width - pad);
  }
  if (left < pad) left = pad;
  panel.style.width = `${width}px`;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  // Flip up if clipped at bottom
  requestAnimationFrame(() => {
    const pr = panel.getBoundingClientRect();
    if (pr.bottom > window.innerHeight - pad) {
      const up = r.top - pr.height - 6;
      if (up >= pad) panel.style.top = `${up}px`;
    }
  });
}

function closeAllPanels(): void {
  if (openPanel) {
    openPanel.hidden = true;
    openPanel = null;
  }
  document.querySelectorAll<HTMLDivElement>('.table-filter-panel:not([hidden])').forEach((p) => {
    p.hidden = true;
  });
  for (const table of document.querySelectorAll<HTMLTableElement>(`table[${ATTR}]`)) {
    const st = states.get(table);
    if (st) st.openCol = null;
  }
}

function bindDocCloseOnce(): void {
  if (docCloseBound) return;
  docCloseBound = true;
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (t.closest?.('.table-filter-panel') || t.closest?.('.table-filter-btn')) return;
      closeAllPanels();
    },
    true,
  );
  window.addEventListener(
    'scroll',
    () => {
      if (openPanel) closeAllPanels();
    },
    true,
  );
  window.addEventListener('resize', () => {
    if (openPanel) closeAllPanels();
  });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buildPanel(table: HTMLTableElement, col: number, btn: HTMLButtonElement): PanelRefs {
  const panel = el('div', 'table-filter-panel');
  panel.hidden = true;

  const sortSec = el('div', 'table-filter-section');
  const sortLabel = el('div', 'table-filter-section-label', '排序');
  const ascBtn = el('button', 'table-filter-menu-item') as HTMLButtonElement;
  ascBtn.type = 'button';
  ascBtn.innerHTML =
    '<span class="table-filter-menu-ico" aria-hidden="true">↑</span><span>升序</span><span class="table-filter-menu-hint">A → Z</span>';
  const descBtn = el('button', 'table-filter-menu-item') as HTMLButtonElement;
  descBtn.type = 'button';
  descBtn.innerHTML =
    '<span class="table-filter-menu-ico" aria-hidden="true">↓</span><span>降序</span><span class="table-filter-menu-hint">Z → A</span>';
  sortSec.append(sortLabel, ascBtn, descBtn);

  const filterSec = el('div', 'table-filter-section');
  const filterLabel = el('div', 'table-filter-section-label', '筛选');
  const searchWrap = el('div', 'table-filter-search-wrap');
  const search = el('input', 'table-filter-search') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = '搜索…';
  search.autocomplete = 'off';
  searchWrap.append(search);

  const actions = el('div', 'table-filter-actions');
  const allBtn = el('button', 'table-filter-link', '全选') as HTMLButtonElement;
  allBtn.type = 'button';
  const sep = el('span', 'table-filter-sep', '·');
  const noneBtn = el('button', 'table-filter-link', '清空') as HTMLButtonElement;
  noneBtn.type = 'button';
  actions.append(allBtn, sep, noneBtn);

  const list = el('div', 'table-filter-values');
  filterSec.append(filterLabel, searchWrap, actions, list);

  panel.append(sortSec, filterSec);
  if (!btn.id) btn.id = `tf-btn-${++btnSeq}`;
  panel.dataset.forBtn = btn.id;
  document.body.append(panel);

  function refreshList(): void {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const st = ensureState(table);
    const keys = uniqueKeys(tbody, col);
    const q = search.value.trim().toLowerCase();
    const selected = st.filters.get(col)?.selected;

    list.replaceChildren();
    let shown = 0;
    for (const key of keys) {
      const label = displayKey(key);
      if (q && !label.toLowerCase().includes(q) && !key.toLowerCase().includes(q)) continue;
      shown += 1;
      const row = el('label', 'table-filter-value');
      const cb = el('input') as HTMLInputElement;
      cb.type = 'checkbox';
      cb.checked = !selected || selected.has(key);
      cb.addEventListener('change', () => {
        const cur = ensureState(table);
        let set = cur.filters.get(col)?.selected;
        if (!set) {
          set = new Set(uniqueKeys(tbody, col));
          cur.filters.set(col, { selected: set });
        }
        if (cb.checked) set.add(key);
        else set.delete(key);
        const all = uniqueKeys(tbody, col);
        if (set.size === all.length && all.every((k) => set!.has(k))) {
          cur.filters.delete(col);
        }
        applyVisibility(table, cur);
        updateBtnChrome(table, cur);
      });
      const span = el('span', undefined, label);
      row.append(cb, span);
      list.append(row);
    }
    if (shown === 0) {
      list.append(el('div', 'table-filter-empty', '无匹配项'));
    }
  }

  function syncSortBtns(): void {
    const st = ensureState(table);
    ascBtn.classList.toggle('is-active', st.sortCol === col && st.sortDir === 'asc');
    descBtn.classList.toggle('is-active', st.sortCol === col && st.sortDir === 'desc');
  }

  ascBtn.addEventListener('click', () => {
    const st = ensureState(table);
    st.sortCol = col;
    st.sortDir = 'asc';
    applySort(table, st);
    applyVisibility(table, st);
    updateBtnChrome(table, st);
    syncSortBtns();
  });
  descBtn.addEventListener('click', () => {
    const st = ensureState(table);
    st.sortCol = col;
    st.sortDir = 'desc';
    applySort(table, st);
    applyVisibility(table, st);
    updateBtnChrome(table, st);
    syncSortBtns();
  });

  allBtn.addEventListener('click', () => {
    const st = ensureState(table);
    st.filters.delete(col);
    refreshList();
    applyVisibility(table, st);
    updateBtnChrome(table, st);
  });
  noneBtn.addEventListener('click', () => {
    const st = ensureState(table);
    st.filters.set(col, { selected: new Set() });
    refreshList();
    applyVisibility(table, st);
    updateBtnChrome(table, st);
  });

  search.addEventListener('input', () => refreshList());

  const refs: PanelRefs = {
    panel,
    btn,
    table,
    col,
    ascBtn,
    descBtn,
    search,
    list,
    refreshList,
    syncSortBtns,
  };
  panelByBtn.set(btn, refs);
  return refs;
}

function openFilterPanel(refs: PanelRefs): void {
  closeAllPanels();
  refs.panel.hidden = false;
  openPanel = refs.panel;
  ensureState(refs.table).openCol = refs.col;
  refs.search.value = '';
  refs.syncSortBtns();
  refs.refreshList();
  placePanel(refs.panel, refs.btn);
  refs.search.focus();
}

function enhanceTable(table: HTMLTableElement): void {
  if (table.getAttribute(ATTR) === '1') return;
  const thead = table.tHead;
  const tbody = table.tBodies[0];
  if (!thead || !tbody) return;

  const headerRow = thead.rows[0];
  if (!headerRow) return;

  table.setAttribute(ATTR, '1');
  ensureState(table);

  Array.from(headerRow.cells).forEach((th, col) => {
    if (th.querySelector('.table-filter-btn')) return;
    th.classList.add('table-filter-th');

    if (!th.querySelector('.table-filter-label')) {
      const label = el('span', 'table-filter-label');
      while (th.firstChild) label.appendChild(th.firstChild);
      th.append(label);
    }

    const btn = el('button', 'table-filter-btn') as HTMLButtonElement;
    btn.type = 'button';
    btn.setAttribute('aria-label', '筛选与排序');
    btn.title = '筛选与排序';
    btn.innerHTML = ICON_FILTER;

    const refs = buildPanel(table, col, btn);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openPanel === refs.panel && !refs.panel.hidden) {
        closeAllPanels();
        return;
      }
      openFilterPanel(refs);
    });

    th.append(btn);
  });
}

function pruneDetachedPanels(): void {
  closeAllPanels();
  for (const panel of Array.from(
    document.querySelectorAll<HTMLDivElement>('.table-filter-panel'),
  )) {
    const id = panel.dataset.forBtn;
    const btn = id ? document.getElementById(id) : null;
    if (!btn?.isConnected) panel.remove();
  }
}

/**
 * Attach Excel-like filter/sort controls to markdown tables under root.
 * Idempotent per table via data-table-filter.
 */
export function enhanceTableFiltersIn(root: HTMLElement | null): void {
  if (!root) return;
  bindDocCloseOnce();
  pruneDetachedPanels();
  root.querySelectorAll<HTMLTableElement>('.md-body table').forEach(enhanceTable);
}
