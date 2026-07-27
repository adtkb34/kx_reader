import { Router } from 'express';
import type { AppContext } from '../../app/context';
import {
  getChapterSection,
  putChapterSection,
  SectionWriteError,
} from '../../adapters/file/sectionWrite';
import { tryCommitBookChanges } from '../../adapters/file/bookCommit';
import { badRequest, requireBook } from '../helpers';

export function booksRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/api/books', async (_req, res) => {
    res.json(await ctx.books.listBooks());
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
