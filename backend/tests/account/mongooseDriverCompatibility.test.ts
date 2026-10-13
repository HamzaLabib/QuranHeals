import { createHash, randomUUID } from 'node:crypto';

import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppleCredentialModel } from '../../src/models/AppleCredential';
import { EmotionModel } from '../../src/models/Emotion';
import { EmotionVerseMappingModel } from '../../src/models/EmotionVerseMapping';
import { SessionModel } from '../../src/models/Session';
import { UserModel } from '../../src/models/User';
import { UserFavoriteModel } from '../../src/models/UserFavorite';
import { UserPreferenceModel } from '../../src/models/UserPreference';
import { UserReflectionModel } from '../../src/models/UserReflection';
import { UserSyncKeyModel } from '../../src/models/UserSyncKey';
import { MongooseAccountDeletionService } from '../../src/services/MongooseAccountDeletionService';
import { MongooseSessionRepository } from '../../src/services/MongooseSessionRepository';
import { MongooseSyncRepository } from '../../src/services/MongooseSyncRepository';
import { MongooseUserRepository } from '../../src/services/MongooseUserRepository';
import {
  DEVELOPMENT_DATABASE,
  PRODUCTION_DATABASE,
  TEST_DATABASE,
  resolveDatabaseTarget,
} from '../../src/config/databaseTarget';

vi.mock('../../src/config/env', () => ({
  env: { SESSION_JWT_SECRET: 'synthetic-integration-test-secret' },
}));

const databaseName = `${TEST_DATABASE}_driver7`;
const runId = randomUUID().replaceAll('-', '');
const syntheticUserIds = new Set<string>();
const syntheticEmotionKeys = new Set<string>();
let replicaSet: MongoMemoryReplSet | undefined;

async function createSyntheticUser(provider: 'apple' | 'google', subject: string) {
  const user = await new MongooseUserRepository().findOrCreateByProviderIdentity({
    provider,
    providerSubject: subject,
    email: `${provider}-${subject}@example.invalid`,
    emailVerified: true,
  });
  syntheticUserIds.add(user.id);
  return user;
}

async function cleanupSyntheticData() {
  if (mongoose.connection.readyState !== 1) return;

  const deletion = new MongooseAccountDeletionService();
  for (const userId of syntheticUserIds) await deletion.deleteAccount(userId);
  for (const emotionKey of syntheticEmotionKeys) {
    await EmotionVerseMappingModel.deleteMany({ emotionKey });
    await EmotionModel.deleteOne({ key: emotionKey });
  }
  syntheticUserIds.clear();
  syntheticEmotionKeys.clear();
}

describe('Mongoose 9.11 / MongoDB Node driver 7.7 integration', () => {
  beforeAll(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      binary: { version: '8.2.6' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });

    const uri = replicaSet.getUri(databaseName);
    const address = new URL(uri);
    const target = resolveDatabaseTarget({ nodeEnv: 'test', uri, dbName: databaseName });
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

    const prohibitedDatabases: readonly string[] = [PRODUCTION_DATABASE, DEVELOPMENT_DATABASE];
    if (
      target.environment !== 'test' ||
      target.databaseName !== databaseName ||
      prohibitedDatabases.includes(target.databaseName) ||
      !loopbackHosts.has(address.hostname) ||
      address.username !== '' ||
      address.password !== ''
    ) {
      throw new Error('Refusing MongoDB integration test: target is not the unauthenticated loopback test replica set.');
    }

    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, {
      dbName: target.databaseName,
      autoIndex: false,
      serverSelectionTimeoutMS: 10_000,
    });

    if (mongoose.connection.db?.databaseName !== databaseName) {
      throw new Error('Refusing MongoDB integration test: connected database name did not match the isolated test target.');
    }

    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (typeof hello.setName !== 'string') {
      throw new Error('MongoDB integration test requires a transaction-capable replica set.');
    }

    await Promise.all([
      AppleCredentialModel.createIndexes(),
      EmotionModel.createIndexes(),
      EmotionVerseMappingModel.createIndexes(),
      SessionModel.createIndexes(),
      UserModel.createIndexes(),
      UserFavoriteModel.createIndexes(),
      UserPreferenceModel.createIndexes(),
      UserReflectionModel.createIndexes(),
      UserSyncKeyModel.createIndexes(),
    ]);
  }, 120_000);

  afterEach(async () => {
    await cleanupSyntheticData();
  });

  afterAll(async () => {
    try {
      await cleanupSyntheticData();
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
      await replicaSet?.stop();
    } finally {
      vi.unstubAllEnvs();
    }
  }, 120_000);

  it('connects only to the isolated replica set and persists provider identities and sessions', async () => {
    const subject = `synthetic-${runId}`;
    const users = new MongooseUserRepository();
    const googleUser = await createSyntheticUser('google', subject);
    const sameGoogleUser = await users.findOrCreateByProviderIdentity({ provider: 'google', providerSubject: subject });
    const appleUser = await createSyntheticUser('apple', subject);

    expect(sameGoogleUser.id).toBe(googleUser.id);
    expect(appleUser.id).not.toBe(googleUser.id);
    expect(await users.findExistingByProviderIdentity({ provider: 'google', providerSubject: `missing-${runId}` })).toBeNull();

    await expect(UserModel.create({ provider: 'not-a-provider', providerSubject: `invalid-${runId}` } as never))
      .rejects.toMatchObject({ name: 'ValidationError' });

    const userIndexes = await UserModel.collection.indexes();
    expect(userIndexes.find((index: { name?: string; unique?: boolean }) => index.name === 'provider_1_providerSubject_1')?.unique).toBe(true);
    const favoriteIndexes = await UserFavoriteModel.collection.indexes();
    expect(favoriteIndexes.find((index: { name?: string; unique?: boolean }) => index.name === 'userId_1_verseKey_1')?.unique).toBe(true);
    const sessionIndexes = await SessionModel.collection.indexes();
    expect(sessionIndexes.find((index: { name?: string; expireAfterSeconds?: number }) => index.name === 'expiresAt_1')?.expireAfterSeconds).toBe(0);

    const sessions = new MongooseSessionRepository();
    const issued = await sessions.createSession(googleUser.id);
    const stored = await SessionModel.findById(issued.sessionId).lean();
    expect(stored?.refreshTokenHash).toBe(createHash('sha256').update(issued.refreshToken).digest('hex'));
    expect(stored?.refreshTokenHash).not.toBe(issued.refreshToken);
    expect(await sessions.isSessionActive(issued.sessionId, googleUser.id)).toBe(true);

    const rotated = await sessions.rotateSession(issued.refreshToken);
    expect(rotated.userId).toBe(googleUser.id);
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);
    expect(await sessions.rotateSession(issued.refreshToken)).toMatchObject({ refreshToken: rotated.refreshToken });
    await sessions.revokeSession(rotated.refreshToken);
    expect(await sessions.isSessionActive(issued.sessionId, googleUser.id)).toBe(false);
  }, 30_000);

  it('keeps sync data isolated by user through writes, reset, and transactional account deletion', async () => {
    const owner = await createSyntheticUser('apple', `owner-${runId}`);
    const other = await createSyntheticUser('google', `other-${runId}`);
    const sessions = new MongooseSessionRepository();
    const ownerSession = await sessions.createSession(owner.id);
    const otherSession = await sessions.createSession(other.id);
    const sync = new MongooseSyncRepository();

    await AppleCredentialModel.create({
      userId: owner.id,
      ciphertext: `synthetic-encrypted-credential-${runId}`,
      iv: `synthetic-iv-${runId}`,
      authTag: `synthetic-tag-${runId}`,
    });

    await sync.addFavorites(owner.id, ['1:1']);
    await sync.addFavorites(other.id, ['2:2']);
    expect((await sync.listFavorites(owner.id)).map((favorite: { verseKey: string }) => favorite.verseKey)).toEqual(['1:1']);
    expect((await sync.listFavorites(other.id)).map((favorite: { verseKey: string }) => favorite.verseKey)).toEqual(['2:2']);
    await sync.removeFavorite(owner.id, '1:1');
    await sync.addFavorites(owner.id, ['1:1']);
    expect(await sync.listFavorites(owner.id)).toEqual([]);
    expect(await sync.listFavoriteSyncRecords(owner.id)).toMatchObject([{ type: 'tombstone', verseKey: '1:1' }]);

    const older = new Date(Date.now() + 10_000).toISOString();
    const newer = new Date(Date.now() + 20_000).toISOString();
    await sync.putPreferences(owner.id, { locale: 'ar', translationDisplayMode: 'on-demand' }, newer);
    await sync.putPreferences(other.id, { locale: 'en', translationDisplayMode: 'off' }, newer);
    await sync.putPreferences(owner.id, { locale: 'en' }, older);
    expect(await sync.getPreferences(owner.id)).toMatchObject({ locale: 'ar', translationDisplayMode: 'on-demand' });
    expect(await sync.getPreferences(other.id)).toMatchObject({ locale: 'en', translationDisplayMode: 'off' });

    const ownerReflection = {
      type: 'active' as const,
      verseKey: '3:3',
      ciphertext: `synthetic-ciphertext-${runId}-owner-v1`,
      nonce: `synthetic-nonce-${runId}-owner-v1`,
      encryptionVersion: 1,
      createdAt: older,
      updatedAt: newer,
      keyFingerprint: `synthetic-fingerprint-${runId}-owner`,
    };
    const otherReflection = {
      ...ownerReflection,
      verseKey: '4:4',
      ciphertext: `synthetic-ciphertext-${runId}-other`,
      nonce: `synthetic-nonce-${runId}-other`,
    };
    await sync.putReflections(owner.id, [ownerReflection]);
    await sync.putReflections(other.id, [otherReflection]);
    const conflict = await sync.putReflections(owner.id, [{
      ...ownerReflection,
      ciphertext: `synthetic-ciphertext-${runId}-owner-v2`,
      nonce: `synthetic-nonce-${runId}-owner-v2`,
    }]);
    expect(conflict.conflicts).toHaveLength(1);
    expect((await sync.listReflectionConflicts(owner.id))[0].conflictVersions).toHaveLength(1);
    expect((await sync.listReflections(other.id))[0]).toMatchObject({ ciphertext: otherReflection.ciphertext });

    const ownerKey = {
      wrappedKey: `synthetic-wrapped-key-${runId}-owner-v1`,
      nonce: `synthetic-key-nonce-${runId}-owner-v1`,
      salt: `synthetic-key-salt-${runId}-owner-v1`,
      kdfIterations: 600_000,
      encryptionVersion: 1,
    };
    const otherKey = { ...ownerKey, wrappedKey: `synthetic-wrapped-key-${runId}-other` };
    await sync.putSyncKey(owner.id, ownerKey);
    await sync.putSyncKey(other.id, otherKey);
    const rotatedKey = { ...ownerKey, wrappedKey: `synthetic-wrapped-key-${runId}-owner-v2` };
    expect(await sync.replaceSyncKey(owner.id, ownerKey, rotatedKey)).toMatchObject(rotatedKey);
    expect(await sync.replaceSyncKey(owner.id, ownerKey, ownerKey)).toBeNull();

    await sync.resetReflectionSync(owner.id);
    expect(await sync.listReflections(owner.id)).toEqual([]);
    expect(await sync.getSyncKey(owner.id)).toBeNull();
    expect(await sync.listFavoriteSyncRecords(owner.id)).toMatchObject([{ type: 'tombstone', verseKey: '1:1' }]);
    expect(await sync.getPreferences(owner.id)).toMatchObject({ locale: 'ar' });
    expect(await sync.listReflections(other.id)).toHaveLength(1);
    expect(await sync.getSyncKey(other.id)).toMatchObject(otherKey);

    await sync.putSyncKey(owner.id, ownerKey);
    await sync.putReflections(owner.id, [ownerReflection]);
    const deletion = new MongooseAccountDeletionService();
    await deletion.deleteAccount(owner.id);
    expect(await UserModel.findById(owner.id)).toBeNull();
    expect(await UserFavoriteModel.countDocuments({ userId: owner.id })).toBe(0);
    expect(await UserPreferenceModel.countDocuments({ userId: owner.id })).toBe(0);
    expect(await UserReflectionModel.countDocuments({ userId: owner.id })).toBe(0);
    expect(await UserSyncKeyModel.countDocuments({ userId: owner.id })).toBe(0);
    expect(await AppleCredentialModel.countDocuments({ userId: owner.id })).toBe(0);
    expect(await SessionModel.countDocuments({ userId: owner.id })).toBe(0);
    expect(await UserModel.findById(other.id)).not.toBeNull();
    expect(await sync.listFavorites(other.id)).toMatchObject([{ verseKey: '2:2' }]);
    expect(await sync.getPreferences(other.id)).toMatchObject({ locale: 'en' });
    expect(await sync.listReflections(other.id)).toMatchObject([{ ciphertext: otherReflection.ciphertext }]);
    expect(await sync.getSyncKey(other.id)).toMatchObject(otherKey);
    expect(await sessions.isSessionActive(otherSession.sessionId, other.id)).toBe(true);
    expect(await sessions.isSessionActive(ownerSession.sessionId, owner.id)).toBe(false);
  }, 30_000);

  it('validates mappings with the driver and sees a newly created emotion within its transaction', async () => {
    const emotionKey = `integration-${runId.replace(/[0-9]/g, 'x').slice(0, 24)}`;
    syntheticEmotionKeys.add(emotionKey);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await EmotionModel.create([{ key: emotionKey, icon: 'test-icon', order: 99 }], { session });
        const mapping = new EmotionVerseMappingModel({
          verseReferenceKey: '1:1',
          emotionKey,
          status: 'approved',
          mappingVersion: 'synthetic-integration-v1',
          connection: { en: `synthetic connection ${runId}` },
        });
        await mapping.save({ session });
      });
    } finally {
      await session.endSession();
    }

    const stored = await EmotionVerseMappingModel.findOne({ emotionKey }).lean();
    expect(stored?.connection).toMatchObject({ en: `synthetic connection ${runId}` });

    const invalid = new EmotionVerseMappingModel({
      verseReferenceKey: '1:1',
      emotionKey: `missing-${emotionKey}`,
      status: 'approved',
      mappingVersion: 'synthetic-integration-v1',
    });
    await expect(invalid.validate()).rejects.toHaveProperty('errors.emotionKey');
  }, 30_000);
});