import matter from 'gray-matter';
import {
  compareMarkdownBySectionId,
  type ChapterCompareResult,
  type CompareMode,
  type SectionCompareItem,
} from '../../../../shared/sectionDiff';
import { findLeafModule } from '../../../../shared/ruler';
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

/**
 * Compare chapter(s) at two refs.
 * Single-page leaf modules expand to every md under that directory.
 */
export async function compareChapterAtRefs(
  bookId: string,
  chapterId: string,
  fromRef: string,
  toRef: string,
  mode: CompareMode,
): Promise<ChapterCompareResult> {
  const toc = await getBookToc(bookId);
  if (!toc) throw new GitError('book not found', 404);
  const seed = toc.chapters.find((c) => c.id === chapterId);
  if (!seed) throw new GitError('chapter not found', 404);

  const mod = findLeafModule(toc, chapterId);
  const chapterIds = mod?.chapterIds?.length ? mod.chapterIds : [chapterId];

  const fromSha = await resolveRef(bookId, fromRef);
  const toSha = await resolveRef(bookId, toRef);

  const multi = chapterIds.length > 1;
  const sections: SectionCompareItem[] = [];

  for (const id of chapterIds) {
    const chapter = toc.chapters.find((c) => c.id === id);
    if (!chapter) continue;
    const [fromRaw, toRaw] = await Promise.all([
      showBookFile(bookId, fromRef, chapter.file),
      showBookFile(bookId, toRef, chapter.file),
    ]);
    const part = compareMarkdownBySectionId(bodyOnly(fromRaw), bodyOnly(toRaw));
    for (const s of part) {
      sections.push({
        ...s,
        id: multi ? `${id}#${s.id}` : s.id,
        title: multi ? `${chapter.title} · ${s.title}` : s.title,
        chapterId: id,
        chapterTitle: chapter.title,
        file: chapter.file,
      });
    }
  }

  return {
    from: fromSha,
    to: toSha,
    mode,
    sections,
  };
}
