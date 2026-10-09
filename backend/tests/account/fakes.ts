import { randomUUID } from 'node:crypto';

import type { AppleRevocationClient } from '../../src/auth/appleRevocationClient';
import type { AppleTokenVerifier, VerifiedAppleIdentity } from '../../src/auth/appleTokenVerifier';
import {
  formatRefreshToken,
  generateRefreshTokenSecret,
  hashRefreshToken,
  parseRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from '../../src/auth/session';
import { rotateRefreshToken, type RotationStore } from '../../src/auth/refreshRotation';
import type { GoogleTokenVerifier, VerifiedGoogleIdentity } from '../../src/auth/googleTokenVerifier';
import { AppError } from '../../src/errors/AppError';
import type { AppleCredentialRepository } from '../../src/services/AppleCredentialRepository';
import type { IssueReportRepository } from '../../src/services/IssueReportRepository';
import type { IssuedSession, SessionRepository } from '../../src/services/SessionRepository';
import type {
  IncomingFavoriteRecord,
  IncomingReflectionRecord,
  PutReflectionsResult,
  SyncRepository,
} from '../../src/services/SyncRepository';
import type { UserRepository, VerifiedProviderIdentity } from '../../src/services/UserRepository';
import type { TranslationDisplayMode } from '../../src/types/accountDomain';
import type {
  FavoriteDto,
  FavoriteSyncRecordDto,
  IssueReportInput,
  PreferencesDto,
  ReflectionConflictDto,
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

  async findExistingByProviderIdentity(identity: VerifiedProviderIdentity): Promise<UserDto | null> {
    if (!this.usersByKey.has(`${identity.provider}:${identity.providerSubject}`)) return null;
    return this.findOrCreateByProviderIdentity(identity);
  }

  /** Test-only: how many accounts exist — proves a rejected sign-up created none. */
  get size(): number {
    return this.usersByKey.size;
  }

  async findById(userId: string): Promise<UserDto | null> {
    return [...this.usersByKey.values()].find((user) => user.id === userId) ?? null;
  }

  async findProviderIdentity(userId: string): Promise<{ provider: 'apple' | 'google'; providerSubject: string } | null> {
    for (const [key, user] of this.usersByKey) {
      if (user.id === userId) {
        const separator = key.indexOf(':');
        return { provider: user.provider, providerSubject: key.slice(separator + 1) };
      }
    }
    return null;
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
  previousRefreshTokenHash?: string;
  rotatedAt?: number;
  expiresAt: number;
  revokedAt: number | null;
};

/**
 * In-memory SessionRepository. Rotation goes through the PRODUCTION decision
 * logic (auth/refreshRotation.ts's rotateRefreshToken) via an in-memory
 * RotationStore — only persistence is faked. compareAndRotate is atomic here
 * because it runs synchronously, with no await between its check and write.
 */
export class InMemorySessionRepository implements SessionRepository {
  private readonly sessionsById = new Map<string, InMemorySession>();
  private nextId = 1;

  readonly rotationStore: RotationStore = {
    compareAndRotate: async (sessionId, expectedHash, update, now) => {
      const session = this.sessionsById.get(sessionId);
      if (!session || session.revokedAt !== null || session.expiresAt <= now || session.refreshTokenHash !== expectedHash) {
        return null;
      }
      Object.assign(session, update);
      return session.userId;
    },
    find: async (sessionId) => {
      const session = this.sessionsById.get(sessionId);
      if (!session) return null;
      return {
        userId: session.userId,
        refreshTokenHash: session.refreshTokenHash,
        previousRefreshTokenHash: session.previousRefreshTokenHash,
        rotatedAt: session.rotatedAt,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt ?? undefined,
      };
    },
    revoke: async (sessionId, now) => {
      const session = this.sessionsById.get(sessionId);
      if (session && session.revokedAt === null) session.revokedAt = now;
    },
  };

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

  rotateSession(refreshToken: string): Promise<IssuedSession & { userId: string }> {
    return rotateRefreshToken(this.rotationStore, refreshToken);
  }

  /** Test-only: how many sessions were ever issued (revoked ones included). */
  get sessionCount(): number {
    return this.sessionsById.size;
  }

  /** Test-only: inspect stored session state (hashes only — never raw tokens). */
  getStoredSession(sessionId: string): Readonly<InMemorySession> | undefined {
    return this.sessionsById.get(sessionId);
  }

  /** Test-only: move a session's expiry (e.g. into the past). */
  setExpiresAt(sessionId: string, expiresAt: number): void {
    const session = this.sessionsById.get(sessionId);
    if (session) session.expiresAt = expiresAt;
  }

  async revokeSession(refreshToken: string): Promise<void> {
    const parsed = parseRefreshToken(refreshToken);
    const session = parsed ? this.sessionsById.get(parsed.sessionId) : undefined;
    if (session && session.revokedAt === null) {
      session.revokedAt = Date.now();
    }
  }

  /** Mirrors MongooseSessionRepository.isSessionActive. */
  async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    const session = this.sessionsById.get(sessionId);
    if (!session || session.userId !== userId || session.revokedAt !== null || session.expiresAt <= Date.now()) {
      return false;
    }
    return true;
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

type StoredFavorite =
  | { type: 'active'; verseKey: string; createdAt: string; updatedAt: string }
  | { type: 'tombstone'; verseKey: string; deletedAt: string };

/** Mirrors both an active record's `updatedAt` and a tombstone's `deletedAt` as one comparable last-write-wins timestamp — see MongooseSyncRepository's equivalent. */
function timestampOf(record: IncomingReflectionRecord | StoredReflection | IncomingFavoriteRecord | StoredFavorite): number {
  return new Date(record.type === 'tombstone' ? record.deletedAt : record.updatedAt).getTime();
}

function toFavoriteSyncRecordDto(stored: StoredFavorite): FavoriteSyncRecordDto {
  return stored.type === 'tombstone'
    ? { type: 'tombstone', verseKey: stored.verseKey, deletedAt: stored.deletedAt }
    : { type: 'active', verseKey: stored.verseKey, createdAt: stored.createdAt, updatedAt: stored.updatedAt };
}

/** Mirrors MongooseSyncRepository's merge semantics (tombstone-aware last-write-wins for favorites and reflections, tie → tombstone wins / conflictVersions) purely in memory. */
export class InMemorySyncRepository implements SyncRepository {
  private readonly favoritesByUser = new Map<string, Map<string, StoredFavorite>>();
  private readonly preferencesByUser = new Map<string, PreferencesDto>();
  private readonly reflectionsByUser = new Map<string, Map<string, StoredReflection>>();
  private readonly syncKeyByUser = new Map<string, SyncKeyDto>();

  async listFavorites(userId: string): Promise<FavoriteDto[]> {
    return [...(this.favoritesByUser.get(userId)?.values() ?? [])]
      .filter((stored): stored is Extract<StoredFavorite, { type: 'active' }> => stored.type === 'active')
      .map(({ verseKey, createdAt, updatedAt }) => ({ verseKey, createdAt, updatedAt }));
  }

  async addFavorites(userId: string, verseKeys: string[]): Promise<FavoriteDto[]> {
    const map = this.favoritesByUser.get(userId) ?? new Map<string, StoredFavorite>();
    const now = new Date().toISOString();
    for (const verseKey of new Set(verseKeys)) {
      // Mirrors $setOnInsert: only applies when nothing exists yet for this
      // verseKey — an existing active OR tombstone entry is left untouched.
      if (!map.has(verseKey)) {
        map.set(verseKey, { type: 'active', verseKey, createdAt: now, updatedAt: now });
      }
    }
    this.favoritesByUser.set(userId, map);
    return this.listFavorites(userId);
  }

  async removeFavorite(userId: string, verseKey: string): Promise<void> {
    const map = this.favoritesByUser.get(userId) ?? new Map<string, StoredFavorite>();
    map.set(verseKey, { type: 'tombstone', verseKey, deletedAt: new Date().toISOString() });
    this.favoritesByUser.set(userId, map);
  }

  async listFavoriteSyncRecords(userId: string): Promise<FavoriteSyncRecordDto[]> {
    return [...(this.favoritesByUser.get(userId)?.values() ?? [])].map(toFavoriteSyncRecordDto);
  }

  async putFavorites(userId: string, records: IncomingFavoriteRecord[]): Promise<FavoriteSyncRecordDto[]> {
    const map = this.favoritesByUser.get(userId) ?? new Map<string, StoredFavorite>();
    const saved: FavoriteSyncRecordDto[] = [];

    for (const record of records) {
      const existing = map.get(record.verseKey);

      if (!existing) {
        const created: StoredFavorite = { ...record };
        map.set(record.verseKey, created);
        saved.push(toFavoriteSyncRecordDto(created));
        continue;
      }

      const incomingTime = timestampOf(record);
      const existingTime = timestampOf(existing);

      if (incomingTime > existingTime) {
        const updated: StoredFavorite = { ...record };
        map.set(record.verseKey, updated);
        saved.push(toFavoriteSyncRecordDto(updated));
        continue;
      }

      if (incomingTime < existingTime) {
        saved.push(toFavoriteSyncRecordDto(existing));
        continue;
      }

      // Exact-timestamp tie: the tombstone wins deterministically, in
      // either direction — mirrors MongooseSyncRepository.
      if (record.type === 'tombstone' && existing.type !== 'tombstone') {
        const converted: StoredFavorite = { type: 'tombstone', verseKey: record.verseKey, deletedAt: record.deletedAt };
        map.set(record.verseKey, converted);
        saved.push(toFavoriteSyncRecordDto(converted));
        continue;
      }
      saved.push(toFavoriteSyncRecordDto(existing));
    }

    this.favoritesByUser.set(userId, map);
    return saved;
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

  async listReflectionConflicts(userId: string): Promise<ReflectionConflictDto[]> {
    return [...(this.reflectionsByUser.get(userId)?.values() ?? [])]
      .filter((stored): stored is Extract<StoredReflection, { type: 'active' }> => stored.type === 'active' && stored.conflictVersions.length > 0)
      .map((stored) => ({ verseKey: stored.verseKey, conflictVersions: stored.conflictVersions.map((version) => ({ ...version })) }));
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

  private readonly syncKeyCreatedAtByUser = new Map<string, Date>();

  async getSyncKeyCreatedAt(userId: string): Promise<Date | null> {
    return this.syncKeyByUser.has(userId) ? (this.syncKeyCreatedAtByUser.get(userId) ?? null) : null;
  }

  async putSyncKey(userId: string, key: SyncKeyDto): Promise<SyncKeyDto> {
    if (this.syncKeyByUser.has(userId)) throw new AppError('Sync key already exists.', 409);
    this.syncKeyByUser.set(userId, key);
    this.syncKeyCreatedAtByUser.set(userId, new Date());
    return key;
  }

  async replaceSyncKey(userId: string, expected: SyncKeyDto, replacement: SyncKeyDto): Promise<SyncKeyDto | null> {
    const current = this.syncKeyByUser.get(userId);
    if (!current || (Object.keys(expected) as (keyof SyncKeyDto)[]).some((field) => current[field] !== expected[field])) return null;
    this.syncKeyByUser.set(userId, replacement);
    return replacement;
  }

  async resetReflectionSync(userId: string): Promise<void> {
    this.reflectionsByUser.delete(userId);
    this.syncKeyByUser.delete(userId);
  }

  async deleteReflectionsNotEncryptedWith(userId: string, keyFingerprint: string): Promise<void> {
    const map = this.reflectionsByUser.get(userId);
    if (!map) return;
    for (const [verseKey, record] of map) {
      if (record.type === 'active' && (record as { keyFingerprint?: string }).keyFingerprint !== keyFingerprint) map.delete(verseKey);
    }
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
    private readonly appleCredentialRepository?: InMemoryAppleCredentialRepository,
  ) {}

  async deleteAccount(userId: string): Promise<void> {
    this.syncRepository.deleteAllForUser(userId);
    this.sessionRepository.revokeAllSessionsForUser(userId);
    await this.appleCredentialRepository?.delete(userId);
    this.userRepository.deleteUser(userId);
  }
}

/** Mirrors MongooseAppleCredentialRepository purely in memory — no encryption, since there's nothing to protect against in a test process. */
export class InMemoryAppleCredentialRepository implements AppleCredentialRepository {
  private readonly refreshTokenByUserId = new Map<string, string>();

  async save(userId: string, refreshToken: string): Promise<void> {
    this.refreshTokenByUserId.set(userId, refreshToken);
  }

  async get(userId: string): Promise<string | null> {
    return this.refreshTokenByUserId.get(userId) ?? null;
  }

  async delete(userId: string): Promise<void> {
    this.refreshTokenByUserId.delete(userId);
  }
}

/**
 * Test double standing in for HttpAppleRevocationClient. `codesToRefreshTokens`
 * maps a fake authorization code to the refresh token exchanging it should
 * yield. `revokedTokens` records every token successfully revoked (including
 * ones treated as idempotently-already-revoked, tracked separately in
 * `alreadyRevokedTokens`), so a test can assert exactly what was revoked
 * without ever needing a real Apple response shape. `failingCodes`/
 * `failingTokens` make the corresponding call reject, simulating a network
 * or Apple-side failure.
 */
export class StubAppleRevocationClient implements AppleRevocationClient {
  public readonly revokedTokens: string[] = [];
  public readonly exchangedCodes: string[] = [];

  constructor(
    public readonly codesToRefreshTokens = new Map<string, string>(),
    public readonly alreadyRevokedTokens = new Set<string>(),
    public readonly failingCodes = new Set<string>(),
    public readonly failingTokens = new Set<string>(),
  ) {}

  async exchangeAuthorizationCode(authorizationCode: string): Promise<{ refreshToken: string }> {
    this.exchangedCodes.push(authorizationCode);
    if (this.failingCodes.has(authorizationCode)) {
      throw new AppError('Account deletion could not be completed. Please try again.', 502);
    }
    const refreshToken = this.codesToRefreshTokens.get(authorizationCode);
    if (!refreshToken) throw new AppError('Account deletion could not be completed. Please try again.', 502);
    return { refreshToken };
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    if (this.failingTokens.has(refreshToken)) {
      throw new AppError('Account deletion could not be completed. Please try again.', 502);
    }
    // Mirrors HttpAppleRevocationClient: an already-revoked token resolves
    // as success, never a thrown error.
    if (!this.alreadyRevokedTokens.has(refreshToken)) {
      this.revokedTokens.push(refreshToken);
    }
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
    // Like a real token: issued "now" unless a test sets issuedAt explicitly.
    return { issuedAt: Math.floor(Date.now() / 1000), ...identity };
  }
}

/** Test double standing in for AppleJwksVerifier — see StubGoogleVerifier. */
export class StubAppleVerifier implements AppleTokenVerifier {
  constructor(private readonly identitiesByToken: Map<string, VerifiedAppleIdentity>) {}

  async verifyIdToken(idToken: string): Promise<VerifiedAppleIdentity> {
    const identity = this.identitiesByToken.get(idToken);
    if (!identity) throw new AppError('Apple sign-in could not be verified.', 401);
    return { issuedAt: Math.floor(Date.now() / 1000), ...identity };
  }
}
