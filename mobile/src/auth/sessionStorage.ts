import * as SecureStore from 'expo-secure-store';

/**
 * Session token and the unwrapped reflection master key are both sensitive
 * enough to warrant Keychain/Keystore-backed storage (expo-secure-store)
 * rather than plain AsyncStorage — unlike locale/favorites/preferences,
 * which are not secrets. See Part B §6 and docs/reflection-privacy.md.
 */
const SESSION_TOKEN_KEY = 'quran-heals:auth-session-token:v1';
// Separate key/value from the access token above (which the multi-device
// auth phase shortened to ~20 minutes) — this is the long-lived opaque
// token used only to obtain a new access token (see auth/tokenManager.ts).
// Absent for a session restored from before this phase shipped; that
// device's existing access token keeps working until it naturally expires,
// it just can't be refreshed (see docs/auth-and-sync/data-behavior.md).
const REFRESH_TOKEN_KEY = 'quran-heals:auth-refresh-token:v1';
const MASTER_KEY_KEY = 'quran-heals:reflection-master-key:v1';

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
