import { apiBaseUrl } from '@/services/apiBase';
import { isStaleSessionToken } from '@/auth/authEpoch';
import type { ProviderCredential } from '@/auth/reauthentication';
import { fetchWithTimeout } from '@/services/fetchWithTimeout';

export class SyncApiError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'SyncApiError';
  }
}

type ApiEnvelope<T> = { success: true; data: T } | { success: false; message: string };

async function sendRequest(sessionToken: string, path: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
  // Bounded the same way as every other network layer in this app (see
  // fetchWithTimeout's doc comment) — this is what makes refreshSync()
  // (favorites/preferences/reflections sync, reachable from Favorites',
  // Reflections', and Settings' pull-to-refresh) recoverable rather than
  // able to hang forever on a dead connection. An abort here rejects like
  // any other fetch failure, which the try/catch in authedRequest below
  // already turns into an ordinary SyncApiError.
  return fetchWithTimeout(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${sessionToken}`,
      ...init.headers,
    },
  }, timeoutMs);
}

/**
 * On a 401 (the access token expired while this device was backgrounded, or
 * simply aged past its ~20-minute lifetime), refreshes once via the shared
 * single-flight refresher and retries the original request exactly once
 * with the new token — never a loop. If refresh isn't possible (offline, or
 * the session was genuinely revoked), the original 401 is surfaced as
 * usual, which every existing caller here already treats as a recoverable
 * sync failure (Part 4: "401 → refresh access token → retry original
 * request → success").
 */
async function authedRequest<T>(sessionToken: string, path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
  let response: Response;
  try {
    response = await sendRequest(sessionToken, path, init, timeoutMs);

    // Never for an earlier session's token: the refresh credential stored
    // now belongs to the current session — possibly another account — and
    // retrying with its token would send this request's data there (see
    // auth/authEpoch.ts). The stale request simply fails.
    if (response.status === 401 && !isStaleSessionToken(sessionToken)) {
      // Imported lazily (rather than as a static top-level import) so
      // modules that never hit this branch — most test suites exercising
      // this file — never pull in tokenManager's own dependency chain
      // (sessionStorage.ts → expo-secure-store), which needs a native
      // runtime this file has no other reason to require.
      const { refreshAccessToken } = await import('@/auth/tokenManager');
      const refreshedToken = await refreshAccessToken();
      if (refreshedToken && !isStaleSessionToken(sessionToken)) {
        response = await sendRequest(refreshedToken, path, init, timeoutMs);
      }
    }
  } catch {
    throw new SyncApiError("We couldn't reach the backend to sync. Check your connection and try again.");
  }

  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (!response.ok || !payload || !payload.success) {
    throw new SyncApiError(
      payload && !payload.success && typeof payload.message === 'string' ? payload.message : 'Sync failed.',
      response.status,
    );
  }

  return payload.data;
}

export type FavoriteRecord = { verseKey: string; createdAt: string; updatedAt: string };

export function getCloudFavorites(sessionToken: string) {
  return authedRequest<FavoriteRecord[]>(sessionToken, '/api/sync/favorites');
}

export function addCloudFavorites(sessionToken: string, verseKeys: string[]) {
  return authedRequest<FavoriteRecord[]>(sessionToken, '/api/sync/favorites', {
    method: 'PUT',
    body: JSON.stringify({ verseKeys }),
  });
}

export function removeCloudFavorite(sessionToken: string, verseKey: string) {
  return authedRequest<null>(sessionToken, `/api/sync/favorites/${encodeURIComponent(verseKey)}`, { method: 'DELETE' });
}

export type FavoriteActiveRecord = {
  // Optional for symmetry with the tombstone variant — every upload this
  // client makes sets it explicitly (see favoritesSync.ts).
  type?: 'active';
  verseKey: string;
  createdAt: string;
  updatedAt: string;
};

/** A durable local-deletion marker. See storage/favorites.ts's FavoriteTombstone. */
export type FavoriteTombstoneRecord = {
  type: 'tombstone';
  verseKey: string;
  deletedAt: string;
};

export type FavoriteSyncRecord = FavoriteActiveRecord | FavoriteTombstoneRecord;

/** Active favorites + deletion tombstones — unlike getCloudFavorites, this never omits a deletion learned from another device. */
export function getCloudFavoriteSyncRecords(sessionToken: string) {
  return authedRequest<FavoriteSyncRecord[]>(sessionToken, '/api/sync/favorites/sync');
}

export function putCloudFavoriteSyncRecords(sessionToken: string, favorites: FavoriteSyncRecord[]) {
  return authedRequest<{ saved: FavoriteSyncRecord[] }>(sessionToken, '/api/sync/favorites', {
    method: 'PUT',
    body: JSON.stringify({ favorites }),
  });
}

export type PreferencesRecord = {
  locale?: string;
  translationDisplayMode?: 'always' | 'on-demand' | 'off';
  translationId?: string;
  updatedAt: string;
};

export function getCloudPreferences(sessionToken: string) {
  return authedRequest<PreferencesRecord | null>(sessionToken, '/api/sync/preferences');
}

export function putCloudPreferences(sessionToken: string, preferences: Omit<PreferencesRecord, 'updatedAt'> & { updatedAt: string }) {
  return authedRequest<PreferencesRecord>(sessionToken, '/api/sync/preferences', {
    method: 'PUT',
    body: JSON.stringify(preferences),
  });
}

export type ReflectionActiveRecord = {
  // Optional for backward compatibility with cloud responses/records
  // predating deletion tombstones, which never included a `type` field at
  // all — absent/omitted always means 'active'. New uploads always set it
  // explicitly (see reflectionsSync.ts).
  type?: 'active';
  verseKey: string;
  ciphertext: string;
  nonce: string;
  encryptionVersion: number;
  /** Fingerprint of the master key this ciphertext was encrypted under (crypto/reflectionEncryption.ts's masterKeyFingerprint). */
  keyFingerprint?: string;
  createdAt: string;
  updatedAt: string;
};

/** A durable local-deletion marker — carries no ciphertext/nonce/plaintext. See storage/ayahReflections.ts's ReflectionTombstone. */
export type ReflectionTombstoneRecord = {
  type: 'tombstone';
  verseKey: string;
  deletedAt: string;
};

export type ReflectionSyncRecord = ReflectionActiveRecord | ReflectionTombstoneRecord;

export type ReflectionConflict = {
  verseKey: string;
  conflictVersions: { ciphertext: string; nonce: string; encryptionVersion: number; createdAt: string }[];
};

export function getCloudReflections(sessionToken: string) {
  return authedRequest<ReflectionSyncRecord[]>(sessionToken, '/api/sync/reflections');
}

export function putCloudReflections(sessionToken: string, reflections: ReflectionSyncRecord[]) {
  return authedRequest<{ saved: ReflectionSyncRecord[]; conflicts: ReflectionConflict[] }>(
    sessionToken,
    '/api/sync/reflections',
    { method: 'PUT', body: JSON.stringify({ reflections }) },
  );
}

export type SyncKeyRecord = {
  wrappedKey: string;
  nonce: string;
  salt: string;
  kdfIterations: number;
  encryptionVersion: number;
  keyFingerprint?: string;
};

export function getCloudSyncKey(sessionToken: string) {
  return authedRequest<SyncKeyRecord | null>(sessionToken, '/api/sync/key');
}

export function putCloudSyncKey(sessionToken: string, key: SyncKeyRecord) {
  return authedRequest<SyncKeyRecord>(sessionToken, '/api/sync/key', { method: 'PUT', body: JSON.stringify(key) });
}

export function replaceCloudSyncKey(sessionToken: string, expected: SyncKeyRecord, replacement: SyncKeyRecord) {
  return authedRequest<SyncKeyRecord>(sessionToken, '/api/sync/key', {
    method: 'PATCH', body: JSON.stringify({ expected, replacement }),
  });
}

/**
 * Forgotten sync password: deletes this account's sync key and every
 * encrypted reflection record in the cloud — never favorites, preferences,
 * or the account itself. The account is taken only from the session, and
 * the backend also requires `credential`: a fresh ID token from the
 * account's own Apple/Google identity, which it verifies itself (403 if it
 * does not match).
 */
export function resetCloudReflectionSync(sessionToken: string, credential: ProviderCredential) {
  return authedRequest<null>(sessionToken, '/api/sync/reflections/reset', {
    method: 'POST',
    body: JSON.stringify({ provider: credential.provider, idToken: credential.idToken }),
  });
}

/**
 * Permanently deletes the account named by the authenticated session —
 * never a client-supplied userId (see backend/src/controllers/accountController.ts).
 * For an Apple-authenticated account, the backend revokes Apple's
 * authorization before deleting anything; if it has no stored revocation
 * credential yet, it rejects with 428 (SyncApiError.statusCode) and the
 * caller (useAuth.tsx's deleteAccount) must retry this same call with a
 * fresh `credential` (a just-obtained Apple identity token +
 * authorization code). The backend deletes every model it owns (User,
 * every session, favorites, preferences, reflections, sync key, any
 * stored Apple credential) before this resolves; only on success should
 * the caller clear local data.
 */
/**
 * Longer than the default 8s: an Apple account's deletion may make two
 * Apple calls (bounded at 10s each on the backend) before deleting. Giving
 * up earlier could show "failed" while the backend completes the deletion.
 */
export const ACCOUNT_DELETION_TIMEOUT_MS = 30_000;

export function deleteAccountRequest(sessionToken: string, credential?: ProviderCredential): Promise<null> {
  return authedRequest<null>(
    sessionToken,
    '/api/account',
    {
      method: 'DELETE',
      ...(credential
        ? { body: JSON.stringify({ provider: credential.provider, idToken: credential.idToken, authorizationCode: credential.authorizationCode }) }
        : {}),
    },
    ACCOUNT_DELETION_TIMEOUT_MS,
  );
}
