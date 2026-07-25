import { reactive } from 'vue';
import type { LensAxisId, LensSelection, PageLayer } from '@shared/types';

export const ui = reactive({
  notesTarget: null as null | { bookId: string; key: string; title: string },
  orphanOpen: false,
  compareOpen: false,
  agentOpen: false,
  /** Bump to force ChapterPage reload after agent writes files. */
  chapterReloadToken: 0,
  detailsOpen: localStorage.getItem('reader.detailsOpen') === '1',
  /** Active multi-axis lens selection per book. */
  lensByBook: {} as Record<string, LensSelection>,
});

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

function lensStorageKey(bookId: string): string {
  return `reader.lens.${bookId}`;
}

function isOptionId(s: string): boolean {
  return /^[\w][\w.-]*$/.test(s);
}

/** Load stored multi-axis selection; migrates legacy single-string to `{ kind: value }`. */
export function getStoredLensSelection(bookId: string): LensSelection | null {
  const raw = localStorage.getItem(lensStorageKey(bookId));
  if (!raw) return null;
  if (isOptionId(raw) && !raw.startsWith('{')) {
    return { kind: raw };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: LensSelection = {};
    for (const [axis, opt] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof opt === 'string' && isOptionId(axis) && isOptionId(opt)) out[axis] = opt;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function setBookLensSelection(bookId: string, selection: LensSelection): void {
  ui.lensByBook[bookId] = { ...selection };
  localStorage.setItem(lensStorageKey(bookId), JSON.stringify(selection));
}

export function setBookAxisLens(
  bookId: string,
  axis: LensAxisId,
  option: PageLayer,
  base: LensSelection,
): LensSelection {
  const next = { ...base, [axis]: option };
  setBookLensSelection(bookId, next);
  return next;
}
