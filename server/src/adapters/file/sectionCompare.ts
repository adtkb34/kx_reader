import matter from 'gray-matter';
import {
  compareMarkdownBySectionId,
  type ChapterCompareResult,
  type CompareMode,
} from '../../../../shared/sectionDiff';
import { getBookToc } from './books';
import { GitError, resolveRef, showBookFile } from './gitHistory';

const MODES = new Set<CompareMode>(['unified', 'sideBySide']);

export function parseCompareMode(raw: unknown): CompareMode {
  if (typeof raw === 'string' && MODES.has(raw as CompareMode)) {
    return raw as CompareMode;
  }
  return 'unified';
}

function bodyOnly(raw: string): string {
  if (!raw) return '';
  return matter(raw).content;
}

export async function compareChapterAtRefs(
  bookId: string,
  chapterId: string,
  fromRef: string,
  toRef: string,
  mode: CompareMode,
): Promise<ChapterCompareResult> {
  const toc = await getBookToc(bookId);
  if (!toc) throw new GitError('book not found', 404);
  const chapter = toc.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new GitError('chapter not found', 404);

  const fromSha = await resolveRef(bookId, fromRef);
  const toSha = await resolveRef(bookId, toRef);
  const [fromRaw, toRaw] = await Promise.all([
    showBookFile(bookId, fromRef, chapter.file),
    showBookFile(bookId, toRef, chapter.file),
  ]);

  const sections = compareMarkdownBySectionId(bodyOnly(fromRaw), bodyOnly(toRaw));
  return {
    from: fromSha,
    to: toSha,
    mode,
    sections,
  };
}
