import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { BOOKS_DIR } from '../../config';
import { extractSections } from '../../../../shared/sections';
import type {
  BookLens,
  BookRuler,
  BookSummary,
  BookToc,
  ChapterContent,
  LensAxisId,
  PageLayer,
  TocChapter,
  TocTreeNode,
} from '../../../../shared/types';
import { findLensNode, lensLeafIds } from '../../../../shared/lenses';
import type { BookAsset, BookRepository } from '../../ports/books';

export type { BookAsset, BookRepository };

/** Per-axis: option id → true (whole page) or section id allowlist. */
type ManifestPageLenses = Record<LensAxisId, Record<string, true | string[]>>;


interface BookManifest {
  title?: string;
  description?: string;
  /** Nested TOC tree: page = `{ id, file, lenses? }`, group = `{ id, title, children }`. */
  contents?: unknown[];
  /** Top-level array of axes; each node has `id` + `title` (+ optional `children`). */
  lenses?: BookLens[];
  /** Optional ruler-mode: key sections → linked section ids. */
  ruler?: unknown;
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

const LENS_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function parseLensColor(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const color = raw.trim();
  return LENS_COLOR_RE.test(color) ? color : undefined;
}

function parseLensTreeNode(
  bookId: string,
  item: unknown,
  seenOptionIds: Set<string>,
): BookLens | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const id = (item as { id?: unknown }).id;
  const title = (item as { title?: unknown }).title;
  if (typeof id !== 'string' || !SAFE_SEGMENT.test(id)) {
    console.warn(`book ${bookId}: lenses node has invalid id; skipping`);
    return null;
  }
  if (typeof title !== 'string' || !title) {
    console.warn(`book ${bookId}: lenses "${id}" missing title; skipping`);
    return null;
  }
  if (seenOptionIds.has(id)) {
    console.warn(`book ${bookId}: lens option id "${id}" reused; skipping`);
    return null;
  }
  seenOptionIds.add(id);

  const color = parseLensColor((item as { color?: unknown }).color);
  if ((item as { color?: unknown }).color != null && !color) {
    console.warn(`book ${bookId}: lenses "${id}" has invalid color; ignoring`);
  }

  const rawChildren = (item as { children?: unknown }).children;
  let children: BookLens[] | undefined;
  if (Array.isArray(rawChildren) && rawChildren.length > 0) {
    children = [];
    for (const child of rawChildren) {
      const parsed = parseLensTreeNode(bookId, child, seenOptionIds);
      if (parsed) children.push(parsed);
    }
    if (children.length === 0) children = undefined;
  }
  return {
    id,
    title,
    ...(color ? { color } : {}),
    ...(children ? { children } : {}),
  };
}

interface ParsedLenses {
  lenses: Record<LensAxisId, BookLens[]>;
  lensAxisTitles: Record<LensAxisId, string>;
  lensAxisOrder: LensAxisId[];
}

/** Parse `lenses` as a titled tree array; top-level nodes are axes. */
function parseLenses(bookId: string, raw: unknown): ParsedLenses | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const seenOptionIds = new Set<string>();
  const lenses: Record<LensAxisId, BookLens[]> = {};
  const lensAxisTitles: Record<LensAxisId, string> = {};
  const lensAxisOrder: LensAxisId[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const id = (item as { id?: unknown }).id;
    const title = (item as { title?: unknown }).title;
    if (typeof id !== 'string' || !SAFE_SEGMENT.test(id)) {
      console.warn(`book ${bookId}: lenses axis has invalid id; skipping`);
      continue;
    }
    if (typeof title !== 'string' || !title) {
      console.warn(`book ${bookId}: lenses axis "${id}" missing title; skipping`);
      continue;
    }
    if (lensAxisTitles[id]) {
      console.warn(`book ${bookId}: lenses axis id "${id}" duplicated; skipping`);
      continue;
    }

    const rawChildren = (item as { children?: unknown }).children;
    let options: BookLens[] | undefined;
    if (Array.isArray(rawChildren) && rawChildren.length > 0) {
      // Axis id is selectable as whole-axis; do not reserve it in the option set.
      options = [];
      for (const child of rawChildren) {
        const parsed = parseLensTreeNode(bookId, child, seenOptionIds);
        if (parsed) options.push(parsed);
      }
      if (options.length === 0) options = undefined;
    }

    if (options?.length) {
      lenses[id] = options;
    } else {
      if (seenOptionIds.has(id)) {
        console.warn(`book ${bookId}: lens option id "${id}" reused; skipping`);
        continue;
      }
      seenOptionIds.add(id);
      const color = parseLensColor((item as { color?: unknown }).color);
      if ((item as { color?: unknown }).color != null && !color) {
        console.warn(`book ${bookId}: lenses axis "${id}" has invalid color; ignoring`);
      }
      lenses[id] = [{ id, title, ...(color ? { color } : {}) }];
    }
    lensAxisTitles[id] = title;
    lensAxisOrder.push(id);
  }

  return lensAxisOrder.length > 0 ? { lenses, lensAxisTitles, lensAxisOrder } : undefined;
}

function parseRuler(
  bookId: string,
  raw: unknown,
  bookLenses: Record<LensAxisId, BookLens[]> | undefined,
): BookRuler | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const axis = (raw as { axis?: unknown }).axis;
  const keys = (raw as { keys?: unknown }).keys;
  const linksRaw = (raw as { links?: unknown }).links;
  if (typeof axis !== 'string' || !SAFE_SEGMENT.test(axis)) {
    console.warn(`book ${bookId}: ruler.axis invalid; skipping ruler`);
    return undefined;
  }
  if (bookLenses && !bookLenses[axis]) {
    console.warn(`book ${bookId}: ruler.axis "${axis}" not in lenses; skipping ruler`);
    return undefined;
  }
  if (keys != null && (typeof keys !== 'string' || !SAFE_SEGMENT.test(keys))) {
    console.warn(`book ${bookId}: ruler.keys invalid; skipping ruler`);
    return undefined;
  }
  if (typeof keys === 'string' && bookLenses) {
    const node = findLensNode(bookLenses[axis] ?? [], keys);
    if (!node) {
      console.warn(`book ${bookId}: ruler.keys "${keys}" not under axis "${axis}"; skipping ruler`);
      return undefined;
    }
  }
  if (!linksRaw || typeof linksRaw !== 'object' || Array.isArray(linksRaw)) {
    console.warn(`book ${bookId}: ruler.links must be an object; skipping ruler`);
    return undefined;
  }
  const links: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(linksRaw as Record<string, unknown>)) {
    if (!SAFE_SEGMENT.test(key)) {
      console.warn(`book ${bookId}: ruler.links key "${key}" invalid; skipping`);
      continue;
    }
    if (
      !Array.isArray(val) ||
      val.length === 0 ||
      !val.every((s) => typeof s === 'string' && SAFE_SEGMENT.test(s))
    ) {
      console.warn(
        `book ${bookId}: ruler.links["${key}"] must be a non-empty string array; skipping`,
      );
      continue;
    }
    links[key] = [...(val as string[])];
  }
  if (Object.keys(links).length === 0) {
    console.warn(`book ${bookId}: ruler.links empty after validation; skipping ruler`);
    return undefined;
  }
  return {
    axis,
    ...(typeof keys === 'string' ? { keys } : {}),
    links,
  };
}

/**
 * Apply page `lenses` from the contents tree onto TocChapter.layers / sectionAllowlists.
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
  manifestId: string,
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
  const title = typeof fm.data.title === 'string' && fm.data.title ? fm.data.title : manifestId;
  const { sections, hasIntro } = extractSections(fm.content);
  const all = hasIntro ? [{ id: '_intro', title: '引言', level: 2 }, ...sections] : sections;
  if (fm.data.layer != null || fm.data.pair != null) {
    console.warn(
      `book ${bookId}: page "${manifestId}" has frontmatter layer/pair; ignored — use contents[].lenses`,
    );
  }
  const fmShow = fm.data.showLevel;
  const showLevel =
    typeof fmShow === 'number' && Number.isFinite(fmShow) ? fmShow : undefined;
  const fmRole = fm.data.role;
  const role =
    fmRole === 'ruler' || fmRole === 'page' ? (fmRole as 'ruler' | 'page') : undefined;
  return {
    id: manifestId,
    title,
    file,
    sections: all,
    ...(showLevel != null ? { showLevel } : {}),
    ...(role ? { role } : {}),
  };
}

async function walkContents(
  bookId: string,
  nodes: unknown[],
  tree: TocTreeNode[],
  pages: TocChapter[],
  seenIds: Set<string>,
  bookLenses: Record<LensAxisId, BookLens[]> | undefined,
): Promise<void> {
  for (const item of nodes) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string' || !SAFE_SEGMENT.test(id)) {
      console.warn(`book ${bookId}: contents node has invalid id; skipping`);
      continue;
    }
    if (seenIds.has(id)) {
      throw new Error(`duplicate contents id "${id}" in book ${bookId}`);
    }
    seenIds.add(id);

    const file = (item as { file?: unknown }).file;
    const title = (item as { title?: unknown }).title;
    const lenses = (item as { lenses?: ManifestPageLenses }).lenses;
    const rawShowLevel = (item as { showLevel?: unknown }).showLevel;
    const rawRole = (item as { role?: unknown }).role;
    const rawChildren = (item as { children?: unknown }).children;
    const childItems = Array.isArray(rawChildren) ? rawChildren : [];

    if (typeof file === 'string' && file) {
      if (childItems.length > 0) {
        console.warn(`book ${bookId}: contents page "${id}" cannot have children; ignoring children`);
      }
      const page = await loadPage(bookId, file, id);
      if (!page) continue;
      if (typeof rawShowLevel === 'number' && Number.isFinite(rawShowLevel)) {
        page.showLevel = rawShowLevel;
      }
      if (rawRole === 'ruler' || rawRole === 'page') {
        page.role = rawRole;
      }
      applyPageLenses(
        bookId,
        page,
        lenses && typeof lenses === 'object' && !Array.isArray(lenses) ? lenses : undefined,
        bookLenses,
      );
      pages.push(page);
      tree.push({ type: 'page', id: page.id, title: page.title, file: page.file });
      continue;
    }

    if (typeof title !== 'string' || !title) {
      console.warn(`book ${bookId}: contents group "${id}" missing title; skipping`);
      continue;
    }
    const children: TocTreeNode[] = [];
    await walkContents(bookId, childItems, children, pages, seenIds, bookLenses);
    tree.push({ type: 'group', id, title, children });
  }
}

async function loadContents(
  bookId: string,
  raw: unknown,
  tree: TocTreeNode[],
  pages: TocChapter[],
  bookLenses: Record<LensAxisId, BookLens[]> | undefined,
): Promise<boolean> {
  if (!Array.isArray(raw) || raw.length === 0) {
    console.warn(`book ${bookId}: contents must be a non-empty tree array`);
    return false;
  }
  const seenIds = new Set<string>();
  await walkContents(bookId, raw, tree, pages, seenIds, bookLenses);
  return true;
}

export async function getBookToc(bookId: string): Promise<BookToc | null> {
  const manifest = await readManifest(bookId);
  if (!manifest) return null;

  const parsed = parseLenses(bookId, manifest.lenses);
  const bookLenses = parsed?.lenses;
  const ruler = parseRuler(bookId, manifest.ruler, bookLenses);
  const tree: TocTreeNode[] = [];
  const pages: TocChapter[] = [];
  try {
    const ok = await loadContents(bookId, manifest.contents, tree, pages, bookLenses);
    if (!ok) return null;
  } catch (e) {
    console.error(e);
    return null;
  }

  return {
    id: bookId,
    title: manifest.title ?? bookId,
    description: manifest.description,
    ...(parsed
      ? {
          lenses: parsed.lenses,
          lensAxisTitles: parsed.lensAxisTitles,
          lensAxisOrder: parsed.lensAxisOrder,
        }
      : {}),
    ...(ruler ? { ruler } : {}),
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
