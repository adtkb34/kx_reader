import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import {
  extractSectionBodies,
  normalizeSectionBody,
} from '../../shared/sections';
import { BOOKS_DIR } from './config';
import { getBookToc } from './books';

export function hashSectionBody(body: string): string {
  return createHash('sha256').update(normalizeSectionBody(body), 'utf8').digest('hex');
}

/** 全书所有可标记小节的当前内容 hash，键为 `chapterId#sectionId`。 */
export async function getBookSectionHashes(bookId: string): Promise<Record<string, string>> {
  const toc = await getBookToc(bookId);
  if (!toc) return {};

  const out: Record<string, string> = {};
  const root = path.join(BOOKS_DIR, bookId);

  for (const ch of toc.chapters) {
    const abs = path.join(root, ch.file);
    if (!abs.startsWith(root + path.sep)) continue;
    let raw: string;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch {
      continue;
    }
    const fm = matter(raw);
    const { intro, sections } = extractSectionBodies(fm.content);
    if (intro != null) out[`${ch.id}#_intro`] = hashSectionBody(intro);
    for (const s of sections) {
      out[`${ch.id}#${s.id}`] = hashSectionBody(s.body);
    }
  }

  return out;
}
