import { AuthApiError, refreshSession } from './authApi';
import { clearRefreshToken, clearSessionToken, getRefreshToken, setRefreshToken, setSessionToken } from './sessionStorage';

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
  const currentRefreshToken = await getRefreshToken();
  if (!currentRefreshToken) return null;

  try {
    const { token, refreshToken } = await requestRotation(currentRefreshToken);
    // Refresh token first: if the app is killed between these two writes,
    // the device keeps the NEW refresh token (and an expired access token,
    // which simply refreshes again) rather than the superseded one.
    await setRefreshToken(refreshToken);
    await setSessionToken(token);
    return token;
  } catch (error) {
    // Only a definitive rejection from the backend (invalid/expired/revoked
    // refresh token — always a 401 from POST /api/auth/refresh) should sign
    // the user out. A network failure reaching the backend at all must
    // never sign the user out (Part 4: "Do not sign the user out because of
    // a temporary network error") — the caller just keeps failing until
    // connectivity returns, exactly like any other request would.
    if (error instanceof AuthApiError && error.statusCode === 401) {
      await clearSessionToken();
      await clearRefreshToken();
      sessionExpiredHandler?.();
    }
    return null;
  }
}

/** Returns a fresh access token, or null if refresh isn't possible right now (no refresh token stored, offline, or the session was genuinely revoked). */
export function refreshAccessToken(): Promise<string | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = performRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}
