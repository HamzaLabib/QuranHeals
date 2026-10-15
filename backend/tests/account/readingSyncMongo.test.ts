import { randomUUID } from 'node:crypto';

import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEVELOPMENT_DATABASE, PRODUCTION_DATABASE, TEST_DATABASE, resolveDatabaseTarget } from '../../src/config/databaseTarget';
import { SessionModel } from '../../src/models/Session';
import { UserModel } from '../../src/models/User';
import { UserReadingRecordModel } from '../../src/models/UserReadingRecord';
import { UserReadingSyncStateModel } from '../../src/models/UserReadingSyncState';
import { UserSyncKeyModel } from '../../src/models/UserSyncKey';
import { MongooseAccountDeletionService } from '../../src/services/MongooseAccountDeletionService';
import { MongooseSyncRepository } from '../../src/services/MongooseSyncRepository';
import { MongooseUserRepository } from '../../src/services/MongooseUserRepository';
import type { ReadingChange } from '../../src/services/readingSync';
import { pushReadingSchema } from '../../src/validators/readingSyncValidators';

vi.mock('../../src/config/env', () => ({ env: { SESSION_JWT_SECRET: 'synthetic-integration-test-secret' } }));

/**
 * أورادي وختماتي sync on a real (in-memory, loopback, unauthenticated)
 * MongoDB replica set: transactions, the unique indexes and genuinely
 * concurrent writes — what the in-memory repository cannot prove.
 */
const databaseName = `${TEST_DATABASE}_reading`;
let replicaSet: MongoMemoryReplSet | undefined;
const repo = new MongooseSyncRepository();

async function newUser() {
  const user = await new MongooseUserRepository().findOrCreateByProviderIdentity({
    provider: 'google',
    providerSubject: `reading-${randomUUID()}`,
    email: `${randomUUID()}@example.invalid`,
    emailVerified: true,
  });
  return user.id;
}

const T = '2026-10-01T00:00:00.000Z';
const wird = (recordId: string, baseRevision: number | null, name = 'Fajr'): ReadingChange => ({
  kind: 'wird', recordId, action: 'upsert', baseRevision,
  data: { v: 1, kind: 'wird', id: recordId, name, nameUpdatedAt: T, page: 250, savedAt: T, cycle: { id: `c-${recordId}`, startedAt: T, lastSavedPage: 250, reachedEndAt: null, startedByKhatmaId: null, savedSinceStart: true, seq: 0, undoneCycleId: null } },
});
const khatma = (recordId: string, cycleId: string): ReadingChange => ({
  kind: 'khatma', recordId, action: 'upsert',
  data: { v: 1, kind: 'khatma', id: recordId, stopId: 'stop-1', stopName: 'Fajr', cycleId, cycleStartedAt: T, previousStartedByKhatmaId: null, completedAt: '2027-02-10T12:00:00.000Z', localDate: '2027-02-10', ramadan: true, ramadanHijriYear: 1448 },
});
const remove = (kind: 'wird' | 'khatma', recordId: string): ReadingChange => ({ kind, recordId, action: 'delete' });

describe('أورادي وختماتي sync on MongoDB (replica set)', () => {
  beforeAll(async () => {
    replicaSet = await MongoMemoryReplSet.create({ binary: { version: '8.2.6' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
    const uri = replicaSet.getUri(databaseName);
    const address = new URL(uri);
    const target = resolveDatabaseTarget({ nodeEnv: 'test', uri, dbName: databaseName });
    if (
      target.environment !== 'test' ||
      target.databaseName !== databaseName ||
      ([PRODUCTION_DATABASE, DEVELOPMENT_DATABASE] as string[]).includes(target.databaseName) ||
      !['127.0.0.1', 'localhost', '::1'].includes(address.hostname) ||
      address.username !== '' ||
      address.password !== ''
    ) {
      throw new Error('Refusing MongoDB integration test: target is not the unauthenticated loopback test replica set.');
    }
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, { dbName: target.databaseName, autoIndex: false, serverSelectionTimeoutMS: 10_000 });
    if (mongoose.connection.db?.databaseName !== databaseName) throw new Error('Refusing: wrong database.');
    for (const model of [UserModel, SessionModel, UserSyncKeyModel, UserReadingRecordModel, UserReadingSyncStateModel]) {
      await model.createCollection();
      await model.createIndexes();
    }
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replicaSet?.stop();
  });

  it('stores the validated content for the account (no encryption fields); a deletion marker keeps no content', async () => {
    const userId = await newUser();
    await repo.pushReading(userId, [wird('stop-1', null, 'ورد الفجر'), khatma('khatma-c1', 'c1')]);
    let docs = await UserReadingRecordModel.find({ userId }).lean();
    const wirdDoc = docs.find((doc) => doc.recordId === 'stop-1')!;
    expect(Object.keys(wirdDoc).sort()).toEqual(['__v', '_id', 'changeSeq', 'createdAt', 'data', 'deleted', 'kind', 'recordId', 'revision', 'updatedAt', 'userId'].sort());
    expect(wirdDoc.data).toMatchObject({ name: 'ورد الفجر', page: 250 });
    expect(docs.find((doc) => doc.recordId === 'khatma-c1')).toMatchObject({ cycleId: 'c1', data: { ramadan: true, localDate: '2027-02-10' } });
    await repo.pushReading(userId, [remove('khatma', 'khatma-c1')]);
    docs = await UserReadingRecordModel.find({ userId }).lean();
    const marker = docs.find((doc) => doc.recordId === 'khatma-c1')!;
    expect(marker).toMatchObject({ deleted: true, revision: 2 });
    for (const field of ['data', 'ciphertext', 'nonce', 'encryptionVersion', 'keyFingerprint', 'cycleId', 'legacyEncrypted']) expect(marker).not.toHaveProperty(field);
  });

  it('a ورد`s `ayahKey`: accepted by the request schema, stored in the document, returned by the change feed; a page-only update removes it', async () => {
    const userId = await newUser();
    const withAyah = { ...wird('stop-1', null), data: { ...(wird('stop-1', null) as { data: object }).data, ayahKey: '13:10' } };
    // Through the same schema the route uses: the field survives validation.
    const { changes } = pushReadingSchema.parse({ changes: [withAyah] });
    expect((changes[0] as { data: { ayahKey?: string } }).data.ayahKey).toBe('13:10');
    expect((await repo.pushReading(userId, changes)).results[0].status).toBe('applied');
    const stored = await UserReadingRecordModel.findOne({ userId, recordId: 'stop-1' }).lean();
    expect(stored?.data).toMatchObject({ page: 250, ayahKey: '13:10' });
    const pulled = await repo.pullReading(userId, 0, 50);
    expect(pulled.records.find((r) => r.recordId === 'stop-1')?.data).toMatchObject({ page: 250, ayahKey: '13:10' });
    // A later page-only save: the content is replaced whole, so the ayah is gone from the document and the feed.
    const pageOnly = pushReadingSchema.parse({ changes: [wird('stop-1', 1)] }).changes;
    expect((await repo.pushReading(userId, pageOnly)).results[0].status).toBe('applied');
    expect((await UserReadingRecordModel.findOne({ userId, recordId: 'stop-1' }).lean())?.data).not.toHaveProperty('ayahKey');
    expect((await repo.pullReading(userId, 0, 50)).records.find((r) => r.recordId === 'stop-1')?.data).not.toHaveProperty('ayahKey');
  });

  it('the partial unique index allows one confirmed Khatma per (account, cycle), and another after a removal', async () => {
    const userId = await newUser();
    const doc = (recordId: string, deleted = false) => ({ userId, kind: 'khatma', recordId, revision: 1, changeSeq: 1, deleted, cycleId: 'c1', data: { v: 1 } });
    await UserReadingRecordModel.create(doc('k1'));
    await expect(UserReadingRecordModel.create(doc('k2'))).rejects.toMatchObject({ code: 11000 });
    await UserReadingRecordModel.updateOne({ userId, recordId: 'k1' }, { $set: { deleted: true } });
    await expect(UserReadingRecordModel.create(doc('k2'))).resolves.toBeDefined();
    // Another account's same cycle id is independent.
    await expect(UserReadingRecordModel.create({ ...doc('k1'), userId: await newUser() })).resolves.toBeDefined();
  });

  it('two devices confirming the same cycle at the same moment record it exactly once', async () => {
    const userId = await newUser();
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) => repo.pushReading(userId, [khatma(i % 2 === 0 ? 'khatma-c1' : `khatma-c1-device${i}`, 'c1')])),
    );
    const statuses = attempts.map((attempt) => attempt.results[0].status);
    expect(statuses.every((status) => status === 'applied' || status === 'duplicate')).toBe(true);
    const confirmed = await UserReadingRecordModel.find({ userId, kind: 'khatma', deleted: false }).lean();
    expect(confirmed).toHaveLength(1);
    // Every answer points at that one canonical record.
    for (const attempt of attempts) expect(attempt.results[0].record?.recordId).toBe(confirmed[0].recordId);
    expect(statuses.filter((status) => status === 'applied').length).toBeGreaterThanOrEqual(1);
  });

  it('concurrent stale updates: exactly one wins, the rest are conflicts with the winner', async () => {
    const userId = await newUser();
    await repo.pushReading(userId, [wird('stop-1', null)]);
    const attempts = await Promise.all(Array.from({ length: 6 }, (_, i) => repo.pushReading(userId, [wird('stop-1', 1, `device${i}`)])));
    const applied = attempts.filter((attempt) => attempt.results[0].status === 'applied');
    expect(applied).toHaveLength(1);
    const winner = applied[0].results[0].record!;
    expect(winner.revision).toBe(2);
    for (const attempt of attempts.filter((a) => a !== applied[0])) {
      expect(attempt.results[0]).toMatchObject({ status: 'conflict', record: { revision: 2, data: { name: (winner.data as { name: string }).name } } });
    }
  });

  it('change numbers are unique and gap-free under concurrency, so an incremental download never misses one', async () => {
    const userId = await newUser();
    await Promise.all(Array.from({ length: 10 }, (_, i) => repo.pushReading(userId, [wird(`stop-${i}`, null), wird(`stop-${i}-b`, null)])));
    const seqs = (await UserReadingRecordModel.find({ userId }).lean()).map((doc) => doc.changeSeq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    let since = 0;
    const seen: string[] = [];
    for (;;) {
      const page = await repo.pullReading(userId, since, 3);
      seen.push(...page.records.map((record) => record.recordId));
      since = page.nextSince;
      if (!page.hasMore) break;
    }
    expect(new Set(seen).size).toBe(20);
    expect((await UserReadingSyncStateModel.findOne({ userId }).lean())?.seq).toBe(20);
  });

  it('a deleted record is never revived, even by a concurrent stale upload', async () => {
    const userId = await newUser();
    await repo.pushReading(userId, [wird('stop-1', null), khatma('khatma-c1', 'c1')]);
    const [deletion, staleWird, staleKhatma] = await Promise.all([
      repo.pushReading(userId, [remove('wird', 'stop-1'), remove('khatma', 'khatma-c1')]),
      repo.pushReading(userId, [wird('stop-1', 1, 'late')]),
      repo.pushReading(userId, [khatma('khatma-c1', 'c1')]),
    ]);
    expect(deletion.results.every((result) => result.status === 'applied')).toBe(true);
    void staleWird;
    void staleKhatma;
    // Whatever the order, both end deleted, and further uploads are refused.
    const docs = await UserReadingRecordModel.find({ userId }).lean();
    expect(docs.every((doc) => doc.deleted)).toBe(true);
    expect((await repo.pushReading(userId, [wird('stop-1', 3), khatma('khatma-c1', 'c1')])).results.map((r) => r.status)).toEqual(['deleted', 'deleted']);
  });

  it('a write for an account deleted meanwhile is refused (401) and leaves nothing behind', async () => {
    const userId = await newUser();
    await new MongooseAccountDeletionService().deleteAccount(userId);
    await expect(repo.pushReading(userId, [wird('stop-1', null)])).rejects.toMatchObject({ statusCode: 401 });
    expect(await UserReadingRecordModel.countDocuments({ userId })).toBe(0);
    expect(await UserReadingSyncStateModel.countDocuments({ userId })).toBe(0);
  });

  it('account deletion removes the account`s reading records and counter, and no one else`s', async () => {
    const userId = await newUser();
    const other = await newUser();
    await repo.pushReading(userId, [wird('stop-1', null), khatma('khatma-c1', 'c1'), remove('khatma', 'khatma-c0')]);
    await repo.pushReading(other, [wird('stop-1', null)]);
    await new MongooseAccountDeletionService().deleteAccount(userId);
    expect(await UserReadingRecordModel.countDocuments({ userId })).toBe(0);
    expect(await UserReadingSyncStateModel.countDocuments({ userId })).toBe(0);
    expect(await UserReadingRecordModel.countDocuments({ userId: other })).toBe(1);
  });

  it('a Sync Password reset or new key never touches أورادي وختماتي: records, markers and the sync position stay', async () => {
    const userId = await newUser();
    await repo.pushReading(userId, [wird('stop-1', null), khatma('khatma-c1', 'c1'), remove('khatma', 'khatma-c0')]);
    const before = await repo.pullReading(userId, 0, 100);
    await repo.resetReflectionSync(userId);
    await repo.deleteReflectionsNotEncryptedWith(userId, 'fp-2');
    expect(await repo.pullReading(userId, 0, 100)).toEqual(before);
  });

  it('migration: legacy encrypted records are kept but never served; the device`s own upload replaces them, keeping the ciphertext aside', async () => {
    const userId = await newUser();
    const legacy = (recordId: string, kind: string, extra: Record<string, unknown> = {}) => ({ userId, kind, recordId, revision: 1, changeSeq: 1, deleted: false, ciphertext: 'bGVnYWN5', nonce: 'bm9uY2U=', encryptionVersion: 1, keyFingerprint: 'fp-old', ...extra });
    await UserReadingRecordModel.collection.insertMany([
      legacy('stop-1', 'wird'),
      legacy('khatma-c1-legacy', 'khatma', { cycleId: 'c1', changeSeq: 2 }),
      { userId, kind: 'khatma', recordId: 'khatma-c0', revision: 2, changeSeq: 3, deleted: true },
    ]);
    await UserReadingSyncStateModel.collection.insertOne({ userId, seq: 3, syncId: 'legacy-sync' });
    expect((await repo.pullReading(userId, 0, 100)).records).toEqual([expect.objectContaining({ recordId: 'khatma-c0', deleted: true })]);

    const result = await repo.pushReading(userId, [wird('stop-1', null), khatma('khatma-c1', 'c1'), khatma('khatma-c0', 'c0')]);
    expect(result.results.map((r) => r.status)).toEqual(['applied', 'applied', 'deleted']);
    const docs = await UserReadingRecordModel.find({ userId }).lean();
    const stop = docs.find((doc) => doc.recordId === 'stop-1')!;
    expect(stop).toMatchObject({ revision: 2, data: { page: 250 }, legacyEncrypted: { ciphertext: 'bGVnYWN5', keyFingerprint: 'fp-old' } });
    expect(stop).not.toHaveProperty('ciphertext');
    // The legacy Khatma for the same cycle: set aside, kept, out of the index and the feed.
    expect(docs.find((doc) => doc.recordId === 'khatma-c1-legacy')).toMatchObject({ kind: 'legacy-khatma', ciphertext: 'bGVnYWN5' });
    expect((await repo.pullReading(userId, 0, 100)).records.map((r) => r.recordId).sort()).toEqual(['khatma-c0', 'khatma-c1', 'stop-1']);
    expect(await UserReadingRecordModel.countDocuments({ userId, kind: 'khatma', deleted: false })).toBe(1);
  });
});
