import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MongoPrivilege } from '../../src/config/credentialScope';
import type { DatabaseTarget } from '../../src/config/databaseTarget';

const db = vi.hoisted(() => ({
  target: { environment: 'development', databaseName: 'quranheals_dev' } as { environment: string; databaseName: string },
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

// No test here ever connects: the database module is replaced.
vi.mock('../../src/config/database', () => ({
  getDatabaseTarget: () => db.target,
  connectScriptDatabase: db.connect,
  disconnectFromDatabase: db.disconnect,
}));

import { DELETION_COLLECTIONS } from '../../src/admin/adminAccountDeletion';
import { assertScriptMayUseTarget, PRODUCTION_WRITE_CONFIRMATION_ENV } from '../../src/config/databaseTarget';
import {
  FORBIDDEN_COLLECTION,
  REQUIRED_PROFILE,
  VerificationRefused,
  assertVerificationTarget,
  classifyAttemptError,
  isAuthorizationDenial,
  formatReport,
  runVerifyDeletionRole,
  summarizePrivileges,
  verificationAccess,
  verifyDeletionRole,
  type Attempt,
  type RoleProbe,
} from '../../src/scripts/verifyDeletionRole';

const DEV: DatabaseTarget = { environment: 'development', databaseName: 'quranheals_dev' };
const PROFILE = { QURAN_HEALS_ADMIN_PROFILE: REQUIRED_PROFILE, QURAN_HEALS_SKIP_DOTENV: '1' };

/** The exact role: find + remove on each of the eight collections of `db`. */
const exactRole = (database = 'quranheals_dev'): MongoPrivilege[] =>
  DELETION_COLLECTIONS.map((collection) => ({ resource: { db: database, collection }, actions: ['find', 'remove'] }));
const readWrite = (database: string): MongoPrivilege => ({ resource: { db: database, collection: '' }, actions: ['find', 'insert', 'update', 'remove', 'createIndex'] });

let counter = 0;
const freshId = () => (counter++).toString(16).padStart(24, '0');

/**
 * A fake connected user whose permissions are derived from its privilege
 * list, like MongoDB's authorization: an action not granted on the
 * collection (or database-wide) is denied. An authorized insert of the
 * invalid document, or an authorized invalid index, fails like the server
 * would (BadValue / CannotCreateIndex). `override` replaces one operation.
 */
class FakeProbe implements RoleProbe {
  readonly calls: string[] = [];
  counts = new Map<string, number>(DELETION_COLLECTIONS.map((c) => [c, 3]));
  countsAfterTransaction: Map<string, number> | null = null;
  ownedBy = 0;
  transactionRan = false;
  override: Partial<Record<keyof RoleProbe, () => Promise<Attempt>>> = {};

  constructor(private readonly granted: MongoPrivilege[], private readonly database = 'quranheals_dev') {}

  private can(action: string, collection: string): boolean {
    return this.granted.some(({ resource, actions }) =>
      actions.includes(action) &&
      (resource.anyResource || resource.db === '' || (resource.db === this.database && (resource.collection === '' || resource.collection === collection))));
  }

  private gate(action: string, collection: string, changed = 0): Attempt {
    return this.can(action, collection) ? { outcome: 'allowed', changed } : { outcome: 'denied' };
  }

  newId = freshId;

  async privileges(): Promise<MongoPrivilege[] | undefined> { this.calls.push('privileges'); return this.granted; }

  async count(collection: string) {
    this.calls.push(`count ${collection}`);
    if (!this.can('find', collection)) throw Object.assign(new Error('not authorized'), { code: 13 });
    return (this.transactionRan && this.countsAfterTransaction ? this.countsAfterTransaction : this.counts).get(collection) ?? 0;
  }

  async countOwnedBy() { return this.ownedBy; }

  async tryFind(collection: string) { this.calls.push(`find ${collection}`); return this.override.tryFind?.() ?? this.gate('find', collection); }

  async tryUpdate(collection: string) { this.calls.push(`update ${collection}`); return this.override.tryUpdate?.() ?? this.gate('update', collection); }

  async tryInsertRejectedDocument(collection: string): Promise<Attempt> {
    this.calls.push(`insert ${collection}`);
    if (this.override.tryInsertRejectedDocument) return this.override.tryInsertRejectedDocument();
    return this.can('insert', collection) ? { outcome: 'error', code: 'BadValue' } : { outcome: 'denied' };
  }

  async tryCreateInvalidIndex(collection: string): Promise<Attempt> {
    this.calls.push(`index ${collection}`);
    return this.can('createIndex', collection) ? { outcome: 'error', code: 'CannotCreateIndex' } : { outcome: 'denied' };
  }

  async tryDelete(collection: string) { this.calls.push(`remove ${collection}`); return this.override.tryDelete?.() ?? this.gate('remove', collection); }

  async runDeletionTransaction(): Promise<Attempt> {
    this.calls.push('transaction');
    if (this.override.runDeletionTransaction) return this.override.runDeletionTransaction();
    this.transactionRan = true;
    return { outcome: 'allowed', changed: 0 };
  }
}

const statuses = (report: Awaited<ReturnType<typeof verifyDeletionRole>>) => report.results.map((r) => `${r.status} ${r.step}`);

beforeEach(() => {
  db.target = { environment: 'development', databaseName: 'quranheals_dev' };
  db.connect.mockReset();
  db.disconnect.mockReset();
});

describe('refused before connecting', () => {
  it('production, the test environment, and any database other than exactly quranheals_dev', () => {
    for (const target of [
      { environment: 'production', databaseName: 'quranheals_prod' },
      { environment: 'test', databaseName: 'quranheals_test' },
      { environment: 'development', databaseName: 'quranheals_dev_copy' },
    ] as DatabaseTarget[]) {
      expect(() => assertVerificationTarget(target, PROFILE)).toThrow(VerificationRefused);
    }
  });

  it('any profile other than development-delete, unknown profiles included, and a run that could read backend/.env', () => {
    for (const profile of [undefined, 'development', 'development-read', 'production-delete', 'production-read', 'dev-delete', 'DEVELOPMENT-DELETE']) {
      expect(() => assertVerificationTarget(DEV, { QURAN_HEALS_ADMIN_PROFILE: profile, QURAN_HEALS_SKIP_DOTENV: '1' }), String(profile)).toThrow(/development-delete/);
    }
    expect(() => assertVerificationTarget(DEV, { QURAN_HEALS_ADMIN_PROFILE: REQUIRED_PROFILE })).toThrow(/QURAN_HEALS_SKIP_DOTENV=1/);
    expect(() => assertVerificationTarget(DEV, PROFILE)).not.toThrow();
  });

  it('the script never calls connect for a production target', async () => {
    db.target = { environment: 'production', databaseName: 'quranheals_prod' };
    await expect(runVerifyDeletionRole({ ...PROFILE })).rejects.toThrow(VerificationRefused);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('the script never calls connect without the development-delete profile', async () => {
    await expect(runVerifyDeletionRole({ QURAN_HEALS_ADMIN_PROFILE: 'development-read', QURAN_HEALS_SKIP_DOTENV: '1' })).rejects.toThrow(VerificationRefused);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('connects with the tool\'s strict deletion-only access, never production-capable', () => {
    const access = verificationAccess();
    expect(access).toMatchObject({ writes: true, productionSupported: false, enforceCredentialScope: true, strictCredentialScope: true });
    expect(access.deletionOnlyCollections).toEqual(DELETION_COLLECTIONS);
    expect(() => assertScriptMayUseTarget({ environment: 'production', databaseName: 'quranheals_prod' }, access, { [PRODUCTION_WRITE_CONFIRMATION_ENV]: 'quranheals_prod' })).toThrow(/does not support the production database/);
  });
});

describe('the exact role passes every check', () => {
  it('privileges, counts, permitted operations, forbidden operations and the no-op deletion transaction', async () => {
    const probe = new FakeProbe(exactRole());
    const report = await verifyDeletionRole(probe, DEV);
    expect(report.ok).toBe(true);
    expect(statuses(report)).toEqual([
      'PASS privileges', 'PASS counts', 'PASS permitted operations',
      'PASS update users', 'PASS insert users', 'PASS create index users', `PASS remove ${FORBIDDEN_COLLECTION}`,
      'PASS deletion transaction',
    ]);
    expect(probe.calls).toContain('transaction');
    expect(formatReport(report)).toMatch(/RESULT: the role is exactly the deletion-only role/);
  });

  it('the report shows counts and action names only', async () => {
    const report = await verifyDeletionRole(new FakeProbe(exactRole()), DEV);
    const text = formatReport(report);
    expect(text).toContain('users=3');
    expect(text).toContain('users: find, remove');
    expect(text).not.toMatch(/mongodb(\+srv)?:\/\/|@|password|token/i);
  });
});

describe('a wrong role is refused before any live probe', () => {
  it('excess privileges: broad readWrite', async () => {
    const probe = new FakeProbe([readWrite('quranheals_dev')]);
    const report = await verifyDeletionRole(probe, DEV);
    expect(statuses(report)).toEqual(['FAIL privileges']);
    expect(report.results[0].detail).toMatch(/"insert"/);
    expect(report.results[0].detail).toMatch(/database-wide actions/);
    expect(probe.calls).toEqual(['privileges']);
  });

  it('excess privileges: the exact role plus update, or plus remove on another collection', async () => {
    const plusUpdate = [...exactRole(), { resource: { db: 'quranheals_dev', collection: 'users' }, actions: ['update'] }];
    expect(statuses(await verifyDeletionRole(new FakeProbe(plusUpdate), DEV))).toEqual(['FAIL privileges']);
    const plusEmotions = [...exactRole(), { resource: { db: 'quranheals_dev', collection: 'emotions' }, actions: ['find', 'remove'] }];
    const report = await verifyDeletionRole(new FakeProbe(plusEmotions), DEV);
    expect(report.results[0]).toMatchObject({ status: 'FAIL', detail: expect.stringContaining('"emotions"') });
  });

  it('missing permissions: no remove on issuereports', async () => {
    const missing = exactRole().map((p) => (p.resource.collection === 'issuereports' ? { ...p, actions: ['find'] } : p));
    const report = await verifyDeletionRole(new FakeProbe(missing), DEV);
    expect(report.results[0]).toMatchObject({ status: 'FAIL', detail: expect.stringContaining('lacks find/remove on: issuereports') });
  });

  it('incorrect database: the role was created for quranheals_prod', async () => {
    const report = await verifyDeletionRole(new FakeProbe(exactRole('quranheals_prod')), DEV);
    expect(report.results[0].status).toBe('FAIL');
    expect(report.results[0].detail).toMatch(/can also access "quranheals_prod"/);
    expect(report.results[0].detail).toMatch(/lacks find\/remove on: users/);
  });

  it('a role reported in an unexpected shape (no privileges listed) fails safe', async () => {
    const report = await verifyDeletionRole(new FakeProbe([]), DEV);
    expect(report.results[0]).toMatchObject({ status: 'FAIL', detail: expect.stringContaining('no privileges reported') });
  });
});

describe('stops at the first unexpectedly permitted operation', () => {
  it('an update that is allowed (even though nothing matched) stops before any later step', async () => {
    const probe = new FakeProbe(exactRole());
    probe.override.tryUpdate = async () => ({ outcome: 'allowed', changed: 0 });
    const report = await verifyDeletionRole(probe, DEV);
    expect(report).toMatchObject({ ok: false, stopped: true });
    expect(statuses(report).at(-1)).toBe('STOP update users');
    expect(probe.calls).not.toContain('insert users');
    expect(probe.calls).not.toContain('transaction');
    expect(formatReport(report)).toMatch(/STOPPED/);
  });

  it('an insert rejected only for its invalid document (so the insert itself was authorized) stops', async () => {
    const probe = new FakeProbe(exactRole());
    probe.override.tryInsertRejectedDocument = async () => ({ outcome: 'error', code: 'BadValue' });
    const report = await verifyDeletionRole(probe, DEV);
    expect(statuses(report).at(-1)).toBe('STOP insert users');
    expect(report.results.at(-1)!.detail).toContain('error (BadValue)');
  });

  it('a permitted delete that removed something stops', async () => {
    const probe = new FakeProbe(exactRole());
    probe.override.tryDelete = async () => ({ outcome: 'allowed', changed: 1 });
    expect(statuses(await verifyDeletionRole(probe, DEV)).at(-1)).toBe('STOP remove users');
  });

  it('a generated id that already owns records: the transaction is not run', async () => {
    const probe = new FakeProbe(exactRole());
    probe.ownedBy = 1;
    const report = await verifyDeletionRole(probe, DEV);
    expect(statuses(report).at(-1)).toBe('STOP deletion transaction');
    expect(probe.calls).not.toContain('transaction');
  });

  it('a count that went down after the no-op transaction stops', async () => {
    const probe = new FakeProbe(exactRole());
    probe.countsAfterTransaction = new Map(DELETION_COLLECTIONS.map((c) => [c, c === 'users' ? 2 : 3]));
    const report = await verifyDeletionRole(probe, DEV);
    expect(statuses(report).at(-1)).toBe('STOP deletion transaction');
    expect(report.results.at(-1)!.detail).toContain('users 3→2');
  });

  it('a transaction the role cannot run is a FAIL, not a pass', async () => {
    const probe = new FakeProbe(exactRole());
    probe.override.runDeletionTransaction = async () => ({ outcome: 'denied' });
    const report = await verifyDeletionRole(probe, DEV);
    expect(report.ok).toBe(false);
    expect(statuses(report).at(-1)).toBe('FAIL deletion transaction');
  });
});

describe('privilege summary', () => {
  it('lists only this database\'s collections and actions, and flags database-wide grants', () => {
    expect(summarizePrivileges(DEV, [...exactRole().slice(0, 1), readWrite('quranheals_prod'), { resource: { cluster: true }, actions: ['listDatabases'] }])).toEqual(['users: find, remove']);
    expect(summarizePrivileges(DEV, [readWrite('quranheals_dev')])).toEqual(['*whole database*: createIndex, find, insert, remove, update']);
  });
});

describe('recognizing a permission refusal', () => {
  const insertUsers = { action: 'insert', db: 'quranheals_dev', collection: 'users' };
  const atlas = (message: string) => Object.assign(new Error(message), { code: 8000, codeName: 'AtlasError' });

  it('MongoDB Unauthorized (code 13) is a refusal', () => {
    expect(isAuthorizationDenial(Object.assign(new Error('not authorized on quranheals_dev to execute command'), { code: 13, codeName: 'Unauthorized' }), insertUsers)).toBe(true);
  });

  it('Atlas code 8000 is a refusal only when it names this exact action on this exact namespace', () => {
    expect(isAuthorizationDenial(atlas('user is not allowed to do action [insert] on [quranheals_dev.users]'), insertUsers)).toBe(true);
    expect(isAuthorizationDenial(atlas('  user is not allowed to do action [insert] on [quranheals_dev.users].  '), insertUsers)).toBe(true);
    expect(isAuthorizationDenial(atlas('user is not allowed to do action [update] on [quranheals_dev.users]'), insertUsers)).toBe(false);
    expect(isAuthorizationDenial(atlas('user is not allowed to do action [insert] on [quranheals_dev.sessions]'), insertUsers)).toBe(false);
    expect(isAuthorizationDenial(atlas('user is not allowed to do action [insert] on [quranheals_prod.users]'), insertUsers)).toBe(false);
  });

  it('a transaction refusal matches any collection of the same database, never another database', () => {
    const anyAccountCollection = { action: 'remove', db: 'quranheals_dev', collection: null };
    expect(isAuthorizationDenial(atlas('user is not allowed to do action [remove] on [quranheals_dev.userfavorites]'), anyAccountCollection)).toBe(true);
    expect(isAuthorizationDenial(atlas('user is not allowed to do action [remove] on [quranheals_prod.userfavorites]'), anyAccountCollection)).toBe(false);
  });

  it.each([
    ['a quota error', atlas('you are over your space quota, using 513 MB of 512 MB')],
    ['an operation limit', atlas('operation exceeded time limit')],
    ['the phrase embedded in a longer message', atlas('proxy: user is not allowed to do action [insert] on [quranheals_dev.users] (retry later)')],
    ['the phrase with a trailing clause', atlas('user is not allowed to do action [insert] on [quranheals_dev.users] because of maintenance')],
    ['code 8000 without a message', Object.assign(new Error(), { code: 8000, message: undefined })],
    ['the refusal text under a different code', Object.assign(new Error('user is not allowed to do action [insert] on [quranheals_dev.users]'), { code: 2 })],
    ['a network failure', Object.assign(new Error('connection 3 to cluster0.example.invalid closed'), { name: 'MongoNetworkError' })],
    ['an invalid document', Object.assign(new Error("can't use an array for _id"), { code: 53, codeName: 'InvalidIdField' })],
    ['an invalid index', Object.assign(new Error('Unknown index plugin'), { code: 67, codeName: 'CannotCreateIndex' })],
    ['a validation failure', Object.assign(new Error('Document failed validation'), { code: 121, codeName: 'DocumentValidationFailure' })],
    ['a timeout', Object.assign(new Error('Server selection timed out after 30000 ms'), { name: 'MongoServerSelectionError' })],
  ])('%s is NOT a refusal; it is reported by code/name only', (_label, error) => {
    expect(isAuthorizationDenial(error, insertUsers)).toBe(false);
    const result = classifyAttemptError(error, insertUsers);
    expect(result.outcome).toBe('error');
    // Message fragments never appear; only the code name (e.g. DocumentValidationFailure) does.
    expect(JSON.stringify(result)).not.toMatch(/quota|time limit|proxy|maintenance|cluster0|array|plugin|failed validation|timed out|not allowed/i);
  });

  it('a refusal is reported without its message', () => {
    expect(classifyAttemptError(atlas('user is not allowed to do action [insert] on [quranheals_dev.users]'), insertUsers)).toEqual({ outcome: 'denied' });
  });

  it('a misleading code-8000 error on a forbidden probe stops the run (never counted as enforcement)', async () => {
    const probe = new FakeProbe(exactRole());
    probe.override.tryUpdate = async () => classifyAttemptError(atlas('operation exceeded time limit'), { action: 'update', db: 'quranheals_dev', collection: 'users' });
    const report = await verifyDeletionRole(probe, DEV);
    expect(statuses(report).at(-1)).toBe('STOP update users');
    expect(report.results.at(-1)!.detail).toContain('error (AtlasError)');
    expect(formatReport(report)).not.toContain('time limit');
  });
});

describe('unexpected errors stop the run', () => {
  it('an exception thrown during a step becomes a STOP with the error name only', async () => {
    const probe = new FakeProbe(exactRole());
    probe.countOwnedBy = async () => { throw Object.assign(new Error('connection to cluster0.example.invalid reset; user x@example.invalid'), { name: 'MongoNetworkError' }); };
    const report = await verifyDeletionRole(probe, DEV);
    expect(report).toMatchObject({ ok: false, stopped: true });
    expect(report.results.at(-1)).toEqual({ step: 'unexpected error', status: 'STOP', detail: 'MongoNetworkError; the run was stopped and nothing further was attempted' });
    expect(probe.calls).not.toContain('transaction');
    expect(formatReport(report)).not.toMatch(/cluster0|@/);
  });

  it('a missing or empty privilege list fails before any live probe', async () => {
    for (const privileges of [undefined, []]) {
      const probe = new FakeProbe(exactRole());
      probe.privileges = async () => { probe.calls.push('privileges'); return privileges; };
      const report = await verifyDeletionRole(probe, DEV);
      expect(statuses(report)).toEqual(['FAIL privileges']);
      expect(probe.calls).toEqual(['privileges']);
    }
  });
});
