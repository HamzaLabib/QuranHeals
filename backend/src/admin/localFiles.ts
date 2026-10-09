import { randomBytes } from 'node:crypto';
import { closeSync, openSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/** The QuranHeals repository root (this file is backend/src/admin/localFiles.ts). */
export const REPOSITORY_ROOT = resolve(__dirname, '../../..');

/**
 * The admin tool's case store, audit log and holds file hold information
 * about real deletion requests, so they must never land in the repository
 * (where they could be committed). Refuses any path inside it.
 */
export function assertOutsideRepository(path: string, label: string, repositoryRoot = REPOSITORY_ROOT): void {
  const fromRoot = relative(resolve(repositoryRoot), resolve(path));
  const inside = fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot));
  if (inside) throw new Error(`The ${label} must be outside the QuranHeals repository (got ${path}).`);
}

function isInside(path: string, folder: string): boolean {
  const fromFolder = relative(resolve(folder), resolve(path));
  return fromFolder === '' || (!fromFolder.startsWith('..') && !isAbsolute(fromFolder));
}

/**
 * A warning (never a refusal) when an admin file sits in a OneDrive-synced
 * folder: a pruned record would then survive in OneDrive's version history
 * and recycle bin, outside the approved retention periods.
 */
export function cloudSyncWarning(path: string, env: Record<string, string | undefined> = process.env): string | null {
  const roots = [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter((root): root is string => Boolean(root));
  return roots.some((root) => isInside(path, root))
    ? `WARNING ${path} is inside a OneDrive-synced folder; removed records can survive in OneDrive's version history and recycle bin. See docs/account-deletion-requests.md.`
    : null;
}

/** Write-to-temporary-then-rename, so an interrupted write never leaves a truncated file. */
export function writeFileAtomic(path: string, contents: string): void {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}

export class FileLockError extends Error {}

/**
 * An exclusive, cross-process lock on `path` (a sibling `<path>.lock`
 * file created with O_EXCL). Two terminals can therefore never verify the
 * same code, or delete with the same case, at the same time. A lock left by
 * a crashed run is never removed automatically: the message tells the
 * operator to check that no other run is active and delete it by hand.
 */
export class FileLock {
  private depth = 0;
  private fd: number | null = null;

  constructor(private readonly path: string) {}

  get lockPath(): string {
    return `${this.path}.lock`;
  }

  private acquire(): void {
    if (this.depth++ > 0) return;
    try {
      this.fd = openSync(this.lockPath, 'wx', 0o600);
      writeSync(this.fd, `${process.pid} ${new Date().toISOString()}\n`);
    } catch (error) {
      this.depth = 0;
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new FileLockError(
          `${this.lockPath} exists: another run is using this file, or an earlier run stopped unexpectedly. ` +
            'Make sure no other run is active, then delete the .lock file and retry.',
        );
      }
      throw error;
    }
  }

  private release(): void {
    if (--this.depth > 0) return;
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
    try { unlinkSync(this.lockPath); } catch { /* already gone */ }
  }

  /** Runs `fn` holding the lock. Re-entrant within one process, so locked methods can call each other. */
  run<T>(fn: () => T): T {
    this.acquire();
    try {
      return fn();
    } finally {
      this.release();
    }
  }

  async runAsync<T>(fn: () => Promise<T>): Promise<T> {
    this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
