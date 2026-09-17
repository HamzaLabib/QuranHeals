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

async function performRefresh(): Promise<string | null> {
  const currentRefreshToken = await getRefreshToken();
  if (!currentRefreshToken) return null;

  try {
    const { token, refreshToken } = await refreshSession(currentRefreshToken);
    await setSessionToken(token);
    await setRefreshToken(refreshToken);
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
