import { UserFavoriteModel } from '../models/UserFavorite';
import { UserPreferenceModel } from '../models/UserPreference';
import { UserReflectionModel } from '../models/UserReflection';
import { UserSyncKeyModel } from '../models/UserSyncKey';
import type { TranslationDisplayMode } from '../types/accountDomain';
import type { FavoriteDto, PreferencesDto, ReflectionRecordDto, SyncKeyDto } from '../types/accountDto';
import type { IncomingReflection, PutReflectionsResult, SyncRepository } from './SyncRepository';

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

function toReflectionDto(doc: {
  verseKey: string;
  ciphertext: string;
  nonce: string;
  encryptionVersion: number;
  createdAt: Date;
  updatedAt: Date;
}): ReflectionRecordDto {
  return {
    verseKey: doc.verseKey,
    ciphertext: doc.ciphertext,
    nonce: doc.nonce,
    encryptionVersion: doc.encryptionVersion,
    createdAt: doc.createdAt.toISOString(),
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

  async listReflections(userId: string): Promise<ReflectionRecordDto[]> {
    const docs = await UserReflectionModel.find({ userId }).lean();
    return docs.map((doc) => toReflectionDto(doc as never));
  }

  async putReflections(userId: string, records: IncomingReflection[]): Promise<PutReflectionsResult> {
    const result: PutReflectionsResult = { saved: [], conflicts: [] };

    for (const record of records) {
      const incomingUpdatedAt = new Date(record.updatedAt);
      const existing = await UserReflectionModel.findOne({ userId, verseKey: record.verseKey });

      if (!existing) {
        const created = await UserReflectionModel.create({
          userId,
          verseKey: record.verseKey,
          ciphertext: record.ciphertext,
          nonce: record.nonce,
          encryptionVersion: record.encryptionVersion,
          createdAt: new Date(record.createdAt),
          updatedAt: incomingUpdatedAt,
        });
        result.saved.push(toReflectionDto(created.toObject() as never));
        continue;
      }

      const existingUpdatedAt = existing.updatedAt.getTime();

      if (incomingUpdatedAt.getTime() > existingUpdatedAt) {
        existing.ciphertext = record.ciphertext;
        existing.nonce = record.nonce;
        existing.encryptionVersion = record.encryptionVersion;
        existing.updatedAt = incomingUpdatedAt;
        await existing.save();
        result.saved.push(toReflectionDto(existing.toObject() as never));
        continue;
      }

      if (incomingUpdatedAt.getTime() < existingUpdatedAt) {
        // Server already has a strictly newer version: keep it, hand it back
        // so the caller can adopt it locally. The incoming (older) write is
        // simply not applied — never destroyed, since it's still what the
        // uploading device already has locally.
        result.saved.push(toReflectionDto(existing.toObject() as never));
        continue;
      }

      // Exact-timestamp tie. If the content actually matches, this is just
      // the same edit re-uploaded — no conflict. Only genuinely differing
      // ciphertext at the same timestamp is ambiguous enough to preserve
      // both versions (Part D §29) rather than picking a silent winner.
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
    const doc = await UserSyncKeyModel.findOneAndUpdate(
      { userId },
      { $set: { ...key, userId } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return toSyncKeyDto(doc as never);
  }
}
