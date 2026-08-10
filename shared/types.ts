import type { SectionStatus } from './annotations';

export interface BookSummary {
  id: string;
  title: string;
  description?: string;
  chapterCount: number;
}

/** Lens option id within an axis; book-defined. */
export type PageLayer = string;

/** Axis id = top-level `lenses[].id`. */
export type LensAxisId = string;

export interface BookLens {
  id: PageLayer;
  title: string;
  /** Optional accent for tags / legend (e.g. `#6d86a0`). */
  color?: string;
  /** Nested options; omit or empty = leaf. */
  children?: BookLens[];
}

export interface TocSection {
  id: string;
  title: string;
  /** Markdown heading level (h2–h6), not content rank. */
  level: number;
  /** Optional content rank from `{#id rank=N}`; omit = no rank filter. */
  rank?: number;
}

/** Leaf page role in a ruler module. */
export type PageRole = 'ruler' | 'page';

/**
 * Ruler assemble config from book.json.
 * Default pick is always「按 index」; `axes` lists lens axes that may replace it.
 */
export interface BookRuler {
  /** Lens axes selectable as ruler (declaration order = dropdown order). */
  axes?: LensAxisId[];
  /** index.md section id → hung section ids from other files (display order). */
  links: Record<string, string[]>;
}

/** Active ruler pick: index skeleton, or a lens axis id from `ruler.axes`. */
export type RulerPick = 'index' | LensAxisId;

/** Leaf page (one markdown file = one flipable page). */
export interface TocChapter {
  id: string;
  title: string;
  file: string;
  sections: TocSection[];
  /**
   * `ruler` = module index skeleton (default assemble backbone).
   * `page` or omit = normal dimension/content page. Manifest page item wins over frontmatter.
   */
  role?: PageRole;
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
  /**
   * Max content rank to show on this page (frontmatter or book.json page item;
   * page item wins). Omit = no rank filtering. Sections with `rank > showLevel` hide.
   */
  showLevel?: number;
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
   * Multi-axis lenses: axis id → option tree (from top-level `lenses[]`).
   * Axis display titles live in `lensAxisTitles`.
   */
  lenses?: Record<LensAxisId, BookLens[]>;
  /** Axis id → title from `lenses[].title` (ordered via `lensAxisOrder`). */
  lensAxisTitles?: Record<LensAxisId, string>;
  /** Axis ids from `lenses[]` in declaration order. */
  lensAxisOrder?: LensAxisId[];
  /**
   * Optional module assemble config (`ruler.links` / `ruler.axes`).
   * Also set (with empty links) when the book has `role: "ruler"` pages but no
   * explicit `ruler` object — enables leaf-module navigation + index assemble.
   */
  ruler?: BookRuler;
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
