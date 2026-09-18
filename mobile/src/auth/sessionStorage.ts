import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import type { AuthUser } from './authTypes';

/**
 * Session token and the unwrapped reflection master key are both sensitive
 * enough to warrant Keychain/Keystore-backed storage (expo-secure-store)
 * rather than plain AsyncStorage — unlike locale/favorites/preferences,
 * which are not secrets. See Part B §6 and docs/reflection-privacy.md.
 */
const SESSION_TOKEN_KEY = 'quran-heals.auth-session-token.v1';

// Separate key/value from the access token above (which the multi-device
// auth phase shortened to ~20 minutes) — this is the long-lived opaque
// token used only to obtain a new access token (see auth/tokenManager.ts).
// Absent for a session restored from before this phase shipped; that
// device's existing access token keeps working until it naturally expires,
// it just can't be refreshed (see docs/auth-and-sync/data-behavior.md).
const REFRESH_TOKEN_KEY = 'quran-heals.auth-refresh-token.v1';

const MASTER_KEY_KEY = 'quran-heals.reflection-master-key.v1';

export async function getSessionToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
}

export async function clearSessionToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  } catch {
    // Best-effort: sign-out must never throw and block the UI.
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
}

export async function clearRefreshToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    // Best-effort — see clearSessionToken.
  }
}

/** Base64 of the unwrapped 32-byte reflection master key, cached on this device only after a successful unwrap so the user isn't asked for their Sync Passphrase on every app open. Cleared on sign-out. */
export async function getCachedMasterKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(MASTER_KEY_KEY);
  } catch {
    return null;
  }
}

export async function setCachedMasterKey(masterKeyBase64: string): Promise<void> {
  await SecureStore.setItemAsync(MASTER_KEY_KEY, masterKeyBase64);
}

export async function clearCachedMasterKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(MASTER_KEY_KEY);
  } catch {
    // Best-effort — see clearSessionToken.
  }
}

// Not a secret (id/provider/email/createdAt — nothing SecureStore-worthy),
// so this one deliberately uses AsyncStorage like locale/preferences rather
// than SecureStore, unlike everything else in this file. Kept here anyway
// since it's part of the same auth-restoration lifecycle: a snapshot of the
// last known-good signed-in profile, used ONLY so a fully-offline cold
// start (no network at all — see useAuth.tsx) can still show "signed in"
// instead of flashing guest, while the persisted session/refresh credential
// itself remains the actual source of truth. Always overwritten by a fresh
// fetchCurrentUser() the moment the backend is reachable again; never relied
// upon for anything security-sensitive.
const CACHED_USER_KEY = 'quran-heals.auth-cached-user.v1';

export async function getCachedUser(): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHED_USER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const candidate = parsed as Partial<AuthUser>;
    if (typeof candidate.id !== 'string' || (candidate.provider !== 'apple' && candidate.provider !== 'google')) return null;
    return candidate as AuthUser;
  } catch {
    return null;
  }
}

export async function setCachedUser(user: AuthUser): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  } catch {
    // Best-effort — a failed write only means a future offline cold start
    // won't have a cached profile to show; it never blocks sign-in itself.
  }
}

export async function clearCachedUser(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHED_USER_KEY);
  } catch {
    // Best-effort — see clearSessionToken.
  }
}
