import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionModel } from '../../src/models/Session';
import { UserModel } from '../../src/models/User';
import { UserPreferenceModel } from '../../src/models/UserPreference';
import { UserSyncKeyModel } from '../../src/models/UserSyncKey';
import { mongooseRotationStore } from '../../src/services/MongooseSessionRepository';
import { MongooseSyncRepository } from '../../src/services/MongooseSyncRepository';
import { MongooseUserRepository } from '../../src/services/MongooseUserRepository';
import { withExistingUser } from '../../src/services/withExistingUser';

/**
 * Every findOneAndUpdate that returns the updated document asks for it with
 * `returnDocument: 'after'` — never the deprecated `new: true`, which
 * Mongoose 9 converts to exactly that value at execution while logging a
 * "[MONGOOSE] Warning" each time (node_modules/mongoose/lib/query.js,
 * convertNewToReturnDocument). No database: the models are stubbed to
 * capture the options, and the warning check runs an unconnected query.
 */

type Captured = { model: string; filter: unknown; update: unknown; options: Record<string, unknown> };
let captured: Captured[];

function fakeQuery(doc: unknown) {
  const result = Promise.resolve(doc);
  return { lean: () => result, then: result.then.bind(result) };
}

type FindOneAndUpdate = { findOneAndUpdate: (...args: unknown[]) => unknown };

function capture(model: unknown, name: string, doc: unknown) {
  vi.spyOn(model as FindOneAndUpdate, 'findOneAndUpdate').mockImplementation(((filter: unknown, update: unknown, options: Record<string, unknown>) => {
    captured.push({ model: name, filter, update, options });
    return fakeQuery(doc);
  }) as never);
}

const fakeSession = { id: 'session' };
const userId = new mongoose.Types.ObjectId().toString();

beforeEach(() => {
  captured = [];
  vi.spyOn(mongoose, 'startSession').mockResolvedValue({
    withTransaction: async (fn: () => Promise<unknown>) => fn(),
    endSession: async () => undefined,
  } as never);
  capture(UserModel, 'User', { _id: userId, provider: 'google', createdAt: new Date('2026-01-01T00:00:00Z') });
  capture(SessionModel, 'Session', { userId });
  capture(UserPreferenceModel, 'UserPreference', { locale: 'ar', updatedAt: new Date('2026-02-01T00:00:00Z') });
  capture(UserSyncKeyModel, 'UserSyncKey', { wrappedKey: 'w2', nonce: 'n2', salt: 's2', kdfIterations: 600_000, encryptionVersion: 1 });
  vi.spyOn(UserPreferenceModel, 'findOne').mockReturnValue({ session: () => ({ lean: async () => null }) } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const asksForUpdatedDocument = (options: Record<string, unknown>) => {
  expect(options.returnDocument).toBe('after');
  expect(options).not.toHaveProperty('new');
  expect(options).not.toHaveProperty('returnOriginal');
};

describe('find-and-modify calls return the updated document without the deprecated option', () => {
  it('withExistingUser (every sync write, including reflections): same filter and session, updated user', async () => {
    await withExistingUser(userId, async () => 'done');
    const [call] = captured;
    expect(call.model).toBe('User');
    expect(call.filter).toEqual({ _id: userId });
    asksForUpdatedDocument(call.options);
    expect(call.options.session).toBeDefined(); // still inside the transaction
    expect(call.options).not.toHaveProperty('upsert'); // a missing user is never created here
  });

  it('withExistingUser still refuses a deleted account (null from the update → 401, operation never runs)', async () => {
    vi.mocked(UserModel.findOneAndUpdate).mockImplementation((() => fakeQuery(null)) as never);
    const operation = vi.fn();
    await expect(withExistingUser(userId, operation)).rejects.toMatchObject({ statusCode: 401 });
    expect(operation).not.toHaveBeenCalled();
  });

  it('sign-in upsert: still an upsert with defaults, returning the created/updated user', async () => {
    const user = await new MongooseUserRepository().findOrCreateByProviderIdentity({ provider: 'google', providerSubject: 'sub-1' } as never);
    const [call] = captured;
    asksForUpdatedDocument(call.options);
    expect(call.options).toMatchObject({ upsert: true, setDefaultsOnInsert: true });
    expect(user).toEqual({ id: userId, provider: 'google', email: undefined, createdAt: '2026-01-01T00:00:00.000Z' });
  });

  it('refresh-token rotation: still one conditional update; a match returns its user, no match returns null', async () => {
    const sessionId = new mongoose.Types.ObjectId().toString();
    const update = { refreshTokenHash: 'h2', previousRefreshTokenHash: 'h1', rotatedAt: 1, expiresAt: 2 };
    expect(await mongooseRotationStore.compareAndRotate(sessionId, 'h1', update, 0)).toBe(userId);
    const [call] = captured;
    asksForUpdatedDocument(call.options);
    expect(call.options).not.toHaveProperty('upsert');
    expect(call.filter).toMatchObject({ _id: sessionId, refreshTokenHash: 'h1' });

    vi.mocked(SessionModel.findOneAndUpdate).mockImplementation((() => fakeQuery(null)) as never);
    expect(await mongooseRotationStore.compareAndRotate(sessionId, 'stale', update, 0)).toBeNull();
  });

  it('preferences: still an upsert in the transaction, returning the stored (updated) preferences', async () => {
    const result = await new MongooseSyncRepository().putPreferences(userId, { locale: 'ar' }, '2026-02-01T00:00:00.000Z');
    const call = captured.find((entry) => entry.model === 'UserPreference')!;
    asksForUpdatedDocument(call.options);
    expect(call.options).toMatchObject({ upsert: true, setDefaultsOnInsert: true });
    expect(call.options.session).toBeDefined();
    expect(result).toMatchObject({ locale: 'ar', updatedAt: '2026-02-01T00:00:00.000Z' });
  });

  it('sync-key replacement (change password): still compare-and-swap with validators and majority write concern, returning the replacement', async () => {
    const expected = { wrappedKey: 'w1', nonce: 'n1', salt: 's1', kdfIterations: 600_000, encryptionVersion: 1 };
    const replacement = { wrappedKey: 'w2', nonce: 'n2', salt: 's2', kdfIterations: 600_000, encryptionVersion: 1 };
    const result = await new MongooseSyncRepository().replaceSyncKey(userId, expected, replacement);
    const [call] = captured;
    asksForUpdatedDocument(call.options);
    expect(call.options).toMatchObject({ runValidators: true, writeConcern: { w: 'majority' } });
    expect(call.options).not.toHaveProperty('upsert');
    expect(call.filter).toEqual({ userId, ...expected });
    expect(result).toMatchObject(replacement);

    vi.mocked(UserSyncKeyModel.findOneAndUpdate).mockImplementation((() => fakeQuery(null)) as never);
    expect(await new MongooseSyncRepository().replaceSyncKey(userId, expected, replacement)).toBeNull(); // another device changed it first
  });
});

describe('no "[MONGOOSE] Warning" for these options', () => {
  // A real, unconnected query: Mongoose converts/validates options when the
  // query executes, before it would reach the (absent) database.
  const Probe = mongoose.models.FindAndModifyProbe
    || mongoose.model('FindAndModifyProbe', new mongoose.Schema({ a: Number }, { bufferTimeoutMS: 20 } as never));

  async function warningsFor(options: Record<string, unknown>): Promise<string[]> {
    const warnings: string[] = [];
    const listener = (warning: Error & { code?: string }) => { if (warning.code === 'MONGOOSE') warnings.push(warning.message); };
    process.on('warning', listener);
    try {
      await Probe.findOneAndUpdate({ a: 1 }, { $set: { a: 2 } }, options).exec().catch(() => undefined);
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('warning', listener);
    }
    return warnings;
  }

  it('the deprecated form does warn (the check works)', async () => {
    expect(await warningsFor({ new: true })).toEqual([
      "mongoose: the `new` option for `findOneAndUpdate()` and `findOneAndReplace()` is deprecated. Use `returnDocument: 'after'` instead.",
    ]);
  });

  it('every option set the repositories pass is warning-free', async () => {
    vi.restoreAllMocks();
    // The option sets from src/services, exactly as written there (session excluded: no database).
    const optionSets = [
      { returnDocument: 'after' }, // withExistingUser, compareAndRotate
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }, // findOrCreateByProviderIdentity, putPreferences
      { returnDocument: 'after', runValidators: true, writeConcern: { w: 'majority' } }, // replaceSyncKey
    ];
    for (const options of optionSets) expect(await warningsFor(options)).toEqual([]);
  });
});
