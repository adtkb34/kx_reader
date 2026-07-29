import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { BOOKS_DIR } from '../../config';
import { extractSections } from '../../../../shared/sections';
import type {
  BookLens,
  BookSummary,
  BookToc,
  ChapterContent,
  LensAxisId,
  PageLayer,
  TocChapter,
  TocTreeNode,
} from '../../../../shared/types';
import { lensLeafIds } from '../../../../shared/lenses';
import type { BookAsset, BookRepository } from '../../ports/books';

export type { BookAsset, BookRepository };

/** Per-axis: option id → true (whole page) or section id allowlist. */
type ManifestPageLenses = Record<LensAxisId, Record<string, true | string[]>>;

interface ManifestPage {
  type: 'page';
  id?: string;
  file: string;
  lenses?: ManifestPageLenses;
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
  /** Multi-axis lenses, or legacy flat array (normalized to `{ kind: [...] }`). */
  lenses?: BookLens[] | Record<string, BookLens[]>;
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

function isSafeBookId(bookId: string): boolean {
  return SAFE_SEGMENT.test(bookId);
}

function isSafeRelFile(file: string): boolean {
  return SAFE_REL_FILE.test(file) && !file.includes('..');
}

function isSafeAssetRel(rel: string): boolean {
  return SAFE_ASSET_REL.test(rel) && !rel.includes('..');
}

function parseLensNode(
  bookId: string,
  axis: string,
  item: unknown,
  seenOptionIds: Set<string>,
): BookLens | null {
  if (!item || typeof item !== 'object') return null;
  const id = (item as { id?: unknown }).id;
  const title = (item as { title?: unknown }).title;
  if (typeof id !== 'string' || !SAFE_SEGMENT.test(id)) {
    console.warn(`book ${bookId}: lenses.${axis} has invalid or empty id; skipping option`);
    return null;
  }
  if (seenOptionIds.has(id)) {
    console.warn(`book ${bookId}: lens option id "${id}" reused across axes; skipping`);
    return null;
  }
  if (typeof title !== 'string' || !title) return null;
  seenOptionIds.add(id);

  const rawChildren = (item as { children?: unknown }).children;
  let children: BookLens[] | undefined;
  if (Array.isArray(rawChildren) && rawChildren.length > 0) {
    children = [];
    for (const child of rawChildren) {
      const parsed = parseLensNode(bookId, axis, child, seenOptionIds);
      if (parsed) children.push(parsed);
    }
    if (children.length === 0) children = undefined;
  }

  return children ? { id, title, children } : { id, title };
}

function parseLensOptions(
  bookId: string,
  axis: string,
  raw: unknown,
  seenOptionIds: Set<string>,
): BookLens[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: BookLens[] = [];
  for (const item of raw) {
    const node = parseLensNode(bookId, axis, item, seenOptionIds);
    if (node) out.push(node);
  }
  return out.length > 0 ? out : undefined;
}

/** Normalize lenses to Record<axis, options>. Legacy array → `{ kind: [...] }`. */
function parseLenses(
  bookId: string,
  raw: unknown,
): Record<LensAxisId, BookLens[]> | undefined {
  if (raw == null) return undefined;
  const seenOptionIds = new Set<string>();

  if (Array.isArray(raw)) {
    const opts = parseLensOptions(bookId, 'kind', raw, seenOptionIds);
    return opts ? { kind: opts } : undefined;
  }

  if (typeof raw !== 'object') return undefined;
  const out: Record<LensAxisId, BookLens[]> = {};
  for (const [axis, options] of Object.entries(raw as Record<string, unknown>)) {
    if (!SAFE_SEGMENT.test(axis)) {
      console.warn(`book ${bookId}: lenses axis "${axis}" is not a valid id; skipping`);
      continue;
    }
    const opts = parseLensOptions(bookId, axis, options, seenOptionIds);
    if (opts) out[axis] = opts;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Apply page.lenses from the manifest onto TocChapter.layers / sectionAllowlists.
 */
function applyPageLenses(
  bookId: string,
  page: TocChapter,
  raw: ManifestPageLenses | undefined,
  bookLenses: Record<LensAxisId, BookLens[]> | undefined,
): void {
  if (!raw || !bookLenses) return;
  const knownSections = new Set(page.sections.map((s) => s.id));

  for (const [axis, options] of Object.entries(raw)) {
    if (!bookLenses[axis]) {
      console.warn(`book ${bookId}: page "${page.id}" lenses axis "${axis}" is undeclared; skipping`);
      continue;
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      console.warn(`book ${bookId}: page "${page.id}" lenses.${axis} must be an object; skipping`);
      continue;
    }
    const allowed = lensLeafIds(bookLenses[axis]);
    const membership: PageLayer[] = [];

    for (const [optionId, spec] of Object.entries(options)) {
      if (!allowed.has(optionId)) {
        console.warn(
          `book ${bookId}: page "${page.id}" lenses.${axis}.${optionId} must be a leaf option id; skipping`,
        );
        continue;
      }
      if (spec === true) {
        membership.push(optionId);
        continue;
      }
      if (
        !Array.isArray(spec) ||
        spec.length === 0 ||
        !spec.every((s) => typeof s === 'string' && s.length > 0)
      ) {
        console.warn(
          `book ${bookId}: page "${page.id}" lenses.${axis}.${optionId} must be true or a non-empty string array; skipping`,
        );
        continue;
      }
      const valid: string[] = [];
      for (const sid of spec) {
        if (!knownSections.has(sid)) {
          console.warn(
            `book ${bookId}: page "${page.id}" lenses.${axis}.${optionId} unknown section "${sid}"; dropping`,
          );
          continue;
        }
        valid.push(sid);
      }
      if (valid.length === 0) continue;
      membership.push(optionId);
      page.sectionAllowlists ??= {};
      page.sectionAllowlists[axis] ??= {};
      page.sectionAllowlists[axis][optionId] = valid;
    }

    if (membership.length === 1) {
      page.layers ??= {};
      page.layers[axis] = membership[0];
    } else if (membership.length > 1) {
      page.layers ??= {};
      page.layers[axis] = membership;
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

async function loadPage(
  bookId: string,
  file: string,
  manifestId?: string,
): Promise<TocChapter | null> {
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
  const rawId = fm.data.id;
  const fmId =
    typeof rawId === 'string' && rawId
      ? rawId
      : typeof rawId === 'number' && Number.isFinite(rawId)
        ? String(rawId)
        : path.basename(file, '.md');
  if (manifestId) {
    if (!SAFE_SEGMENT.test(manifestId)) {
      console.warn(`book ${bookId}: page file "${file}" has invalid manifest id "${manifestId}"`);
      return null;
    }
    if (fmId !== manifestId) {
      console.warn(
        `book ${bookId}: page "${manifestId}" frontmatter id "${fmId}" does not match book.json; refusing`,
      );
      return null;
    }
  }
  const id = manifestId ?? fmId;
  const title = typeof fm.data.title === 'string' && fm.data.title ? fm.data.title : id;
  const { sections, hasIntro } = extractSections(fm.content);
  const all = hasIntro ? [{ id: '_intro', title: '引言', level: 2 }, ...sections] : sections;
  if (fm.data.layer != null || fm.data.pair != null) {
    console.warn(
      `book ${bookId}: page "${id}" has frontmatter layer/pair; ignored — use book.json page.lenses`,
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
  bookLenses: Record<LensAxisId, BookLens[]> | undefined,
): Promise<void> {
  for (const node of nodes) {
    if (node.type === 'page') {
      if (!node.file) continue;
      if (!node.id) {
        console.warn(
          `book ${bookId}: page file "${node.file}" missing id in book.json; using frontmatter id`,
        );
      }
      const page = await loadPage(bookId, node.file, node.id);
      if (!page) continue;
      if (seenIds.has(page.id)) {
        throw new Error(`duplicate page id "${page.id}" in book ${bookId}`);
      }
      seenIds.add(page.id);
      applyPageLenses(bookId, page, node.lenses, bookLenses);
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
      await walkContents(bookId, node.children ?? [], children, pages, seenIds, bookLenses);
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

  const lenses = parseLenses(bookId, manifest.lenses);
  const tree: TocTreeNode[] = [];
  const pages: TocChapter[] = [];
  const seenIds = new Set<string>();
  try {
    await walkContents(bookId, legacyContents(manifest), tree, pages, seenIds, lenses);
  } catch (e) {
    console.error(e);
    return null;
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
