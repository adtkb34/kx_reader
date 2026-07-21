import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { BOOKS_DIR } from './config';
import { extractSections } from '../../shared/sections';
import type {
  BookLens,
  BookSummary,
  BookToc,
  ChapterContent,
  PageLayer,
  TocChapter,
  TocTreeNode,
} from '../../shared/types';

interface ManifestPage {
  type: 'page';
  file: string;
}

interface ManifestGroup {
  type: 'group';
  id: string;
  title: string;
  children: ManifestNode[];
}

type ManifestNode = ManifestPage | ManifestGroup;

interface BookManifest {
  title?: string;
  description?: string;
  /** Legacy flat list of markdown files. */
  chapters?: string[];
  /** Nested tree; preferred when present. */
  contents?: ManifestNode[];
  /** Optional reading lenses (ids are book-defined, e.g. rules/ui or scenario/impl). */
  lenses?: BookLens[];
}

/** Book id / single path segment. */
const SAFE_SEGMENT = /^[\w][\w.-]*$/;
/** Relative file under book root, no `..`. */
const SAFE_REL_FILE = /^[\w][\w./-]*\.md$/;

function isSafeBookId(bookId: string): boolean {
  return SAFE_SEGMENT.test(bookId);
}

function isSafeRelFile(file: string): boolean {
  return SAFE_REL_FILE.test(file) && !file.includes('..');
}

function parseLayer(raw: unknown): PageLayer | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  return SAFE_SEGMENT.test(raw) ? raw : undefined;
}

function parsePair(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  return SAFE_SEGMENT.test(raw) ? raw : undefined;
}

function parseLenses(raw: unknown): BookLens[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: BookLens[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown }).id;
    const title = (item as { title?: unknown }).title;
    if (typeof id !== 'string' || !SAFE_SEGMENT.test(id) || seen.has(id)) continue;
    if (typeof title !== 'string' || !title) continue;
    seen.add(id);
    out.push({ id, title });
  }
  return out.length > 0 ? out : undefined;
}

async function readManifest(bookId: string): Promise<BookManifest | null> {
  if (!isSafeBookId(bookId)) return null;
  try {
    const raw = await fs.readFile(path.join(BOOKS_DIR, bookId, 'book.json'), 'utf8');
    return JSON.parse(raw) as BookManifest;
  } catch {
    return null;
  }
}

export async function bookExists(bookId: string): Promise<boolean> {
  return (await readManifest(bookId)) != null;
}

export async function listBooks(): Promise<BookSummary[]> {
  let entries;
  try {
    entries = await fs.readdir(BOOKS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const books: BookSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = await readManifest(entry.name);
    if (!manifest) continue;
    const toc = await getBookToc(entry.name);
    books.push({
      id: entry.name,
      title: manifest.title ?? entry.name,
      description: manifest.description,
      chapterCount: toc?.chapters.length ?? 0,
    });
  }
  return books.sort((a, b) => a.id.localeCompare(b.id));
}

async function loadPage(bookId: string, file: string): Promise<TocChapter | null> {
  if (!isSafeRelFile(file)) return null;
  const abs = path.join(BOOKS_DIR, bookId, file);
  const root = path.join(BOOKS_DIR, bookId);
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  let raw: string;
  try {
    raw = await fs.readFile(abs, 'utf8');
  } catch {
    return null;
  }
  const fm = matter(raw);
  const id =
    typeof fm.data.id === 'string' && fm.data.id ? fm.data.id : path.basename(file, '.md');
  const title = typeof fm.data.title === 'string' && fm.data.title ? fm.data.title : id;
  const { sections, hasIntro } = extractSections(fm.content);
  const all = hasIntro ? [{ id: '_intro', title: '引言', level: 2 }, ...sections] : sections;
  const layer = parseLayer(fm.data.layer);
  const pair = parsePair(fm.data.pair);
  return {
    id,
    title,
    file,
    sections: all,
    ...(layer ? { layer } : {}),
    ...(pair ? { pair } : {}),
  };
}

async function walkContents(
  bookId: string,
  nodes: ManifestNode[],
  tree: TocTreeNode[],
  pages: TocChapter[],
  seenIds: Set<string>,
): Promise<void> {
  for (const node of nodes) {
    if (node.type === 'page') {
      const page = await loadPage(bookId, node.file);
      if (!page) continue;
      if (seenIds.has(page.id)) {
        throw new Error(`duplicate page id "${page.id}" in book ${bookId}`);
      }
      seenIds.add(page.id);
      pages.push(page);
      tree.push({ type: 'page', id: page.id, title: page.title, file: page.file });
      continue;
    }
    if (node.type === 'group') {
      if (!node.id || !SAFE_SEGMENT.test(node.id)) continue;
      if (seenIds.has(node.id)) {
        throw new Error(`duplicate group/page id "${node.id}" in book ${bookId}`);
      }
      seenIds.add(node.id);
      const children: TocTreeNode[] = [];
      await walkContents(bookId, node.children ?? [], children, pages, seenIds);
      tree.push({ type: 'group', id: node.id, title: node.title || node.id, children });
    }
  }
}

function legacyContents(manifest: BookManifest): ManifestNode[] {
  if (Array.isArray(manifest.contents) && manifest.contents.length > 0) {
    return manifest.contents;
  }
  return (manifest.chapters ?? []).map((file) => ({ type: 'page' as const, file }));
}

export async function getBookToc(bookId: string): Promise<BookToc | null> {
  const manifest = await readManifest(bookId);
  if (!manifest) return null;

  const tree: TocTreeNode[] = [];
  const pages: TocChapter[] = [];
  const seenIds = new Set<string>();
  try {
    await walkContents(bookId, legacyContents(manifest), tree, pages, seenIds);
  } catch (e) {
    console.error(e);
    return null;
  }

  const lenses = parseLenses(manifest.lenses);
  if (lenses) {
    const allowed = new Set(lenses.map((l) => l.id));
    for (const page of pages) {
      if (page.layer && !allowed.has(page.layer)) {
        console.warn(
          `book ${bookId}: page "${page.id}" layer "${page.layer}" not in lenses; dropping layer`,
        );
        delete page.layer;
      }
    }
  }

  return {
    id: bookId,
    title: manifest.title ?? bookId,
    description: manifest.description,
    ...(lenses ? { lenses } : {}),
    tree,
    chapters: pages,
  };
}

export async function getChapter(
  bookId: string,
  chapterId: string,
): Promise<ChapterContent | null> {
  const toc = await getBookToc(bookId);
  if (!toc) return null;
  const chapter = toc.chapters.find((c) => c.id === chapterId);
  if (!chapter) return null;
  const abs = path.join(BOOKS_DIR, bookId, chapter.file);
  const raw = await fs.readFile(abs, 'utf8');
  const fm = matter(raw);
  return { id: chapter.id, title: chapter.title, markdown: fm.content };
}
