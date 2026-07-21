import { reactive } from 'vue';
import { api } from '@/api';
import type { BookSummary, BookToc } from '@shared/types';

export const booksState = reactive({
  books: [] as BookSummary[],
  booksLoaded: false,
  tocs: {} as Record<string, BookToc>,
});

export async function loadBooks(): Promise<void> {
  booksState.books = await api.books();
  booksState.booksLoaded = true;
}

export async function loadToc(bookId: string, force = false): Promise<BookToc> {
  if (!force && booksState.tocs[bookId]) return booksState.tocs[bookId];
  const toc = await api.toc(bookId);
  booksState.tocs[bookId] = toc;
  return toc;
}

export function tocOf(bookId: string): BookToc | undefined {
  return booksState.tocs[bookId];
}
