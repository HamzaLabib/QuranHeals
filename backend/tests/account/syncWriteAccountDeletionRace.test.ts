import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase B3: a sync write that already passed requireAuth (B2) can still
 * lose a race against a concurrent account deletion before it actually
 * commits — nothing previously re-checked the account's existence at
 * write time. withExistingUser (src/services/withExistingUser.ts) closes
 * this by making the existence check itself a write to the User document,
 * in the same transaction as the sync write, so a genuinely concurrent
 * account-deletion transaction (which also writes/deletes that same
 * document) is forced to serialize against it rather than silently
 * diverging.
 *
 * As with mongooseAccountDeletionService.test.ts (see its own doc
 * comment): there's no mongodb-memory-server or other real-Mongo
 * transaction harness in this project, and adding one is out of scope
 * here. These tests instead fake just enough of the Mongoose surface to
 * deterministically prove the ORCHESTRATION — that every user-scoped
 * write performs a fresh existence check immediately before committing,
 * and aborts without writing anything if that check (simulating a
 * deletion that completed while the write was paused) comes back empty.
 * MongoDB's own write-conflict/retry behavior for a genuinely
 * simultaneous transaction is a database engine guarantee this harness
 * cannot exercise — see the final report's "Remaining Risks".
 *
 * The gate below lets a test pause a write exactly at its existence
 * check (mirroring "pause the write after auth, before commit"), flip
 * simulated deletion state while it's paused, then release it — fully
 * deterministic, no real timing dependency.
 */

function flushMicrotasks() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function fakeQuery<T>(result: T) {
  const query = Promise.resolve(result) as Promise<T> & { session: () => typeof query; lean: () => typeof query };
  query.session = () => query;
  query.lean = () => query;
  return query;
}

const mock = vi.hoisted(() => {
  let userExists = true;
  let gateResolve: (() => void) | null = null;
  let gatePromise: Promise<void> = Promise.resolve();

  const calls = {
    touch: 0,
    favoriteBulkWrite: 0,
    favoriteFindOneAndUpdate: 0,
    favoriteCreate: 0,
    preferenceFindOneAndUpdate: 0,
    reflectionCreate: 0,
    syncKeyCreate: 0,
  };

  return {
    reset: () => {
      userExists = true;
      gatePromise = Promise.resolve();
      gateResolve = null;
      for (const key of Object.keys(calls) as (keyof typeof calls)[]) calls[key] = 0;
    },
    calls,
    simulateDeletion: () => {
      userExists = false;
    },
    armGate: () => {
      gatePromise = new Promise((resolve) => {
        gateResolve = resolve;
      });
    },
    releaseGate: () => {
      gateResolve?.();
    },
    userModel: {
      findOneAndUpdate: vi.fn(async () => {
        calls.touch += 1;
        await gatePromise;
        return userExists ? { _id: 'user-1' } : null;
      }),
    },
    userFavoriteModel: {
      bulkWrite: vi.fn(async () => {
        calls.favoriteBulkWrite += 1;
        return { acknowledged: true };
      }),
      findOneAndUpdate: vi.fn(() => {
        calls.favoriteFindOneAndUpdate += 1;
        return fakeQuery(null);
      }),
      findOne: vi.fn(() => fakeQuery(null)),
      find: vi.fn(() => fakeQuery([])),
      create: vi.fn(async (docs: Record<string, unknown>[]) => {
        calls.favoriteCreate += 1;
        return docs.map((doc) => ({ ...doc, toObject: () => ({ ...doc, updatedAt: doc.updatedAt ?? new Date() }) }));
      }),
    },
    userPreferenceModel: {
      findOne: vi.fn(() => fakeQuery(null)),
      findOneAndUpdate: vi.fn(() => {
        calls.preferenceFindOneAndUpdate += 1;
        return fakeQuery({ userId: 'user-1', updatedAt: new Date() });
      }),
    },
    userReflectionModel: {
      findOne: vi.fn(() => fakeQuery(null)),
      create: vi.fn(async (docs: Record<string, unknown>[]) => {
        calls.reflectionCreate += 1;
        return docs.map((doc) => ({ ...doc, toObject: () => ({ ...doc, updatedAt: doc.updatedAt ?? new Date() }) }));
      }),
    },
    userSyncKeyModel: {
      create: vi.fn(async (docs: Record<string, unknown>[]) => {
        calls.syncKeyCreate += 1;
        return docs.map((doc) => ({ ...doc, toObject: () => doc }));
      }),
    },
    endSession: vi.fn(async () => {}),
  };
});

vi.mock('../../src/models/User', () => ({ UserModel: mock.userModel }));
vi.mock('../../src/models/UserFavorite', () => ({ UserFavoriteModel: mock.userFavoriteModel }));
vi.mock('../../src/models/UserPreference', () => ({ UserPreferenceModel: mock.userPreferenceModel }));
vi.mock('../../src/models/UserReflection', () => ({ UserReflectionModel: mock.userReflectionModel }));
vi.mock('../../src/models/UserSyncKey', () => ({ UserSyncKeyModel: mock.userSyncKeyModel }));
vi.mock('mongoose', () => ({
  default: {
    startSession: async () => ({
      withTransaction: async (fn: () => Promise<unknown>) => fn(),
      endSession: mock.endSession,
    }),
  },
}));

import { MongooseSyncRepository } from '../../src/services/MongooseSyncRepository';

beforeEach(() => {
  mock.reset();
  vi.clearAllMocks();
});

describe('Phase B3: sync writes vs. a concurrent account deletion', () => {
  it('Test A — favorite write: deletion completing while the write is paused aborts it and recreates nothing', async () => {
    const repo = new MongooseSyncRepository();
    mock.armGate();

    const write = repo.addFavorites('user-1', ['1:1']);
    await flushMicrotasks();
    expect(mock.calls.touch).toBe(1); // the write reached its existence check and is now paused there

    mock.simulateDeletion();
    mock.releaseGate();

    await expect(write).rejects.toMatchObject({ statusCode: 401 });
    expect(mock.calls.favoriteBulkWrite).toBe(0);
  });

  it('Test B — reflection write: deletion completing mid-write aborts it and recreates nothing', async () => {
    const repo = new MongooseSyncRepository();
    mock.armGate();

    const write = repo.putReflections('user-1', [
      { type: 'active', verseKey: '2:255', ciphertext: 'c', nonce: 'n', encryptionVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    await flushMicrotasks();
    expect(mock.calls.touch).toBe(1);

    mock.simulateDeletion();
    mock.releaseGate();

    await expect(write).rejects.toMatchObject({ statusCode: 401 });
    expect(mock.calls.reflectionCreate).toBe(0);
  });

  it('Test C — preference write: deletion completing mid-write aborts it and recreates nothing', async () => {
    const repo = new MongooseSyncRepository();
    mock.armGate();

    const write = repo.putPreferences('user-1', { locale: 'en' }, new Date().toISOString());
    await flushMicrotasks();
    expect(mock.calls.touch).toBe(1);

    mock.simulateDeletion();
    mock.releaseGate();

    await expect(write).rejects.toMatchObject({ statusCode: 401 });
    expect(mock.calls.preferenceFindOneAndUpdate).toBe(0);
  });

  it('Test D — sync key write: deletion completing mid-write aborts it and recreates nothing', async () => {
    const repo = new MongooseSyncRepository();
    mock.armGate();

    const write = repo.putSyncKey('user-1', { wrappedKey: 'w', nonce: 'n', salt: 's', kdfIterations: 210_000, encryptionVersion: 1 });
    await flushMicrotasks();
    expect(mock.calls.touch).toBe(1);

    mock.simulateDeletion();
    mock.releaseGate();

    await expect(write).rejects.toMatchObject({ statusCode: 401 });
    expect(mock.calls.syncKeyCreate).toBe(0);
  });

  it('Test E — if the write resolves its existence check before any deletion happens, it proceeds normally', async () => {
    const repo = new MongooseSyncRepository();
    mock.armGate();

    const write = repo.addFavorites('user-1', ['1:1']);
    await flushMicrotasks();
    expect(mock.calls.touch).toBe(1);

    // No deletion occurs — the account is still here when the gate opens.
    mock.releaseGate();
    await write;

    expect(mock.calls.favoriteBulkWrite).toBe(1);
  });

  it('Test F — two concurrent writes both lose to a deletion that completes while both are paused', async () => {
    const repo = new MongooseSyncRepository();
    mock.armGate();

    const writeA = repo.addFavorites('user-1', ['1:1']);
    const writeB = repo.putPreferences('user-1', { locale: 'en' }, new Date().toISOString());
    await flushMicrotasks();
    expect(mock.calls.touch).toBe(2); // both paused at their own existence check

    mock.simulateDeletion();
    mock.releaseGate();

    await expect(writeA).rejects.toMatchObject({ statusCode: 401 });
    await expect(writeB).rejects.toMatchObject({ statusCode: 401 });
    expect(mock.calls.favoriteBulkWrite).toBe(0);
    expect(mock.calls.preferenceFindOneAndUpdate).toBe(0);
  });

  it('Test G — a second device’s in-flight sync loses the race too: the guard is keyed only by userId, never by which session/device started the write', async () => {
    const repo = new MongooseSyncRepository();
    mock.armGate();

    // Device B's in-flight write for the same account as the one Device A
    // is deleting — nothing here is scoped by session, so it's rejected
    // exactly like Device A's own write would be.
    const deviceBWrite = repo.putReflections('user-1', [
      { type: 'active', verseKey: '9:9', ciphertext: 'c', nonce: 'n', encryptionVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    await flushMicrotasks();
    expect(mock.calls.touch).toBe(1);

    mock.simulateDeletion(); // Device A's deletion completes while B is paused
    mock.releaseGate();

    await expect(deviceBWrite).rejects.toMatchObject({ statusCode: 401 });
    expect(mock.calls.reflectionCreate).toBe(0);
  });

  it('Test H — the guard itself is safe to exercise repeatedly against an already-deleted account (idempotent rejection, never a crash)', async () => {
    const repo = new MongooseSyncRepository();
    mock.simulateDeletion();

    await expect(repo.addFavorites('user-1', ['1:1'])).rejects.toMatchObject({ statusCode: 401 });
    await expect(repo.addFavorites('user-1', ['1:1'])).rejects.toMatchObject({ statusCode: 401 });
    expect(mock.calls.favoriteBulkWrite).toBe(0);
  });

  it('Test I — normal sync (account exists throughout) still works for every write path', async () => {
    const repo = new MongooseSyncRepository();

    await expect(repo.addFavorites('user-1', ['1:1'])).resolves.toBeDefined();
    await expect(
      repo.putReflections('user-1', [
        { type: 'active', verseKey: '2:255', ciphertext: 'c', nonce: 'n', encryptionVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]),
    ).resolves.toBeDefined();
    await expect(repo.putPreferences('user-1', { locale: 'en' }, new Date().toISOString())).resolves.toBeDefined();
    await expect(
      repo.putSyncKey('user-1', { wrappedKey: 'w', nonce: 'n', salt: 's', kdfIterations: 210_000, encryptionVersion: 1 }),
    ).resolves.toBeDefined();

    expect(mock.calls.favoriteBulkWrite).toBe(1);
    expect(mock.calls.reflectionCreate).toBe(1);
    expect(mock.calls.preferenceFindOneAndUpdate).toBe(1);
    expect(mock.calls.syncKeyCreate).toBe(1);
  });

  it('every guarded write always ends its session, even when the existence check rejects it', async () => {
    const repo = new MongooseSyncRepository();
    mock.simulateDeletion();

    await expect(repo.addFavorites('user-1', ['1:1'])).rejects.toMatchObject({ statusCode: 401 });

    expect(mock.endSession).toHaveBeenCalledTimes(1);
  });
});
