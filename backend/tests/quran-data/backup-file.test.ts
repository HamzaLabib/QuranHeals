import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BackupVerificationError, writeVerifiedJsonBackup } from '../../src/utils/backupFile';
import { sha256Utf8 } from '../../src/utils/checksum';

// All writes in this suite go to a freshly created OS temp directory, never
// to backend/backups/ - no real backup is ever created by these tests.
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'backup-file-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('writeVerifiedJsonBackup', () => {
  it('creates the parent directory recursively', () => {
    const nestedPath = join(tempDir, 'a', 'b', 'c', 'backup.json');
    const result = writeVerifiedJsonBackup(nestedPath, { verses: [1, 2, 3] }, (parsed) =>
      Array.isArray((parsed as { verses?: unknown }).verses),
    );

    expect(existsSync(nestedPath)).toBe(true);
    expect(result.path).toBe(nestedPath);
  });

  it('writes valid, parseable JSON that reads back exactly as written', () => {
    const target = join(tempDir, 'backup.json');
    const payload = { verses: [{ _id: 'a' }, { _id: 'b' }], ayahs: [{ _id: 'c' }] };

    writeVerifiedJsonBackup(target, payload, (parsed) => {
      const candidate = parsed as typeof payload;
      return candidate.verses.length === 2 && candidate.ayahs.length === 1;
    });

    const readBack = JSON.parse(readFileSync(target, 'utf-8'));
    expect(readBack).toEqual(payload);
  });

  it('refuses to overwrite an existing backup (fail-if-exists)', () => {
    const target = join(tempDir, 'backup.json');
    writeVerifiedJsonBackup(target, { verses: [] }, () => true);

    expect(() => writeVerifiedJsonBackup(target, { verses: [1] }, () => true)).toThrow();

    // The original backup must be untouched by the failed second attempt.
    const stillOriginal = JSON.parse(readFileSync(target, 'utf-8'));
    expect(stillOriginal).toEqual({ verses: [] });
  });

  it('throws BackupVerificationError when validation fails, and the write is not silently accepted', () => {
    const target = join(tempDir, 'backup.json');

    expect(() =>
      writeVerifiedJsonBackup(target, { verses: [1, 2, 3] }, (parsed) => {
        const candidate = parsed as { verses?: unknown[] };
        // Deliberately wrong expected count, simulating incomplete/invalid data.
        return Array.isArray(candidate.verses) && candidate.verses.length === 999;
      }),
    ).toThrow(BackupVerificationError);
  });

  it('computes a deterministic SHA-256 over the exact written bytes', () => {
    const target = join(tempDir, 'backup.json');
    const payload = { verses: [{ _id: 'a' }] };

    const result = writeVerifiedJsonBackup(target, payload, () => true);
    const bytesOnDisk = readFileSync(target, 'utf-8');

    expect(result.sha256).toBe(sha256Utf8(bytesOnDisk));
    expect(result.byteLength).toBe(Buffer.byteLength(bytesOnDisk, 'utf-8'));
  });

  it('never returns from a failed write/verification, so a caller-side guarded mutation never runs', () => {
    const target = join(tempDir, 'backup.json');
    let mutationRan = false;

    function guardedMutation() {
      writeVerifiedJsonBackup(target, { verses: [1] }, () => false); // always fails verification
      mutationRan = true; // must never be reached
    }

    expect(guardedMutation).toThrow(BackupVerificationError);
    expect(mutationRan).toBe(false);
  });

  it('requires no database connection or network access', () => {
    // Purely a structural assertion: this whole suite only touches the
    // filesystem (an OS temp directory) and node:crypto: no mongoose,
    // no MONGODB_URI, no network I/O anywhere above.
    const target = join(tempDir, 'backup.json');
    expect(() => writeVerifiedJsonBackup(target, { ok: true }, () => true)).not.toThrow();
  });
});
