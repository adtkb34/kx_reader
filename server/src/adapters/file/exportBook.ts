import fs from 'node:fs/promises';
import {
  assembleDigestExport,
  digestExportOptionsFromQuery,
  parseExportImageMode,
  sanitizeExportFilename,
  type DigestExportAsset,
  type DigestExportPayload,
  type DigestExportResult,
} from '../../../../shared/digestExport';
import {
  bookAssetRelPath,
  bytesToBase64,
  collectMarkdownAssetPaths,
  embedAssetsInMarkdown,
} from '../../../../shared/exportAssets';
import { zipStore } from '../../../../shared/zipStore';
import type { ReaderShowLevel } from '../../../../shared/lenses';
import type { BookRepository } from '../../ports/books';

export type { DigestExportPayload };

export type BookExportBundle = {
  payload: DigestExportPayload;
  zipBytes: Uint8Array;
};

function showLevelJson(level: ReaderShowLevel): number | null {
  return typeof level === 'number' && Number.isFinite(level) ? level : null;
}

function zipFilenameFor(mdFilename: string): string {
  return mdFilename.replace(/\.md$/i, '.zip');
}

function zipFolderName(mdFilename: string): string {
  return sanitizeExportFilename(mdFilename.replace(/\.md$/i, ''));
}

async function loadReferencedImages(
  books: BookRepository,
  bookId: string,
  markdown: string,
): Promise<Array<{ path: string; contentType: string; bytes: Uint8Array }>> {
  const out: Array<{ path: string; contentType: string; bytes: Uint8Array }> = [];
  for (const assetPath of collectMarkdownAssetPaths(markdown)) {
    const asset = await books.resolveBookAsset(bookId, bookAssetRelPath(assetPath));
    if (!asset) continue;
    const bytes = new Uint8Array(await fs.readFile(asset.absPath));
    out.push({ path: assetPath, contentType: asset.contentType, bytes });
  }
  return out;
}

function toAssetsJson(
  files: Array<{ path: string; contentType: string; bytes: Uint8Array }>,
  includeBase64: boolean,
): DigestExportAsset[] {
  return files.map((file) => ({
    path: file.path,
    contentType: file.contentType,
    byteLength: file.bytes.byteLength,
    ...(includeBase64 ? { base64: bytesToBase64(file.bytes) } : {}),
  }));
}

function buildZip(
  mdFilename: string,
  markdown: string,
  files: Array<{ path: string; bytes: Uint8Array }>,
): Uint8Array {
  const folder = zipFolderName(mdFilename);
  const encoder = new TextEncoder();
  return zipStore([
    { name: `${folder}/${mdFilename}`, data: encoder.encode(markdown) },
    ...files.map((file) => ({ name: `${folder}/${file.path}`, data: file.bytes })),
  ]);
}

function toPayload(
  tocId: string,
  tocTitle: string,
  assembled: DigestExportResult,
  markdown: string,
  assets: DigestExportAsset[],
): DigestExportPayload {
  const { options } = assembled;
  return {
    bookId: tocId,
    title: tocTitle,
    filename: assembled.filename,
    zipFilename: assets.length ? zipFilenameFor(assembled.filename) : null,
    markdown,
    chapterIds: assembled.chapterIds,
    selection: options.selection,
    rulerPick: options.rulerPick != null ? String(options.rulerPick) : null,
    hangFilter: options.hangFilter ?? 'all',
    readerShowLevel: showLevelJson(options.readerShowLevel),
    focusModuleIds: options.focusModuleIds ?? null,
    outlineKeyIdsByModule: options.outlineKeyIdsByModule ?? null,
    assets,
  };
}

export async function exportBookDigest(
  books: BookRepository,
  bookId: string,
  query: Record<string, unknown>,
): Promise<BookExportBundle | null> {
  const toc = await books.getBookToc(bookId);
  if (!toc) return null;
  const assembled = await assembleDigestExport(
    toc,
    async (chapterId) => {
      const chapter = await books.getChapter(bookId, chapterId);
      return chapter?.markdown;
    },
    digestExportOptionsFromQuery(toc, query),
  );

  const imageMode = parseExportImageMode(query.images);
  const files =
    imageMode === 'omit' ? [] : await loadReferencedImages(books, bookId, assembled.markdown);
  const fileMap = new Map(files.map((f) => [f.path, f]));
  const markdown =
    imageMode === 'embed' ? embedAssetsInMarkdown(assembled.markdown, fileMap) : assembled.markdown;
  const assets = toAssetsJson(files, imageMode === 'base64' || imageMode === 'embed');
  const payload = toPayload(toc.id, toc.title, assembled, markdown, assets);
  const zipBytes = buildZip(assembled.filename, assembled.markdown, files);
  return { payload, zipBytes };
}
