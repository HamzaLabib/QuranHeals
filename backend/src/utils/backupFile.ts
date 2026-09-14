import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { sha256Utf8 } from './checksum';

/**
 * Thrown when a just-written backup fails read-back, JSON parsing, or shape
 * verification. Callers must let this propagate — it means the guarded
 * destructive operation must not proceed.
 */
export class BackupVerificationError extends Error {}

export type WrittenBackup = {
  path: string;
  sha256: string;
  byteLength: number;
};

/**
 * Writes `contents` as JSON to `absolutePath` with fail-if-exists semantics
 * (`flag: 'wx'`, so an existing backup is never overwritten), creating the
 * parent directory recursively first. Immediately reads the bytes back,
 * parses them, and runs `validate` against the parsed value — only on
 * success does this return; any failure throws `BackupVerificationError`
 * before the caller can proceed to a destructive step.
 */
export function writeVerifiedJsonBackup(
  absolutePath: string,
  contents: unknown,
  validate: (parsed: unknown) => boolean,
): WrittenBackup {
  const serialized = `${JSON.stringify(contents, null, 2)}\n`;

  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, serialized, { flag: 'wx' });

  const readBack = readFileSync(absolutePath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(readBack);
  } catch {
    throw new BackupVerificationError(`Backup at ${absolutePath} could not be parsed as JSON after writing.`);
  }

  if (!validate(parsed)) {
    throw new BackupVerificationError(`Backup at ${absolutePath} failed shape/record-count verification after writing.`);
  }

  return { path: absolutePath, sha256: sha256Utf8(readBack), byteLength: Buffer.byteLength(readBack, 'utf-8') };
}
