import { fetchCurrentUser } from './authApi';
import type { AuthUser } from './authTypes';
import { clearCachedUser, clearRefreshToken, clearSessionToken, getCachedUser, getRefreshToken, getSessionToken } from './sessionStorage';
import { refreshAccessToken } from './tokenManager';

export type InitializedSession =
  | { status: 'guest'; token: null; user: null; shouldSync: false }
  | { status: 'signed-in'; token: string | null; user: AuthUser | null; shouldSync: boolean };

const guest: InitializedSession = { status: 'guest', token: null, user: null, shouldSync: false };

/** Resolves authentication independently of preference hydration and post-login sync. */
export async function initializeSession(): Promise<InitializedSession> {
  let token: string | null = null;
  let hasRefreshToken = false;
  let invalidSession = false;

  const offlineSession = async (): Promise<InitializedSession> => {
    if (!token && !hasRefreshToken) return guest;
    const user = await getCachedUser().catch(() => null);
    // Without an access token, only a persisted refresh credential plus a
    // cached profile can provide an offline account view.
    if (!token && !user) return guest;
    return { status: 'signed-in', token, user, shouldSync: false };
  };

  try {
    token = await getSessionToken();
    hasRefreshToken = Boolean(await getRefreshToken());
    if (!token && !hasRefreshToken) return guest;

    if (token) {
      const result = await fetchCurrentUser(token);
      if (result.outcome === 'valid') {
        return { status: 'signed-in', token, user: result.user, shouldSync: true };
      }
      if (result.outcome === 'unreachable') return await offlineSession();
    }

    // Also recovers an interrupted write when only the refresh token survived.
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      token = refreshedToken;
      const retryResult = await fetchCurrentUser(refreshedToken);
      if (retryResult.outcome === 'valid') {
        return { status: 'signed-in', token, user: retryResult.user, shouldSync: true };
      }
      if (retryResult.outcome === 'unreachable') return await offlineSession();
      invalidSession = true;
    }

    // Refresh clears its persisted credential only on a definitive rejection.
    hasRefreshToken = Boolean(await getRefreshToken());
    if (!invalidSession && hasRefreshToken) return await offlineSession();

    invalidSession = true;
    await Promise.allSettled([clearSessionToken(), clearRefreshToken(), clearCachedUser()]);
    return guest;
  } catch {
    // Storage/native/API exceptions are not proof of revocation. Preserve a
    // known persisted session, but never revive one already rejected by /me.
    if (invalidSession) return guest;
    // A refresh may have cleared credentials before an unexpected error.
    try {
      token = await getSessionToken();
      hasRefreshToken = Boolean(await getRefreshToken());
    } catch {
      // Keep only the credentials successfully read before the error.
    }
    return offlineSession();
  }
}
