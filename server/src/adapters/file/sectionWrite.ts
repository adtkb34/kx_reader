import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import {
  extractSectionBodies,
  normalizeSectionBody,
} from '../../../../shared/sections';
import { BOOKS_DIR } from '../../config';
import { getBookToc } from './books';

export class SectionWriteError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
    this.name = 'SectionWriteError';
  }
}

async function resolveChapterFile(
  bookId: string,
  chapterId: string,
): Promise<{ abs: string; root: string } | null> {
  const toc = await getBookToc(bookId);
  if (!toc) return null;
  const chapter = toc.chapters.find((c) => c.id === chapterId);
  if (!chapter) return null;
  const root = path.join(BOOKS_DIR, bookId);
  const abs = path.join(root, chapter.file);
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  return { abs, root };
}

function findSectionBody(
  content: string,
  sectionId: string,
): { body: string; title: string } | null {
  const { intro, sections } = extractSectionBodies(content);
  if (sectionId === '_intro') {
    if (intro == null) return null;
    return { body: intro, title: '引言' };
  }
  const hit = sections.find((s) => s.id === sectionId);
  if (!hit) return null;
  return { body: hit.body, title: hit.title };
}

/** Ensure saved markdown keeps the same section id (non-intro). */
export function assertSectionIdPreserved(sectionId: string, markdown: string): void {
  if (sectionId === '_intro') return;
  const { sections } = extractSectionBodies(markdown);
  if (sections.length === 0) {
    throw new SectionWriteError(
      '小节正文须以独占行 {#id} 开头，且 id 与原小节一致',
    );
  }
  if (sections[0].id !== sectionId) {
    throw new SectionWriteError(
      `不可更改小节 id：须保持开头 {#${sectionId}}，当前为 {#${sections[0].id}}`,
    );
  }
}

export function replaceSectionBody(
  content: string,
  sectionId: string,
  newBody: string,
): string {
  const { intro, sections } = extractSectionBodies(content);
  const next = normalizeSectionBody(newBody);
  const parts: string[] = [];

  if (sectionId === '_intro') {
    if (intro == null) {
      throw new SectionWriteError('intro section not found', 404);
    }
    if (next) parts.push(next);
    for (const s of sections) parts.push(s.body);
  } else {
    const idx = sections.findIndex((s) => s.id === sectionId);
    if (idx < 0) {
      throw new SectionWriteError(`section "${sectionId}" not found`, 404);
    }
    if (intro != null && intro.length > 0) parts.push(intro);
    for (let i = 0; i < sections.length; i++) {
      parts.push(i === idx ? next : sections[i].body);
    }
  }

  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

export async function getChapterSection(
  bookId: string,
  chapterId: string,
  sectionId: string,
): Promise<{ id: string; title: string; markdown: string } | null> {
  const resolved = await resolveChapterFile(bookId, chapterId);
  if (!resolved) return null;
  let raw: string;
  try {
    raw = await fs.readFile(resolved.abs, 'utf8');
  } catch {
    return null;
  }
  const fm = matter(raw);
  const hit = findSectionBody(fm.content, sectionId);
  if (!hit) return null;
  return { id: sectionId, title: hit.title, markdown: hit.body };
}

export async function putChapterSection(
  bookId: string,
  chapterId: string,
  sectionId: string,
  markdown: string,
): Promise<{ id: string; title: string; markdown: string }> {
  const resolved = await resolveChapterFile(bookId, chapterId);
  if (!resolved) {
    throw new SectionWriteError('chapter not found', 404);
  }

  assertSectionIdPreserved(sectionId, markdown);

  let raw: string;
  try {
    raw = await fs.readFile(resolved.abs, 'utf8');
  } catch {
    throw new SectionWriteError('chapter file not found', 404);
  }

  const fm = matter(raw);
  const nextContent = replaceSectionBody(fm.content, sectionId, markdown);
  const out = matter.stringify(nextContent.replace(/^\n+/, ''), fm.data);
  const tmp = `${resolved.abs}.tmp`;
  await fs.writeFile(tmp, out, 'utf8');
  await fs.rename(tmp, resolved.abs);

  const hit = findSectionBody(nextContent, sectionId);
  if (!hit) {
    throw new SectionWriteError('section missing after write', 500);
  }
  return { id: sectionId, title: hit.title, markdown: hit.body };
}
