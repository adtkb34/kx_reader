import { Router, type Request, type Response } from 'express';
import type { AppContext } from '../../app/context';
import {
  getChapterSection,
  putChapterSection,
  SectionWriteError,
} from '../../adapters/file/sectionWrite';
import { tryCommitBookChanges } from '../../adapters/file/bookCommit';
import { exportBookDigest } from '../../adapters/file/exportBook';
import { parseExportFormat } from '../../../../shared/digestExport';
import { badRequest, requireBook } from '../helpers';

function contentDispositionAttachment(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, '_') || 'export.bin';
  return `attachment; filename="${fallback.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function wantsMarkdown(req: Request): boolean {
  if (parseExportFormat(req.query.format) === 'md') return true;
  if (req.query.format != null && String(req.query.format).length > 0) return false;
  const accept = String(req.headers.accept ?? '');
  return /\btext\/markdown\b/i.test(accept) && !/\bapplication\/json\b/i.test(accept);
}

async function sendBookExport(
  ctx: AppContext,
  req: Request,
  res: Response,
  query: Record<string, unknown>,
): Promise<void> {
  const bookId = await requireBook(ctx, req, res);
  if (!bookId) return;
  const bundle = await exportBookDigest(ctx.books, bookId, query);
  if (!bundle) {
    res.status(404).json({ error: 'book not found' });
    return;
  }
  const format = parseExportFormat(req.query.format);
  const { payload, zipBytes } = bundle;
  const zipName = payload.zipFilename ?? payload.filename.replace(/\.md$/i, '.zip');
  if (format === 'zip' || (format === 'auto' && payload.assets.length > 0)) {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDispositionAttachment(zipName));
    res.send(Buffer.from(zipBytes));
    return;
  }
  if (format === 'md' || format === 'auto' || wantsMarkdown(req)) {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', contentDispositionAttachment(payload.filename));
    res.send(payload.markdown);
    return;
  }
  res.json(payload);
}

export function booksRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/api/books', async (_req, res) => {
    res.json(await ctx.books.listBooks());
  });

  router.get('/api/books/:bookId/export', async (req, res) => {
    await sendBookExport(ctx, req, res, req.query as Record<string, unknown>);
  });

  router.get('/api/books/:bookId/chapters/:chapterId/export', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    const toc = await ctx.books.getBookToc(bookId);
    if (!toc?.chapters.some((c) => c.id === req.params.chapterId)) {
      res.status(404).json({ error: 'chapter not found' });
      return;
    }
    const query: Record<string, unknown> = {
      ...(req.query as Record<string, unknown>),
      modules: req.query.modules ?? req.params.chapterId,
    };
    await sendBookExport(ctx, req, res, query);
  });

  router.get('/api/books/:bookId', async (req, res) => {
    const toc = await ctx.books.getBookToc(req.params.bookId);
    if (!toc) {
      res.status(404).json({ error: 'book not found' });
      return;
    }
    res.json(toc);
  });

  router.get('/api/books/:bookId/chapters/:chapterId', async (req, res) => {
    const chapter = await ctx.books.getChapter(req.params.bookId, req.params.chapterId);
    if (!chapter) {
      res.status(404).json({ error: 'chapter not found' });
      return;
    }
    res.json(chapter);
  });

  router.get('/api/books/:bookId/assets/*assetPath', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    const raw = req.params.assetPath;
    const assetPath = Array.isArray(raw) ? raw.join('/') : String(raw ?? '');
    const asset = await ctx.books.resolveBookAsset(bookId, assetPath);
    if (!asset) {
      res.status(404).json({ error: 'asset not found' });
      return;
    }
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.sendFile(asset.absPath);
  });

  router.get(
    '/api/books/:bookId/chapters/:chapterId/sections/:sectionId',
    async (req, res) => {
      const bookId = await requireBook(ctx, req, res);
      if (!bookId) return;
      const section = await getChapterSection(
        bookId,
        req.params.chapterId,
        req.params.sectionId,
      );
      if (!section) {
        res.status(404).json({ error: 'section not found' });
        return;
      }
      res.json(section);
    },
  );

  router.put(
    '/api/books/:bookId/chapters/:chapterId/sections/:sectionId',
    async (req, res) => {
      const bookId = await requireBook(ctx, req, res);
      if (!bookId) return;
      void ctx.actor; // reserved for future auth / audit
      const { markdown } = (req.body ?? {}) as { markdown?: unknown };
      if (typeof markdown !== 'string') {
        return badRequest(res, 'markdown is required');
      }
      try {
        const saved = await putChapterSection(
          bookId,
          req.params.chapterId,
          req.params.sectionId,
          markdown,
        );
        await tryCommitBookChanges(bookId, {
          fallbackMessage: `docs: update ${req.params.chapterId}#${req.params.sectionId}`,
          hint: `section edit ${req.params.chapterId}#${req.params.sectionId}`,
        });
        res.json(saved);
      } catch (err) {
        if (err instanceof SectionWriteError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }
    },
  );

  return router;
}
