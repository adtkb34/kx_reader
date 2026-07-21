import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadAgentsConfig } from './agentConfig';
import { resolveExecutable, runCliCapture } from './drivers/runCli';

const COMMIT_MSG_TIMEOUT_MS = Number(process.env.COMMIT_MSG_TIMEOUT_MS ?? 90_000);
const DIFF_MAX = 12_000;

function sanitizeCommitMessage(raw: string, fallback: string): string {
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('```'));
  let line =
    lines.find((l) => !/^(here'?s|commit message|subject)\b/i.test(l)) ?? lines[0] ?? '';
  line = line.replace(/^["'`]+|["'`]+$/g, '').replace(/^Commit message:\s*/i, '');
  if (line.length > 200) line = line.slice(0, 197) + '...';
  if (!line || line.length < 3) return fallback.slice(0, 200);
  return line;
}

/** Ask the default agent CLI for a one-line commit message; never edits the book. */
export async function generateCommitMessageAi(opts: {
  diff: string;
  fallback: string;
  hint?: string;
}): Promise<string> {
  const fallback = opts.fallback.trim() || 'docs: update book';
  let agent;
  try {
    const cfg = await loadAgentsConfig();
    agent = cfg.agents.find((a) => a.id === cfg.defaultAgent) ?? cfg.agents[0];
  } catch {
    return fallback;
  }
  if (!agent || !(await resolveExecutable(agent.bin))) {
    return fallback;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kx-reader-commit-'));
  try {
    const diff =
      opts.diff.length > DIFF_MAX ? `${opts.diff.slice(0, DIFF_MAX)}\n…(truncated)` : opts.diff;
    const hint = opts.hint?.trim() ? `Context: ${opts.hint.trim()}\n` : '';
    const prompt = [
      'You write git commit messages for a documentation book.',
      'Do NOT modify any files. Do NOT run git commands.',
      'Reply with ONLY one commit message line (imperative, <= 72 chars preferred).',
      'No quotes, no markdown, no explanation.',
      hint,
      'Diff:',
      diff || '(no diff text)',
    ].join('\n');

    const model =
      (agent.defaultModel ?? '').trim() || process.env.AGENT_MODEL?.trim() || undefined;
    const args = buildCommitMsgArgv(agent.driver, tmp, model, prompt);
    const result = await runCliCapture({
      bin: agent.bin,
      args,
      cwd: tmp,
      timeoutMs: Number.isFinite(COMMIT_MSG_TIMEOUT_MS) ? COMMIT_MSG_TIMEOUT_MS : 90_000,
    });
    if (result.code !== 0) {
      console.warn('[commit-msg] AI CLI failed:', result.stderr.slice(0, 400));
      return fallback;
    }
    return sanitizeCommitMessage(result.stdout, fallback);
  } catch (err) {
    console.warn('[commit-msg] AI unavailable:', err instanceof Error ? err.message : err);
    return fallback;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Minimal print argv: empty workspace, no reader --add-dir. */
function buildCommitMsgArgv(
  driver: string,
  workspace: string,
  model: string | undefined,
  prompt: string,
): string[] {
  if (driver === 'claude-code') {
    const args = ['-p', '--permission-mode', 'acceptEdits', '--output-format', 'text'];
    if (model) args.push('--model', model);
    args.push(prompt);
    return args;
  }
  const args = [
    '-p',
    '--trust',
    '--force',
    '--workspace',
    workspace,
    '--output-format',
    'text',
  ];
  if (model) args.push('--model', model);
  args.push(prompt);
  return args;
}
