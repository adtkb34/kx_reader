import type { SectionStatus } from './annotations';

export interface BookSummary {
  id: string;
  title: string;
  description?: string;
  chapterCount: number;
}

/** Reading lens id; each book declares its own ids in book.json `lenses`. */
export type PageLayer = string;

export interface BookLens {
  id: PageLayer;
  title: string;
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
   * Derived from book.json `correspondences` (which lens key lists this page).
   * Omit = always visible under every lens.
   */
  layer?: PageLayer;
}

/**
 * One topic across lenses: lens id → chapter id.
 * Multi-key rows define switch targets; single-key rows are membership only.
 */
export type LensCorrespondence = Record<PageLayer, string>;

/** Nested TOC: groups are folders only; pages are leaves. */
export type TocTreeNode =
  | { type: 'group'; id: string; title: string; children: TocTreeNode[] }
  | { type: 'page'; id: string; title: string; file: string };

export interface BookToc {
  id: string;
  title: string;
  description?: string;
  /** When set, reader shows a lens switcher and filters TOC / prev-next. */
  lenses?: BookLens[];
  /**
   * Cross-lens page groups from book.json. Also used to derive chapter.layer.
   */
  correspondences?: LensCorrespondence[];
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
  /** 标记为已读/确认时记下的小节正文 hash；内容变则刷新时打回未读 */
  contentHash?: string;
  notes: Note[];
}

/** key 形如 `chapterId#sectionId` */
export type AnnotationMap = Record<string, SectionAnnotation>;

export interface BookAnnotations {
  version: 1;
  bookId: string;
  sections: AnnotationMap;
}
