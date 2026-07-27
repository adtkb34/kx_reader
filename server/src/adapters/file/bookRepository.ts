import {
  bookExists,
  getBookToc,
  getChapter,
  listBooks,
  resolveBookAsset,
} from './books';
import type { BookRepository } from '../../ports/books';

export const fileBookRepository: BookRepository = {
  bookExists,
  listBooks,
  getBookToc,
  getChapter,
  resolveBookAsset,
};
