import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression test for the production bug where MongooseAccountDeletionService
 * ran its `.session(session)` deletes through `Promise.all`. A single
 * MongoDB session can only have one operation in flight against its active
 * transaction at a time — running several concurrently throws
 * `MongoServerError: Only servers in a sharded cluster can start a new
 * transaction at the active transaction number` (code 117) in production,
 * even though every test that only goes through
 * `InMemoryAccountDeletionService` (see tests/account/testApp.ts) stays
 * green, since that fake never touches a real Mongo session at all.
 *
 * There's no mongodb-memory-server (or any other real-Mongo test harness) in
 * this project, and adding one is out of scope for this fix — so this test
 * fakes just enough of the Mongoose surface (`Model.deleteMany(...).session()`,
 * `mongoose.startSession()`) to prove, structurally, that the service never
 * has two `.session(session)` operations in flight at once.
 */

const mock = vi.hoisted(() => {
  let maxConcurrentOperations = 0;
  let currentConcurrentOperations = 0;
  const callOrder: string[] = [];

  // A macrotask (not just a resolved microtask) so that if the caller fires
  // every operation before awaiting any of them (the Promise.all bug), all
  // six calls are guaranteed to overlap here before the first settles.
  function trackedOperation(name: string): Promise<{ acknowledged: true }> {
    currentConcurrentOperations += 1;
    maxConcurrentOperations = Math.max(maxConcurrentOperations, currentConcurrentOperations);
    return new Promise((resolve) => {
      setTimeout(() => {
        callOrder.push(name);
        currentConcurrentOperations -= 1;
        resolve({ acknowledged: true });
      }, 0);
    });
  }

  function fakeModel(name: string, methodName: 'deleteMany' | 'deleteOne') {
    return {
      [methodName]: vi.fn(() => ({
        session: (_session: unknown) => trackedOperation(name),
      })),
    };
  }

  return {
    reset: () => {
      maxConcurrentOperations = 0;
      currentConcurrentOperations = 0;
      callOrder.length = 0;
    },
    getMaxConcurrentOperations: () => maxConcurrentOperations,
    getCallOrder: () => callOrder,
    userModel: fakeModel('User', 'deleteOne'),
    userFavoriteModel: fakeModel('UserFavorite', 'deleteMany'),
    userPreferenceModel: fakeModel('UserPreference', 'deleteMany'),
    userReflectionModel: fakeModel('UserReflection', 'deleteMany'),
    userSyncKeyModel: fakeModel('UserSyncKey', 'deleteMany'),
    sessionModel: fakeModel('Session', 'deleteMany'),
    endSession: vi.fn(async () => {}),
    withTransaction: vi.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
  };
});

vi.mock('../../src/models/User', () => ({ UserModel: mock.userModel }));
vi.mock('../../src/models/UserFavorite', () => ({ UserFavoriteModel: mock.userFavoriteModel }));
vi.mock('../../src/models/UserPreference', () => ({ UserPreferenceModel: mock.userPreferenceModel }));
vi.mock('../../src/models/UserReflection', () => ({ UserReflectionModel: mock.userReflectionModel }));
vi.mock('../../src/models/UserSyncKey', () => ({ UserSyncKeyModel: mock.userSyncKeyModel }));
vi.mock('../../src/models/Session', () => ({ SessionModel: mock.sessionModel }));
vi.mock('mongoose', () => ({
  default: {
    startSession: async () => ({ withTransaction: mock.withTransaction, endSession: mock.endSession }),
  },
}));

import { MongooseAccountDeletionService } from '../../src/services/MongooseAccountDeletionService';

beforeEach(() => {
  mock.reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MongooseAccountDeletionService: session/transaction concurrency', () => {
  it('never runs more than one operation on the shared session at a time', async () => {
    const service = new MongooseAccountDeletionService();

    await service.deleteAccount('user-1');

    // This is the exact regression: Promise.all([...]) would have started
    // all five deleteMany calls before any of them resolved, so
    // getMaxConcurrentOperations() would be 5 instead of 1.
    expect(mock.getMaxConcurrentOperations()).toBe(1);
  });

  it('deletes User only after every other user-owned collection has finished', async () => {
    const service = new MongooseAccountDeletionService();

    await service.deleteAccount('user-1');

    expect(mock.getCallOrder()).toEqual([
      'UserFavorite',
      'UserPreference',
      'UserReflection',
      'UserSyncKey',
      'Session',
      'User',
    ]);
  });

  it('every delete is scoped to userId and runs on the started session', async () => {
    const service = new MongooseAccountDeletionService();

    await service.deleteAccount('user-42');

    expect(mock.userFavoriteModel.deleteMany).toHaveBeenCalledWith({ userId: 'user-42' });
    expect(mock.userPreferenceModel.deleteMany).toHaveBeenCalledWith({ userId: 'user-42' });
    expect(mock.userReflectionModel.deleteMany).toHaveBeenCalledWith({ userId: 'user-42' });
    expect(mock.userSyncKeyModel.deleteMany).toHaveBeenCalledWith({ userId: 'user-42' });
    expect(mock.sessionModel.deleteMany).toHaveBeenCalledWith({ userId: 'user-42' });
    expect(mock.userModel.deleteOne).toHaveBeenCalledWith({ _id: 'user-42' });
  });

  it('runs the deletes inside session.withTransaction, and always ends the session', async () => {
    const service = new MongooseAccountDeletionService();

    await service.deleteAccount('user-1');

    expect(mock.withTransaction).toHaveBeenCalledTimes(1);
    expect(mock.endSession).toHaveBeenCalledTimes(1);
  });

  it('still ends the session when the transaction throws', async () => {
    mock.withTransaction.mockImplementationOnce(async () => {
      throw new Error('transaction aborted');
    });
    const service = new MongooseAccountDeletionService();

    await expect(service.deleteAccount('user-1')).rejects.toThrow('transaction aborted');
    expect(mock.endSession).toHaveBeenCalledTimes(1);
  });
});
