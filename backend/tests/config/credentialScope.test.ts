import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assessCredentialScope, credentialScopeProblems, deletionScopeProblems, type MongoPrivilege } from '../../src/config/credentialScope';
import type { DatabaseTarget } from '../../src/config/databaseTarget';

/**
 * D4: the credential each environment connects with must reach only its own
 * database. Privilege shapes mirror MongoDB's connectionStatus output for
 * Atlas built-in roles.
 */

const state = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  connect: vi.fn(),
  disconnect: vi.fn(),
  command: vi.fn(),
  connectedName: 'quranheals_dev',
}));

vi.mock('mongoose', () => ({
  default: {
    set: vi.fn(),
    connect: state.connect,
    disconnect: state.disconnect,
    get connection() {
      return { db: { databaseName: state.connectedName, command: state.command } };
    },
  },
}));
vi.mock('../../src/config/env', () => ({ env: state.env }));

import { connectScriptDatabase, connectToDatabase } from '../../src/config/database';

const DEV: DatabaseTarget = { environment: 'development', databaseName: 'quranheals_dev' };
const PROD: DatabaseTarget = { environment: 'production', databaseName: 'quranheals_prod' };
const URI = 'mongodb+srv://someuser:s3cret@cluster0.example.invalid/?retryWrites=true';

const readWrite = (db: string): MongoPrivilege => ({ resource: { db, collection: '' }, actions: ['find', 'insert', 'update', 'remove', 'createIndex'] });
const read = (db: string): MongoPrivilege => ({ resource: { db, collection: '' }, actions: ['find', 'listCollections'] });
const cluster: MongoPrivilege = { resource: { cluster: true }, actions: ['listDatabases'] };
const adminDb: MongoPrivilege = { resource: { db: 'admin', collection: 'system.version' }, actions: ['find'] };

describe('assessCredentialScope / credentialScopeProblems', () => {
  it('accepts a development user scoped to quranheals_dev only', () => {
    const scope = assessCredentialScope(DEV, [readWrite('quranheals_dev'), cluster, adminDb]);
    expect(scope).toEqual({ authenticated: true, anyDatabase: false, otherDatabases: [], canWriteTarget: true, privilegesReported: true, unrecognizedEntries: 0, canReadTarget: true });
    expect(credentialScopeProblems(DEV, scope)).toEqual([]);
  });

  it('flags today\'s shared credential: development can also read production', () => {
    const scope = assessCredentialScope(DEV, [readWrite('quranheals_dev'), readWrite('quranheals_prod')]);
    expect(scope.otherDatabases).toEqual(['quranheals_prod']);
    expect(credentialScopeProblems(DEV, scope)).toEqual(['the MongoDB user can also access "quranheals_prod"']);
  });

  it('flags a production user that can reach development', () => {
    const problems = credentialScopeProblems(PROD, assessCredentialScope(PROD, [readWrite('quranheals_prod'), read('quranheals_dev')]));
    expect(problems).toEqual(['the MongoDB user can also access "quranheals_dev"']);
  });

  it.each<[string, MongoPrivilege]>([
    ['readWriteAnyDatabase / atlasAdmin', { resource: { db: '', collection: '' }, actions: ['find', 'insert'] }],
    ['anyResource', { resource: { anyResource: true }, actions: ['find'] }],
  ])('flags all-database roles (%s)', (_label, privilege) => {
    const scope = assessCredentialScope(PROD, [privilege]);
    expect(scope.anyDatabase).toBe(true);
    expect(credentialScopeProblems(PROD, scope)[0]).toMatch(/every database/);
  });

  it('accepts a production user scoped to quranheals_prod only', () => {
    expect(credentialScopeProblems(PROD, assessCredentialScope(PROD, [readWrite('quranheals_prod'), cluster], ['quranheals-prod']))).toEqual([]);
  });

  it('accepts the production read-only audit user for read-only runs and for the server check alike', () => {
    const scope = assessCredentialScope(PROD, [read('quranheals_prod')], ['quranheals-prod-audit']);
    expect(scope.canWriteTarget).toBe(false);
    expect(credentialScopeProblems(PROD, scope, { readOnly: true })).toEqual([]);
  });

  it('development read-only scripts may use the normal development user (no audit user exists there)', () => {
    expect(credentialScopeProblems(DEV, assessCredentialScope(DEV, [readWrite('quranheals_dev')]), { readOnly: true })).toEqual([]);
  });

  it('flags a connection with no authenticated user (a server without access control grants everything)', () => {
    const scope = assessCredentialScope(DEV, [], []);
    expect(scope.authenticated).toBe(false);
    expect(credentialScopeProblems(DEV, scope)[0]).toMatch(/not authenticated/);
  });

  it('a read-only audit run requires a user that cannot write production', () => {
    expect(credentialScopeProblems(PROD, assessCredentialScope(PROD, [read('quranheals_prod')]), { readOnly: true })).toEqual([]);
    expect(credentialScopeProblems(PROD, assessCredentialScope(PROD, [readWrite('quranheals_prod')]), { readOnly: true })[0]).toMatch(/read-only audit user/);
  });
});

describe('startup check after connecting', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const key of Object.keys(state.env)) delete state.env[key];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    Object.assign(state.env, { NODE_ENV: 'development', MONGODB_URI: URI, MONGODB_DB_NAME: 'quranheals_dev' });
    state.connectedName = 'quranheals_dev';
  });

  const privileges = (list: MongoPrivilege[]) => state.command.mockResolvedValue({ authInfo: { authenticatedUserPrivileges: list } });

  it('is silent for a correctly scoped user', async () => {
    privileges([readWrite('quranheals_dev')]);
    await connectToDatabase();
    expect(console.warn).not.toHaveBeenCalled();
    expect(state.command).toHaveBeenCalledWith({ connectionStatus: 1, showPrivileges: true });
  });

  it('only warns by default, so a deployment still on the shared credential keeps running', async () => {
    privileges([readWrite('quranheals_dev'), readWrite('quranheals_prod')]);
    await expect(connectToDatabase()).resolves.toEqual(DEV);
    const warning = vi.mocked(console.warn).mock.calls[0][0] as string;
    expect(warning).toContain('"quranheals_prod"');
    expect(warning).not.toContain('someuser');
    expect(warning).not.toContain('s3cret');
    expect(warning).not.toContain('cluster0');
    expect(state.disconnect).not.toHaveBeenCalled();
  });

  it('refuses to start and disconnects when enforcement is on', async () => {
    state.env.MONGODB_ENFORCE_CREDENTIAL_SCOPE = 'true';
    privileges([readWrite('quranheals_dev'), readWrite('quranheals_prod')]);
    await expect(connectToDatabase()).rejects.toThrow(/can also access "quranheals_prod"/);
    expect(state.disconnect).toHaveBeenCalled();
  });

  it('treats an unverifiable credential as a problem (warning, or fatal when enforced)', async () => {
    state.command.mockRejectedValue(new Error('not authorized on cluster0.example.invalid'));
    await connectToDatabase();
    expect(vi.mocked(console.warn).mock.calls[0][0]).toMatch(/could not be verified/);
    expect(vi.mocked(console.warn).mock.calls[0][0]).not.toContain('cluster0');

    state.env.MONGODB_ENFORCE_CREDENTIAL_SCOPE = 'true';
    await expect(connectToDatabase()).rejects.toThrow(/could not be verified/);
  });

  it('a network or server error during the check is reported without details, and is fatal only when enforced', async () => {
    state.command.mockRejectedValue(new Error('connection 3 to cluster0-shard-00-01.example.invalid:27017 closed'));
    await expect(connectToDatabase()).resolves.toEqual(DEV);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toMatch(/could not be verified/);
    expect(vi.mocked(console.warn).mock.calls[0][0]).not.toMatch(/cluster0|27017/);
    state.env.MONGODB_ENFORCE_CREDENTIAL_SCOPE = 'true';
    await expect(connectToDatabase()).rejects.toThrow(/could not be verified/);
    expect(state.disconnect).toHaveBeenCalled();
  });

  it('a check that never answers times out instead of hanging startup', async () => {
    vi.useFakeTimers();
    try {
      state.command.mockReturnValue(new Promise(() => undefined));
      const connecting = connectToDatabase();
      await vi.advanceTimersByTimeAsync(5000);
      await expect(connecting).resolves.toEqual(DEV);
      expect(vi.mocked(console.warn).mock.calls[0][0]).toMatch(/could not be verified/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforcement off (unset or "false") never blocks startup, whatever the credential', async () => {
    for (const value of [undefined, 'false']) {
      state.env.MONGODB_ENFORCE_CREDENTIAL_SCOPE = value;
      privileges([{ resource: { db: '', collection: '' }, actions: ['find', 'insert'] }]);
      await expect(connectToDatabase()).resolves.toEqual(DEV);
    }
    expect(state.disconnect).not.toHaveBeenCalled();
  });

  it('development read-only scripts with the development user pass even when enforced', async () => {
    state.env.MONGODB_ENFORCE_CREDENTIAL_SCOPE = 'true';
    privileges([readWrite('quranheals_dev')]);
    await expect(connectScriptDatabase({ script: 'dry-run', writes: false })).resolves.toEqual(DEV);
  });

  it('read-only scripts against production expect the read-only audit user', async () => {
    Object.assign(state.env, { NODE_ENV: 'production', MONGODB_DB_NAME: 'quranheals_prod' });
    state.connectedName = 'quranheals_prod';
    state.env.MONGODB_ENFORCE_CREDENTIAL_SCOPE = 'true';

    privileges([readWrite('quranheals_prod')]);
    await expect(connectScriptDatabase({ script: 'audit', writes: false, productionSupported: true })).rejects.toThrow(/read-only audit user/);

    privileges([read('quranheals_prod')]);
    await expect(connectScriptDatabase({ script: 'audit', writes: false, productionSupported: true })).resolves.toEqual(PROD);
  });
});

describe('deletion-only credential (admin email deletion)', () => {
  const COLLECTIONS = ['users', 'sessions', 'issuereports'] as const;
  const findRemove = (collection: string): MongoPrivilege => ({ resource: { db: 'quranheals_prod', collection }, actions: ['find', 'remove'] });
  const exact = COLLECTIONS.map(findRemove);

  it('accepts a custom role with find + remove on exactly the account collections, and nothing else', () => {
    expect(deletionScopeProblems(PROD, exact, COLLECTIONS)).toEqual([]);
  });

  it('allowlist: find granted database-wide is refused (only the account collections may be read)', () => {
    const problems = deletionScopeProblems(PROD, [read('quranheals_prod'), ...COLLECTIONS.map((c) => ({ resource: { db: 'quranheals_prod', collection: c }, actions: ['remove'] }))], COLLECTIONS);
    expect(problems.join('\n')).toMatch(/database-wide actions on "quranheals_prod" \("find", "listCollections"\)/);
  });

  it('refuses broad readWrite: insert, update, index changes and database-wide remove', () => {
    const problems = deletionScopeProblems(PROD, [readWrite('quranheals_prod')], COLLECTIONS);
    expect(problems.join('\n')).toMatch(/database-wide actions/);
    expect(problems.join('\n')).toMatch(/"insert"/);
    expect(problems.join('\n')).toMatch(/"update"/);
    expect(problems.join('\n')).toMatch(/"createIndex"/);
  });

  it('refuses actions on a collection deletion never needs, and reports missing privileges', () => {
    expect(deletionScopeProblems(PROD, [...exact, findRemove('emotions')], COLLECTIONS)).toEqual(['the deletion user has actions on "emotions" ("find", "remove"), which account deletion never needs']);
    expect(deletionScopeProblems(PROD, exact.slice(1), COLLECTIONS)).toEqual(['the deletion user lacks find/remove on: users']);
  });

  it('refuses privileges on any other database, including system databases', () => {
    expect(deletionScopeProblems(PROD, [...exact, readWrite('quranheals_dev')], COLLECTIONS)).toEqual([
      'the deletion user has actions on "quranheals_dev" ("find", "insert", "update", "remove", "createIndex"); it should only reach "quranheals_prod"',
    ]);
    expect(deletionScopeProblems(PROD, [...exact, adminDb], COLLECTIONS)).toEqual(['the deletion user has actions on "admin" ("find"); it should only reach "quranheals_prod"']);
  });

  it('refuses cluster-wide actions', () => {
    expect(deletionScopeProblems(PROD, [...exact, cluster], COLLECTIONS)).toEqual(['the deletion user has cluster-wide actions ("listDatabases"); it should have none']);
  });

  it.each([
    'dropDatabase', 'dropCollection', 'createCollection', 'collMod', 'createUser', 'dropUser', 'grantRole', 'revokeRole', 'createRole',
    'changeOwnPassword', 'killop', 'listCollections', 'listIndexes', 'collStats', 'dbStats', 'enableProfiler', 'compact', 'reIndex',
    'renameCollectionSameDB', 'bypassDocumentValidation', 'changeStream', 'planCacheWrite',
  ])('refuses the extra action %s on an account collection', (action) => {
    const extra: MongoPrivilege = { resource: { db: 'quranheals_prod', collection: 'users' }, actions: ['find', 'remove', action] };
    expect(deletionScopeProblems(PROD, [extra, ...exact.slice(1)], COLLECTIONS)).toEqual([`the deletion user has "${action}" on "users"; only find and remove are allowed`]);
  });

  it('a missing privilege list, an empty one, or an unrecognized entry fails closed', () => {
    expect(deletionScopeProblems(PROD, undefined, COLLECTIONS)).toEqual(['MongoDB did not report the deletion user\'s privileges, so its role cannot be confirmed']);
    expect(deletionScopeProblems(PROD, [], COLLECTIONS)).toEqual(['the deletion user lacks find/remove on: users, sessions, issuereports']);
    for (const malformed of [{}, { resource: null, actions: ['find'] }, { resource: { db: 'quranheals_prod', collection: 'users' }, actions: 'find' }, { resource: { db: 'quranheals_prod', cluster: true }, actions: ['find'] }]) {
      expect(deletionScopeProblems(PROD, [...exact, malformed as MongoPrivilege], COLLECTIONS)).toEqual(['a privilege entry has an unrecognized shape, so the deletion user\'s role cannot be confirmed']);
    }
  });

  describe('enforced at connection time', () => {
    beforeEach(() => {
      vi.resetAllMocks();
      for (const key of Object.keys(state.env)) delete state.env[key];
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      Object.assign(state.env, { NODE_ENV: 'production', MONGODB_URI: URI, MONGODB_DB_NAME: 'quranheals_prod', QURAN_HEALS_CONFIRM_PRODUCTION_WRITE: 'quranheals_prod' });
      state.connectedName = 'quranheals_prod';
    });
    const privileges = (list: MongoPrivilege[]) => state.command.mockResolvedValue({ authInfo: { authenticatedUserPrivileges: list } });
    const access = { script: 'account:admin-delete', writes: true, productionSupported: true, enforceCredentialScope: true, deletionOnlyCollections: COLLECTIONS };

    it('refuses the broad production readWrite user even when MONGODB_ENFORCE_CREDENTIAL_SCOPE is not set', async () => {
      const original = process.env.QURAN_HEALS_CONFIRM_PRODUCTION_WRITE;
      process.env.QURAN_HEALS_CONFIRM_PRODUCTION_WRITE = 'quranheals_prod';
      try {
        privileges([readWrite('quranheals_prod')]);
        await expect(connectScriptDatabase(access)).rejects.toThrow(/deletion user/);
        expect(state.disconnect).toHaveBeenCalled();
        privileges(exact);
        await expect(connectScriptDatabase(access)).resolves.toEqual(PROD);
      } finally {
        if (original === undefined) delete process.env.QURAN_HEALS_CONFIRM_PRODUCTION_WRITE;
        else process.env.QURAN_HEALS_CONFIRM_PRODUCTION_WRITE = original;
      }
    });

    it('a read-only run with enforceCredentialScope refuses a writing user without the global flag', async () => {
      privileges([readWrite('quranheals_prod')]);
      await expect(connectScriptDatabase({ script: 'account:admin-delete', writes: false, productionSupported: true, enforceCredentialScope: true })).rejects.toThrow(/read-only audit user/);
    });

    it('without enforceCredentialScope, existing scripts keep the old warn-only behaviour', async () => {
      privileges([readWrite('quranheals_prod')]);
      await expect(connectScriptDatabase({ script: 'audit', writes: false, productionSupported: true })).resolves.toEqual(PROD);
    });
  });
});

describe('strict development rehearsal (development-read / development-delete)', () => {
  const COLLECTIONS = ['users', 'sessions', 'issuereports'] as const;
  const devFindRemove = (collection: string, db = 'quranheals_dev'): MongoPrivilege => ({ resource: { db, collection }, actions: ['find', 'remove'] });
  const exactDev = COLLECTIONS.map((c) => devFindRemove(c));

  it('the read-only rule applies in development only when strict', () => {
    const scope = assessCredentialScope(DEV, [readWrite('quranheals_dev')]);
    expect(credentialScopeProblems(DEV, scope, { readOnly: true })).toEqual([]);
    expect(credentialScopeProblems(DEV, scope, { readOnly: true, strict: true })).toEqual([
      'a read-only run is using a MongoDB user that can write to "quranheals_dev" (use the read-only audit user)',
    ]);
    expect(credentialScopeProblems(DEV, assessCredentialScope(DEV, [read('quranheals_dev')]), { readOnly: true, strict: true })).toEqual([]);
  });

  it('a role created for the wrong database is rejected for the development target', () => {
    const wrong = COLLECTIONS.map((c) => devFindRemove(c, 'quranheals_prod'));
    expect(credentialScopeProblems(DEV, assessCredentialScope(DEV, wrong))).toEqual(['the MongoDB user can also access "quranheals_prod"']);
    expect(deletionScopeProblems(DEV, wrong, COLLECTIONS)).toEqual([
      'the deletion user has actions on "quranheals_prod" ("find", "remove"); it should only reach "quranheals_dev"',
      'the deletion user lacks find/remove on: users, sessions, issuereports',
    ]);
  });

  describe('enforced at connection time against quranheals_dev', () => {
    beforeEach(() => {
      vi.resetAllMocks();
      for (const key of Object.keys(state.env)) delete state.env[key];
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      Object.assign(state.env, { NODE_ENV: 'development', MONGODB_URI: URI, MONGODB_DB_NAME: 'quranheals_dev' });
      state.connectedName = 'quranheals_dev';
    });
    const privileges = (list: MongoPrivilege[]) => state.command.mockResolvedValue({ authInfo: { authenticatedUserPrivileges: list } });
    const deleteAccess = { script: 'account:admin-delete', writes: true, enforceCredentialScope: true, strictCredentialScope: true, deletionOnlyCollections: COLLECTIONS };
    const readAccess = { script: 'account:admin-delete', writes: false, enforceCredentialScope: true, strictCredentialScope: true };

    it('development-delete: the exact role connects; the normal readWrite development user is refused and disconnected', async () => {
      privileges([readWrite('quranheals_dev')]);
      await expect(connectScriptDatabase(deleteAccess)).rejects.toThrow(/deletion user/);
      expect(state.disconnect).toHaveBeenCalled();
      privileges(exactDev);
      await expect(connectScriptDatabase(deleteAccess)).resolves.toEqual(DEV);
    });

    it('development-delete: excess or missing privileges are refused', async () => {
      privileges([...exactDev, { resource: { db: 'quranheals_dev', collection: 'users' }, actions: ['insert'] }]);
      await expect(connectScriptDatabase(deleteAccess)).rejects.toThrow(/"insert"/);
      privileges(exactDev.slice(1));
      await expect(connectScriptDatabase(deleteAccess)).rejects.toThrow(/lacks find\/remove on: users/);
    });

    it('strict mode is fatal even when MONGODB_ENFORCE_CREDENTIAL_SCOPE is not set', async () => {
      expect(state.env.MONGODB_ENFORCE_CREDENTIAL_SCOPE).toBeUndefined();
      privileges([readWrite('quranheals_dev')]);
      await expect(connectScriptDatabase({ ...deleteAccess, enforceCredentialScope: false })).rejects.toThrow(/credential scope/);
    });

    it('development-read: a read-only user connects; a user that can write is refused', async () => {
      privileges([read('quranheals_dev')]);
      await expect(connectScriptDatabase(readAccess)).resolves.toEqual(DEV);
      privileges([readWrite('quranheals_dev')]);
      await expect(connectScriptDatabase(readAccess)).rejects.toThrow(/read-only audit user/);
    });

    it('without a rehearsal profile, ordinary development runs keep their existing behaviour', async () => {
      privileges([readWrite('quranheals_dev')]);
      await expect(connectScriptDatabase({ script: 'account:admin-delete', writes: true, enforceCredentialScope: true, deletionOnlyCollections: COLLECTIONS })).resolves.toEqual(DEV);
      await expect(connectScriptDatabase({ script: 'dry-run', writes: false })).resolves.toEqual(DEV);
    });
  });
});

describe('strict read-only check fails closed', () => {
  const strictRead = { readOnly: true, strict: true };

  it('a missing privilege list is refused', () => {
    expect(credentialScopeProblems(DEV, assessCredentialScope(DEV, undefined), strictRead)).toEqual([
      'MongoDB did not report the user\'s privileges, so read-only access cannot be confirmed',
    ]);
  });

  it('an empty privilege list is refused (no read access shown)', () => {
    expect(credentialScopeProblems(DEV, assessCredentialScope(DEV, []), strictRead)).toEqual([
      'the reported privileges show no read access to "quranheals_dev", so the user\'s role was not recognized',
    ]);
  });

  it('unrecognized privilege entries are refused', () => {
    const malformed = [read('quranheals_dev'), { resource: { db: 'quranheals_dev' }, actions: [42] }, { nope: true }] as unknown as MongoPrivilege[];
    const scope = assessCredentialScope(DEV, malformed);
    expect(scope.unrecognizedEntries).toBe(2);
    expect(credentialScopeProblems(DEV, scope, strictRead)).toEqual(['2 privilege entries have an unrecognized shape, so read-only access cannot be confirmed']);
  });

  it('privileges only on another database are refused for the target', () => {
    expect(credentialScopeProblems(DEV, assessCredentialScope(DEV, [read('quranheals_prod')]), strictRead)).toEqual([
      'the MongoDB user can also access "quranheals_prod"',
      'the reported privileges show no read access to "quranheals_dev", so the user\'s role was not recognized',
    ]);
  });

  it('a genuine read-only user passes', () => {
    expect(credentialScopeProblems(DEV, assessCredentialScope(DEV, [read('quranheals_dev'), cluster]), strictRead)).toEqual([]);
  });

  it('non-strict runs keep their existing behaviour (no new refusals)', () => {
    expect(credentialScopeProblems(DEV, assessCredentialScope(DEV, undefined), { readOnly: true })).toEqual([]);
    expect(credentialScopeProblems(DEV, assessCredentialScope(DEV, []), { readOnly: true })).toEqual([]);
  });

  describe('at connection time', () => {
    beforeEach(() => {
      vi.resetAllMocks();
      for (const key of Object.keys(state.env)) delete state.env[key];
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      Object.assign(state.env, { NODE_ENV: 'development', MONGODB_URI: URI, MONGODB_DB_NAME: 'quranheals_dev' });
      state.connectedName = 'quranheals_dev';
    });
    const readAccess = { script: 'account:admin-delete', writes: false, enforceCredentialScope: true, strictCredentialScope: true };

    it('refuses when connectionStatus reports no privilege list or an empty one', async () => {
      state.command.mockResolvedValue({ authInfo: { authenticatedUsers: [{ user: 'u', db: 'admin' }] } });
      await expect(connectScriptDatabase(readAccess)).rejects.toThrow(/did not report the user's privileges/);
      state.command.mockResolvedValue({ authInfo: { authenticatedUsers: [{ user: 'u', db: 'admin' }], authenticatedUserPrivileges: [] } });
      await expect(connectScriptDatabase(readAccess)).rejects.toThrow(/no read access/);
    });

    it('refuses a deletion run when no privilege list is reported', async () => {
      state.command.mockResolvedValue({ authInfo: { authenticatedUsers: [{ user: 'u', db: 'admin' }] } });
      await expect(connectScriptDatabase({ ...readAccess, writes: true, deletionOnlyCollections: ['users'] })).rejects.toThrow(/did not report the deletion user's privileges/);
    });
  });
});
