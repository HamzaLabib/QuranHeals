import { isAbsolute, relative, resolve } from 'node:path';

/** The QuranHeals repository root (this file is backend/src/admin/localFiles.ts). */
export const REPOSITORY_ROOT = resolve(__dirname, '../../..');

/**
 * The admin tool's case store and audit log hold information about real
 * deletion requests, so they must never land in the repository (where they
 * could be committed). Refuses any path inside it.
 */
export function assertOutsideRepository(path: string, label: string, repositoryRoot = REPOSITORY_ROOT): void {
  const fromRoot = relative(resolve(repositoryRoot), resolve(path));
  const inside = fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot));
  if (inside) throw new Error(`The ${label} must be outside the QuranHeals repository (got ${path}).`);
}
