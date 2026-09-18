import { apiBaseUrl } from '@/services/apiBase';
import { fetchWithTimeout } from '@/services/fetchWithTimeout';

export class SyncApiError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'SyncApiError';
  }
}

type ApiEnvelope<T> = { success: true; data: T } | { success: false; message: string };

async function sendRequest(sessionToken: string, path: string, init: RequestInit): Promise<Response> {
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
  });
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
async function authedRequest<T>(sessionToken: string, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await sendRequest(sessionToken, path, init);

    if (response.status === 401) {
      // Imported lazily (rather than as a static top-level import) so
      // modules that never hit this branch — most test suites exercising
      // this file — never pull in tokenManager's own dependency chain
      // (sessionStorage.ts → expo-secure-store), which needs a native
      // runtime this file has no other reason to require.
      const { refreshAccessToken } = await import('@/auth/tokenManager');
      const refreshedToken = await refreshAccessToken();
      if (refreshedToken) {
        response = await sendRequest(refreshedToken, path, init);
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
};

export function getCloudSyncKey(sessionToken: string) {
  return authedRequest<SyncKeyRecord | null>(sessionToken, '/api/sync/key');
}

export function putCloudSyncKey(sessionToken: string, key: SyncKeyRecord) {
  return authedRequest<SyncKeyRecord>(sessionToken, '/api/sync/key', { method: 'PUT', body: JSON.stringify(key) });
}

/**
 * Permanently deletes the account named by the authenticated session —
 * never a client-supplied userId (see backend/src/controllers/accountController.ts).
 * The backend deletes every model it owns (User, every session, favorites,
 * preferences, reflections, sync key) before this resolves; only on success
 * should the caller (useAuth.tsx's deleteAccount) clear local data.
 */
export function deleteAccountRequest(sessionToken: string): Promise<null> {
  return authedRequest<null>(sessionToken, '/api/account', { method: 'DELETE' });
}
