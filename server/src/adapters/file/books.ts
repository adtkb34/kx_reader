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
  CorrespondenceTarget,
  LensAxisId,
  LensCorrespondence,
  TocChapter,
  TocTreeNode,
} from '../../../../shared/types';
import { correspondencePageId } from '../../../../shared/lenses';
import type { BookAsset, BookRepository } from '../../ports/books';

export type { BookAsset, BookRepository };

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
  /** Multi-axis lenses, or legacy flat array (normalized to `{ kind: [...] }`). */
  lenses?: BookLens[] | Record<string, BookLens[]>;
  /**
   * Correspondences per axis, or legacy flat array (normalized under sole/default axis).
   */
  correspondences?: LensCorrespondence[] | Record<string, LensCorrespondence[]>;
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

function parseLensOptions(
  bookId: string,
  axis: string,
  raw: unknown,
  seenOptionIds: Set<string>,
): BookLens[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: BookLens[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown }).id;
    const title = (item as { title?: unknown }).title;
    if (typeof id !== 'string' || !SAFE_SEGMENT.test(id)) {
      console.warn(`book ${bookId}: lenses.${axis} has invalid or empty id; skipping option`);
      continue;
    }
    if (seenOptionIds.has(id)) {
      console.warn(`book ${bookId}: lens option id "${id}" reused across axes; skipping`);
      continue;
    }
    if (typeof title !== 'string' || !title) continue;
    seenOptionIds.add(id);
    out.push({ id, title });
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

function parseCorrespondenceTarget(
  bookId: string,
  axis: string,
  rowIndex: number,
  lens: string,
  raw: unknown,
  pageIds: Set<string>,
): CorrespondenceTarget | null {
  if (typeof raw === 'string') {
    if (!SAFE_SEGMENT.test(raw) || !pageIds.has(raw)) {
      console.warn(
        `book ${bookId}: correspondences.${axis}[${rowIndex}].${lens} is not a valid page id; skipping row`,
      );
      return null;
    }
    return raw;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn(
      `book ${bookId}: correspondences.${axis}[${rowIndex}].${lens} must be a page id or { page, sections? }; skipping row`,
    );
    return null;
  }
  const page = (raw as { page?: unknown }).page;
  const sections = (raw as { sections?: unknown }).sections;
  if (typeof page !== 'string' || !SAFE_SEGMENT.test(page) || !pageIds.has(page)) {
    console.warn(
      `book ${bookId}: correspondences.${axis}[${rowIndex}].${lens}.page is not a valid page id; skipping row`,
    );
    return null;
  }
  if (sections === undefined) return { page };
  if (
    !Array.isArray(sections) ||
    sections.length === 0 ||
    !sections.every((s) => typeof s === 'string' && s.length > 0)
  ) {
    console.warn(
      `book ${bookId}: correspondences.${axis}[${rowIndex}].${lens}.sections must be a non-empty string array; skipping row`,
    );
    return null;
  }
  return { page, sections: sections as string[] };
}

function parseCorrespondenceRows(
  bookId: string,
  axis: string,
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
      console.warn(`book ${bookId}: correspondences.${axis}[${i}] is not an object; skipping`);
      continue;
    }
    const row: LensCorrespondence = {};
    let ok = true;
    const rowPages = new Set<string>();
    for (const [lens, targetRaw] of Object.entries(item as Record<string, unknown>)) {
      if (!lensIds.has(lens)) {
        console.warn(
          `book ${bookId}: correspondences.${axis}[${i}] key "${lens}" is not a declared option; skipping row`,
        );
        ok = false;
        break;
      }
      const target = parseCorrespondenceTarget(bookId, axis, i, lens, targetRaw, pageIds);
      if (!target) {
        ok = false;
        break;
      }
      const pageId = correspondencePageId(target);
      if (claimed.has(pageId)) {
        console.warn(
          `book ${bookId}: chapter "${pageId}" appears twice in correspondences.${axis}; skipping later row`,
        );
        ok = false;
        break;
      }
      row[lens] = target;
      rowPages.add(pageId);
    }
    if (!ok || Object.keys(row).length === 0) continue;
    for (const id of rowPages) claimed.add(id);
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Normalize correspondences to Record<axis, rows>.
 * Legacy flat array hangs under the sole axis (or `kind`).
 */
function parseCorrespondences(
  bookId: string,
  raw: unknown,
  lenses: Record<LensAxisId, BookLens[]>,
  pageIds: Set<string>,
): Record<LensAxisId, LensCorrespondence[]> | undefined {
  if (raw == null) return undefined;
  const axes = Object.keys(lenses);
  if (axes.length === 0) return undefined;

  const optionToAxis = new Map<string, LensAxisId>();
  for (const [axis, opts] of Object.entries(lenses)) {
    for (const o of opts) optionToAxis.set(o.id, axis);
  }

  if (Array.isArray(raw)) {
    const defaultAxis = axes.includes('kind') ? 'kind' : axes[0];
    const allOptionIds = new Set(optionToAxis.keys());
    const rows = parseCorrespondenceRows(bookId, defaultAxis, raw, allOptionIds, pageIds);
    if (!rows) return undefined;
    // Split rows onto the axis that owns each option key.
    const byAxis: Record<LensAxisId, LensCorrespondence[]> = {};
    for (const row of rows) {
      const axesInRow = new Set(
        Object.keys(row).map((k) => optionToAxis.get(k)).filter(Boolean) as LensAxisId[],
      );
      if (axesInRow.size !== 1) {
        console.warn(
          `book ${bookId}: legacy correspondence row spans multiple axes or unknown keys; skipping`,
          row,
        );
        continue;
      }
      const axis = [...axesInRow][0];
      (byAxis[axis] ??= []).push(row);
    }
    return Object.keys(byAxis).length > 0 ? byAxis : undefined;
  }

  if (typeof raw !== 'object') return undefined;
  const out: Record<LensAxisId, LensCorrespondence[]> = {};
  for (const [axis, rowsRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!lenses[axis]) {
      console.warn(`book ${bookId}: correspondences axis "${axis}" has no lenses; skipping`);
      continue;
    }
    const lensIds = new Set(lenses[axis].map((l) => l.id));
    const rows = parseCorrespondenceRows(bookId, axis, rowsRaw, lensIds, pageIds);
    if (rows) out[axis] = rows;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Assign chapter.layers and sectionAllowlists from per-axis correspondences. */
function applyCorrespondences(
  bookId: string,
  pages: TocChapter[],
  correspondences: Record<LensAxisId, LensCorrespondence[]>,
): void {
  const byId = new Map(pages.map((p) => [p.id, p]));
  for (const [axis, rows] of Object.entries(correspondences)) {
    for (const row of rows) {
      for (const [lens, target] of Object.entries(row)) {
        const pageId = correspondencePageId(target);
        const page = byId.get(pageId);
        if (!page) continue;
        page.layers ??= {};
        const existing = page.layers[axis];
        if (existing == null) {
          page.layers[axis] = lens;
        } else {
          const list = Array.isArray(existing) ? existing : [existing];
          if (!list.includes(lens)) {
            page.layers[axis] = [...list, lens];
          }
        }
        if (typeof target === 'object' && target.sections) {
          const known = new Set(page.sections.map((s) => s.id));
          const valid: string[] = [];
          for (const sid of target.sections) {
            if (!known.has(sid)) {
              console.warn(
                `book ${bookId}: correspondences.${axis} ${lens}→${pageId} unknown section "${sid}"; dropping`,
              );
              continue;
            }
            valid.push(sid);
          }
          if (valid.length === 0) continue;
          page.sectionAllowlists ??= {};
          page.sectionAllowlists[axis] ??= {};
          page.sectionAllowlists[axis][lens] = valid;
        }
      }
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

  const lenses = parseLenses(bookId, manifest.lenses);
  const pageIds = new Set(pages.map((p) => p.id));
  const correspondences = lenses
    ? parseCorrespondences(bookId, manifest.correspondences, lenses, pageIds)
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
