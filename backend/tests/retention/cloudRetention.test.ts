import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exactScopeProblems, type MongoPrivilege } from '../../src/config/credentialScope';
import type { DatabaseTarget } from '../../src/config/databaseTarget';
import { retentionRunHistory } from '../../src/retention/issueReportRetention';
import { DAY_MS } from '../../src/retention/retentionPolicy';
import { holdsScriptAccess, parseHoldsArgs, parseReviewBy, resolveHoldsProfile } from '../../src/scripts/issueReportHolds';
import { IssueReportModel } from '../../src/models/IssueReport';
import { exitCodeFor, parseRetentionArgs, RETENTION_CRON_SCHEDULE, retentionScriptAccess, runIssueReportRetention, scheduledRunCheckIn } from '../../src/scripts/issueReportRetention';
import {
  HOLDS_ADMIN_PRIVILEGES,
  HOLDS_META_ID,
  loadMongoHolds,
  MongoRetentionAudit,
  MongoRetentionHoldsAdmin,
  MongoRetentionLock,
  RETENTION_COLLECTIONS,
  RETENTION_JOB_PRIVILEGES,
  RETENTION_LOCK_ID,
  RetentionLockError,
  RetentionStoreError,
} from '../../src/services/MongoRetentionStores';
import type { IssueReportRetentionStore } from '../../src/services/MongooseIssueReportRetentionStore';
import { FakeDb } from './fakeMongoDb';

const NOW = new Date('2027-10-09T12:00:00.000Z');
const PROD: DatabaseTarget = { environment: 'production', databaseName: 'quranheals_prod' };
const id = (n: number) => n.toString(16).padStart(24, '0');

let fake: FakeDb;
let originalDb: unknown;
beforeEach(() => {
  fake = new FakeDb();
  originalDb = mongoose.connection.db;
  (mongoose.connection as unknown as { db: unknown }).db = fake;
});
afterEach(() => {
  (mongoose.connection as unknown as { db: unknown }).db = originalDb;
});

const holds = () => fake.collection(RETENTION_COLLECTIONS.holds);
const audit = () => fake.collection(RETENTION_COLLECTIONS.audit);
const locks = () => fake.collection(RETENTION_COLLECTIONS.locks);
const initHolds = () => holds().insertOne({ _id: HOLDS_META_ID, formatVersion: 1 });

type Row = { id: string; createdAt: string | null };
function memoryReports(initial: Row[]) {
  const rows = initial.map((row) => ({ ...row }));
  const store: IssueReportRetentionStore = {
    countAll: async () => rows.length,
    findCandidates: async (cutoff) => rows.filter((r) => !r.createdAt || Date.parse(r.createdAt) <= cutoff.getTime()),
    deleteByIds: async (ids, notAfter) => {
      let count = 0;
      for (const target of ids) {
        const index = rows.findIndex((r) => r.id === target && r.createdAt !== null && Date.parse(r.createdAt) <= notAfter.getTime());
        if (index >= 0) { rows.splice(index, 1); count++; }
      }
      return count;
    },
    existingIds: async (ids) => ids.filter((target) => rows.some((r) => r.id === target)),
  };
  return { store, rows };
}

const privileges = (spec: Record<string, string[]>): MongoPrivilege[] =>
  Object.entries(spec).map(([collection, actions]) => ({ resource: { db: 'quranheals_prod', collection }, actions }));

describe('least privilege: exact roles', () => {
  it('the retention job role is exactly issuereports find/remove, holds find, audit find/insert, locks find/insert/update/remove', () => {
    expect(RETENTION_JOB_PRIVILEGES).toEqual({
      issuereports: ['find', 'remove'],
      retentionholds: ['find'],
      retentionaudit: ['find', 'insert'],
      retentionlocks: ['find', 'insert', 'update', 'remove'],
    });
    expect(exactScopeProblems(PROD, privileges({ ...RETENTION_JOB_PRIVILEGES } as Record<string, string[]>), RETENTION_JOB_PRIVILEGES)).toEqual([]);
  });

  it('the job can never place or lift a hold, edit its audit history, or touch any other collection', () => {
    const job = RETENTION_JOB_PRIVILEGES as Record<string, string[]>;
    const withHoldWrite = privileges({ ...job, retentionholds: ['find', 'insert', 'update', 'remove'] });
    expect(exactScopeProblems(PROD, withHoldWrite, RETENTION_JOB_PRIVILEGES).join(' ')).toMatch(/"insert" on "retentionholds"/);
    const withAuditEdit = privileges({ ...job, retentionaudit: ['find', 'insert', 'update', 'remove'] });
    expect(exactScopeProblems(PROD, withAuditEdit, RETENTION_JOB_PRIVILEGES).join(' ')).toMatch(/"update" on "retentionaudit"/);
    const withUsers = privileges({ ...job, users: ['find'] });
    expect(exactScopeProblems(PROD, withUsers, RETENTION_JOB_PRIVILEGES).join(' ')).toMatch(/"users"/);
    const reportUpdate = privileges({ ...job, issuereports: ['find', 'remove', 'update'] });
    expect(exactScopeProblems(PROD, reportUpdate, RETENTION_JOB_PRIVILEGES).join(' ')).toMatch(/"update" on "issuereports"/);
  });

  it('database-wide, cluster-wide, other-database or missing grants are refused; an unreported privilege list fails closed', () => {
    const job = RETENTION_JOB_PRIVILEGES;
    expect(exactScopeProblems(PROD, [{ resource: { db: 'quranheals_prod', collection: '' }, actions: ['find'] }, ...privileges({ ...job } as Record<string, string[]>)], job).join(' ')).toMatch(/database-wide/);
    expect(exactScopeProblems(PROD, [{ resource: { cluster: true }, actions: ['listDatabases'] }, ...privileges({ ...job } as Record<string, string[]>)], job).join(' ')).toMatch(/cluster-wide/);
    expect(exactScopeProblems(PROD, [{ resource: { db: 'quranheals_dev', collection: 'issuereports' }, actions: ['find'] }], job).join(' ')).toMatch(/quranheals_dev/);
    expect(exactScopeProblems(PROD, privileges({ issuereports: ['find', 'remove'] }), job).join(' ')).toMatch(/lacks "find", "insert" on "retentionaudit"/);
    expect(exactScopeProblems(PROD, undefined, job)).toHaveLength(1);
  });

  it('the holds admin is exactly find/insert/update/remove on retentionholds, and nothing else', () => {
    expect(HOLDS_ADMIN_PRIVILEGES).toEqual({ retentionholds: ['find', 'insert', 'update', 'remove'] });
    expect(exactScopeProblems(PROD, privileges({ retentionholds: ['find', 'insert', 'update', 'remove'] }), HOLDS_ADMIN_PRIVILEGES)).toEqual([]);
    expect(exactScopeProblems(PROD, privileges({ retentionholds: ['find', 'insert', 'update', 'remove'], issuereports: ['find'] }), HOLDS_ADMIN_PRIVILEGES).join(' ')).toMatch(/"issuereports"/);
  });

  it('mongo-mode deleting runs check the exact job role; file mode keeps its issuereports-only check', () => {
    const mongoApply = parseRetentionArgs(['purge', '--store', 'mongo', '--apply', '--unattended', '--max-delete', '25']);
    expect(retentionScriptAccess(mongoApply, true, 'production-retention')).toMatchObject({ writes: true, strictCredentialScope: true, exactPrivileges: RETENTION_JOB_PRIVILEGES });
    expect(retentionScriptAccess(mongoApply, true, 'production-retention')).not.toHaveProperty('deletionOnlyCollections');
    const fileApply = parseRetentionArgs(['purge', '--holds', 'h', '--audit-log', 'a', '--apply']);
    expect(retentionScriptAccess(fileApply, true, 'production-retention')).toMatchObject({ deletionOnlyCollections: ['issuereports'] });
    expect(retentionScriptAccess(fileApply, true, 'production-retention')).not.toHaveProperty('exactPrivileges');
    expect(retentionScriptAccess(parseRetentionArgs(['preflight', '--store', 'mongo']), true, 'production-read')).toMatchObject({ writes: false, strictCredentialScope: true });
  });

  it('--store is validated, and mongo mode takes no local file paths', () => {
    expect(parseRetentionArgs(['purge', '--store', 'mongo'])).toMatchObject({ store: 'mongo', apply: false });
    expect(parseRetentionArgs(['purge', '--holds', 'h', '--audit-log', 'a'])).toMatchObject({ store: 'file' });
    expect(() => parseRetentionArgs(['purge', '--store', 's3'])).toThrow(/file or mongo/);
    expect(() => parseRetentionArgs(['purge', '--store', 'mongo', '--holds', 'h'])).toThrow(/do not apply/);
    expect(parseRetentionArgs(['status', '--store', 'mongo'])).toMatchObject({ command: 'status', store: 'mongo' });
  });
});

describe('holds in the database', () => {
  it('a missing or wrong format marker fails safe: holds cannot be confirmed, so nothing may be deleted', async () => {
    await expect(loadMongoHolds()).rejects.toBeInstanceOf(RetentionStoreError);
    await holds().insertOne({ _id: HOLDS_META_ID, formatVersion: 2 });
    await expect(loadMongoHolds()).rejects.toThrow(/format marker/);
  });

  it('an unreadable collection or a malformed hold fails safe', async () => {
    await initHolds();
    holds().failNext.find = new Error('MongoNetworkError');
    await expect(loadMongoHolds()).rejects.toThrow(/could not be read/);
    await holds().insertOne({ _id: `issue-report:${id(1)}`, kind: 'issue-report', ref: id(1), reason: 'not-a-reason', reviewBy: NOW });
    await expect(loadMongoHolds()).rejects.toThrow(/invalid entry/);
  });

  it('active holds protect their report until the review date, then stop protecting it', async () => {
    await initHolds();
    const admin = new MongoRetentionHoldsAdmin();
    await admin.place({ ref: id(3), reason: 'dispute', reviewBy: new Date(NOW.getTime() + 10 * DAY_MS) }, NOW);
    const snapshot = await loadMongoHolds();
    expect(snapshot.isHeld('issue-report', id(3), NOW)).toBe(true);
    expect(snapshot.isHeld('issue-report', id(3), new Date(NOW.getTime() + 10 * DAY_MS))).toBe(false);
    expect(snapshot.isHeld('issue-report', id(4), NOW)).toBe(false);
    expect(snapshot.activeAt(NOW)).toBe(1);
  });

  it('the holds admin enforces the same rules as file holds, refuses an uninitialised collection, and can release', async () => {
    const admin = new MongoRetentionHoldsAdmin();
    await expect(admin.place({ ref: id(1), reason: 'dispute', reviewBy: new Date(NOW.getTime() + DAY_MS) }, NOW)).rejects.toThrow(/format marker/);
    expect(await admin.init()).toBe('created');
    expect(await admin.init()).toBe('already-initialised');
    await expect(admin.place({ ref: 'nope', reason: 'dispute', reviewBy: new Date(NOW.getTime() + DAY_MS) }, NOW)).rejects.toThrow(/24-character/);
    await expect(admin.place({ ref: id(1), reason: 'dispute', reviewBy: new Date(NOW.getTime() + 400 * DAY_MS) }, NOW)).rejects.toThrow(/at most 365 days/);
    await expect(admin.place({ ref: id(1), reason: 'dispute', reviewBy: new Date(NOW.getTime() - 1) }, NOW)).rejects.toThrow(/future/);
    await admin.place({ ref: id(1), reason: 'legal-obligation', reviewBy: new Date(NOW.getTime() + DAY_MS) }, NOW);
    expect(await admin.list()).toEqual([expect.objectContaining({ ref: id(1), reason: 'legal-obligation' })]);
    expect(await admin.release(id(1))).toBe(true);
    expect(await admin.release(id(1))).toBe(false);
  });

  it('the holds command: production writes need production-holds, listing needs production-read; the job profile is refused', () => {
    const place = parseHoldsArgs(['place', '--ref', id(1), '--reason', 'dispute', '--review-by', '2027-01-15']);
    const list = parseHoldsArgs(['list']);
    const env = (profile: string) => ({ QURAN_HEALS_SKIP_DOTENV: '1', QURAN_HEALS_ADMIN_PROFILE: profile });
    expect(resolveHoldsProfile(place, PROD, env('production-holds'))).toBe('production-holds');
    expect(() => resolveHoldsProfile(place, PROD, env('production-retention'))).toThrow(/production-holds/);
    expect(() => resolveHoldsProfile(list, PROD, env('production-holds'))).toThrow(/production-read/);
    expect(() => resolveHoldsProfile(place, PROD, { QURAN_HEALS_ADMIN_PROFILE: 'production-holds' })).toThrow(/QURAN_HEALS_SKIP_DOTENV/);
    expect(() => resolveHoldsProfile(place, { environment: 'development' }, env('production-holds'))).toThrow(/production profile/);
    expect(holdsScriptAccess(place, 'production-holds')).toMatchObject({ writes: true, strictCredentialScope: true, exactPrivileges: HOLDS_ADMIN_PRIVILEGES });
    expect(holdsScriptAccess(list, 'production-read')).toMatchObject({ writes: false, strictCredentialScope: true });
    expect(() => parseHoldsArgs(['place', '--ref', id(1), '--reason', 'dispute'])).toThrow(/--review-by is required/);
    expect(parseReviewBy('2027-01-15').toISOString()).toBe('2027-01-15T00:00:00.000Z');
    expect(() => parseReviewBy('next week')).toThrow(/YYYY|like 2027-01-15/);
  });
});

describe('audit history in the database', () => {
  it('survives job restarts: entries written by one run are read by the next (new objects, same database)', async () => {
    await new MongoRetentionAudit().append({ at: NOW.toISOString(), action: 'issue-report-retention', result: 'issue-reports-checked', run: 'r1', deleted: { IssueReport: 0 } });
    const nextContainer = new MongoRetentionAudit();
    const entries = await nextContainer.entries();
    expect(entries).toEqual([expect.objectContaining({ at: NOW.toISOString(), result: 'issue-reports-checked', run: 'r1' })]);
    expect(retentionRunHistory(entries, new Date(NOW.getTime() + DAY_MS))).toMatchObject({ ok: true, daysSinceLastSuccess: 1 });
  });

  it('every entry expires exactly 3 calendar years later, leap days rolled forward, never earlier', async () => {
    const sink = new MongoRetentionAudit();
    for (const at of ['2027-03-01T10:00:00.000Z', '2028-02-29T10:00:00.000Z', '2029-12-31T23:59:59.999Z']) {
      await sink.append({ at, action: 'issue-report-retention', result: 'issue-reports-checked', run: at });
    }
    const expiries = audit().docs.map((doc) => [(doc.at as Date).toISOString(), (doc.expiresAt as Date).toISOString()]);
    expect(expiries).toEqual([
      ['2027-03-01T10:00:00.000Z', '2030-03-01T10:00:00.000Z'],
      ['2028-02-29T10:00:00.000Z', '2031-03-01T10:00:00.000Z'],
      ['2029-12-31T23:59:59.999Z', '2032-12-31T23:59:59.999Z'],
    ]);
    for (const doc of audit().docs) expect((doc.expiresAt as Date).getTime() - (doc.at as Date).getTime()).toBeGreaterThanOrEqual(1095 * DAY_MS);
  });

  it('stores only allow-listed fields: ids and counts, never content', async () => {
    await new MongoRetentionAudit().append({ at: NOW.toISOString(), action: 'issue-report-retention', result: 'issue-reports-purged', run: 'r', reportIds: [id(1)], deleted: { IssueReport: 1 }, ...({ comment: 'private', email: 'x@example.com' } as object) });
    expect(Object.keys(audit().docs[0]).sort()).toEqual(['_id', 'action', 'at', 'deleted', 'expiresAt', 'reportIds', 'result', 'run']);
  });

  it('the 3-year expiry index is detected only when it is the right TTL index', async () => {
    const sink = new MongoRetentionAudit();
    expect(await sink.hasExpiryIndex()).toBe(false);
    audit().indexes.push({ key: { expiresAt: 1 }, name: 'expiresAt_1', expireAfterSeconds: 3600 });
    expect(await sink.hasExpiryIndex()).toBe(false);
    audit().indexes.push({ key: { expiresAt: 1 }, name: 'expiresAt_ttl', expireAfterSeconds: 0 });
    expect(await sink.hasExpiryIndex()).toBe(true);
  });
});

describe('distributed run lock (server clock, fenced deletion)', () => {
  const lease = 15 * 60_000;
  const setServerTime = (ms: number) => {
    fake.now = new Date(NOW.getTime() + ms);
  };
  const deleted: unknown[] = [];
  beforeEach(() => {
    setServerTime(0);
    deleted.length = 0;
    // A transaction stand-in: runs the callback once; the real driver aborts and rolls back on a throw.
    vi.spyOn(mongoose, 'startSession').mockResolvedValue({ withTransaction: async (fn: () => Promise<unknown>) => fn(), endSession: async () => undefined } as never);
    vi.spyOn(IssueReportModel, 'deleteMany').mockImplementation((async (filter: unknown) => {
      deleted.push(filter);
      return { deletedCount: 1 };
    }) as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('only one run holds the lock; a second run (Render, manual or another computer) is refused while the lease is live', async () => {
    await new MongoRetentionLock(lease).acquire('render-run');
    setServerTime(60_000);
    await expect(new MongoRetentionLock(lease).acquire('manual-run')).rejects.toBeInstanceOf(RetentionLockError);
    expect(locks().docs).toEqual([expect.objectContaining({ _id: RETENTION_LOCK_ID, owner: 'render-run', expiresAt: new Date(NOW.getTime() + lease) })]);
  });

  it('lease times come from the server clock ($$NOW), not the runner: a runner whose own clock is hours off cannot shorten a lease', async () => {
    await new MongoRetentionLock(lease).acquire('a');
    // Whatever the second runner believes the time is, the server says the lease is still live.
    setServerTime(lease - 1);
    await expect(new MongoRetentionLock(lease).acquire('b')).rejects.toBeInstanceOf(RetentionLockError);
  });

  it('an expired lock (crashed run) is taken over; the stale run can then neither renew nor release it', async () => {
    const crashed = new MongoRetentionLock(lease);
    await crashed.acquire('crashed');
    setServerTime(lease);
    const next = new MongoRetentionLock(lease);
    await next.acquire('next');
    await expect(crashed.renew('crashed')).rejects.toThrow(/no longer holds/);
    await crashed.release('crashed');
    expect(locks().docs[0]).toMatchObject({ owner: 'next' });
    await next.renew('next');
    await next.release('next');
    expect(locks().docs).toEqual([]);
  });

  it('a run whose own lease expired cannot renew it, even if nobody took it over', async () => {
    const slow = new MongoRetentionLock(lease);
    await slow.acquire('slow');
    setServerTime(lease);
    await expect(slow.renew('slow')).rejects.toBeInstanceOf(RetentionLockError);
  });

  it('fenced deletion: the lease check and the deletion share one transaction; the owner deletes, with the createdAt backstop', async () => {
    const lock = new MongoRetentionLock(lease);
    await lock.acquire('owner');
    setServerTime(5 * 60_000);
    const count = await lock.deleteWithinLease('owner', [id(1)], new Date('2026-10-09T12:00:00.000Z'));
    expect(count).toBe(1);
    expect(deleted).toEqual([{ _id: { $in: [id(1)] }, createdAt: { $lte: new Date('2026-10-09T12:00:00.000Z') } }]);
    // The fence also extended the lease from the server clock.
    expect(locks().docs[0].expiresAt).toEqual(new Date(NOW.getTime() + 5 * 60_000 + lease));
  });

  it('a stale worker reaching the delete step after its lease was taken over deletes nothing (two workers can never both delete)', async () => {
    const stale = new MongoRetentionLock(lease);
    await stale.acquire('stale');
    setServerTime(lease);
    await new MongoRetentionLock(lease).acquire('winner');
    await expect(stale.deleteWithinLease('stale', [id(1)], NOW)).rejects.toBeInstanceOf(RetentionLockError);
    expect(deleted).toEqual([]);
    // Same when the lease merely expired without a takeover.
    const lone = new MongoRetentionLock(lease);
    locks().docs.length = 0;
    setServerTime(0);
    await lone.acquire('lone');
    setServerTime(lease + 1);
    await expect(lone.deleteWithinLease('lone', [id(1)], NOW)).rejects.toBeInstanceOf(RetentionLockError);
    expect(deleted).toEqual([]);
  });

  it('verify uses the fenced transaction with no ids: it proves the lock and transaction work and deletes nothing', async () => {
    const lock = new MongoRetentionLock(lease);
    await lock.acquire('verify');
    expect(await lock.deleteWithinLease('verify', [], NOW)).toBe(0);
    expect(deleted).toEqual([]);
    await lock.release('verify');
    expect(locks().docs).toEqual([]);
  });

  it('a run that lost its lock records the refusal and deletes nothing (end to end through the cleanup)', async () => {
    await initHolds();
    const lock = new MongoRetentionLock(lease);
    await lock.acquire('stale');
    setServerTime(lease);
    await new MongoRetentionLock(lease).acquire('winner');
    const { store, rows } = memoryReports([{ id: id(1), createdAt: '2025-01-01T00:00:00.000Z' }]);

    await expect(
      runIssueReportRetention(
        { store, loadHolds: loadMongoHolds, audit: new MongoRetentionAudit(), lock: { renew: () => lock.renew('stale') }, deleteDue: (ids, notAfter) => lock.deleteWithinLease('stale', ids, notAfter), target: PROD, newRunId: () => 'stale' },
        { apply: true, now: NOW, unattended: { maxDelete: 25 } },
        async () => true,
      ),
    ).rejects.toThrow(/no longer holds/);
    expect(rows).toHaveLength(1);
    expect(deleted).toEqual([]);
    expect(audit().docs).toEqual([]);
  });

  it('if the lease is lost between the renewal and the delete, the fence aborts and the refusal is audited', async () => {
    await initHolds();
    const lock = new MongoRetentionLock(lease);
    await lock.acquire('slow');
    const { store, rows } = memoryReports([{ id: id(1), createdAt: '2025-01-01T00:00:00.000Z' }]);
    await expect(
      runIssueReportRetention(
        {
          store,
          loadHolds: loadMongoHolds,
          audit: new MongoRetentionAudit(),
          lock: { renew: () => lock.renew('slow') },
          deleteDue: async (ids, notAfter) => {
            setServerTime(2 * lease); // a long pause: the lease runs out before the delete commits
            await new MongoRetentionLock(lease).acquire('winner');
            return lock.deleteWithinLease('slow', ids, notAfter);
          },
          target: PROD,
          newRunId: () => 'slow',
        },
        { apply: true, now: NOW, unattended: { maxDelete: 25 } },
        async () => true,
      ),
    ).rejects.toBeInstanceOf(RetentionLockError);
    expect(rows).toHaveLength(1);
    expect(deleted).toEqual([]);
    expect(audit().docs.map((d) => d.result)).toEqual(['issue-reports-purge-started', 'failed:issue-report-purge']);
    expect(audit().docs[1]).toMatchObject({ deleted: { IssueReport: 0 } });
  });
});

describe('verify command, missed runs and audit expiry', () => {
  it('verify needs --store mongo and --max-delete, and runs as the retention user (a writing step)', () => {
    expect(() => parseRetentionArgs(['verify', '--max-delete', '25'])).toThrow(/--store mongo/);
    expect(() => parseRetentionArgs(['verify', '--store', 'mongo'])).toThrow(/needs --max-delete/);
    const verify = parseRetentionArgs(['verify', '--store', 'mongo', '--max-delete', '25']);
    expect(verify).toMatchObject({ command: 'verify', store: 'mongo', maxDelete: 25 });
    expect(retentionScriptAccess(verify, true, 'production-retention')).toMatchObject({ writes: true, exactPrivileges: RETENTION_JOB_PRIVILEGES, strictCredentialScope: true });
  });

  it('verify exit codes: 0 when the scheduled run would succeed, 6 when it would refuse', () => {
    expect(exitCodeFor({ command: 'verify' })).toBe(0);
    expect(exitCodeFor({ command: 'verify', attention: ['30 reports are due, more than --max-delete 25'] })).toBe(6);
  });

  it('verify entries never count as a cleanup run, so they cannot hide a missed or failed month', () => {
    const day = (n: number) => new Date(NOW.getTime() - n * DAY_MS).toISOString();
    const history = retentionRunHistory(
      [
        { at: day(60), action: 'issue-report-retention', result: 'issue-reports-checked', run: 'a' },
        { at: day(1), action: 'issue-report-retention', result: 'issue-reports-verified', run: 'v' },
      ],
      NOW,
    );
    expect(history.lastSuccessAt).toBe(day(60));
    expect(history.ok).toBe(false);
    expect(history.attention.join(' ')).toMatch(/60 days ago/);
  });

  it('every audit entry is kept at least 3 full calendar years (every day 2026-2036, several times of day)', async () => {
    const sink = new MongoRetentionAudit();
    let shortest = Number.POSITIVE_INFINITY;
    for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2036, 0, 1); t += DAY_MS) {
      for (const offset of [0, DAY_MS - 1]) {
        const at = new Date(t + offset);
        await sink.append({ at: at.toISOString(), action: 'issue-report-retention', result: 'issue-reports-checked', run: 'x' });
        const doc = audit().docs.pop()!;
        const expiresAt = doc.expiresAt as Date;
        const sameDayThreeYearsLater = new Date(Date.UTC(at.getUTCFullYear() + 3, at.getUTCMonth(), at.getUTCDate()) + (at.getTime() - Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())));
        // Never before the same calendar date + time three years later (29 Feb rolls to 1 Mar).
        expect(expiresAt.getTime()).toBeGreaterThanOrEqual(sameDayThreeYearsLater.getTime());
        shortest = Math.min(shortest, expiresAt.getTime() - at.getTime());
      }
    }
    expect(shortest).toBeGreaterThanOrEqual(1095 * DAY_MS);
  });

  it('the Sentry check-in only covers the scheduled cloud command, and is a no-op without a DSN and monitor slug', async () => {
    const off = scheduledRunCheckIn(['purge', '--store', 'mongo', '--apply', '--unattended', '--max-delete', '25'], { environment: 'test' });
    await expect(off.finish(true)).resolves.toBeUndefined();
    const manual = scheduledRunCheckIn(['verify', '--store', 'mongo', '--max-delete', '25'], { dsn: 'https://k@o0.ingest.sentry.io/0', slug: 'retention', environment: 'test' });
    await expect(manual.finish(true)).resolves.toBeUndefined();
    expect(RETENTION_CRON_SCHEDULE).toEqual({ crontab: '0 15 1 * *', checkinMarginMinutes: 120, maxRuntimeMinutes: 30 });
  });
});

describe('a database-backed run end to end (in-memory database)', () => {
  const reports: Row[] = [
    { id: id(1), createdAt: '2026-10-09T12:00:00.000Z' }, // exactly 12 months: due
    { id: id(2), createdAt: '2025-01-01T00:00:00.000Z' }, // due, held below
    { id: id(3), createdAt: '2026-10-09T12:00:00.001Z' }, // 1 ms short: protected
  ];
  const deps = (store: IssueReportRetentionStore, lock?: MongoRetentionLock, run = 'r') => ({
    store,
    loadHolds: loadMongoHolds,
    audit: new MongoRetentionAudit(),
    ...(lock ? { lock: { renew: () => lock.renew(run) } } : {}),
    target: PROD,
    newRunId: () => run,
  });

  it('deletes only expired, unheld reports within --max-delete, and audits started + purged durably', async () => {
    await initHolds();
    await new MongoRetentionHoldsAdmin().place({ ref: id(2), reason: 'dispute', reviewBy: new Date(NOW.getTime() + 30 * DAY_MS) }, NOW);
    const { store, rows } = memoryReports(reports);
    fake.now = NOW;
    const lock = new MongoRetentionLock();
    await lock.acquire('r');

    const result = await runIssueReportRetention(deps(store, lock), { apply: true, now: NOW, unattended: { maxDelete: 25 } }, async () => true);

    expect(result).toMatchObject({ due: 1, held: 1, deleted: 1 });
    expect(rows.map((r) => r.id).sort()).toEqual([id(2), id(3)]);
    expect(audit().docs.map((d) => d.result)).toEqual(['issue-reports-purge-started', 'issue-reports-purged']);
  });

  it('dry run deletes nothing and writes no audit entry', async () => {
    await initHolds();
    const { store, rows } = memoryReports(reports);
    const result = await runIssueReportRetention({ ...deps(store), audit: undefined }, { apply: false, now: NOW }, async () => true);
    expect(result).toMatchObject({ mode: 'dry-run', due: 2 });
    expect(rows).toHaveLength(3);
    expect(audit().docs).toEqual([]);
  });

  it('above --max-delete nothing is deleted, and the refusal is audited (so the failure is visible)', async () => {
    await initHolds();
    const { store, rows } = memoryReports(reports);
    await expect(runIssueReportRetention(deps(store), { apply: true, now: NOW, unattended: { maxDelete: 1 } }, async () => true)).rejects.toThrow(/more than --max-delete 1/);
    expect(rows).toHaveLength(3);
    expect(audit().docs.map((d) => d.result)).toEqual(['failed:issue-report-purge']);
  });

  it('missing holds marker: the run stops before deleting or recording anything', async () => {
    const { store, rows } = memoryReports(reports);
    await expect(runIssueReportRetention(deps(store), { apply: true, now: NOW, unattended: { maxDelete: 25 } }, async () => true)).rejects.toBeInstanceOf(RetentionStoreError);
    expect(rows).toHaveLength(3);
    expect(audit().docs).toEqual([]);
  });

  it('holds are re-read before deleting: a hold placed meanwhile stops the run', async () => {
    await initHolds();
    const { store, rows } = memoryReports(reports);
    let loads = 0;
    const loadHolds = async () => {
      if (++loads === 2) await new MongoRetentionHoldsAdmin().place({ ref: id(1), reason: 'security-investigation', reviewBy: new Date(NOW.getTime() + DAY_MS) }, NOW);
      return loadMongoHolds();
    };
    await expect(runIssueReportRetention({ ...deps(store), loadHolds }, { apply: true, now: NOW, unattended: { maxDelete: 25 } }, async () => true)).rejects.toThrow(/changed after the count was confirmed/);
    expect(rows).toHaveLength(3);
  });

  it('an audit store that cannot be written stops the run before any deletion', async () => {
    await initHolds();
    const { store, rows } = memoryReports(reports);
    audit().failNext.insert = new Error('not authorized on quranheals_prod to execute command { insert: "retentionaudit" }');
    await expect(runIssueReportRetention(deps(store), { apply: true, now: NOW, unattended: { maxDelete: 25 } }, async () => true)).rejects.toThrow(/not authorized/);
    expect(rows).toHaveLength(3);
  });

  it('an interrupted run (started, never finished) is detected from the durable history', async () => {
    await new MongoRetentionAudit().append({ at: NOW.toISOString(), action: 'issue-report-retention', result: 'issue-reports-purge-started', run: 'lost', reportIds: [id(1)] });
    const history = retentionRunHistory(await new MongoRetentionAudit().entries(), NOW);
    expect(history.interruptedRuns).toEqual([{ run: 'lost', at: NOW.toISOString(), reportIds: 1 }]);
    expect(history.ok).toBe(false);
  });
});

describe('failure visibility (exit codes for Render)', () => {
  it('status problems and missed months exit with 6; a clean run exits 0', () => {
    expect(exitCodeFor({ command: 'status', ok: false })).toBe(6);
    expect(exitCodeFor({ command: 'status', ok: true })).toBe(0);
    expect(exitCodeFor({ command: 'purge', attention: ['previous run missed'] })).toBe(6);
    expect(exitCodeFor({ command: 'purge' })).toBe(0);
  });
});
