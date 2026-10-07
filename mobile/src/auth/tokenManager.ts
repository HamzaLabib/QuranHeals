import { AuthApiError, refreshSession } from './authApi';
import { currentAuthEpoch, recordSessionToken } from './authEpoch';
import {
  clearCachedMasterKey,
  clearCachedUser,
  clearRefreshToken,
  clearSessionToken,
  getRefreshToken,
  setRefreshToken,
  setSessionToken,
} from './sessionStorage';

/**
 * Every write of the persisted session (sign-in, token rotation, sign-out)
 * runs one at a time, and only while the session it was made for is still
 * current (see authEpoch.ts). So a late rotation or sign-out for Account A
 * can never overwrite or clear Account B's tokens after B signed in.
 */
let sessionWrites: Promise<unknown> = Promise.resolve();
export function writeForEpoch(ofEpoch: number, write: () => Promise<void>): Promise<boolean> {
  const result = sessionWrites.then(async () => {
    if (ofEpoch !== currentAuthEpoch()) return false;
    await write();
    return true;
  });
  sessionWrites = result.catch(() => undefined);
  return result;
}

/** Persists a session's tokens, unless that session is no longer current. Refresh token first — see performRefresh. */
export function persistSessionTokens(ofEpoch: number, token: string, refreshToken?: string): Promise<boolean> {
  return writeForEpoch(ofEpoch, async () => {
    recordSessionToken(token, ofEpoch);
    if (refreshToken) await setRefreshToken(refreshToken);
    await setSessionToken(token);
  });
}

/** Removes the persisted session (tokens, cached profile, cached master key), unless a newer session has started since. */
export function clearPersistedSession(ofEpoch: number): Promise<boolean> {
  return writeForEpoch(ofEpoch, async () => {
    await Promise.allSettled([clearSessionToken(), clearRefreshToken(), clearCachedMasterKey(), clearCachedUser()]);
  });
}

/**
 * Single in-flight refresh at a time: several authenticated requests (e.g.
 * favorites + reflections + preferences during a full sync) can each hit a
 * 401 around the same moment when the access token expires. Without this,
 * each would race its own /api/auth/refresh call — wasteful, and each
 * successful rotation would invalidate the refresh token the others are
 * about to present. Every caller during a refresh shares this one promise
 * instead (Part 4: "single-flight/queued refresh approach").
 */
let inFlightRefresh: Promise<string | null> | null = null;

// Registered by AuthProvider (useAuth.tsx) so a definitively-invalid refresh
// token (the backend rejected it — expired, revoked, reused) signs the user
// out locally. Never invoked for a network-level failure to reach the
// refresh endpoint — see the catch block below.
let sessionExpiredHandler: (() => void) | null = null;

export function registerSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

// The backend accepts the token a lost rotation response superseded for a
// short window after that rotation (backend/src/auth/refreshRotation.ts,
// REFRESH_RETRY_GRACE_MS) and answers it with the same new token. Without a
// prompt retry here, the next refresh attempt could come long after that
// window (the next foreground, or the next app launch) and be treated as
// token reuse, revoking the session.
export const REFRESH_RETRY_DELAY_MS = 1000;

/**
 * Whether the server may have rotated the token even though no usable
 * answer arrived: a transport failure or timeout (no status), a 5xx, or a
 * success status with an unreadable body. A 4xx is a definite answer —
 * the request was rejected without rotating.
 */
function outcomeUnknown(error: unknown): boolean {
  if (!(error instanceof AuthApiError)) return false;
  const status = error.statusCode;
  return status === undefined || status >= 500 || (status >= 200 && status < 300);
}

async function requestRotation(currentRefreshToken: string) {
  try {
    return await refreshSession(currentRefreshToken);
  } catch (error) {
    if (!outcomeUnknown(error)) throw error;
    // Exactly one retry with the SAME token — never a loop.
    await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAY_MS));
    return refreshSession(currentRefreshToken);
  }
}

async function performRefresh(): Promise<string | null> {
  // The session this refresh is for: if a sign-out or another sign-in
  // happens meanwhile, its result is discarded rather than persisted.
  const ofEpoch = currentAuthEpoch();
  const currentRefreshToken = await getRefreshToken();
  if (!currentRefreshToken) return null;

  try {
    const { token, refreshToken } = await requestRotation(currentRefreshToken);
    // Refresh token first: if the app is killed between these two writes,
    // the device keeps the NEW refresh token (and an expired access token,
    // which simply refreshes again) rather than the superseded one.
    return (await persistSessionTokens(ofEpoch, token, refreshToken)) ? token : null;
  } catch (error) {
    if (ofEpoch !== currentAuthEpoch()) return null;
    // Only a definitive rejection from the backend (invalid/expired/revoked
    // refresh token — always a 401 from POST /api/auth/refresh) should sign
    // the user out. A network failure reaching the backend at all must
    // never sign the user out (Part 4: "Do not sign the user out because of
    // a temporary network error") — the caller just keeps failing until
    // connectivity returns, exactly like any other request would.
    if (error instanceof AuthApiError && error.statusCode === 401) {
      // Only the session that was actually rejected is signed out.
      if (await writeForEpoch(ofEpoch, async () => {
        await clearSessionToken();
        await clearRefreshToken();
      })) {
        sessionExpiredHandler?.();
      }
    }
    return null;
  }
}

/** Returns a fresh access token, or null if refresh isn't possible right now (no refresh token stored, offline, the session was genuinely revoked, or the session changed meanwhile). */
export function refreshAccessToken(): Promise<string | null> {
  if (!inFlightRefresh) {
    const refresh = performRefresh().finally(() => {
      if (inFlightRefresh === refresh) inFlightRefresh = null;
    });
    inFlightRefresh = refresh;
  }
  return inFlightRefresh;
}

/** A new session must never share a refresh that an earlier session started (see authEpoch.ts). Called on every sign-in/sign-out. */
export function forgetInFlightRefresh(): void {
  inFlightRefresh = null;
}
