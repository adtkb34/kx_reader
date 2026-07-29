import type { SectionStatus } from './annotations';

export interface BookSummary {
  id: string;
  title: string;
  description?: string;
  chapterCount: number;
}

/** Lens option id within an axis; book-defined. */
export type PageLayer = string;

/** Axis id in book.json `lenses` object keys (e.g. kind, audience). */
export type LensAxisId = string;

export interface BookLens {
  id: PageLayer;
  title: string;
  /** Nested dimension options; omit or empty = leaf. */
  children?: BookLens[];
}

export interface TocSection {
  id: string;
  title: string;
  level: number;
}

/** Leaf page (one markdown file = one flipable page). */
export interface TocChapter {
  id: string;
  title: string;
  file: string;
  sections: TocSection[];
  /**
   * Per-axis membership from page `lenses` in book.json (leaf option ids only).
   * One option or several (same page under multiple options).
   * Omit an axis (or omit `layers`) = always visible on that axis.
   */
  layers?: Record<LensAxisId, PageLayer | PageLayer[]>;
  /**
   * Per-axis, per-option section allowlists from page `lenses` (string[] values).
   * Missing option = show all sections for that leaf.
   */
  sectionAllowlists?: Record<LensAxisId, Partial<Record<PageLayer, string[]>>>;
}

/** Nested TOC: groups are folders only; pages are leaves. */
export type TocTreeNode =
  | { type: 'group'; id: string; title: string; children: TocTreeNode[] }
  | { type: 'page'; id: string; title: string; file: string };

/** Active selection: axis id → selected tree node ids (multi-select; parents allowed). */
export type LensSelection = Record<LensAxisId, PageLayer[]>;

export interface BookToc {
  id: string;
  title: string;
  description?: string;
  /**
   * Multi-axis lenses: axis id → options.
   * Legacy single-array books are normalized to `{ kind: [...] }`.
   */
  lenses?: Record<LensAxisId, BookLens[]>;
  /** Nested sidebar tree (groups + pages). */
  tree: TocTreeNode[];
  /** Leaf pages in DFS reading / prev-next order (always flat). */
  chapters: TocChapter[];
}

export interface ChapterContent {
  id: string;
  title: string;
  markdown: string;
}

export interface Note {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface SectionAnnotation {
  status: SectionStatus;
  statusUpdatedAt?: string;
  notes: Note[];
}

/** key 形如 `chapterId#sectionId` */
export type AnnotationMap = Record<string, SectionAnnotation>;

export interface BookAnnotations {
  version: 1;
  bookId: string;
  sections: AnnotationMap;
}
