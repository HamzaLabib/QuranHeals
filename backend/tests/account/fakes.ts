import { randomUUID } from 'node:crypto';

import type { AppleTokenVerifier, VerifiedAppleIdentity } from '../../src/auth/appleTokenVerifier';
import type { GoogleTokenVerifier, VerifiedGoogleIdentity } from '../../src/auth/googleTokenVerifier';
import { AppError } from '../../src/errors/AppError';
import type { IssueReportRepository } from '../../src/services/IssueReportRepository';
import type {
  IncomingReflection,
  PutReflectionsResult,
  SyncRepository,
} from '../../src/services/SyncRepository';
import type { UserRepository, VerifiedProviderIdentity } from '../../src/services/UserRepository';
import type { TranslationDisplayMode } from '../../src/types/accountDomain';
import type {
  FavoriteDto,
  IssueReportInput,
  PreferencesDto,
  ReflectionRecordDto,
  SyncKeyDto,
  UserDto,
} from '../../src/types/accountDto';

/** Mirrors MongooseUserRepository's identity semantics without touching Mongo. */
export class InMemoryUserRepository implements UserRepository {
  private readonly usersByKey = new Map<string, UserDto>();

  async findOrCreateByProviderIdentity(identity: VerifiedProviderIdentity): Promise<UserDto> {
    const key = `${identity.provider}:${identity.providerSubject}`;
    const existing = this.usersByKey.get(key);
    if (existing) {
      const updated: UserDto = { ...existing, email: identity.email ?? existing.email };
      this.usersByKey.set(key, updated);
      return updated;
    }

    const user: UserDto = {
      id: randomUUID(),
      provider: identity.provider,
      email: identity.email,
      createdAt: new Date().toISOString(),
    };
    this.usersByKey.set(key, user);
    return user;
  }

  async findById(userId: string): Promise<UserDto | null> {
    return [...this.usersByKey.values()].find((user) => user.id === userId) ?? null;
  }
}

type ReflectionRecord = ReflectionRecordDto & {
  conflictVersions: Array<{ ciphertext: string; nonce: string; encryptionVersion: number; createdAt: string }>;
};

/** Mirrors MongooseSyncRepository's merge semantics (union favorites, last-write-wins preferences/reflections, tie → conflictVersions) purely in memory. */
export class InMemorySyncRepository implements SyncRepository {
  private readonly favoritesByUser = new Map<string, Map<string, FavoriteDto>>();
  private readonly preferencesByUser = new Map<string, PreferencesDto>();
  private readonly reflectionsByUser = new Map<string, Map<string, ReflectionRecord>>();
  private readonly syncKeyByUser = new Map<string, SyncKeyDto>();

  async listFavorites(userId: string): Promise<FavoriteDto[]> {
    return [...(this.favoritesByUser.get(userId)?.values() ?? [])];
  }

  async addFavorites(userId: string, verseKeys: string[]): Promise<FavoriteDto[]> {
    const map = this.favoritesByUser.get(userId) ?? new Map<string, FavoriteDto>();
    const now = new Date().toISOString();
    for (const verseKey of new Set(verseKeys)) {
      if (!map.has(verseKey)) {
        map.set(verseKey, { verseKey, createdAt: now, updatedAt: now });
      }
    }
    this.favoritesByUser.set(userId, map);
    return this.listFavorites(userId);
  }

  async removeFavorite(userId: string, verseKey: string): Promise<void> {
    this.favoritesByUser.get(userId)?.delete(verseKey);
  }

  async getPreferences(userId: string): Promise<PreferencesDto | null> {
    return this.preferencesByUser.get(userId) ?? null;
  }

  async putPreferences(
    userId: string,
    input: { locale?: string; translationDisplayMode?: TranslationDisplayMode; translationId?: string },
    clientUpdatedAt: string,
  ): Promise<PreferencesDto> {
    const existing = this.preferencesByUser.get(userId);
    if (existing && new Date(existing.updatedAt).getTime() >= new Date(clientUpdatedAt).getTime()) {
      return existing;
    }
    const next: PreferencesDto = { ...existing, ...input, updatedAt: clientUpdatedAt };
    this.preferencesByUser.set(userId, next);
    return next;
  }

  async listReflections(userId: string): Promise<ReflectionRecordDto[]> {
    return [...(this.reflectionsByUser.get(userId)?.values() ?? [])];
  }

  async putReflections(userId: string, records: IncomingReflection[]): Promise<PutReflectionsResult> {
    const map = this.reflectionsByUser.get(userId) ?? new Map<string, ReflectionRecord>();
    const result: PutReflectionsResult = { saved: [], conflicts: [] };

    for (const record of records) {
      const existing = map.get(record.verseKey);

      if (!existing) {
        const created: ReflectionRecord = { ...record, conflictVersions: [] };
        map.set(record.verseKey, created);
        result.saved.push(created);
        continue;
      }

      const incomingTime = new Date(record.updatedAt).getTime();
      const existingTime = new Date(existing.updatedAt).getTime();

      if (incomingTime > existingTime) {
        const updated: ReflectionRecord = { ...existing, ...record };
        map.set(record.verseKey, updated);
        result.saved.push(updated);
        continue;
      }

      if (incomingTime < existingTime) {
        result.saved.push(existing);
        continue;
      }

      if (existing.ciphertext === record.ciphertext && existing.nonce === record.nonce) {
        result.saved.push(existing);
        continue;
      }

      existing.conflictVersions = [
        ...existing.conflictVersions,
        {
          ciphertext: record.ciphertext,
          nonce: record.nonce,
          encryptionVersion: record.encryptionVersion,
          createdAt: new Date().toISOString(),
        },
      ];
      result.saved.push(existing);
      result.conflicts.push({ verseKey: record.verseKey, conflictVersions: existing.conflictVersions });
    }

    this.reflectionsByUser.set(userId, map);
    return result;
  }

  async getSyncKey(userId: string): Promise<SyncKeyDto | null> {
    return this.syncKeyByUser.get(userId) ?? null;
  }

  async putSyncKey(
    userId: string,
    key: { wrappedKey: string; nonce: string; salt: string; kdfIterations: number; encryptionVersion: number },
  ): Promise<SyncKeyDto> {
    this.syncKeyByUser.set(userId, key);
    return key;
  }
}

export class InMemoryIssueReportRepository implements IssueReportRepository {
  public readonly created: IssueReportInput[] = [];

  async create(input: IssueReportInput): Promise<{ id: string }> {
    this.created.push(input);
    return { id: randomUUID() };
  }
}

/** Test double standing in for GoogleAuthLibraryVerifier — maps a fake idToken string directly to a verified identity (or throws), never touching Google's network. */
export class StubGoogleVerifier implements GoogleTokenVerifier {
  constructor(private readonly identitiesByToken: Map<string, VerifiedGoogleIdentity>) {}

  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    const identity = this.identitiesByToken.get(idToken);
    if (!identity) throw new AppError('Google sign-in could not be verified.', 401);
    return identity;
  }
}

/** Test double standing in for AppleJwksVerifier — see StubGoogleVerifier. */
export class StubAppleVerifier implements AppleTokenVerifier {
  constructor(private readonly identitiesByToken: Map<string, VerifiedAppleIdentity>) {}

  async verifyIdToken(idToken: string): Promise<VerifiedAppleIdentity> {
    const identity = this.identitiesByToken.get(idToken);
    if (!identity) throw new AppError('Apple sign-in could not be verified.', 401);
    return identity;
  }
}
