import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// An in-memory stand-in for the mapping collection: the script's only database surface.
const db = vi.hoisted(() => ({
  docs: [] as Record<string, unknown>[],
  calls: [] as string[],
  updateOne: vi.fn(),
  target: { environment: 'development', databaseName: 'quranheals_dev' },
}));

vi.mock('../../src/config/database', () => ({
  connectScriptDatabase: vi.fn(async () => {
    db.calls.push('connect');
    return db.target;
  }),
  disconnectFromDatabase: vi.fn(async () => {
    db.calls.push('disconnect');
  }),
}));
import mongoose from 'mongoose';

import { EmotionVerseMappingModel } from '../../src/models/EmotionVerseMapping';
import { parseApplyArgs, runApplyConnections } from '../../src/scripts/applyAyahConnections';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
let dir: string;
let file: string;

function seed() {
  db.docs = [
    { _id: 'm1', emotionKey: 'sad', verseReferenceKey: '93:3', status: 'approved', mappingVersion: 'v7', rationale: 'kept', tafsirReferences: ['ref'], reviewedBy: 'editor' },
    { _id: 'm2', emotionKey: 'sad', verseReferenceKey: '94:5', status: 'approved', mappingVersion: 'v7', connection: { en: 'old', ar: 'قديم' } },
    { _id: 'm3', emotionKey: 'hopeless', verseReferenceKey: '93:3', status: 'approved', mappingVersion: 'v7' },
  ];
}

beforeEach(() => {
  seed();
  db.calls = [];
  dir = mkdtempSync(join(tmpdir(), 'connections-'));
  file = join(dir, 'reviewed.json');
  writeFileSync(file, JSON.stringify({ sad: { '93:3': { en: '...', ar: '...' }, '94:5': { en: '...' } } }));

  vi.spyOn(EmotionVerseMappingModel, 'find').mockImplementation(((filter: { $or?: { emotionKey: string; verseReferenceKey: string }[]; _id?: { $in: string[] } }) => {
    db.calls.push('find');
    const matches = db.docs.filter((doc) =>
      filter.$or ? filter.$or.some((pair) => pair.emotionKey === doc.emotionKey && pair.verseReferenceKey === doc.verseReferenceKey) : filter._id!.$in.includes(doc._id as string),
    );
    const query = { session: () => query, lean: async () => clone(matches) };
    return query;
  }) as never);
  db.updateOne.mockImplementation(async (filter: Record<string, unknown>, update: { $set: Record<string, string>; $unset?: Record<string, ''> }) => {
    db.calls.push('update');
    const doc = db.docs.find((candidate) => Object.entries(filter).every(([key, value]) => candidate[key] === value));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    const connection = { ...((doc.connection as object) ?? {}) } as Record<string, string>;
    for (const [path, value] of Object.entries(update.$set)) connection[path.split('.')[1]] = value;
    for (const path of Object.keys(update.$unset ?? {})) delete connection[path.split('.')[1]];
    doc.connection = connection;
    return { matchedCount: 1, modifiedCount: 1 };
  });
  // The script writes with one bulkWrite; each op goes through the same in-memory update.
  vi.spyOn(EmotionVerseMappingModel, 'bulkWrite').mockImplementation((async (ops: { updateOne: { filter: Record<string, unknown>; update: never } }[], options: { session?: unknown }) => {
    db.calls.push('bulkWrite');
    expect(options.session).toBeDefined(); // inside the transaction
    let matchedCount = 0;
    for (const op of ops) matchedCount += (await db.updateOne(op.updateOne.filter, op.updateOne.update)).matchedCount;
    return { matchedCount };
  }) as never);
  vi.spyOn(mongoose, 'startSession').mockImplementation((async () => ({
    withTransaction: async (fn: () => Promise<void>) => {
      db.calls.push('transaction');
      return fn();
    },
    endSession: async () => undefined,
  })) as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const run = (apply: boolean, lines: string[] = []) => runApplyConnections({ apply, filePath: file, backupDir: join(dir, 'backups'), log: (line) => lines.push(line), now: () => new Date('2026-10-07T12:00:00.000Z') });

describe('connections:apply', () => {
  it('is dry-run by default (no --apply flag)', () => {
    expect(parseApplyArgs([])).toEqual({ apply: false, filePath: undefined });
    expect(parseApplyArgs(['--apply']).apply).toBe(true);
    expect(() => parseApplyArgs(['--force'])).toThrow(/Unknown argument/);
  });

  it('8. dry-run reports the plan and writes nothing (no updates, no transaction, no backup)', async () => {
    const lines: string[] = [];
    const before = clone(db.docs);
    const result = await run(false, lines);
    expect(result).toMatchObject({ mode: 'dry-run', database: 'quranheals_dev', entries: 2, unchanged: 0, backup: null });
    expect(result.changes.map((change) => `${change.emotionKey} ${change.verseKey}`)).toEqual(['sad 93:3', 'sad 94:5']);
    expect(db.updateOne).not.toHaveBeenCalled();
    expect(db.calls).not.toContain('transaction');
    expect(db.docs).toEqual(before);
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    expect(lines[0]).toMatch(/dry-run — development\/quranheals_dev: 2 reviewed entries, 2 to update/);
    expect(lines.at(-1)).toMatch(/Dry run only; nothing was written/);
  });

  it('9/10. apply sets only connection.en/ar on the targeted mappings and leaves every other field untouched', async () => {
    const before = clone(db.docs);
    await run(true);
    const byId = (id: string) => db.docs.find((doc) => doc._id === id)!;
    expect(byId('m1').connection).toEqual({ en: '...', ar: '...' });
    expect(byId('m2').connection).toEqual({ en: '...' }); // ar not in the file → removed
    const strip = ({ connection: _connection, ...rest }: Record<string, unknown>) => rest;
    expect(db.docs.map(strip)).toEqual(before.map(strip)); // status, provenance, keys, etc. unchanged
    expect(byId('m3')).toEqual(before[2]); // same verse, other emotion: untouched
    for (const [filter, update] of db.updateOne.mock.calls) {
      expect(filter).toMatchObject({ status: 'approved' });
      expect(Object.keys({ ...update.$set, ...update.$unset }).every((key) => /^connection\.(en|ar)$/.test(key))).toBe(true);
    }
  });

  it('11. writes a verified backup of the previous connection values before any update', async () => {
    const result = await run(true);
    expect(db.calls.indexOf('update')).toBeGreaterThan(db.calls.indexOf('find'));
    const [backupFile] = readdirSync(join(dir, 'backups'));
    expect(result.backup).toBe(join(dir, 'backups', backupFile));
    const backup = JSON.parse(readFileSync(result.backup!, 'utf8'));
    expect(backup).toMatchObject({ kind: 'ayah-connections-before-apply', database: 'quranheals_dev', environment: 'development', createdAt: '2026-10-07T12:00:00.000Z' });
    expect(backup.records).toEqual([
      { mappingId: 'm1', emotionKey: 'sad', verseKey: '93:3', connection: null },
      { mappingId: 'm2', emotionKey: 'sad', verseKey: '94:5', connection: { en: 'old', ar: 'قديم' } },
    ]);
  });

  it('a backup failure prevents every write', async () => {
    writeFileSync(join(dir, 'backups'), 'not a directory'); // makes the backup directory unwritable
    await expect(run(true)).rejects.toThrow();
    expect(db.updateOne).not.toHaveBeenCalled();
  });

  it('is idempotent: a second apply finds nothing to update and writes nothing', async () => {
    await run(true);
    db.updateOne.mockClear();
    const second = await run(true);
    expect(second).toMatchObject({ unchanged: 2, changes: [], backup: null });
    expect(db.updateOne).not.toHaveBeenCalled();
  });

  it('5. an unapproved mapping stops everything before any write', async () => {
    db.docs[1].status = 'reviewed';
    await expect(run(true)).rejects.toThrow(/sad 94:5: mapping status is "reviewed"/);
    expect(db.updateOne).not.toHaveBeenCalled();
    expect(existsSync(join(dir, 'backups'))).toBe(false);
  });

  it('an invalid file stops before connecting to any database', async () => {
    writeFileSync(file, JSON.stringify({ sad: { '93:3': { en: '' } } }));
    await expect(run(true)).rejects.toThrow(/is blank/);
    expect(db.calls).not.toContain('connect');
  });

  it('a mapping that changes mid-apply rolls the whole apply back', async () => {
    db.updateOne.mockImplementationOnce(async () => ({ matchedCount: 0, modifiedCount: 0 }));
    await expect(run(true)).rejects.toThrow('Only 1 of 2 mappings matched (a mapping changed during apply); rolled back');
  });

  it('always disconnects', async () => {
    db.docs[0].status = 'development';
    await expect(run(false)).rejects.toThrow();
    expect(db.calls.at(-1)).toBe('disconnect');
  });
});
