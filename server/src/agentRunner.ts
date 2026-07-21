import type { ChildProcess } from 'node:child_process';
import { bookRoot } from './gitHistory';
import { getBookToc } from './books';
import { ROOT_DIR } from './config';
import {
  getAgentsCatalog,
  resolveAgentRun,
  buildRunPrompt,
  buildCliArgv,
  type AgentCatalogPublic,
} from './agentConfig';
import { resolveExecutable, runConfiguredCli } from './drivers/runCli';
import type { AgentSseEvent } from './agentTypes';
import { tryCommitBookChanges } from './bookCommit';

export type { AgentSseEvent } from './agentTypes';
export type { AgentCatalogPublic };

export const AGENT_ENABLED = process.env.AGENT_ENABLED === '1';
export const AGENT_MODEL = process.env.AGENT_MODEL?.trim() || '';

const runningByBook = new Map<string, ChildProcess>();

export function isAgentRunning(bookId: string): boolean {
  return runningByBook.has(bookId);
}

export interface AgentStatus {
  enabled: boolean;
  defaultAgent: string;
  defaultBehavior: string;
}

export async function getAgentStatus(): Promise<AgentStatus> {
  let defaultAgent = 'cursor';
  let defaultBehavior = 'doc-edit';
  try {
    const catalog = await getAgentsCatalog();
    defaultAgent = catalog.defaultAgent;
    defaultBehavior = catalog.defaultBehavior;
  } catch {
    // config missing
  }
  return {
    enabled: AGENT_ENABLED,
    defaultAgent,
    defaultBehavior,
  };
}

export async function getAgentsCatalogPublic(): Promise<AgentCatalogPublic> {
  return getAgentsCatalog();
}

export class AgentBusyError extends Error {
  constructor(bookId: string) {
    super(`agent already running for book "${bookId}"`);
    this.name = 'AgentBusyError';
  }
}

export class AgentDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentDisabledError';
  }
}

export async function startAgentRun(opts: {
  bookId: string;
  chapterId?: string;
  userPrompt: string;
  agentId?: string;
  behaviorId?: string;
  model?: string;
  onEvent: (event: AgentSseEvent) => void;
}): Promise<{ code: number }> {
  if (!AGENT_ENABLED) {
    throw new AgentDisabledError('agent is disabled; set AGENT_ENABLED=1 to enable');
  }
  if (!opts.userPrompt.trim()) {
    throw new AgentDisabledError('prompt is required');
  }
  if (runningByBook.has(opts.bookId)) {
    throw new AgentBusyError(opts.bookId);
  }

  let agent;
  let behavior;
  try {
    ({ agent, behavior } = await resolveAgentRun({
      agentId: opts.agentId,
      behaviorId: opts.behaviorId,
    }));
  } catch (err) {
    throw new AgentDisabledError(err instanceof Error ? err.message : String(err));
  }

  const bin = agent.bin.trim();
  if (!(await resolveExecutable(bin))) {
    throw new AgentDisabledError(
      `agent binary not found: ${bin} (edit agents[].bin in config/agents.json)`,
    );
  }

  const allowedModels = new Set(agent.models.map((m) => m.id));
  const requested = (opts.model ?? '').trim();
  if (requested && !allowedModels.has(requested)) {
    throw new AgentDisabledError(`model "${requested}" is not allowed for agent "${agent.id}"`);
  }

  const root = bookRoot(opts.bookId);
  let chapterFile: string | undefined;
  if (opts.chapterId) {
    const toc = await getBookToc(opts.bookId);
    chapterFile = toc?.chapters.find((c) => c.id === opts.chapterId)?.file;
  }

  const prompt = await buildRunPrompt({
    agent,
    behavior,
    bookId: opts.bookId,
    chapterFile,
    userPrompt: opts.userPrompt,
  });

  const model =
    requested ||
    (agent.defaultModel ?? '').trim() ||
    AGENT_MODEL ||
    undefined;
  const args = buildCliArgv({
    agent,
    bookRoot: root,
    readerRoot: ROOT_DIR,
    model,
    prompt,
  });

  const result = await runConfiguredCli({
    bin,
    args,
    cwd: root,
    onEvent: opts.onEvent,
    onSpawn: (child) => {
      runningByBook.set(opts.bookId, child);
    },
    onSettled: () => {
      runningByBook.delete(opts.bookId);
    },
  });

  if (result.code === 0) {
    const hintBits = [
      `agent ${agent.id}/${behavior.id}`,
      opts.chapterId ? `chapter ${opts.chapterId}` : null,
      opts.userPrompt.trim().slice(0, 120),
    ].filter(Boolean);
    const commit = await tryCommitBookChanges(opts.bookId, {
      fallbackMessage: `docs: agent ${behavior.id}`,
      hint: hintBits.join(' — '),
    });
    if (commit?.committed) {
      opts.onEvent({
        type: 'log',
        stream: 'stdout',
        text: `\n[book-git] committed ${commit.sha?.slice(0, 7) ?? ''} — ${commit.message ?? ''}\n`,
      });
    } else if (commit?.initialized) {
      opts.onEvent({
        type: 'log',
        stream: 'stdout',
        text: '\n[book-git] repository initialized\n',
      });
    }
  }

  return result;
}
