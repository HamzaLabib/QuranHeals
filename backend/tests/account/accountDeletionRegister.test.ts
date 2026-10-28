import { describe, expect, it } from 'vitest';

import { ACCOUNT_DELETION_REGISTER_DAYS, AccountDeletionModel, registerEntry } from '../../src/models/AccountDeletion';
import { assertExportPathAllowed, assertLocalRestoreUri, idsToReapply, parseExport } from '../../src/scripts/restoreDeletionRegister';

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

  it('the export is never written into the repository or OneDrive', () => {
    expect(() => assertExportPathAllowed(`${__dirname}/register.json`)).toThrow(/repository|OneDrive/);
    expect(() => assertExportPathAllowed('C:\\Users\\x\\OneDrive\\Documents\\register.json')).toThrow(/OneDrive/);
    expect(() => assertExportPathAllowed('C:\\QuranHealsRestoreTest\\register.json')).not.toThrow();
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
