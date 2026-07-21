import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import { DATA_DIR, PORT, ROOT_DIR } from './config';
import { bookExists, getBookToc, getChapter, listBooks } from './books';
import { FileAnnotationStore } from './annotationStore';
import { SECTION_STATUS_IDS, type SectionStatus } from '../../shared/annotations';
import {
  GitError,
  hasBookGit,
  listBookHistory,
  listBookRefs,
  listFileHistory,
} from './gitHistory';
import { compareChapterAtRefs, parseCompareMode } from './sectionCompare';
import {
  AgentBusyError,
  AgentDisabledError,
  getAgentsCatalogPublic,
  getAgentStatus,
  isAgentRunning,
  startAgentRun,
  type AgentSseEvent,
} from './agentRunner';
import {
  getChapterSection,
  putChapterSection,
  SectionWriteError,
} from './sectionWrite';
import { tryCommitBookChanges } from './bookCommit';

const app = express();
app.use(express.json());

const store = new FileAnnotationStore(DATA_DIR);

function badRequest(res: Response, error: string): void {
  res.status(400).json({ error });
}

async function requireBook(req: Request, res: Response): Promise<string | null> {
  const bookId = req.params.bookId as string;
  if (!(await bookExists(bookId))) {
    res.status(404).json({ error: `book "${bookId}" not found` });
    return null;
  }
  return bookId;
}

app.get('/api/books', async (_req, res) => {
  res.json(await listBooks());
});

app.get('/api/books/:bookId', async (req, res) => {
  const toc = await getBookToc(req.params.bookId);
  if (!toc) {
    res.status(404).json({ error: 'book not found' });
    return;
  }
  res.json(toc);
});

app.get('/api/books/:bookId/chapters/:chapterId', async (req, res) => {
  const chapter = await getChapter(req.params.bookId, req.params.chapterId);
  if (!chapter) {
    res.status(404).json({ error: 'chapter not found' });
    return;
  }
  res.json(chapter);
});

app.get('/api/books/:bookId/chapters/:chapterId/sections/:sectionId', async (req, res) => {
  const bookId = await requireBook(req, res);
  if (!bookId) return;
  const section = await getChapterSection(bookId, req.params.chapterId, req.params.sectionId);
  if (!section) {
    res.status(404).json({ error: 'section not found' });
    return;
  }
  res.json(section);
});

app.put('/api/books/:bookId/chapters/:chapterId/sections/:sectionId', async (req, res) => {
  const bookId = await requireBook(req, res);
  if (!bookId) return;
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
});

app.get('/api/books/:bookId/annotations', async (req, res) => {
  const bookId = await requireBook(req, res);
  if (!bookId) return;
  res.json(await store.getBook(bookId));
});

app.put('/api/books/:bookId/annotations/status', async (req, res) => {
  const bookId = await requireBook(req, res);
  if (!bookId) return;
  const { sectionId, status } = (req.body ?? {}) as { sectionId?: unknown; status?: unknown };
  if (typeof sectionId !== 'string' || !sectionId) return badRequest(res, 'sectionId is required');
  if (typeof status !== 'string' || !(SECTION_STATUS_IDS as string[]).includes(status)) {
    return badRequest(res, `status must be one of: ${SECTION_STATUS_IDS.join(', ')}`);
  }
  res.json(await store.setStatus(bookId, sectionId, status as SectionStatus));
});

app.post('/api/books/:bookId/annotations/notes', async (req, res) => {
  const bookId = await requireBook(req, res);
  if (!bookId) return;
  const { sectionId, text } = (req.body ?? {}) as { sectionId?: unknown; text?: unknown };
  if (typeof sectionId !== 'string' || !sectionId) return badRequest(res, 'sectionId is required');
  if (typeof text !== 'string' || !text.trim()) return badRequest(res, 'text is required');
  res.status(201).json(await store.addNote(bookId, sectionId, text.trim()));
});

app.put('/api/books/:bookId/annotations/notes/:noteId', async (req, res) => {
  const bookId = await requireBook(req, res);
  if (!bookId) return;
  const { sectionId, text } = (req.body ?? {}) as { sectionId?: unknown; text?: unknown };
  if (typeof sectionId !== 'string' || !sectionId) return badRequest(res, 'sectionId is required');
  if (typeof text !== 'string' || !text.trim()) return badRequest(res, 'text is required');
  const note = await store.updateNote(bookId, sectionId, req.params.noteId, text.trim());
  if (!note) {
    res.status(404).json({ error: 'note not found' });
    return;
  }
  res.json(note);
});

app.delete('/api/books/:bookId/annotations/notes/:noteId', async (req, res) => {
  const bookId = await requireBook(req, res);
  if (!bookId) return;
  const sectionId = String(req.query.sectionId ?? '');
  if (!sectionId) return badRequest(res, 'sectionId query param is required');
  const ok = await store.deleteNote(bookId, sectionId, req.params.noteId);
  if (!ok) {
    res.status(404).json({ error: 'note not found' });
    return;
  }
  res.json({ ok: true });
});

app.delete('/api/books/:bookId/annotations/section', async (req, res) => {
  const bookId = await requireBook(req, res);
  if (!bookId) return;
  const sectionId = String(req.query.sectionId ?? '');
  if (!sectionId) return badRequest(res, 'sectionId query param is required');
  await store.deleteSection(bookId, sectionId);
  res.json({ ok: true });
});

function sendGitError(res: Response, err: unknown): boolean {
  if (err instanceof GitError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

app.get('/api/books/:bookId/git/status', async (req, res) => {
  const bookId = await requireBook(req, res);
  if (!bookId) return;
  res.json({ hasGit: hasBookGit(bookId) });
});

app.get('/api/books/:bookId/git/refs', async (req, res) => {
  const bookId = await requireBook(req, res);
  if (!bookId) return;
  try {
    res.json(await listBookRefs(bookId));
  } catch (err) {
    if (!sendGitError(res, err)) throw err;
  }
});

app.get('/api/books/:bookId/git/history', async (req, res) => {
  const bookId = await requireBook(req, res);
  if (!bookId) return;
  const limitRaw = Number(req.query.limit);
  try {
    res.json(await listBookHistory(bookId, Number.isFinite(limitRaw) ? limitRaw : 100));
  } catch (err) {
    if (!sendGitError(res, err)) throw err;
  }
});

app.get('/api/books/:bookId/chapters/:chapterId/history', async (req, res) => {
  const bookId = await requireBook(req, res);
  if (!bookId) return;
  const toc = await getBookToc(bookId);
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

app.get('/api/books/:bookId/chapters/:chapterId/compare', async (req, res) => {
  const bookId = await requireBook(req, res);
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

app.get('/api/agent/status', async (_req, res) => {
  res.json(await getAgentStatus());
});

app.get('/api/agents/catalog', async (_req, res) => {
  try {
    res.json(await getAgentsCatalogPublic());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

function writeSse(res: Response, event: AgentSseEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

app.post('/api/books/:bookId/agent/runs', async (req, res) => {
  const bookId = await requireBook(req, res);
  if (!bookId) return;
  const body = (req.body ?? {}) as {
    prompt?: unknown;
    chapterId?: unknown;
    agentId?: unknown;
    behaviorId?: unknown;
    model?: unknown;
  };
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
    return badRequest(res, 'prompt is required');
  }
  const chapterId =
    typeof body.chapterId === 'string' && body.chapterId ? body.chapterId : undefined;
  const agentId =
    typeof body.agentId === 'string' && body.agentId.trim()
      ? body.agentId.trim()
      : undefined;
  const behaviorId =
    typeof body.behaviorId === 'string' && body.behaviorId.trim()
      ? body.behaviorId.trim()
      : undefined;
  const model =
    typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;

  const status = await getAgentStatus();
  if (!status.enabled) {
    res.status(503).json({ error: 'agent is disabled; set AGENT_ENABLED=1 to enable' });
    return;
  }
  if (isAgentRunning(bookId)) {
    res.status(409).json({ error: `agent already running for book "${bookId}"` });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  const emit = (event: AgentSseEvent): void => {
    if (closed) return;
    writeSse(res, event);
  };

  try {
    await startAgentRun({
      bookId,
      chapterId,
      userPrompt: body.prompt,
      agentId,
      behaviorId,
      model,
      onEvent: emit,
    });
  } catch (err) {
    if (err instanceof AgentBusyError) {
      emit({ type: 'error', message: err.message });
    } else if (err instanceof AgentDisabledError) {
      emit({ type: 'error', message: err.message });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', message });
    }
  } finally {
    if (!closed) res.end();
  }
});

// 若已构建前端（client/dist），单端口直接可用
const clientDist = path.join(ROOT_DIR, 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    } else {
      next();
    }
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'internal server error' });
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
