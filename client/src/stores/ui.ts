import { reactive } from 'vue';
import type { LensAxisId, LensSelection, PageLayer } from '@shared/types';
import { normalizeAxisSelection } from '@shared/lenses';

/** Same-axis multi-select vs single-select for the lens tree. */
export type LensAxisPickMode = 'multi' | 'single';

/** Single-page reading vs lens digest (all visible sections in one stream). */
export type LensReadMode = 'page' | 'digest';

const LENS_PICK_KEY = 'reader.lensPickMode';
const LENS_READ_KEY = 'reader.lensReadMode';

function readLensPickMode(): LensAxisPickMode {
  const raw = localStorage.getItem(LENS_PICK_KEY);
  if (raw === 'multi') return 'multi';
  return 'single';
}

function readLensReadMode(): LensReadMode {
  return localStorage.getItem(LENS_READ_KEY) === 'digest' ? 'digest' : 'page';
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
  /** 多选 = same-axis multi; 单选 = one id per axis. */
  lensPickMode: readLensPickMode() as LensAxisPickMode,
  /** 单页 = one chapter; 汇总 = all visible sections under current lens. */
  lensReadMode: readLensReadMode() as LensReadMode,
});

export function setLensPickMode(mode: LensAxisPickMode): void {
  ui.lensPickMode = mode;
  localStorage.setItem(LENS_PICK_KEY, mode);
}

export function setLensReadMode(mode: LensReadMode): void {
  ui.lensReadMode = mode;
  localStorage.setItem(LENS_READ_KEY, mode);
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
