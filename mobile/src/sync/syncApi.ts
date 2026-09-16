import { apiBaseUrl } from '@/services/apiBase';

export class SyncApiError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'SyncApiError';
  }
}

type ApiEnvelope<T> = { success: true; data: T } | { success: false; message: string };

async function authedRequest<T>(sessionToken: string, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${sessionToken}`,
        ...init.headers,
      },
    });
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

export type ReflectionRecord = {
  verseKey: string;
  ciphertext: string;
  nonce: string;
  encryptionVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type ReflectionConflict = {
  verseKey: string;
  conflictVersions: { ciphertext: string; nonce: string; encryptionVersion: number; createdAt: string }[];
};

export function getCloudReflections(sessionToken: string) {
  return authedRequest<ReflectionRecord[]>(sessionToken, '/api/sync/reflections');
}

export function putCloudReflections(sessionToken: string, reflections: ReflectionRecord[]) {
  return authedRequest<{ saved: ReflectionRecord[]; conflicts: ReflectionConflict[] }>(
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
