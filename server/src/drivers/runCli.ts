import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import type { AgentSseEvent } from '../agentTypes';

export const CLI_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 10 * 60 * 1000);

export async function resolveExecutable(bin: string): Promise<string | null> {
  if (bin.includes('/') || bin.includes('\\')) {
    try {
      await access(bin, fsConstants.X_OK);
      return bin;
    } catch {
      return null;
    }
  }
  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, bin);
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // next
    }
  }
  return null;
}

export interface RunConfiguredCliOpts {
  bin: string;
  args: string[];
  cwd: string;
  onEvent: (event: AgentSseEvent) => void;
  onSpawn?: (child: ChildProcess) => void;
  onSettled?: () => void;
}

export async function runConfiguredCli(opts: RunConfiguredCliOpts): Promise<{ code: number }> {
  const bin = opts.bin.trim();
  const binPath = await resolveExecutable(bin);
  if (!binPath) {
    throw new Error(
      `agent binary not found: ${bin} (install the CLI or set agents[].bin in config/agents.json)`,
    );
  }

  const env = { ...process.env, NO_OPEN_BROWSER: '1' };

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(binPath, opts.args, {
        cwd: opts.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(err);
      return;
    }

    opts.onSpawn?.(child);
    let settled = false;

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      opts.onSettled?.();
      clearTimeout(timer);
      opts.onEvent({ type: 'done', code });
      resolve({ code });
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      opts.onSettled?.();
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      opts.onEvent({ type: 'error', message });
      reject(new Error(message));
    };

    const timeout =
      Number.isFinite(CLI_TIMEOUT_MS) && CLI_TIMEOUT_MS > 0
        ? CLI_TIMEOUT_MS
        : 10 * 60 * 1000;
    const timer = setTimeout(() => {
      fail(`agent timed out after ${timeout}ms`);
    }, timeout);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      opts.onEvent({ type: 'log', stream: 'stdout', text: chunk });
    });
    child.stderr?.on('data', (chunk: string) => {
      opts.onEvent({ type: 'log', stream: 'stderr', text: chunk });
    });
    child.on('error', (err) => {
      fail(err.message);
    });
    child.on('close', (code) => {
      finish(code ?? 1);
    });
  });
}
