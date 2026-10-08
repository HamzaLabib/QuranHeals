import mongoose from 'mongoose';

import { UserFavoriteModel } from '../models/UserFavorite';
import { UserPreferenceModel } from '../models/UserPreference';
import { UserReflectionModel } from '../models/UserReflection';
import { UserSyncKeyModel } from '../models/UserSyncKey';
import { AppError } from '../errors/AppError';
import type { TranslationDisplayMode } from '../types/accountDomain';
import type { FavoriteDto, FavoriteSyncRecordDto, PreferencesDto, ReflectionConflictDto, ReflectionSyncRecordDto, SyncKeyDto } from '../types/accountDto';
import type {
  IncomingFavoriteRecord,
  IncomingReflectionRecord,
  PutReflectionsResult,
  SyncRepository,
} from './SyncRepository';
import { withExistingUser } from './withExistingUser';

function toFavoriteDto(doc: { verseKey: string; createdAt?: Date; updatedAt?: Date }): FavoriteDto {
  return {
    verseKey: doc.verseKey,
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
    updatedAt: (doc.updatedAt ?? new Date()).toISOString(),
  };
}

/**
 * Branches on `deleted` to build either shape — a pre-tombstone document
 * (deleted absent/undefined, i.e. falsy) is always read back as `'active'`,
 * so existing MongoDB documents need no migration. Mirrors toReflectionDto.
 */
function toFavoriteSyncRecordDto(doc: { verseKey: string; deleted?: boolean; createdAt?: Date; updatedAt: Date }): FavoriteSyncRecordDto {
  if (doc.deleted) {
    return { type: 'tombstone', verseKey: doc.verseKey, deletedAt: doc.updatedAt.toISOString() };
  }
  return {
    type: 'active',
    verseKey: doc.verseKey,
    createdAt: (doc.createdAt ?? doc.updatedAt).toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toPreferencesDto(doc: {
  locale?: string;
  translationDisplayMode?: TranslationDisplayMode;
  translationId?: string;
  updatedAt: Date;
}): PreferencesDto {
  return {
    locale: doc.locale,
    translationDisplayMode: doc.translationDisplayMode,
    translationId: doc.translationId,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Branches on `deleted` to build either shape — a pre-tombstone document
 * (deleted absent/undefined, i.e. falsy) is always read back as `'active'`,
 * so existing MongoDB documents need no migration. `updatedAt` is reused as
 * a tombstone's `deletedAt` — see UserReflection.ts's schema comment.
 */
function toReflectionDto(doc: {
  verseKey: string;
  deleted?: boolean;
  ciphertext?: string;
  nonce?: string;
  encryptionVersion?: number;
  createdAt?: Date;
  updatedAt: Date;
}): ReflectionSyncRecordDto {
  if (doc.deleted) {
    return { type: 'tombstone', verseKey: doc.verseKey, deletedAt: doc.updatedAt.toISOString() };
  }
  return {
    type: 'active',
    verseKey: doc.verseKey,
    ciphertext: doc.ciphertext ?? '',
    nonce: doc.nonce ?? '',
    encryptionVersion: doc.encryptionVersion ?? 1,
    createdAt: (doc.createdAt ?? doc.updatedAt).toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toSyncKeyDto(doc: {
  wrappedKey: string;
  nonce: string;
  salt: string;
  kdfIterations: number;
  encryptionVersion: number;
  keyFingerprint?: string;
}): SyncKeyDto {
  return {
    wrappedKey: doc.wrappedKey,
    nonce: doc.nonce,
    salt: doc.salt,
    kdfIterations: doc.kdfIterations,
    encryptionVersion: doc.encryptionVersion,
    ...(doc.keyFingerprint ? { keyFingerprint: doc.keyFingerprint } : {}),
  };
}

export class MongooseSyncRepository implements SyncRepository {
  async listFavorites(userId: string): Promise<FavoriteDto[]> {
    const docs = await UserFavoriteModel.find({ userId, deleted: { $ne: true } }).lean();
    return docs.map((doc) => toFavoriteDto(doc as never));
  }

  async addFavorites(userId: string, verseKeys: string[]): Promise<FavoriteDto[]> {
    const uniqueKeys = [...new Set(verseKeys)];
    if (uniqueKeys.length > 0) {
      await withExistingUser(userId, async (session) => {
        const now = new Date();
        await UserFavoriteModel.bulkWrite(
          uniqueKeys.map((verseKey) => ({
            updateOne: {
              filter: { userId, verseKey },
              // $setOnInsert only applies when no (userId, verseKey) document
              // exists yet — an existing document, active OR a tombstone, is
              // always left completely untouched. See the interface doc
              // comment on addFavorites.
              update: { $setOnInsert: { userId, verseKey, deleted: false, createdAt: now, updatedAt: now } },
              upsert: true,
            },
          })),
          { session },
        );
      });
    }
    return this.listFavorites(userId);
  }

  async removeFavorite(userId: string, verseKey: string): Promise<void> {
    await withExistingUser(userId, async (session) => {
      const now = new Date();
      await UserFavoriteModel.findOneAndUpdate(
        { userId, verseKey },
        { $set: { deleted: true, updatedAt: now }, $unset: { createdAt: 1 } },
        { upsert: true, setDefaultsOnInsert: true, session },
      );
    });
  }

  async listFavoriteSyncRecords(userId: string): Promise<FavoriteSyncRecordDto[]> {
    const docs = await UserFavoriteModel.find({ userId }).lean();
    return docs.map((doc) => toFavoriteSyncRecordDto(doc as never));
  }

  async putFavorites(userId: string, records: IncomingFavoriteRecord[]): Promise<FavoriteSyncRecordDto[]> {
    return withExistingUser(userId, async (session) => {
      const saved: FavoriteSyncRecordDto[] = [];

      for (const record of records) {
        const incomingTimestamp = new Date(record.type === 'tombstone' ? record.deletedAt : record.updatedAt);
        const existing = await UserFavoriteModel.findOne({ userId, verseKey: record.verseKey }).session(session);

        if (!existing) {
          const [created] = await UserFavoriteModel.create(
            [
              record.type === 'tombstone'
                ? { userId, verseKey: record.verseKey, deleted: true, updatedAt: incomingTimestamp }
                : { userId, verseKey: record.verseKey, deleted: false, createdAt: new Date(record.createdAt), updatedAt: incomingTimestamp },
            ],
            { session },
          );
          saved.push(toFavoriteSyncRecordDto(created.toObject() as never));
          continue;
        }

        const existingTimestamp = existing.updatedAt.getTime();

        if (incomingTimestamp.getTime() > existingTimestamp) {
          if (record.type === 'tombstone') {
            existing.deleted = true;
            existing.createdAt = undefined;
          } else {
            existing.deleted = false;
            existing.createdAt = new Date(record.createdAt);
          }
          existing.updatedAt = incomingTimestamp;
          await existing.save({ session });
          saved.push(toFavoriteSyncRecordDto(existing.toObject() as never));
          continue;
        }

        if (incomingTimestamp.getTime() < existingTimestamp) {
          // Server already has a strictly newer version (active or a
          // tombstone): keep it, hand it back so the caller can adopt it
          // locally. Mirrors putReflections — stops a stale upload from
          // resurrecting (or deleting) something a later write already
          // settled.
          saved.push(toFavoriteSyncRecordDto(existing.toObject() as never));
          continue;
        }

        // Exact-timestamp tie: the tombstone wins, deterministically, in
        // either direction — a favorite carries no content to disagree about,
        // so unlike reflections there is no conflict-preservation case here.
        if (record.type === 'tombstone' && !existing.deleted) {
          existing.deleted = true;
          existing.createdAt = undefined;
          existing.updatedAt = incomingTimestamp;
          await existing.save({ session });
        }
        saved.push(toFavoriteSyncRecordDto(existing.toObject() as never));
      }

      return saved;
    });
  }

  async getPreferences(userId: string): Promise<PreferencesDto | null> {
    const doc = await UserPreferenceModel.findOne({ userId }).lean();
    return doc ? toPreferencesDto(doc as never) : null;
  }

  async putPreferences(
    userId: string,
    input: { locale?: string; translationDisplayMode?: TranslationDisplayMode; translationId?: string },
    clientUpdatedAt: string,
  ): Promise<PreferencesDto> {
    return withExistingUser(userId, async (session) => {
      const incomingUpdatedAt = new Date(clientUpdatedAt);
      const existing = await UserPreferenceModel.findOne({ userId }).session(session).lean();

      if (existing && (existing as { updatedAt: Date }).updatedAt.getTime() >= incomingUpdatedAt.getTime()) {
        return toPreferencesDto(existing as never);
      }

      const doc = await UserPreferenceModel.findOneAndUpdate(
        { userId },
        { $set: { ...input, updatedAt: incomingUpdatedAt } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, session },
      ).lean();

      return toPreferencesDto(doc as never);
    });
  }

  async listReflections(userId: string): Promise<ReflectionSyncRecordDto[]> {
    const docs = await UserReflectionModel.find({ userId }).lean();
    return docs.map((doc) => toReflectionDto(doc as never));
  }

  async listReflectionConflicts(userId: string): Promise<ReflectionConflictDto[]> {
    const docs = await UserReflectionModel.find(
      { userId, deleted: { $ne: true }, 'conflictVersions.0': { $exists: true } },
      { verseKey: 1, conflictVersions: 1 },
    ).lean<{ verseKey: string; conflictVersions: Array<{ ciphertext: string; nonce: string; encryptionVersion: number; createdAt: Date }> }[]>();
    return docs.map((doc) => ({
      verseKey: doc.verseKey,
      conflictVersions: doc.conflictVersions.map((version) => ({
        ciphertext: version.ciphertext,
        nonce: version.nonce,
        encryptionVersion: version.encryptionVersion,
        createdAt: version.createdAt.toISOString(),
      })),
    }));
  }

  async putReflections(userId: string, records: IncomingReflectionRecord[]): Promise<PutReflectionsResult> {
    return withExistingUser(userId, async (session) => {
      const result: PutReflectionsResult = { saved: [], conflicts: [] };

      for (const record of records) {
        const incomingTimestamp = new Date(record.type === 'tombstone' ? record.deletedAt : record.updatedAt);
        const existing = await UserReflectionModel.findOne({ userId, verseKey: record.verseKey }).session(session);

        if (!existing) {
          const [created] = await UserReflectionModel.create(
            [
              record.type === 'tombstone'
                ? { userId, verseKey: record.verseKey, deleted: true, updatedAt: incomingTimestamp }
                : {
                    userId,
                    verseKey: record.verseKey,
                    deleted: false,
                    ciphertext: record.ciphertext,
                    nonce: record.nonce,
                    encryptionVersion: record.encryptionVersion,
                    keyFingerprint: record.keyFingerprint,
                    createdAt: new Date(record.createdAt),
                    updatedAt: incomingTimestamp,
                  },
            ],
            { session },
          );
          result.saved.push(toReflectionDto(created.toObject() as never));
          continue;
        }

        const existingTimestamp = existing.updatedAt.getTime();

        if (incomingTimestamp.getTime() > existingTimestamp) {
          if (record.type === 'tombstone') {
            existing.deleted = true;
            existing.ciphertext = undefined;
            existing.nonce = undefined;
            existing.encryptionVersion = undefined;
            existing.keyFingerprint = undefined;
            existing.createdAt = undefined;
          } else {
            existing.deleted = false;
            existing.ciphertext = record.ciphertext;
            existing.nonce = record.nonce;
            existing.encryptionVersion = record.encryptionVersion;
            existing.keyFingerprint = record.keyFingerprint;
            existing.createdAt = new Date(record.createdAt);
          }
          existing.updatedAt = incomingTimestamp;
          await existing.save({ session });
          result.saved.push(toReflectionDto(existing.toObject() as never));
          continue;
        }

        if (incomingTimestamp.getTime() < existingTimestamp) {
          // Server already has a strictly newer version (active or a
          // tombstone): keep it, hand it back so the caller can adopt it
          // locally. The incoming (older) write is simply not applied — never
          // destroyed, since it's still what the uploading device already has
          // locally. This is exactly what stops a stale active upload from
          // resurrecting a reflection deleted later on another device, and
          // stops a stale tombstone from deleting a genuinely newer active one.
          result.saved.push(toReflectionDto(existing.toObject() as never));
          continue;
        }

        // Exact-timestamp tie: the tombstone wins, deterministically, in
        // either direction — never "whichever happened to already be
        // stored" — so two devices (or a device and the backend) can never
        // permanently disagree about a verseKey they both touched at the
        // same instant. Two ACTIVE records at an exact tie are the only
        // case still ambiguous enough to preserve both versions as a
        // conflict (Part D §29); a tombstone always simply wins.
        if (record.type === 'tombstone' || existing.deleted) {
          if (record.type === 'tombstone' && !existing.deleted) {
            existing.deleted = true;
            existing.ciphertext = undefined;
            existing.nonce = undefined;
            existing.encryptionVersion = undefined;
            existing.createdAt = undefined;
            existing.updatedAt = incomingTimestamp;
            await existing.save({ session });
          }
          // Else existing is already a tombstone: an incoming tombstone at
          // the same instant is idempotent, and an incoming ACTIVE record at
          // the same instant as an existing tombstone still loses — either
          // way, the (possibly just-updated) existing document is returned
          // unchanged from here.
          result.saved.push(toReflectionDto(existing.toObject() as never));
          continue;
        }

        // Both active, exact-timestamp tie. If the content actually matches,
        // this is just the same edit re-uploaded — no conflict. Only genuinely
        // differing ciphertext at the same timestamp is ambiguous enough to
        // preserve both versions rather than picking a silent winner.
        if (existing.ciphertext === record.ciphertext && existing.nonce === record.nonce) {
          result.saved.push(toReflectionDto(existing.toObject() as never));
          continue;
        }

        existing.conflictVersions = [
          ...(existing.conflictVersions ?? []),
          {
            ciphertext: record.ciphertext,
            nonce: record.nonce,
            encryptionVersion: record.encryptionVersion,
            createdAt: new Date(),
          },
        ];
        await existing.save({ session });
        result.saved.push(toReflectionDto(existing.toObject() as never));
        result.conflicts.push({
          verseKey: record.verseKey,
          conflictVersions: existing.conflictVersions.map((version: (typeof existing.conflictVersions)[number]) => ({
            ciphertext: version.ciphertext,
            nonce: version.nonce,
            encryptionVersion: version.encryptionVersion,
            createdAt: version.createdAt.toISOString(),
          })),
        });
      }

      return result;
    });
  }

  async getSyncKey(userId: string): Promise<SyncKeyDto | null> {
    const doc = await UserSyncKeyModel.findOne({ userId }).lean();
    return doc ? toSyncKeyDto(doc as never) : null;
  }

  async putSyncKey(userId: string, key: SyncKeyDto): Promise<SyncKeyDto> {
    return withExistingUser(userId, async (session) => {
      try {
        const [doc] = await UserSyncKeyModel.create([{ ...key, userId }], { session });
        return toSyncKeyDto(doc);
      } catch (error) {
        if ((error as { code?: number }).code === 11000) throw new AppError('A sync key already exists for this account.', 409);
        throw error;
      }
    });
  }

  async replaceSyncKey(userId: string, expected: SyncKeyDto, replacement: SyncKeyDto): Promise<SyncKeyDto | null> {
    const doc = await UserSyncKeyModel.findOneAndUpdate(
      { userId, ...expected },
      { $set: replacement },
      { returnDocument: 'after', runValidators: true, writeConcern: { w: 'majority' } },
    ).lean();
    return doc ? toSyncKeyDto(doc as never) : null;
  }

  async resetReflectionSync(userId: string): Promise<void> {
    // One transaction (same pattern as MongooseAccountDeletionService): a
    // reset never leaves the key without its reflections or vice versa.
    // Deleting zero documents is not an error, so a repeat is a no-op.
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await UserReflectionModel.deleteMany({ userId }).session(session);
        await UserSyncKeyModel.deleteMany({ userId }).session(session);
      });
    } finally {
      await session.endSession();
    }
  }

  async getSyncKeyCreatedAt(userId: string): Promise<Date | null> {
    const doc = await UserSyncKeyModel.findOne({ userId }).select('createdAt').lean<{ createdAt?: Date }>();
    return doc?.createdAt ?? null;
  }

  async deleteReflectionsNotEncryptedWith(userId: string, keyFingerprint: string): Promise<void> {
    await UserReflectionModel.deleteMany({ userId, deleted: { $ne: true }, keyFingerprint: { $ne: keyFingerprint } });
  }
}
