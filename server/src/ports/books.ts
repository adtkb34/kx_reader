import type { BookSummary, BookToc, ChapterContent } from '../../../shared/types';

export interface BookAsset {
  absPath: string;
  contentType: string;
}

/**
 * Book content port (TOC, chapter markdown, assets).
 * File-backed today; swappable later.
 */
export interface BookRepository {
  bookExists(bookId: string): Promise<boolean>;
  listBooks(): Promise<BookSummary[]>;
  getBookToc(bookId: string): Promise<BookToc | null>;
  getChapter(bookId: string, chapterId: string): Promise<ChapterContent | null>;
  resolveBookAsset(bookId: string, assetPath: string): Promise<BookAsset | null>;
}
