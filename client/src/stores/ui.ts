import { reactive } from 'vue';
import type { LensAxisId, LensSelection, PageLayer } from '@shared/types';
import { normalizeAxisSelection } from '@shared/lenses';

/** Same-axis multi-select vs single-select for the lens tree. */
export type LensAxisPickMode = 'multi' | 'single';

/** Outline key multi-select vs single-select (independent from lens). */
export type OutlinePickMode = 'multi' | 'single';

/** Single-page (leaf module) reading vs lens digest. */
export type LensReadMode = 'page' | 'digest';

/** TOC group expand: one sibling at a time vs many. */
export type TocSiblingExpand = 'single' | 'multi';

/** Filter TOC/body by whether pages have content under the current lens. */
export type LensContentFilter = 'all' | 'content' | 'empty';

const LENS_PICK_KEY = 'reader.lensPickMode';
const LENS_READ_KEY = 'reader.lensReadMode';
const OUTLINE_PICK_KEY = 'reader.outlinePickMode';
const TOC_EXPAND_KEY = 'reader.tocSiblingExpand';
const TOC_EXPAND_LEGACY_KEY = 'reader.tocLightboxExpand';
const LENS_CONTENT_FILTER_KEY = 'reader.lensContentFilter';
const LENS_CONTENT_FILTER_LEGACY_KEY = 'reader.hideEmptyLens';

function readLensPickMode(): LensAxisPickMode {
  const raw = localStorage.getItem(LENS_PICK_KEY);
  if (raw === 'multi') return 'multi';
  return 'single';
}

function readOutlinePickMode(): OutlinePickMode {
  const raw = localStorage.getItem(OUTLINE_PICK_KEY);
  if (raw === 'single') return 'single';
  return 'multi';
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
  /** Outline keys: default multi; independent from lensPickMode. */
  outlinePickMode: readOutlinePickMode() as OutlinePickMode,
  /** 单页 = leaf module; 汇总 = all visible modules. */
  lensReadMode: readLensReadMode() as LensReadMode,
  /** TOC groups: 单开 = one sibling; 多开 = many siblings open. */
  tocSiblingExpand: readTocSiblingExpand() as TocSiblingExpand,
  /**
   * all = no extra filter; content = only pages with lens content;
   * empty = only pages without lens content. Default all.
   */
  lensContentFilter: readLensContentFilter() as LensContentFilter,
  /** Selected ruler outline keys per `bookId::moduleIndexId`. */
  outlineKeysByScope: {} as Record<string, string[]>,
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

export function setOutlinePickMode(mode: OutlinePickMode): void {
  ui.outlinePickMode = mode;
  localStorage.setItem(OUTLINE_PICK_KEY, mode);
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
      if (Array.isArray(opt) && opt.length === 0) {
        out[axis] = [];
        continue;
      }
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

function outlineKeysStorageKey(bookId: string, moduleId: string): string {
  return `reader.outlineKeys.${bookId}.${moduleId}`;
}

function outlineScopeKey(bookId: string, moduleId: string): string {
  return `${bookId}::${moduleId}`;
}

/** Last reconciled available key ids (memory only — for detecting newly appeared tops). */
export const outlineAvailableByScope: Record<string, string[]> = {};

function readStoredOutlineKeys(bookId: string, moduleId: string): string[] | null {
  const raw = localStorage.getItem(outlineKeysStorageKey(bookId, moduleId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return null;
  }
}

/** Selected ruler-key section ids for a book module (reactive). */
export function getOutlineKeySelection(bookId: string, moduleId: string): string[] | null {
  if (!bookId || !moduleId) return null;
  const scope = outlineScopeKey(bookId, moduleId);
  if (!(scope in ui.outlineKeysByScope)) {
    ui.outlineKeysByScope[scope] = readStoredOutlineKeys(bookId, moduleId) ?? [];
  }
  const cur = ui.outlineKeysByScope[scope]!;
  return cur.length ? cur : null;
}

export function setOutlineKeySelection(
  bookId: string,
  moduleId: string,
  ids: string[],
  availableIds?: string[],
): void {
  if (!bookId || !moduleId) return;
  const scope = outlineScopeKey(bookId, moduleId);
  const copy = [...ids];
  ui.outlineKeysByScope[scope] = copy;
  localStorage.setItem(outlineKeysStorageKey(bookId, moduleId), JSON.stringify(copy));
  if (availableIds) {
    outlineAvailableByScope[scope] = [...availableIds];
  }
}
