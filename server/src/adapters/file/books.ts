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
  LensAxisNode,
  LensDimension,
  PageLayer,
  TocChapter,
  TocTreeNode,
} from '../../../../shared/types';
import { lensLeafIds } from '../../../../shared/lenses';
import type { BookAsset, BookRepository } from '../../ports/books';

export type { BookAsset, BookRepository };

/** Per-axis: option id → true (whole page) or section id allowlist. */
type ManifestPageLenses = Record<LensAxisId, Record<string, true | string[]>>;

/** Catalog entry for contents.dimensions: page (file) or group (title). */
interface ContentDimension {
  id: string;
  title?: string;
  file?: string;
  lenses?: ManifestPageLenses;
}

interface BookManifest {
  title?: string;
  description?: string;
  /** Required: `{ dimensions, axes }` — same shape as lenses. */
  contents?: {
    dimensions?: ContentDimension[];
    axes?: LensAxisNode[];
  };
  /**
   * Optional lens config:
   * - `dimensions`: flat `{ id, title }[]` catalog
   * - `axes`: trees of `{ id, children? }` (titles from dimensions)
   */
  lenses?: {
    dimensions?: LensDimension[];
    axes?: LensAxisNode[];
  };
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

function parseDimensionCatalog(
  bookId: string,
  raw: unknown,
): Map<string, string> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    console.warn(`book ${bookId}: lenses.dimensions must be a non-empty array`);
    return undefined;
  }
  const titles = new Map<string, string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown }).id;
    const title = (item as { title?: unknown }).title;
    if (typeof id !== 'string' || !SAFE_SEGMENT.test(id)) {
      console.warn(`book ${bookId}: lenses.dimensions entry has invalid id; skipping`);
      continue;
    }
    if (typeof title !== 'string' || !title) {
      console.warn(`book ${bookId}: lenses.dimensions "${id}" missing title; skipping`);
      continue;
    }
    if (titles.has(id)) {
      console.warn(`book ${bookId}: lenses.dimensions id "${id}" duplicated; skipping`);
      continue;
    }
    if ((item as { children?: unknown }).children != null) {
      console.warn(
        `book ${bookId}: lenses.dimensions "${id}" must not have children; put tree under lenses.axes`,
      );
    }
    titles.set(id, title);
  }
  return titles.size > 0 ? titles : undefined;
}

/** Axis / tree node: `{ id, children? }` only (no bare string ids). */
function readAxisNode(item: unknown): { id: string; children?: unknown } | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const id = (item as { id?: unknown }).id;
  if (typeof id !== 'string' || !SAFE_SEGMENT.test(id)) return null;
  return { id, children: (item as { children?: unknown }).children };
}

/** Resolve an axes tree node; titles come from the dimensions catalog. */
function parseAxisTreeNode(
  bookId: string,
  axis: string,
  item: unknown,
  titles: Map<string, string>,
  seenOptionIds: Set<string>,
): BookLens | null {
  const node = readAxisNode(item);
  if (!node) {
    console.warn(`book ${bookId}: lenses.axes.${axis} has invalid node; skipping option`);
    return null;
  }
  const { id } = node;
  const title = titles.get(id);
  if (!title) {
    console.warn(
      `book ${bookId}: lenses.axes.${axis} node "${id}" missing from lenses.dimensions; skipping`,
    );
    return null;
  }
  if (seenOptionIds.has(id)) {
    console.warn(`book ${bookId}: lens option id "${id}" reused across axes; skipping`);
    return null;
  }
  seenOptionIds.add(id);

  let children: BookLens[] | undefined;
  if (Array.isArray(node.children) && node.children.length > 0) {
    children = [];
    for (const child of node.children) {
      const parsed = parseAxisTreeNode(bookId, axis, child, titles, seenOptionIds);
      if (parsed) children.push(parsed);
    }
    if (children.length === 0) children = undefined;
  }

  return children ? { id, title, children } : { id, title };
}

interface ParsedLenses {
  lenses: Record<LensAxisId, BookLens[]>;
  lensAxisTitles: Record<LensAxisId, string>;
  lensAxisOrder: LensAxisId[];
}

/**
 * Parse `lenses.dimensions` (titles) + `lenses.axes` (trees).
 * No hardcoded axis labels (kind/audience removed).
 */
function parseLenses(bookId: string, raw: unknown): ParsedLenses | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const titles = parseDimensionCatalog(bookId, (raw as { dimensions?: unknown }).dimensions);
  if (!titles) return undefined;

  const axesRaw = (raw as { axes?: unknown }).axes;
  if (!Array.isArray(axesRaw) || axesRaw.length === 0) {
    console.warn(`book ${bookId}: lenses.axes must be a non-empty array`);
    return undefined;
  }

  const seenOptionIds = new Set<string>();
  const lenses: Record<LensAxisId, BookLens[]> = {};
  const lensAxisTitles: Record<LensAxisId, string> = {};
  const lensAxisOrder: LensAxisId[] = [];

  for (const item of axesRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string' || !SAFE_SEGMENT.test(id)) {
      console.warn(`book ${bookId}: lenses.axes entry has invalid id; skipping`);
      continue;
    }
    const title = titles.get(id);
    if (!title) {
      console.warn(`book ${bookId}: lenses.axes "${id}" missing from lenses.dimensions; skipping`);
      continue;
    }
    if (lensAxisTitles[id]) {
      console.warn(`book ${bookId}: lenses.axes id "${id}" duplicated; skipping`);
      continue;
    }

    const rawChildren = (item as { children?: unknown }).children;
    let options: BookLens[] | undefined;
    if (Array.isArray(rawChildren) && rawChildren.length > 0) {
      options = [];
      for (const child of rawChildren) {
        const parsed = parseAxisTreeNode(bookId, id, child, titles, seenOptionIds);
        if (parsed) options.push(parsed);
      }
      if (options.length === 0) options = undefined;
    }

    if (options?.length) {
      lenses[id] = options;
    } else {
      if (seenOptionIds.has(id)) {
        console.warn(`book ${bookId}: lens option id "${id}" reused across axes; skipping`);
        continue;
      }
      seenOptionIds.add(id);
      lenses[id] = [{ id, title }];
    }
    lensAxisTitles[id] = title;
    lensAxisOrder.push(id);
  }

  return lensAxisOrder.length > 0 ? { lenses, lensAxisTitles, lensAxisOrder } : undefined;
}

/**
 * Apply contents.dimensions[].lenses onto TocChapter.layers / sectionAllowlists.
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
      `book ${bookId}: page "${id}" has frontmatter layer/pair; ignored — use contents.dimensions[].lenses`,
    );
  }
  return {
    id,
    title,
    file,
    sections: all,
  };
}

async function walkContentAxis(
  bookId: string,
  item: unknown,
  catalog: Map<string, ContentDimension>,
  tree: TocTreeNode[],
  pages: TocChapter[],
  seenIds: Set<string>,
  bookLenses: Record<LensAxisId, BookLens[]> | undefined,
): Promise<void> {
  const node = readAxisNode(item);
  if (!node) {
    console.warn(`book ${bookId}: contents.axes has invalid node; skipping`);
    return;
  }
  const dim = catalog.get(node.id);
  if (!dim) {
    console.warn(
      `book ${bookId}: contents.axes "${node.id}" missing from contents.dimensions; skipping`,
    );
    return;
  }
  if (seenIds.has(node.id)) {
    throw new Error(`duplicate contents id "${node.id}" in book ${bookId}`);
  }
  seenIds.add(node.id);

  const childItems = Array.isArray(node.children) ? node.children : [];

  if (typeof dim.file === 'string' && dim.file) {
    if (childItems.length > 0) {
      console.warn(
        `book ${bookId}: contents page "${node.id}" cannot have children; ignoring children`,
      );
    }
    const page = await loadPage(bookId, dim.file, node.id);
    if (!page) return;
    applyPageLenses(bookId, page, dim.lenses, bookLenses);
    pages.push(page);
    tree.push({ type: 'page', id: page.id, title: page.title, file: page.file });
    return;
  }

  const title = typeof dim.title === 'string' && dim.title ? dim.title : node.id;
  const children: TocTreeNode[] = [];
  for (const child of childItems) {
    await walkContentAxis(bookId, child, catalog, children, pages, seenIds, bookLenses);
  }
  tree.push({ type: 'group', id: node.id, title, children });
}

function parseContentsCatalog(
  bookId: string,
  raw: unknown,
): Map<string, ContentDimension> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    console.warn(`book ${bookId}: contents.dimensions must be a non-empty array`);
    return undefined;
  }
  const catalog = new Map<string, ContentDimension>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string' || !SAFE_SEGMENT.test(id)) {
      console.warn(`book ${bookId}: contents.dimensions entry has invalid id; skipping`);
      continue;
    }
    if (catalog.has(id)) {
      console.warn(`book ${bookId}: contents.dimensions id "${id}" duplicated; skipping`);
      continue;
    }
    if ((item as { children?: unknown }).children != null) {
      console.warn(
        `book ${bookId}: contents.dimensions "${id}" must not have children; put tree under contents.axes`,
      );
    }
    const file = (item as { file?: unknown }).file;
    const title = (item as { title?: unknown }).title;
    const lenses = (item as { lenses?: ManifestPageLenses }).lenses;
    const dim: ContentDimension = { id };
    if (typeof file === 'string' && file) dim.file = file;
    if (typeof title === 'string' && title) dim.title = title;
    if (lenses && typeof lenses === 'object' && !Array.isArray(lenses)) dim.lenses = lenses;
    if (!dim.file && !dim.title) {
      console.warn(
        `book ${bookId}: contents.dimensions "${id}" needs file (page) or title (group); skipping`,
      );
      continue;
    }
    catalog.set(id, dim);
  }
  return catalog.size > 0 ? catalog : undefined;
}

async function loadContents(
  bookId: string,
  raw: unknown,
  tree: TocTreeNode[],
  pages: TocChapter[],
  bookLenses: Record<LensAxisId, BookLens[]> | undefined,
): Promise<boolean> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn(`book ${bookId}: contents must be { dimensions, axes }`);
    return false;
  }
  const catalog = parseContentsCatalog(bookId, (raw as { dimensions?: unknown }).dimensions);
  if (!catalog) return false;
  const axes = (raw as { axes?: unknown }).axes;
  if (!Array.isArray(axes) || axes.length === 0) {
    console.warn(`book ${bookId}: contents.axes must be a non-empty array`);
    return false;
  }
  const seenIds = new Set<string>();
  for (const axis of axes) {
    await walkContentAxis(bookId, axis, catalog, tree, pages, seenIds, bookLenses);
  }
  return true;
}

export async function getBookToc(bookId: string): Promise<BookToc | null> {
  const manifest = await readManifest(bookId);
  if (!manifest) return null;

  const parsed = parseLenses(bookId, manifest.lenses);
  const bookLenses = parsed?.lenses;
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
