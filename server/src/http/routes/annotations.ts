import { Router } from 'express';
import { SECTION_STATUS_IDS, type SectionStatus } from '../../../../shared/annotations';
import type { AppContext } from '../../app/context';
import { badRequest, requireBook } from '../helpers';

export function annotationsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/api/books/:bookId/annotations', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    res.json(await ctx.annotations.getBook(bookId));
  });

  router.put('/api/books/:bookId/annotations/status', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    void ctx.actor;
    const { sectionId, status } = (req.body ?? {}) as {
      sectionId?: unknown;
      status?: unknown;
    };
    if (typeof sectionId !== 'string' || !sectionId) {
      return badRequest(res, 'sectionId is required');
    }
    if (typeof status !== 'string' || !(SECTION_STATUS_IDS as string[]).includes(status)) {
      return badRequest(res, `status must be one of: ${SECTION_STATUS_IDS.join(', ')}`);
    }
    res.json(await ctx.annotations.setStatus(bookId, sectionId, status as SectionStatus));
  });

  router.post('/api/books/:bookId/annotations/notes', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    void ctx.actor;
    const { sectionId, text } = (req.body ?? {}) as { sectionId?: unknown; text?: unknown };
    if (typeof sectionId !== 'string' || !sectionId) {
      return badRequest(res, 'sectionId is required');
    }
    if (typeof text !== 'string' || !text.trim()) {
      return badRequest(res, 'text is required');
    }
    res.status(201).json(await ctx.annotations.addNote(bookId, sectionId, text.trim()));
  });

  router.put('/api/books/:bookId/annotations/notes/:noteId', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    void ctx.actor;
    const { sectionId, text } = (req.body ?? {}) as { sectionId?: unknown; text?: unknown };
    if (typeof sectionId !== 'string' || !sectionId) {
      return badRequest(res, 'sectionId is required');
    }
    if (typeof text !== 'string' || !text.trim()) {
      return badRequest(res, 'text is required');
    }
    const note = await ctx.annotations.updateNote(
      bookId,
      sectionId,
      req.params.noteId,
      text.trim(),
    );
    if (!note) {
      res.status(404).json({ error: 'note not found' });
      return;
    }
    res.json(note);
  });

  router.delete('/api/books/:bookId/annotations/notes/:noteId', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    void ctx.actor;
    const sectionId = String(req.query.sectionId ?? '');
    if (!sectionId) return badRequest(res, 'sectionId query param is required');
    const ok = await ctx.annotations.deleteNote(bookId, sectionId, req.params.noteId);
    if (!ok) {
      res.status(404).json({ error: 'note not found' });
      return;
    }
    res.json({ ok: true });
  });

  router.delete('/api/books/:bookId/annotations/section', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    void ctx.actor;
    const sectionId = String(req.query.sectionId ?? '');
    if (!sectionId) return badRequest(res, 'sectionId query param is required');
    await ctx.annotations.deleteSection(bookId, sectionId);
    res.json({ ok: true });
  });

  return router;
}
