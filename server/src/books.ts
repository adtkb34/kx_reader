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
  LensCorrespondence,
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
  /**
   * Cross-lens page groups: lens id → chapter id.
   * Also derives each page's layer; pages not listed are always-visible.
   */
  correspondences?: LensCorrespondence[];
}

/** Book id / single path segment. */
const SAFE_SEGMENT = /^[\w][\w.-]*$/;
/** Relative file under book root, no `..`. */
const SAFE_REL_FILE = /^[\w][\w./-]*\.md$/;
/** Relative asset under book `assets/`, no `..`. */
const SAFE_ASSET_REL = /^[\w][\w./-]*\.(?:jpg|jpeg|png|webp|gif)$/i;

const ASSET_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export interface BookAsset {
  absPath: string;
  contentType: string;
}

function isSafeBookId(bookId: string): boolean {
  return SAFE_SEGMENT.test(bookId);
}

function isSafeRelFile(file: string): boolean {
  return SAFE_REL_FILE.test(file) && !file.includes('..');
}

function isSafeAssetRel(rel: string): boolean {
  return SAFE_ASSET_REL.test(rel) && !rel.includes('..');
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

/**
 * Parse correspondences from book.json. Keys must be lens ids; values are chapter ids.
 * Invalid rows / duplicate chapter ids are dropped with warnings.
 */
function parseCorrespondences(
  bookId: string,
  raw: unknown,
  lensIds: Set<string>,
  pageIds: Set<string>,
): LensCorrespondence[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: LensCorrespondence[] = [];
  const claimed = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      console.warn(`book ${bookId}: correspondences[${i}] is not an object; skipping`);
      continue;
    }
    const row: LensCorrespondence = {};
    let ok = true;
    for (const [lens, chapterId] of Object.entries(item as Record<string, unknown>)) {
      if (!lensIds.has(lens)) {
        console.warn(
          `book ${bookId}: correspondences[${i}] key "${lens}" is not a declared lens; skipping row`,
        );
        ok = false;
        break;
      }
      if (typeof chapterId !== 'string' || !SAFE_SEGMENT.test(chapterId)) {
        console.warn(
          `book ${bookId}: correspondences[${i}].${lens} is not a valid chapter id; skipping row`,
        );
        ok = false;
        break;
      }
      if (!pageIds.has(chapterId)) {
        console.warn(
          `book ${bookId}: correspondences[${i}].${lens}="${chapterId}" is not a page; skipping row`,
        );
        ok = false;
        break;
      }
      if (claimed.has(chapterId)) {
        console.warn(
          `book ${bookId}: chapter "${chapterId}" appears in multiple correspondences; skipping later row`,
        );
        ok = false;
        break;
      }
      row[lens] = chapterId;
    }
    if (!ok || Object.keys(row).length === 0) continue;
    for (const id of Object.values(row)) claimed.add(id);
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

/** Assign chapter.layer from which lens key lists the chapter in correspondences. */
function applyCorrespondences(
  bookId: string,
  pages: TocChapter[],
  correspondences: LensCorrespondence[],
): void {
  const byId = new Map(pages.map((p) => [p.id, p]));
  for (const row of correspondences) {
    for (const [lens, chapterId] of Object.entries(row)) {
      const page = byId.get(chapterId);
      if (!page) continue;
      if (page.layer && page.layer !== lens) {
        console.warn(
          `book ${bookId}: page "${chapterId}" claimed by lenses "${page.layer}" and "${lens}"; keeping "${page.layer}"`,
        );
        continue;
      }
      page.layer = lens;
    }
  }
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
  if (fm.data.layer != null || fm.data.pair != null) {
    console.warn(
      `book ${bookId}: page "${id}" has frontmatter layer/pair; ignored — use book.json correspondences`,
    );
  }
  return {
    id,
    title,
    file,
    sections: all,
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
  const pageIds = new Set(pages.map((p) => p.id));
  const correspondences =
    lenses && lenses.length > 0
      ? parseCorrespondences(
          bookId,
          manifest.correspondences,
          new Set(lenses.map((l) => l.id)),
          pageIds,
        )
      : undefined;
  if (correspondences) {
    applyCorrespondences(bookId, pages, correspondences);
  }

  return {
    id: bookId,
    title: manifest.title ?? bookId,
    description: manifest.description,
    ...(lenses ? { lenses } : {}),
    ...(correspondences ? { correspondences } : {}),
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

/**
 * Resolve a book-local asset under `assets/`. Returns null if the book or file
 * is missing, or if the path escapes the assets root / fails the extension allowlist.
 */
export async function resolveBookAsset(
  bookId: string,
  assetPath: string,
): Promise<BookAsset | null> {
  if (!isSafeBookId(bookId)) return null;
  const normalized = assetPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!isSafeAssetRel(normalized)) return null;

  const assetsRoot = path.resolve(BOOKS_DIR, bookId, 'assets');
  const abs = path.resolve(assetsRoot, normalized);
  if (!abs.startsWith(assetsRoot + path.sep) && abs !== assetsRoot) return null;

  const ext = path.extname(abs).toLowerCase();
  const contentType = ASSET_CONTENT_TYPES[ext];
  if (!contentType) return null;

  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  return { absPath: abs, contentType };
}
