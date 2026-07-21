import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { BOOKS_DIR } from './config';

const SAFE_BOOK_ID = /^[\w][\w.-]*$/;
/** Relative markdown under book root. */
const SAFE_REL_FILE = /^[\w][\w./-]*\.md$/;

/**
 * Git ref-ish: HEAD, branch/tag names, or hex sha.
 * Rejects option injection and path tricks.
 */
const SAFE_REF =
  /^(?:HEAD(?:\^[0-9]*)?|[0-9a-f]{4,40}|[A-Za-z][A-Za-z0-9._\-/]*)$/;

export class GitError extends Error {
  constructor(
    message: string,
    public status: number = 500,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export function bookRoot(bookId: string): string {
  if (!SAFE_BOOK_ID.test(bookId)) throw new GitError(`invalid book id: ${bookId}`, 400);
  return path.join(BOOKS_DIR, bookId);
}

export function assertSafeRelFile(file: string): void {
  if (!SAFE_REL_FILE.test(file) || file.includes('..')) {
    throw new GitError(`invalid file path: ${file}`, 400);
  }
}

export function assertSafeRef(ref: string): void {
  if (!ref || ref.length > 256 || !SAFE_REF.test(ref) || ref.includes('..')) {
    throw new GitError(`invalid git ref: ${ref}`, 400);
  }
}

export function hasBookGit(bookId: string): boolean {
  return existsSync(path.join(bookRoot(bookId), '.git'));
}

interface GitRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Exported for book commit helpers. */
export async function runGit(cwd: string, args: string[]): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new GitError('git command timed out', 504));
    }, 15_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new GitError(`git not available: ${err.message}`, 503));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export interface GitCommitSummary {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
}

export interface GitRefSummary {
  name: string;
  sha: string;
  kind: 'branch' | 'tag' | 'other';
}

export async function listBookRefs(bookId: string): Promise<GitRefSummary[]> {
  if (!hasBookGit(bookId)) throw new GitError('not a git repository', 503);
  const root = bookRoot(bookId);
  const result = await runGit(root, [
    'for-each-ref',
    '--format=%(refname:short)\t%(objectname)\t%(refname)',
    'refs/heads',
    'refs/tags',
  ]);
  if (result.code !== 0) {
    throw new GitError(result.stderr.trim() || 'failed to list refs', 500);
  }
  const out: GitRefSummary[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [name, sha, full] = line.split('\t');
    if (!name || !sha) continue;
    let kind: GitRefSummary['kind'] = 'other';
    if (full?.startsWith('refs/heads/')) kind = 'branch';
    else if (full?.startsWith('refs/tags/')) kind = 'tag';
    out.push({ name, sha, kind });
  }
  return out;
}

function parseLogLimit(limit: number | undefined, fallback: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(1, Math.floor(limit!)), 200);
}

function parseCommitLog(stdout: string): GitCommitSummary[] {
  const out: GitCommitSummary[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const [sha, shortSha, subject, author, date] = line.split('\t');
    if (!sha) continue;
    out.push({
      sha,
      shortSha: shortSha ?? sha.slice(0, 7),
      subject: subject ?? '',
      author: author ?? '',
      date: date ?? '',
    });
  }
  return out;
}

export async function listBookHistory(
  bookId: string,
  limit = 100,
): Promise<GitCommitSummary[]> {
  if (!hasBookGit(bookId)) throw new GitError('not a git repository', 503);
  const lim = parseLogLimit(limit, 100);
  const root = bookRoot(bookId);
  const result = await runGit(root, [
    'log',
    `-n${lim}`,
    '--format=%H%x09%h%x09%s%x09%an%x09%aI',
  ]);
  if (result.code !== 0) {
    throw new GitError(result.stderr.trim() || 'failed to read history', 500);
  }
  return parseCommitLog(result.stdout);
}

export async function listFileHistory(
  bookId: string,
  relFile: string,
  limit = 50,
): Promise<GitCommitSummary[]> {
  if (!hasBookGit(bookId)) throw new GitError('not a git repository', 503);
  assertSafeRelFile(relFile);
  const lim = parseLogLimit(limit, 50);
  const root = bookRoot(bookId);
  const result = await runGit(root, [
    'log',
    `-n${lim}`,
    '--format=%H%x09%h%x09%s%x09%an%x09%aI',
    '--',
    relFile,
  ]);
  if (result.code !== 0) {
    throw new GitError(result.stderr.trim() || 'failed to read history', 500);
  }
  return parseCommitLog(result.stdout);
}

/** Blob text at ref:path; missing path → empty string. */
export async function showBookFile(
  bookId: string,
  ref: string,
  relFile: string,
): Promise<string> {
  if (!hasBookGit(bookId)) throw new GitError('not a git repository', 503);
  assertSafeRef(ref);
  assertSafeRelFile(relFile);
  const root = bookRoot(bookId);
  const result = await runGit(root, ['show', `${ref}:${relFile}`]);
  if (result.code !== 0) {
    const err = result.stderr.toLowerCase();
    const missingPath =
      err.includes('does not exist') ||
      err.includes('exists on disk, but not in') ||
      (err.includes('path') && err.includes('exist')) ||
      err.includes('not in');
    if (missingPath || err.includes('bad revision') || err.includes('invalid object')) {
      const rev = await runGit(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
      if (rev.code !== 0) {
        throw new GitError(`unknown ref: ${ref}`, 400);
      }
      if (missingPath) return '';
      throw new GitError(`unknown ref: ${ref}`, 400);
    }
    throw new GitError(result.stderr.trim() || `git show failed for ${ref}:${relFile}`, 500);
  }
  return result.stdout;
}

export async function resolveRef(bookId: string, ref: string): Promise<string> {
  if (!hasBookGit(bookId)) throw new GitError('not a git repository', 503);
  assertSafeRef(ref);
  const root = bookRoot(bookId);
  const result = await runGit(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (result.code !== 0) {
    throw new GitError(`unknown ref: ${ref}`, 400);
  }
  return result.stdout.trim();
}
