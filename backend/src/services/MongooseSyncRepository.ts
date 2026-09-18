import { UserFavoriteModel } from '../models/UserFavorite';
import { UserPreferenceModel } from '../models/UserPreference';
import { UserReflectionModel } from '../models/UserReflection';
import { UserSyncKeyModel } from '../models/UserSyncKey';
import { AppError } from '../errors/AppError';
import type { TranslationDisplayMode } from '../types/accountDomain';
import type { FavoriteDto, PreferencesDto, ReflectionSyncRecordDto, SyncKeyDto } from '../types/accountDto';
import type { IncomingReflectionRecord, PutReflectionsResult, SyncRepository } from './SyncRepository';

function toFavoriteDto(doc: { verseKey: string; createdAt?: Date; updatedAt?: Date }): FavoriteDto {
  return {
    verseKey: doc.verseKey,
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
    updatedAt: (doc.updatedAt ?? new Date()).toISOString(),
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
}): SyncKeyDto {
  return {
    wrappedKey: doc.wrappedKey,
    nonce: doc.nonce,
    salt: doc.salt,
    kdfIterations: doc.kdfIterations,
    encryptionVersion: doc.encryptionVersion,
  };
}

export class MongooseSyncRepository implements SyncRepository {
  async listFavorites(userId: string): Promise<FavoriteDto[]> {
    const docs = await UserFavoriteModel.find({ userId }).lean();
    return docs.map((doc) => toFavoriteDto(doc as never));
  }

  async addFavorites(userId: string, verseKeys: string[]): Promise<FavoriteDto[]> {
    const uniqueKeys = [...new Set(verseKeys)];
    if (uniqueKeys.length > 0) {
      await UserFavoriteModel.bulkWrite(
        uniqueKeys.map((verseKey) => ({
          updateOne: {
            filter: { userId, verseKey },
            update: { $setOnInsert: { userId, verseKey } },
            upsert: true,
          },
        })),
      );
    }
    return this.listFavorites(userId);
  }

  async removeFavorite(userId: string, verseKey: string): Promise<void> {
    await UserFavoriteModel.deleteOne({ userId, verseKey });
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
    const incomingUpdatedAt = new Date(clientUpdatedAt);
    const existing = await UserPreferenceModel.findOne({ userId }).lean();

    if (existing && (existing as { updatedAt: Date }).updatedAt.getTime() >= incomingUpdatedAt.getTime()) {
      return toPreferencesDto(existing as never);
    }

    const doc = await UserPreferenceModel.findOneAndUpdate(
      { userId },
      { $set: { ...input, updatedAt: incomingUpdatedAt } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    return toPreferencesDto(doc as never);
  }

  async listReflections(userId: string): Promise<ReflectionSyncRecordDto[]> {
    const docs = await UserReflectionModel.find({ userId }).lean();
    return docs.map((doc) => toReflectionDto(doc as never));
  }

  async putReflections(userId: string, records: IncomingReflectionRecord[]): Promise<PutReflectionsResult> {
    const result: PutReflectionsResult = { saved: [], conflicts: [] };

    for (const record of records) {
      const incomingTimestamp = new Date(record.type === 'tombstone' ? record.deletedAt : record.updatedAt);
      const existing = await UserReflectionModel.findOne({ userId, verseKey: record.verseKey });

      if (!existing) {
        const created = await UserReflectionModel.create(
          record.type === 'tombstone'
            ? { userId, verseKey: record.verseKey, deleted: true, updatedAt: incomingTimestamp }
            : {
                userId,
                verseKey: record.verseKey,
                deleted: false,
                ciphertext: record.ciphertext,
                nonce: record.nonce,
                encryptionVersion: record.encryptionVersion,
                createdAt: new Date(record.createdAt),
                updatedAt: incomingTimestamp,
              },
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
          existing.createdAt = undefined;
        } else {
          existing.deleted = false;
          existing.ciphertext = record.ciphertext;
          existing.nonce = record.nonce;
          existing.encryptionVersion = record.encryptionVersion;
          existing.createdAt = new Date(record.createdAt);
        }
        existing.updatedAt = incomingTimestamp;
        await existing.save();
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
          await existing.save();
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
      await existing.save();
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
  }

  async getSyncKey(userId: string): Promise<SyncKeyDto | null> {
    const doc = await UserSyncKeyModel.findOne({ userId }).lean();
    return doc ? toSyncKeyDto(doc as never) : null;
  }

  async putSyncKey(
    userId: string,
    key: { wrappedKey: string; nonce: string; salt: string; kdfIterations: number; encryptionVersion: number },
  ): Promise<SyncKeyDto> {
    try {
      const doc = await UserSyncKeyModel.create({ ...key, userId });
      return toSyncKeyDto(doc);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new AppError('A sync key already exists for this account.', 409);
      throw error;
    }
  }

  async replaceSyncKey(userId: string, expected: SyncKeyDto, replacement: SyncKeyDto): Promise<SyncKeyDto | null> {
    const doc = await UserSyncKeyModel.findOneAndUpdate(
      { userId, ...expected },
      { $set: replacement },
      { new: true, runValidators: true, writeConcern: { w: 'majority' } },
    ).lean();
    return doc ? toSyncKeyDto(doc as never) : null;
  }
}
