import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT_DIR } from './config';
import { resolveExecutable } from './drivers/runCli';

export type AgentDriverId = string;

export interface AgentModelOption {
  id: string;
  title: string;
}

export interface AgentBehavior {
  id: string;
  title: string;
  promptFile: string;
}

export interface AgentDef {
  id: string;
  title: string;
  /** Short label for the CLI family (cursor-cli, claude-code, …) */
  driver: AgentDriverId;
  /** CLI executable name or absolute path on this machine */
  bin: string;
  /** Argv template; placeholders: {{bookRoot}} {{readerRoot}} */
  args: string[];
  /** Driver-specific invoke instructions (prompt template) */
  promptFile: string;
  /** Default model id from models[] (empty string = CLI default) */
  defaultModel?: string;
  models: AgentModelOption[];
}

export interface AgentsConfigFile {
  defaultAgent: string;
  defaultBehavior: string;
  agents: AgentDef[];
  behaviors: AgentBehavior[];
}

export interface AgentCatalogPublic {
  defaultAgent: string;
  defaultBehavior: string;
  agents: Array<{
    id: string;
    title: string;
    driver: AgentDriverId;
    bin: string;
    binOk: boolean;
    defaultModel: string;
    models: AgentModelOption[];
  }>;
  behaviors: Array<{ id: string; title: string }>;
}

const CONFIG_DIR = path.join(ROOT_DIR, 'config');
const AGENTS_FILE = path.join(CONFIG_DIR, 'agents.json');

let cached: AgentsConfigFile | null = null;
let cachedAt = 0;
const CACHE_MS = 2000;

async function readJsonConfig(): Promise<AgentsConfigFile> {
  const raw = await fs.readFile(AGENTS_FILE, 'utf8');
  const parsed = JSON.parse(raw) as AgentsConfigFile;
  if (
    !parsed.defaultAgent ||
    !parsed.defaultBehavior ||
    !Array.isArray(parsed.agents) ||
    parsed.agents.length === 0 ||
    !Array.isArray(parsed.behaviors) ||
    parsed.behaviors.length === 0
  ) {
    throw new Error(
      'invalid agents.json: need defaultAgent, defaultBehavior, agents[], behaviors[]',
    );
  }
  for (const a of parsed.agents) {
    if (
      !a.id ||
      !a.title ||
      !a.driver ||
      !a.bin?.trim() ||
      !a.promptFile ||
      !Array.isArray(a.args) ||
      a.args.length === 0 ||
      !Array.isArray(a.models)
    ) {
      throw new Error(`invalid agent entry: ${JSON.stringify(a)}`);
    }
    if (!a.args.every((x) => typeof x === 'string')) {
      throw new Error(`invalid agent args (must be string[]): ${a.id}`);
    }
    a.bin = a.bin.trim();
    if (typeof a.defaultModel === 'string') {
      a.defaultModel = a.defaultModel.trim();
    } else {
      a.defaultModel = undefined;
    }
    if (
      a.defaultModel !== undefined &&
      !a.models.some((m) => (m.id ?? '') === a.defaultModel)
    ) {
      throw new Error(
        `agent "${a.id}" defaultModel "${a.defaultModel}" is not in models[]`,
      );
    }
  }
  for (const b of parsed.behaviors) {
    if (!b.id || !b.title || !b.promptFile) {
      throw new Error(`invalid behavior entry: ${JSON.stringify(b)}`);
    }
  }
  return parsed;
}

export async function loadAgentsConfig(force = false): Promise<AgentsConfigFile> {
  const now = Date.now();
  if (!force && cached && now - cachedAt < CACHE_MS) return cached;
  cached = await readJsonConfig();
  cachedAt = now;
  return cached;
}

export async function getAgentsCatalog(): Promise<AgentCatalogPublic> {
  const cfg = await loadAgentsConfig();
  const agents = await Promise.all(
    cfg.agents.map(async (a) => {
      const bin = a.bin.trim();
      return {
        id: a.id,
        title: a.title,
        driver: a.driver,
        bin,
        binOk: (await resolveExecutable(bin)) != null,
        defaultModel: a.defaultModel ?? '',
        models: a.models.map((m) => ({ id: m.id ?? '', title: m.title || m.id || '默认' })),
      };
    }),
  );
  return {
    defaultAgent: cfg.defaultAgent,
    defaultBehavior: cfg.defaultBehavior,
    agents,
    behaviors: cfg.behaviors.map((b) => ({ id: b.id, title: b.title })),
  };
}

export async function resolveAgentRun(opts: {
  agentId?: string;
  behaviorId?: string;
}): Promise<{ agent: AgentDef; behavior: AgentBehavior }> {
  const cfg = await loadAgentsConfig();
  const agentId = (opts.agentId ?? cfg.defaultAgent).trim() || cfg.defaultAgent;
  const agent = cfg.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`unknown agent: ${agentId}`);

  const behaviorId = (opts.behaviorId ?? cfg.defaultBehavior).trim() || cfg.defaultBehavior;
  const behavior = cfg.behaviors.find((b) => b.id === behaviorId);
  if (!behavior) {
    throw new Error(`unknown behavior: ${behaviorId}`);
  }
  return { agent, behavior };
}

/** Build final argv from agents[].args + optional --model + prompt. */
export function buildCliArgv(opts: {
  agent: AgentDef;
  bookRoot: string;
  readerRoot?: string;
  model?: string;
  prompt: string;
}): string[] {
  const vars: Record<string, string> = {
    bookRoot: opts.bookRoot,
    readerRoot: opts.readerRoot ?? ROOT_DIR,
  };
  const args = opts.agent.args.map((token) =>
    token.replace(/\{\{\s*(bookRoot|readerRoot)\s*\}\}/g, (_m, key: string) => vars[key] ?? ''),
  );
  const model = (opts.model ?? '').trim();
  if (model) {
    args.push('--model', model);
  }
  args.push(opts.prompt);
  return args;
}

function safePromptPath(rel: string): string {
  const abs = path.resolve(CONFIG_DIR, rel);
  if (!abs.startsWith(CONFIG_DIR + path.sep) && abs !== CONFIG_DIR) {
    throw new Error(`prompt path escapes config dir: ${rel}`);
  }
  return abs;
}

async function loadPromptFile(rel: string): Promise<string> {
  return fs.readFile(safePromptPath(rel), 'utf8');
}

export function renderPromptTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    return vars[key] ?? '';
  });
}

export async function buildRunPrompt(opts: {
  agent: AgentDef;
  behavior: AgentBehavior;
  bookId: string;
  chapterFile?: string;
  userPrompt: string;
}): Promise<string> {
  const authoringPath = path.join(ROOT_DIR, 'books', 'sample');
  const common = await loadPromptFile('prompts/_common.md');
  const scope = opts.chapterFile
    ? `Default edit scope: the current chapter file \`${opts.chapterFile}\` under this book root. Expand to other files in this book only if the user explicitly asks for the whole book or other chapters.`
    : `Edit scope: any Markdown / book.json under this book root as needed.`;

  const baseVars = {
    common: common.trim(),
    authoringPath,
    bookId: opts.bookId,
    chapterFile: opts.chapterFile ?? '',
    scope,
    userPrompt: opts.userPrompt.trim(),
  };

  const driver = renderPromptTemplate(
    await loadPromptFile(opts.agent.promptFile),
    baseVars,
  ).trim();

  return renderPromptTemplate(await loadPromptFile(opts.behavior.promptFile), {
    ...baseVars,
    driver,
  }).trim();
}
