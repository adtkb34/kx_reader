import { reactive } from 'vue';
import type { PageLayer } from '@shared/types';

export const ui = reactive({
  notesTarget: null as null | { bookId: string; key: string; title: string },
  orphanOpen: false,
  compareOpen: false,
  agentOpen: false,
  /** Bump to force ChapterPage reload after agent writes files. */
  chapterReloadToken: 0,
  detailsOpen: localStorage.getItem('reader.detailsOpen') === '1',
  /** Active reading lens per book; only used when the book declares lenses. */
  lensByBook: {} as Record<string, PageLayer>,
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

export function getStoredLens(bookId: string): PageLayer | null {
  const raw = localStorage.getItem(lensStorageKey(bookId));
  if (typeof raw === 'string' && /^[\w][\w.-]*$/.test(raw)) return raw;
  return null;
}

export function setBookLens(bookId: string, lens: PageLayer): void {
  ui.lensByBook[bookId] = lens;
  localStorage.setItem(lensStorageKey(bookId), lens);
}
