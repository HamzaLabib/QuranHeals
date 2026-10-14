import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { READING_LIMITS } from '../../src/services/readingSync';
import { buildAccountTestApp } from './testApp';

/**
 * أورادي وختماتي sync API (/api/sync/reading): account-based like favorites
 * — no Sync Password, never affected by the reflections' one. The server
 * keeps the records consistent: compare-and-swap updates, permanent
 * deletion markers, one confirmed Khatma per cycle, an incremental change
 * feed. Same rules on MongoDB: readingSyncMongo.test.ts.
 */
type TestApp = ReturnType<typeof buildAccountTestApp>;

async function signIn({ app, googleTokens }: TestApp, sub: string) {
  googleTokens.set(`token-${sub}`, { providerSubject: sub });
  const res = await request(app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: `token-${sub}` });
  return { token: res.body.data.token as string, userId: res.body.data.user.id as string };
}

const KEY = { wrappedKey: 'd3JhcHBlZA==', nonce: 'bm9uY2U=', salt: 'c2FsdA==', kdfIterations: 210_000, encryptionVersion: 2, keyFingerprint: 'fp-1' };

/** An account; no Sync Password key unless `withSyncKey`. */
async function account(t: TestApp, sub: string, options: { withSyncKey?: boolean } = {}) {
  const { token, userId } = await signIn(t, sub);
  if (options.withSyncKey) await request(t.app).put('/api/sync/key').set('Authorization', `Bearer ${token}`).send(KEY).expect(200);
  return {
    token,
    userId,
    push: (changes: unknown[]) => request(t.app).post('/api/sync/reading').set('Authorization', `Bearer ${token}`).send({ changes }),
    pull: (query = '') => request(t.app).get(`/api/sync/reading${query}`).set('Authorization', `Bearer ${token}`),
  };
}

const T = '2026-10-01T00:00:00.000Z';
const wirdData = (id: string, overrides: Record<string, unknown> = {}) => ({
  v: 1, kind: 'wird', id, name: 'ورد الفجر', nameUpdatedAt: T, page: 250, savedAt: T,
  cycle: { id: `c-${id}`, startedAt: T, lastSavedPage: 250, reachedEndAt: null, startedByKhatmaId: null, savedSinceStart: true, seq: 0, undoneCycleId: null },
  ...overrides,
});
const khatmaData = (id: string, cycleId: string, overrides: Record<string, unknown> = {}) => ({
  v: 1, kind: 'khatma', id, stopId: 'stop-1', stopName: 'ورد الفجر', cycleId, cycleStartedAt: T, previousStartedByKhatmaId: null,
  completedAt: '2027-02-10T12:00:00.000Z', localDate: '2027-02-10', ramadan: true, ramadanHijriYear: 1448, ...overrides,
});
const wird = (recordId: string, baseRevision: number | null, overrides: Record<string, unknown> = {}) => ({ kind: 'wird', recordId, action: 'upsert', baseRevision, data: wirdData(recordId, overrides) });
const khatma = (recordId: string, cycleId: string, overrides: Record<string, unknown> = {}) => ({ kind: 'khatma', recordId, action: 'upsert', data: khatmaData(recordId, cycleId, overrides) });
const remove = (kind: 'wird' | 'khatma', recordId: string) => ({ kind, recordId, action: 'delete' });
const active = (baseRevision: number | null, stopId: string | null) => ({ kind: 'active', recordId: 'active', action: 'upsert', baseRevision, data: { v: 1, kind: 'active', id: 'active', stopId, changedAt: T } });
const statuses = (res: request.Response) => res.body.data.results.map((r: { status: string }) => r.status);

describe('أورادي وختماتي sync: access', () => {
  it('requires a signed-in session for reading and writing', async () => {
    const { app } = buildAccountTestApp();
    expect((await request(app).get('/api/sync/reading')).status).toBe(401);
    expect((await request(app).post('/api/sync/reading').send({ changes: [wird('stop-1', null)] })).status).toBe(401);
    expect((await request(app).get('/api/sync/reading').set('Authorization', 'Bearer not-a-token')).status).toBe(401);
  });

  it('works with the session alone: no Sync Password key is needed or consulted', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    expect((await request(t.app).get('/api/sync/key').set('Authorization', `Bearer ${a.token}`)).body.data).toBeNull();
    const res = await a.push([wird('stop-1', null), khatma('khatma-c1', 'c1'), active(null, 'stop-1')]);
    expect(res.status).toBe(200);
    expect(statuses(res)).toEqual(['applied', 'applied', 'applied']);
    expect((await a.pull()).body.data.records).toHaveLength(3);
  });

  it('Account B never sees or changes Account A`s records, even by naming the same ids', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    const b = await account(t, 'b');
    await a.push([wird('stop-1', null, { name: 'A wird' }), khatma('khatma-c1', 'c1')]);
    expect((await b.pull()).body.data.records).toEqual([]);
    expect(statuses(await b.push([wird('stop-1', null, { name: 'B wird' }), khatma('khatma-c1', 'c1')]))).toEqual(['applied', 'applied']);
    expect(statuses(await b.push([remove('wird', 'stop-1')]))).toEqual(['applied']);
    const aRecords = (await a.pull()).body.data.records;
    expect(aRecords).toHaveLength(2);
    expect(aRecords.find((r: { recordId: string }) => r.recordId === 'stop-1')).toMatchObject({ deleted: false, data: { name: 'A wird' } });
  });

  it('an account id in the body is refused, never used', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    expect((await request(t.app).post('/api/sync/reading').set('Authorization', `Bearer ${a.token}`).send({ userId: 'someone-else', changes: [wird('stop-1', null)] })).status).toBe(400);
    expect((await a.push([{ ...wird('stop-1', null), userId: 'someone-else' }])).status).toBe(400);
  });

  it('account deletion removes every reading record; a new account with the same identity starts empty', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    await a.push([wird('stop-1', null), khatma('khatma-c1', 'c1'), remove('khatma', 'khatma-old')]);
    expect(t.syncRepository.reading.recordsOf(a.userId)).toHaveLength(3);
    await t.accountDeletionService.deleteAccount(a.userId);
    expect(t.syncRepository.reading.recordsOf(a.userId)).toEqual([]);
    const again = await account(t, 'a');
    expect((await again.pull()).body.data).toMatchObject({ records: [], syncId: null });
  });
});

describe('أورادي وختماتي sync: validation', () => {
  it('rejects malformed, out-of-range, mismatched or oversized content', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    const bad: unknown[][] = [
      [],
      [wird('stop-1', null, { page: 605 })],
      [wird('stop-1', null, { page: 0 })],
      [wird('stop-1', null, { page: 12.5 })],
      [wird('stop-1', null, { name: 'x'.repeat(41) })],
      [wird('stop-1', null, { name: '' })],
      [wird('stop-1', null, { name: ' padded ' })],
      [wird('stop-1', null, { name: 'two  spaces' })],
      [wird('stop-1', null, { name: 'line\nbreak' })],
      [wird('stop-1', null, { savedAt: 'yesterday' })],
      [wird('stop-1', null, { extra: 'field' })],
      [{ ...wird('stop-1', null), data: wirdData('stop-2') }], // content of another record
      [{ ...wird('stop-1', null), data: { ...wirdData('stop-1'), cycle: { ...wirdData('stop-1').cycle, lastSavedPage: 12 } } }], // cycle disagrees with page
      [{ ...wird('stop-1', null), data: { ...wirdData('stop-1'), cycle: { ...wirdData('stop-1').cycle, seq: -1 } } }],
      [khatma('khatma-c1', 'c1', { localDate: '10/02/2027' })],
      [khatma('khatma-c1', 'c1', { ramadan: 'yes' })],
      [khatma('khatma-c1', 'c1', { kind: 'wird' })],
      [{ ...khatma('khatma-c1', 'c1'), cycleId: 'c1' }],
      [wird('../etc/passwd', null)],
      [{ kind: 'wird', recordId: 'stop-1', action: 'upsert', baseRevision: null }],
      [{ kind: 'active', recordId: 'not-active', action: 'upsert', baseRevision: null, data: { v: 1, kind: 'active', id: 'active', stopId: null, changedAt: null } }],
      [{ kind: 'active', recordId: 'active', action: 'delete' }],
      [{ kind: 'stats', recordId: 'all', action: 'upsert', baseRevision: null, data: {} }],
      [{ ...wird('stop-1', null), revision: 99 }],
      [wird('stop-1', 0)],
      [wird('stop-1', null), wird('stop-1', null)],
      Array.from({ length: 51 }, (_, i) => wird(`stop-${i}`, null)),
    ];
    for (const changes of bad) expect((await a.push(changes)).status, JSON.stringify(changes).slice(0, 100)).toBe(400);
    for (const query of ['?since=-1', '?since=abc', '?limit=0', '?limit=501', '?since=1&userId=x']) expect((await a.pull(query)).status, query).toBe(400);
    expect((await a.pull()).body.data.records).toEqual([]);
  });

  it('the unreleased encrypted format is refused, so a client still sending it cannot overwrite anything', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a', { withSyncKey: true });
    await a.push([wird('stop-1', null, { page: 250 })]);
    const payload = { ciphertext: 'Y2lwaGVy', nonce: 'bm9uY2U=', encryptionVersion: 1, keyFingerprint: 'fp-1' };
    for (const old of [
      { kind: 'wird', recordId: 'stop-1', action: 'upsert', baseRevision: 1, payload },
      { kind: 'khatma', recordId: 'khatma-c1', action: 'upsert', cycleId: 'c1', payload },
    ]) expect((await a.push([old])).status).toBe(400);
    expect((await a.pull()).body.data.records).toEqual([expect.objectContaining({ recordId: 'stop-1', revision: 1, data: expect.objectContaining({ page: 250 }) })]);
  });

  it('an old client`s batch is refused whole: a valid change sent alongside encrypted content, or content carrying ciphertext, changes nothing', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    await a.push([wird('stop-1', null, { page: 250 }), khatma('khatma-c1', 'c1')]);
    const before = (await a.pull()).body.data.records;
    const payload = { ciphertext: 'Y2lwaGVy', nonce: 'bm9uY2U=', encryptionVersion: 1, keyFingerprint: 'fp-1' };
    for (const changes of [
      [wird('stop-1', 1, { page: 10 }), { kind: 'wird', recordId: 'stop-2', action: 'upsert', baseRevision: null, payload }],
      [remove('khatma', 'khatma-c1'), { kind: 'khatma', recordId: 'khatma-c2', action: 'upsert', payload }],
      [{ ...wird('stop-1', 1, { page: 10 }), ...payload }],
      [{ ...remove('khatma', 'khatma-c1'), keyFingerprint: 'fp-1' }],
    ]) expect((await a.push(changes)).status).toBe(400);
    expect((await a.pull()).body.data.records).toEqual(before);
  });

  it('a content-free deletion is accepted from any client: it carries no content and is the user`s own removal', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    await a.push([khatma('khatma-c1', 'c1')]);
    expect(statuses(await a.push([remove('khatma', 'khatma-c1')]))).toEqual(['applied']);
    expect((await a.pull()).body.data.records).toEqual([expect.objectContaining({ recordId: 'khatma-c1', deleted: true })]);
  });
});

describe('أورادي وختماتي sync: rules', () => {
  it('a ورد: created at revision 1; an update must name the current revision, otherwise a conflict with the current record', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    expect((await a.push([wird('stop-1', null, { page: 10, cycle: { ...wirdData('stop-1').cycle, lastSavedPage: 10 } })])).body.data.results[0]).toMatchObject({ status: 'applied', record: { revision: 1, data: { page: 10 } } });
    const at = (page: number) => ({ page, cycle: { ...wirdData('stop-1').cycle, lastSavedPage: page } });
    expect((await a.push([wird('stop-1', 1, at(20))])).body.data.results[0]).toMatchObject({ status: 'applied', record: { revision: 2 } });
    expect((await a.push([wird('stop-1', 1, at(30))])).body.data.results[0]).toMatchObject({ status: 'conflict', record: { revision: 2, data: { page: 20 } } });
    expect((await a.push([wird('stop-1', null, at(40))])).body.data.results[0].status).toBe('conflict');
    expect((await a.push([wird('stop-1', 2, at(30))])).body.data.results[0]).toMatchObject({ status: 'applied', record: { revision: 3, data: { page: 30 } } });
  });

  it('a deleted ورد never comes back: later updates and re-creations answer `deleted`', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    await a.push([wird('stop-1', null)]);
    const deleted = (await a.push([remove('wird', 'stop-1')])).body.data.results[0];
    expect(deleted).toMatchObject({ status: 'applied', record: { deleted: true, revision: 2 } });
    expect(deleted.record.data).toBeUndefined();
    expect((await a.push([wird('stop-1', 1)])).body.data.results[0]).toMatchObject({ status: 'deleted', record: { deleted: true } });
    expect((await a.push([wird('stop-1', null)])).body.data.results[0].status).toBe('deleted');
    expect((await a.push([remove('wird', 'stop-1')])).body.data.results[0]).toMatchObject({ status: 'applied', record: { revision: 2 } });
    const records = (await a.pull()).body.data.records;
    expect(records).toEqual([expect.objectContaining({ recordId: 'stop-1', deleted: true })]);
    expect(records[0].data).toBeUndefined();
  });

  it('a Khatma: re-sending is idempotent and never replaces it; a second record for the same cycle is a duplicate', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    expect((await a.push([khatma('khatma-c1', 'c1')])).body.data.results[0]).toMatchObject({ status: 'applied', record: { revision: 1, data: { cycleId: 'c1', ramadan: true } } });
    for (let i = 0; i < 3; i++) {
      // The stored record is returned, with its original date and classification.
      expect((await a.push([khatma('khatma-c1', 'c1', { completedAt: '2027-06-01T00:00:00.000Z', ramadan: false, ramadanHijriYear: null })])).body.data.results[0])
        .toMatchObject({ status: 'applied', record: { revision: 1, data: { completedAt: '2027-02-10T12:00:00.000Z', ramadan: true } } });
    }
    expect((await a.push([khatma('khatma-c1-other', 'c1')])).body.data.results[0]).toMatchObject({ status: 'duplicate', record: { recordId: 'khatma-c1', data: { cycleId: 'c1' } } });
    expect((await a.pull()).body.data.records.filter((r: { kind: string; deleted: boolean }) => r.kind === 'khatma' && !r.deleted)).toHaveLength(1);
  });

  it('a removed Khatma is never restored by an older copy; re-confirming the cycle later takes a new id', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    await a.push([khatma('khatma-c1', 'c1')]);
    expect((await a.push([remove('khatma', 'khatma-c1')])).body.data.results[0]).toMatchObject({ status: 'applied', record: { deleted: true } });
    expect((await a.push([khatma('khatma-c1', 'c1')])).body.data.results[0].status).toBe('deleted');
    expect((await a.push([khatma('khatma-c1-2', 'c1')])).body.data.results[0]).toMatchObject({ status: 'applied', record: { data: { cycleId: 'c1' } } });
    await a.push([remove('khatma', 'khatma-never-uploaded')]);
    expect((await a.push([khatma('khatma-never-uploaded', 'c9')])).body.data.results[0].status).toBe('deleted');
  });

  it('the active ورد: compare-and-swap like a ورد, never deletable', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    expect((await a.push([active(null, 'stop-1')])).body.data.results[0]).toMatchObject({ status: 'applied', record: { kind: 'active', revision: 1 } });
    expect((await a.push([active(null, 'stop-2')])).body.data.results[0].status).toBe('conflict');
    expect((await a.push([active(1, 'stop-2')])).body.data.results[0]).toMatchObject({ status: 'applied', record: { revision: 2, data: { stopId: 'stop-2' } } });
  });

  it('a batch applies each change independently and reports each one', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    await a.push([wird('stop-1', null)]);
    expect(statuses(await a.push([wird('stop-1', 7), wird('stop-2', null), khatma('khatma-c1', 'c1'), remove('wird', 'stop-3')]))).toEqual(['conflict', 'applied', 'applied', 'applied']);
  });

  it('bounded: a new ورد beyond the limit is refused (`limit`), updates and deletions still apply', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    for (let start = 0; start < READING_LIMITS.activeWirds; start += 50) {
      await a.push(Array.from({ length: 50 }, (_, i) => wird(`stop-${start + i}`, null)));
    }
    expect(statuses(await a.push([wird('stop-extra', null)]))).toEqual(['limit']);
    expect(statuses(await a.push([wird('stop-0', 1)]))).toEqual(['applied']);
    expect(statuses(await a.push([remove('wird', 'stop-1')]))).toEqual(['applied']);
    expect(statuses(await a.push([wird('stop-extra', null)]))).toEqual(['applied']);
  });
});

describe('أورادي وختماتي sync: incremental download', () => {
  it('returns changes after `since`, in change order, page by page', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    await a.push(Array.from({ length: 5 }, (_, i) => wird(`stop-${i}`, null)));
    await a.push([wird('stop-0', 1, { name: 'Renamed' })]);
    const first = (await a.pull('?limit=4')).body.data;
    expect(first.records.map((r: { recordId: string }) => r.recordId)).toEqual(['stop-1', 'stop-2', 'stop-3', 'stop-4']);
    expect(first.hasMore).toBe(true);
    const second = (await a.pull(`?since=${first.nextSince}&limit=4`)).body.data;
    expect(second.records).toEqual([expect.objectContaining({ recordId: 'stop-0', revision: 2, data: expect.objectContaining({ name: 'Renamed' }) })]);
    expect(second.hasMore).toBe(false);
    expect((await a.pull(`?since=${second.nextSince}`)).body.data).toMatchObject({ records: [], hasMore: false, nextSince: second.nextSince });
  });
});

describe('the Sync Password affects reflections only', () => {
  it('a forgotten-password reset and a new key leave every ورد, Khatma, marker and the sync position untouched', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a', { withSyncKey: true });
    await a.push([wird('stop-1', null), khatma('khatma-c1', 'c1'), remove('khatma', 'khatma-c0'), active(null, 'stop-1')]);
    const before = (await a.pull()).body.data;
    await t.syncRepository.resetReflectionSync(a.userId);
    await request(t.app).put('/api/sync/key').set('Authorization', `Bearer ${a.token}`).send({ ...KEY, keyFingerprint: 'fp-2' }).expect(200);
    await t.syncRepository.deleteReflectionsNotEncryptedWith(a.userId, 'fp-2');
    expect((await a.pull()).body.data).toEqual(before);
    // And it keeps syncing as before, with no key involved.
    expect(statuses(await a.push([wird('stop-1', 1, { name: 'After reset' })]))).toEqual(['applied']);
  });
});

describe('migration from the unreleased encrypted format', () => {
  it('legacy encrypted records are never served; a device`s own copy replaces them (the ciphertext kept aside); legacy deletion markers still hold', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    const store = t.syncRepository.reading;
    store.seedLegacy(a.userId, { kind: 'wird', recordId: 'stop-1' });
    store.seedLegacy(a.userId, { kind: 'khatma', recordId: 'khatma-c1', cycleId: 'c1' });
    store.seedLegacy(a.userId, { kind: 'khatma', recordId: 'khatma-c0', deleted: true });
    // Only the content-free deletion marker is served.
    expect((await a.pull()).body.data.records).toEqual([expect.objectContaining({ recordId: 'khatma-c0', deleted: true })]);
    // The device re-uploads what it holds, as new records (its sync state was reset by the app update).
    const res = await a.push([wird('stop-1', null), khatma('khatma-c1', 'c1'), khatma('khatma-c0', 'c0')]);
    expect(statuses(res)).toEqual(['applied', 'applied', 'deleted']);
    expect(res.body.data.results[0].record.revision).toBe(2); // continues the legacy record's revision
    const stored = store.recordsOf(a.userId);
    expect(stored.find((r) => r.recordId === 'stop-1')).toMatchObject({ legacyEncrypted: 'bGVnYWN5', data: expect.objectContaining({ page: 250 }) });
    expect((await a.pull()).body.data.records.map((r: { recordId: string }) => r.recordId).sort()).toEqual(['khatma-c0', 'khatma-c1', 'stop-1']);
  });

  it('a legacy Khatma holding a cycle under another id is set aside (kept, never served), and the device`s own record takes the cycle', async () => {
    const t = buildAccountTestApp();
    const a = await account(t, 'a');
    t.syncRepository.reading.seedLegacy(a.userId, { kind: 'khatma', recordId: 'khatma-c1-legacy', cycleId: 'c1' });
    expect(statuses(await a.push([khatma('khatma-c1', 'c1')]))).toEqual(['applied']);
    expect(t.syncRepository.reading.recordsOf(a.userId).find((r) => r.recordId === 'khatma-c1-legacy')?.kind).toBe('legacy-khatma');
    expect((await a.pull()).body.data.records.map((r: { recordId: string }) => r.recordId)).toEqual(['khatma-c1']);
    // Still one Khatma for the cycle from here on.
    expect(statuses(await a.push([khatma('khatma-c1-again', 'c1')]))).toEqual(['duplicate']);
  });
});
