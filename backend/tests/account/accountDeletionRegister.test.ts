import { join, parse, posix, win32 } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ACCOUNT_DELETION_REGISTER_DAYS, AccountDeletionModel, registerEntry } from '../../src/models/AccountDeletion';
import {
  assertExportPathAllowed,
  assertLocalRestoreUri,
  EXPORT_IN_ONEDRIVE,
  EXPORT_IN_REPOSITORY,
  exportPathProblems,
  idsToReapply,
  parseExport,
} from '../../src/scripts/restoreDeletionRegister';

/** The deletion register and the restore tool's safety checks (release audit B12, 2026-10-28). */
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

describe('deletion register', () => {
  it('keeps an entry 30 days, longer than any Atlas Flex snapshot (8 days)', () => {
    const now = new Date('2026-10-28T00:00:00.000Z');
    expect(ACCOUNT_DELETION_REGISTER_DAYS).toBeGreaterThan(8);
    expect(registerEntry(A, now)).toEqual({ userId: A, deletedAt: now, purgeAt: new Date('2026-11-27T00:00:00.000Z') });
  });

  it('stores the account id and dates only, and expires by TTL', () => {
    expect(Object.keys(AccountDeletionModel.schema.paths).sort()).toEqual(['_id', 'deletedAt', 'purgeAt', 'userId']);
    expect(AccountDeletionModel.collection.collectionName).toBe('accountdeletions');
    expect(AccountDeletionModel.schema.indexes()).toContainEqual([{ purgeAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0 })]);
  });
});

describe('restore tool safety', () => {
  it('reapply only ever connects to a local mongod', () => {
    expect(() => assertLocalRestoreUri('mongodb://127.0.0.1:27027/')).not.toThrow();
    expect(() => assertLocalRestoreUri('mongodb://localhost:27027/')).not.toThrow();
    expect(() => assertLocalRestoreUri('mongodb+srv://user:secret@cluster0.example.mongodb.net/')).toThrow(/mongodb\+srv/);
    expect(() => assertLocalRestoreUri('mongodb://cluster0-shard-00-00.example.mongodb.net:27017/')).toThrow(/local restored copy/);
    expect(() => assertLocalRestoreUri('not a url')).toThrow();
  });

  it('the export is never written into the repository or OneDrive (this OS)', () => {
    // Paths built for the OS running the test, so the same assertions hold on Windows and on the Linux CI runner.
    const drive = parse(process.cwd()).root;
    expect(() => assertExportPathAllowed(join(__dirname, 'register.json'))).toThrow(EXPORT_IN_REPOSITORY);
    expect(() => assertExportPathAllowed(join(drive, 'Users', 'x', 'OneDrive', 'Documents', 'register.json'))).toThrow(EXPORT_IN_ONEDRIVE);
    expect(() => assertExportPathAllowed(join(drive, 'QuranHealsRestoreTest', 'register.json'))).not.toThrow();
  });

  describe('export path rules on Windows and POSIX (independent of the OS running the test)', () => {
    const winRepo = 'C:\\Users\\h\\OneDrive\\Documents\\Projects\\My App\\QuranHeals';
    const win = (target: string, cwd = 'C:\\Users\\h') => exportPathProblems(target, { pathApi: win32, repoRoot: winRepo, cwd });
    const posixRepo = '/home/runner/work/QuranHeals/QuranHeals';
    const nix = (target: string, cwd = `${posixRepo}/backend`) => exportPathProblems(target, { pathApi: posix, repoRoot: posixRepo, cwd });

    it('Windows: OneDrive outside the repository is refused for OneDrive only', () => {
      expect(win('C:\\Users\\x\\OneDrive\\Documents\\register.json')).toEqual([EXPORT_IN_ONEDRIVE]);
      expect(win('D:\\OneDrive - Contoso\\register.json')).toEqual([EXPORT_IN_ONEDRIVE]);
      expect(win('C:/Users/x/OneDrive/register.json')).toEqual([EXPORT_IN_ONEDRIVE]);
    });

    it('Windows: the repository (itself inside OneDrive) reports both reasons, whatever the letter case', () => {
      expect(win(`${winRepo}\\backend\\register.json`)).toEqual([EXPORT_IN_REPOSITORY, EXPORT_IN_ONEDRIVE]);
      expect(win(`${winRepo.toLowerCase()}\\register.json`)).toEqual([EXPORT_IN_REPOSITORY, EXPORT_IN_ONEDRIVE]);
      // A relative path is judged where it lands: here, the working directory is the repository.
      expect(win('register.json', `${winRepo}\\backend`)).toEqual([EXPORT_IN_REPOSITORY, EXPORT_IN_ONEDRIVE]);
    });

    it('Windows: a sibling folder that only starts with the repository name is not the repository', () => {
      expect(win('C:\\Users\\h\\OneDrive\\Documents\\Projects\\My App\\QuranHealsBackups\\r.json')).toEqual([EXPORT_IN_ONEDRIVE]);
      expect(win('C:\\QuranHealsRestoreTest\\register.json')).toEqual([]);
      expect(win('C:\\Users\\h\\NotOneDriveAtAll\\register.json')).toEqual([]);
    });

    it('POSIX: repository and OneDrive are both refused, each on its own', () => {
      expect(nix(`${posixRepo}/backend/register.json`)).toEqual([EXPORT_IN_REPOSITORY]);
      expect(nix('/home/u/OneDrive/register.json')).toEqual([EXPORT_IN_ONEDRIVE]);
      expect(nix('/tmp/quranheals-restore/register.json')).toEqual([]);
      expect(nix('/home/runner/work/QuranHeals/QuranHealsBackups/r.json')).toEqual([]);
    });

    it('POSIX: a Windows-style path is relative there, so it is refused as inside the repository, and its OneDrive folder is still seen', () => {
      // The failure first seen on the Linux CI runner: written as-is, this file would land in the working directory.
      expect(nix('C:\\Users\\x\\OneDrive\\Documents\\register.json')).toEqual([EXPORT_IN_REPOSITORY, EXPORT_IN_ONEDRIVE]);
      expect(nix('C:\\QuranHealsRestoreTest\\register.json')).toEqual([EXPORT_IN_REPOSITORY]);
      expect(nix('C:\\QuranHealsRestoreTest\\register.json', '/tmp')).toEqual([]);
    });

    it('the thrown message names every reason, so one protection never hides the other', () => {
      const both = join(__dirname, 'OneDrive', 'register.json');
      expect(() => assertExportPathAllowed(both)).toThrow(EXPORT_IN_REPOSITORY);
      expect(() => assertExportPathAllowed(both)).toThrow(EXPORT_IN_ONEDRIVE);
    });
  });

  it('re-deletes the union of the live export and the restored copy’s own register, each once', () => {
    const exported = parseExport(JSON.stringify({ kind: 'quran-heals-deletion-register', exportedAt: '2026-10-28T00:00:00Z', database: 'quranheals_prod', entries: [{ userId: B, deletedAt: '2026-10-27T00:00:00Z' }, { userId: A, deletedAt: '2026-10-26T00:00:00Z' }] }));
    expect(idsToReapply(exported, [{ userId: A }])).toEqual([A, B]);
  });

  it('refuses a file that is not a register export, or has a malformed id', () => {
    expect(() => parseExport('{"entries":[]}')).toThrow(/Not a deletion-register export/);
    expect(() => parseExport(JSON.stringify({ kind: 'quran-heals-deletion-register', entries: [{ userId: 'x', deletedAt: '2026-10-27T00:00:00Z' }] }))).toThrow(/malformed/);
  });
});
