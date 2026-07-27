import { Router, type Response } from 'express';
import type { AppContext } from '../../app/context';
import {
  GitError,
  hasBookGit,
  listBookHistory,
  listBookRefs,
  listFileHistory,
} from '../../adapters/file/gitHistory';
import { compareChapterAtRefs, parseCompareMode } from '../../adapters/file/sectionCompare';
import { badRequest, requireBook } from '../helpers';

function sendGitError(res: Response, err: unknown): boolean {
  if (err instanceof GitError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

export function gitRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/api/books/:bookId/git/status', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    res.json({ hasGit: hasBookGit(bookId) });
  });

  router.get('/api/books/:bookId/git/refs', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    try {
      res.json(await listBookRefs(bookId));
    } catch (err) {
      if (!sendGitError(res, err)) throw err;
    }
  });

  router.get('/api/books/:bookId/git/history', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    const limitRaw = Number(req.query.limit);
    try {
      res.json(await listBookHistory(bookId, Number.isFinite(limitRaw) ? limitRaw : 100));
    } catch (err) {
      if (!sendGitError(res, err)) throw err;
    }
  });

  router.get('/api/books/:bookId/chapters/:chapterId/history', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    const toc = await ctx.books.getBookToc(bookId);
    const chapter = toc?.chapters.find((c) => c.id === req.params.chapterId);
    if (!chapter) {
      res.status(404).json({ error: 'chapter not found' });
      return;
    }
    const limitRaw = Number(req.query.limit);
    try {
      res.json(await listFileHistory(bookId, chapter.file, limitRaw));
    } catch (err) {
      if (!sendGitError(res, err)) throw err;
    }
  });

  router.get('/api/books/:bookId/chapters/:chapterId/compare', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    if (!from) return badRequest(res, 'from query param is required');
    if (!to) return badRequest(res, 'to query param is required');
    const mode = parseCompareMode(req.query.mode);
    try {
      res.json(await compareChapterAtRefs(bookId, req.params.chapterId, from, to, mode));
    } catch (err) {
      if (!sendGitError(res, err)) throw err;
    }
  });

  return router;
}
