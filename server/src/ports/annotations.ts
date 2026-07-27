import type { SectionStatus } from '../../../shared/annotations';
import type { BookAnnotations, Note, SectionAnnotation } from '../../../shared/types';

/**
 * Annotation persistence port.
 * File adapter today; DB + user dimension later without changing HTTP handlers.
 */
export interface AnnotationStore {
  getBook(bookId: string): Promise<BookAnnotations>;
  setStatus(
    bookId: string,
    sectionId: string,
    status: SectionStatus,
  ): Promise<SectionAnnotation | null>;
  addNote(bookId: string, sectionId: string, text: string): Promise<Note>;
  updateNote(
    bookId: string,
    sectionId: string,
    noteId: string,
    text: string,
  ): Promise<Note | null>;
  deleteNote(bookId: string, sectionId: string, noteId: string): Promise<boolean>;
  deleteSection(bookId: string, sectionId: string): Promise<void>;
}
