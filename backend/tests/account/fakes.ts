import { randomUUID } from 'node:crypto';

import type { AppleTokenVerifier, VerifiedAppleIdentity } from '../../src/auth/appleTokenVerifier';
import {
  formatRefreshToken,
  generateRefreshTokenSecret,
  hashRefreshToken,
  parseRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from '../../src/auth/session';
import type { GoogleTokenVerifier, VerifiedGoogleIdentity } from '../../src/auth/googleTokenVerifier';
import { AppError } from '../../src/errors/AppError';
import type { IssueReportRepository } from '../../src/services/IssueReportRepository';
import type { IssuedSession, SessionRepository } from '../../src/services/SessionRepository';
import type {
  IncomingReflectionRecord,
  PutReflectionsResult,
  SyncRepository,
} from '../../src/services/SyncRepository';
import type { UserRepository, VerifiedProviderIdentity } from '../../src/services/UserRepository';
import type { TranslationDisplayMode } from '../../src/types/accountDomain';
import type {
  FavoriteDto,
  IssueReportInput,
  PreferencesDto,
  ReflectionSyncRecordDto,
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

  /** Test-only: mirrors MongooseAccountDeletionService's `UserModel.deleteOne`. Not part of the production UserRepository interface. */
  deleteUser(userId: string): void {
    for (const [key, user] of this.usersByKey) {
      if (user.id === userId) this.usersByKey.delete(key);
    }
  }
}

type InMemorySession = {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: number;
  revokedAt: number | null;
};

const INVALID_SESSION_MESSAGE = 'Session is invalid or has expired. Please sign in again.';

/** Mirrors MongooseSessionRepository's rotation/revocation semantics (including reuse-detected revocation) purely in memory, using the exact same token helpers as production. */
export class InMemorySessionRepository implements SessionRepository {
  private readonly sessionsById = new Map<string, InMemorySession>();
  private nextId = 1;

  async createSession(userId: string): Promise<IssuedSession> {
    const sessionId = String(this.nextId++);
    const secret = generateRefreshTokenSecret();
    const refreshToken = formatRefreshToken(sessionId, secret);

    this.sessionsById.set(sessionId, {
      id: sessionId,
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
      revokedAt: null,
    });

    return { sessionId, refreshToken };
  }

  async rotateSession(refreshToken: string): Promise<IssuedSession & { userId: string }> {
    const parsed = parseRefreshToken(refreshToken);
    const session = parsed ? this.sessionsById.get(parsed.sessionId) : undefined;

    if (!parsed || !session || session.revokedAt !== null || session.expiresAt < Date.now()) {
      throw new AppError(INVALID_SESSION_MESSAGE, 401);
    }

    if (session.refreshTokenHash !== hashRefreshToken(refreshToken)) {
      session.revokedAt = Date.now();
      throw new AppError(INVALID_SESSION_MESSAGE, 401);
    }

    const nextSecret = generateRefreshTokenSecret();
    const nextRefreshToken = formatRefreshToken(parsed.sessionId, nextSecret);
    session.refreshTokenHash = hashRefreshToken(nextRefreshToken);
    session.expiresAt = Date.now() + REFRESH_TOKEN_TTL_MS;

    return { sessionId: parsed.sessionId, refreshToken: nextRefreshToken, userId: session.userId };
  }

  async revokeSession(refreshToken: string): Promise<void> {
    const parsed = parseRefreshToken(refreshToken);
    const session = parsed ? this.sessionsById.get(parsed.sessionId) : undefined;
    if (session && session.revokedAt === null) {
      session.revokedAt = Date.now();
    }
  }

  /** Test-only: mirrors MongooseAccountDeletionService's `SessionModel.deleteMany({ userId })` — deletes every session for this user, every device. Not part of the production SessionRepository interface. */
  revokeAllSessionsForUser(userId: string): void {
    for (const [id, session] of this.sessionsById) {
      if (session.userId === userId) this.sessionsById.delete(id);
    }
  }
}

type StoredReflection =
  | ({ type: 'active' } & Omit<Extract<ReflectionSyncRecordDto, { type: 'active' }>, 'type'> & {
        conflictVersions: Array<{ ciphertext: string; nonce: string; encryptionVersion: number; createdAt: string }>;
      })
  | ({ type: 'tombstone' } & Omit<Extract<ReflectionSyncRecordDto, { type: 'tombstone' }>, 'type'>);

/** Mirrors both an active record's `updatedAt` and a tombstone's `deletedAt` as one comparable last-write-wins timestamp — see MongooseSyncRepository's equivalent. */
function timestampOf(record: IncomingReflectionRecord | StoredReflection): number {
  return new Date(record.type === 'tombstone' ? record.deletedAt : record.updatedAt).getTime();
}

/** Mirrors MongooseSyncRepository's merge semantics (union favorites, last-write-wins preferences/reflections/tombstones, tie → conflictVersions) purely in memory. */
export class InMemorySyncRepository implements SyncRepository {
  private readonly favoritesByUser = new Map<string, Map<string, FavoriteDto>>();
  private readonly preferencesByUser = new Map<string, PreferencesDto>();
  private readonly reflectionsByUser = new Map<string, Map<string, StoredReflection>>();
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

  async listReflections(userId: string): Promise<ReflectionSyncRecordDto[]> {
    return [...(this.reflectionsByUser.get(userId)?.values() ?? [])];
  }

  async putReflections(userId: string, records: IncomingReflectionRecord[]): Promise<PutReflectionsResult> {
    const map = this.reflectionsByUser.get(userId) ?? new Map<string, StoredReflection>();
    const result: PutReflectionsResult = { saved: [], conflicts: [] };

    for (const record of records) {
      const existing = map.get(record.verseKey);

      if (!existing) {
        const created: StoredReflection =
          record.type === 'tombstone' ? { ...record } : { ...record, conflictVersions: [] };
        map.set(record.verseKey, created);
        result.saved.push(created);
        continue;
      }

      const incomingTime = timestampOf(record);
      const existingTime = timestampOf(existing);

      if (incomingTime > existingTime) {
        const updated: StoredReflection =
          record.type === 'tombstone'
            ? { ...record }
            : { ...record, conflictVersions: existing.type === 'active' ? existing.conflictVersions : [] };
        map.set(record.verseKey, updated);
        result.saved.push(updated);
        continue;
      }

      if (incomingTime < existingTime) {
        // Server already has a strictly newer version (active or a
        // tombstone) — never overwritten by a stale write in either
        // direction.
        result.saved.push(existing);
        continue;
      }

      // Exact-timestamp tie: the tombstone wins deterministically, in
      // either direction — mirrors MongooseSyncRepository's tie-break so
      // both implementations converge identically.
      if (record.type === 'tombstone' || existing.type === 'tombstone') {
        if (record.type === 'tombstone' && existing.type !== 'tombstone') {
          const converted: StoredReflection = { type: 'tombstone', verseKey: record.verseKey, deletedAt: record.deletedAt };
          map.set(record.verseKey, converted);
          result.saved.push(converted);
          continue;
        }
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
    if (this.syncKeyByUser.has(userId)) throw new AppError('Sync key already exists.', 409);
    this.syncKeyByUser.set(userId, key);
    return key;
  }

  async replaceSyncKey(userId: string, expected: SyncKeyDto, replacement: SyncKeyDto): Promise<SyncKeyDto | null> {
    const current = this.syncKeyByUser.get(userId);
    if (!current || (Object.keys(expected) as (keyof SyncKeyDto)[]).some((field) => current[field] !== expected[field])) return null;
    this.syncKeyByUser.set(userId, replacement);
    return replacement;
  }

  /** Test-only: mirrors MongooseAccountDeletionService's four `deleteMany({ userId })` calls (favorites, preferences, reflections, sync key) in one step. Not part of the production SyncRepository interface. */
  deleteAllForUser(userId: string): void {
    this.favoritesByUser.delete(userId);
    this.preferencesByUser.delete(userId);
    this.reflectionsByUser.delete(userId);
    this.syncKeyByUser.delete(userId);
  }
}

/** Test-only account-deletion orchestrator — mirrors MongooseAccountDeletionService's effect (every model owned by userId is gone) by delegating to the same InMemory*Repository instances the test app already uses, so assertions made through the HTTP API see the deletion too. */
export class InMemoryAccountDeletionService {
  constructor(
    private readonly userRepository: InMemoryUserRepository,
    private readonly syncRepository: InMemorySyncRepository,
    private readonly sessionRepository: InMemorySessionRepository,
  ) {}

  async deleteAccount(userId: string): Promise<void> {
    this.syncRepository.deleteAllForUser(userId);
    this.sessionRepository.revokeAllSessionsForUser(userId);
    this.userRepository.deleteUser(userId);
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
