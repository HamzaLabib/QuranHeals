import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assessCredentialScope, credentialScopeProblems, type MongoPrivilege } from '../../src/config/credentialScope';
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
    expect(scope).toEqual({ authenticated: true, anyDatabase: false, otherDatabases: [], canWriteTarget: true });
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
