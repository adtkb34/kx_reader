import { Router, type Response } from 'express';
import type { AppContext } from '../../app/context';
import {
  AgentBusyError,
  AgentDisabledError,
  getAgentsCatalogPublic,
  getAgentStatus,
  isAgentRunning,
  startAgentRun,
  type AgentSseEvent,
} from '../../adapters/agent/agentRunner';
import { badRequest, requireBook } from '../helpers';

function writeSse(res: Response, event: AgentSseEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function agentRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/api/agent/status', async (_req, res) => {
    res.json(await getAgentStatus());
  });

  router.get('/api/agents/catalog', async (_req, res) => {
    try {
      res.json(await getAgentsCatalogPublic());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.post('/api/books/:bookId/agent/runs', async (req, res) => {
    const bookId = await requireBook(ctx, req, res);
    if (!bookId) return;
    void ctx.actor;
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

  return router;
}
