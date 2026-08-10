import { reactive } from 'vue';
import type { LensAxisId, LensSelection, PageLayer } from '@shared/types';
import { normalizeAxisSelection } from '@shared/lenses';

/** Same-axis multi-select vs single-select for the lens tree. */
export type LensAxisPickMode = 'multi' | 'single';

/** Single-page (leaf module) reading vs lens digest. */
export type LensReadMode = 'page' | 'digest';

/** TOC group expand: one sibling at a time vs many. */
export type TocSiblingExpand = 'single' | 'multi';

/** Filter TOC/body by whether pages have content under the current lens. */
export type LensContentFilter = 'all' | 'content' | 'empty';

const LENS_PICK_KEY = 'reader.lensPickMode';
const LENS_READ_KEY = 'reader.lensReadMode';
const TOC_EXPAND_KEY = 'reader.tocSiblingExpand';
const TOC_EXPAND_LEGACY_KEY = 'reader.tocLightboxExpand';
const LENS_CONTENT_FILTER_KEY = 'reader.lensContentFilter';
const LENS_CONTENT_FILTER_LEGACY_KEY = 'reader.hideEmptyLens';

function readLensPickMode(): LensAxisPickMode {
  const raw = localStorage.getItem(LENS_PICK_KEY);
  if (raw === 'multi') return 'multi';
  return 'single';
}

function readLensReadMode(): LensReadMode {
  const raw = localStorage.getItem(LENS_READ_KEY);
  // Migrate removed「尺子」read mode → 单页.
  if (raw === 'digest') return 'digest';
  return 'page';
}

function readTocSiblingExpand(): TocSiblingExpand {
  const raw =
    localStorage.getItem(TOC_EXPAND_KEY) ?? localStorage.getItem(TOC_EXPAND_LEGACY_KEY);
  return raw === 'single' ? 'single' : 'multi';
}

function readLensContentFilter(): LensContentFilter {
  const raw = localStorage.getItem(LENS_CONTENT_FILTER_KEY);
  if (raw === 'content' || raw === 'empty' || raw === 'all') return raw;
  // Migrate former boolean toggle.
  if (localStorage.getItem(LENS_CONTENT_FILTER_LEGACY_KEY) === '1') return 'content';
  return 'all';
}

function showLevelStorageKey(bookId: string): string {
  return `reader.showLevel.${bookId}`;
}

function rulerPickStorageKey(bookId: string): string {
  return `reader.rulerPick.${bookId}`;
}

export const ui = reactive({
  notesTarget: null as null | { bookId: string; key: string; title: string },
  orphanOpen: false,
  compareOpen: false,
  agentOpen: false,
  /** Bump to force ChapterPage reload after agent writes files. */
  chapterReloadToken: 0,
  detailsOpen: localStorage.getItem('reader.detailsOpen') === '1',
  /** Sidebar TOC visible; default open. */
  tocOpen: localStorage.getItem('reader.tocOpen') !== '0',
  /** Active multi-axis lens selection per book. */
  lensByBook: {} as Record<string, LensSelection>,
  /** Per-book content rank ceiling; `null` = show all ranks. */
  showLevelByBook: {} as Record<string, number | null>,
  /** Per-book ruler pick: `index` or a lens axis id. */
  rulerPickByBook: {} as Record<string, string>,
  /** 多选 = same-axis multi; 单选 = one id per axis. */
  lensPickMode: readLensPickMode() as LensAxisPickMode,
  /** 单页 = leaf module; 汇总 = all visible modules. */
  lensReadMode: readLensReadMode() as LensReadMode,
  /** TOC groups: 单开 = one sibling; 多开 = many siblings open. */
  tocSiblingExpand: readTocSiblingExpand() as TocSiblingExpand,
  /**
   * all = no extra filter; content = only pages with lens content;
   * empty = only pages without lens content. Default all.
   */
  lensContentFilter: readLensContentFilter() as LensContentFilter,
});

/** Load per-book content rank ceiling; `null` = 全部. */
export function getBookShowLevel(bookId: string): number | null {
  // Use `in` + property read so Vue tracks showLevelByBook[bookId].
  // hasOwnProperty alone does not establish a reactive dependency.
  if (!(bookId in ui.showLevelByBook)) {
    const raw = localStorage.getItem(showLevelStorageKey(bookId));
    if (raw == null || raw === 'all' || raw === '') {
      ui.showLevelByBook[bookId] = null;
    } else {
      const n = Number(raw);
      ui.showLevelByBook[bookId] = Number.isFinite(n) ? n : null;
    }
  }
  return ui.showLevelByBook[bookId]!;
}

export function setBookShowLevel(bookId: string, level: number | null): void {
  ui.showLevelByBook[bookId] = level;
  localStorage.setItem(showLevelStorageKey(bookId), level == null ? 'all' : String(level));
}

export function getBookRulerPick(bookId: string): string {
  if (!(bookId in ui.rulerPickByBook)) {
    ui.rulerPickByBook[bookId] = localStorage.getItem(rulerPickStorageKey(bookId)) ?? 'index';
  }
  return ui.rulerPickByBook[bookId]!;
}

export function setBookRulerPick(bookId: string, pick: string): void {
  ui.rulerPickByBook[bookId] = pick;
  localStorage.setItem(rulerPickStorageKey(bookId), pick);
}

export function setLensPickMode(mode: LensAxisPickMode): void {
  ui.lensPickMode = mode;
  localStorage.setItem(LENS_PICK_KEY, mode);
}

export function setLensReadMode(mode: LensReadMode): void {
  ui.lensReadMode = mode;
  localStorage.setItem(LENS_READ_KEY, mode);
}

export function setTocSiblingExpand(mode: TocSiblingExpand): void {
  ui.tocSiblingExpand = mode;
  localStorage.setItem(TOC_EXPAND_KEY, mode);
}

export function setLensContentFilter(mode: LensContentFilter): void {
  ui.lensContentFilter = mode;
  localStorage.setItem(LENS_CONTENT_FILTER_KEY, mode);
}

export function bumpChapterReload(): void {
  ui.chapterReloadToken += 1;
}

export function openNotes(bookId: string, key: string, title: string): void {
  ui.notesTarget = { bookId, key, title };
}

export function closeNotes(): void {
  ui.notesTarget = null;
}

export function toggleDetailsOpen(): void {
  ui.detailsOpen = !ui.detailsOpen;
  localStorage.setItem('reader.detailsOpen', ui.detailsOpen ? '1' : '0');
}

export function toggleTocOpen(): void {
  ui.tocOpen = !ui.tocOpen;
  localStorage.setItem('reader.tocOpen', ui.tocOpen ? '1' : '0');
}

function lensStorageKey(bookId: string): string {
  return `reader.lens.${bookId}`;
}

function isOptionId(s: string): boolean {
  return /^[\w][\w.-]*$/.test(s);
}

/** Load stored multi-axis selection (JSON object only). */
export function getStoredLensSelection(bookId: string): LensSelection | null {
  const raw = localStorage.getItem(lensStorageKey(bookId));
  if (!raw || !raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: LensSelection = {};
    for (const [axis, opt] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isOptionId(axis)) continue;
      const ids = normalizeAxisSelection(opt).filter(isOptionId);
      if (ids.length > 0) out[axis] = ids;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function setBookLensSelection(bookId: string, selection: LensSelection): void {
  const copy: LensSelection = {};
  for (const [axis, ids] of Object.entries(selection)) {
    copy[axis] = [...ids];
  }
  ui.lensByBook[bookId] = copy;
  localStorage.setItem(lensStorageKey(bookId), JSON.stringify(copy));
}

export function setBookAxisLens(
  bookId: string,
  axis: LensAxisId,
  options: PageLayer[],
  base: LensSelection,
): LensSelection {
  const next = { ...base, [axis]: [...options] };
  setBookLensSelection(bookId, next);
  return next;
}
