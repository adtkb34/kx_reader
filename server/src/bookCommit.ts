import { bookRoot, hasBookGit, runGit, GitError } from './gitHistory';
import { generateCommitMessageAi } from './commitMessageAi';

export interface BookCommitResult {
  committed: boolean;
  initialized: boolean;
  sha?: string;
  message?: string;
  skippedReason?: string;
}

async function ensureLocalGitIdentity(root: string): Promise<void> {
  const name = await runGit(root, ['config', '--get', 'user.name']);
  if (name.code !== 0 || !name.stdout.trim()) {
    await runGit(root, ['config', 'user.name', 'kx-reader']);
  }
  const email = await runGit(root, ['config', '--get', 'user.email']);
  if (email.code !== 0 || !email.stdout.trim()) {
    await runGit(root, ['config', 'user.email', 'kx-reader@local']);
  }
}

/** git init if missing; set local identity when unset. */
export async function ensureBookGit(bookId: string): Promise<{ initialized: boolean }> {
  const root = bookRoot(bookId);
  let initialized = false;
  if (!hasBookGit(bookId)) {
    const init = await runGit(root, ['init']);
    if (init.code !== 0) {
      throw new GitError(init.stderr.trim() || 'git init failed', 500);
    }
    initialized = true;
  }
  await ensureLocalGitIdentity(root);
  return { initialized };
}

/**
 * After content writes: ensure git repo, stage all, AI commit message, commit.
 * No-op when working tree clean. Does not push.
 */
export async function commitBookChanges(
  bookId: string,
  opts: { fallbackMessage: string; hint?: string },
): Promise<BookCommitResult> {
  const { initialized } = await ensureBookGit(bookId);
  const root = bookRoot(bookId);

  const add = await runGit(root, ['add', '-A']);
  if (add.code !== 0) {
    throw new GitError(add.stderr.trim() || 'git add failed', 500);
  }

  const status = await runGit(root, ['status', '--porcelain']);
  if (status.code !== 0) {
    throw new GitError(status.stderr.trim() || 'git status failed', 500);
  }
  if (!status.stdout.trim()) {
    return { committed: false, initialized, skippedReason: 'clean' };
  }

  const diff = await runGit(root, ['diff', '--cached']);
  const diffText = diff.code === 0 ? diff.stdout : status.stdout;

  const message = await generateCommitMessageAi({
    diff: diffText,
    fallback: opts.fallbackMessage,
    hint: opts.hint,
  });

  const commit = await runGit(root, ['commit', '-m', message]);
  if (commit.code !== 0) {
    throw new GitError(commit.stderr.trim() || commit.stdout.trim() || 'git commit failed', 500);
  }

  const rev = await runGit(root, ['rev-parse', 'HEAD']);
  const sha = rev.code === 0 ? rev.stdout.trim() : undefined;
  return { committed: true, initialized, sha, message };
}

/** Best-effort commit; logs errors and never throws to callers of content writes. */
export async function tryCommitBookChanges(
  bookId: string,
  opts: { fallbackMessage: string; hint?: string },
): Promise<BookCommitResult | null> {
  try {
    const result = await commitBookChanges(bookId, opts);
    if (result.committed) {
      console.info(
        `[book-git] ${bookId} committed ${result.sha?.slice(0, 7) ?? '?'} — ${result.message}`,
      );
    } else if (result.initialized) {
      console.info(`[book-git] ${bookId} initialized (clean tree)`);
    }
    return result;
  } catch (err) {
    console.error(
      `[book-git] ${bookId} commit failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
