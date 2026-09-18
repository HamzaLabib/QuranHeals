import { apiBaseUrl } from '@/services/apiBase';
import { fetchWithTimeout } from '@/services/fetchWithTimeout';
import type { AuthUser } from './authTypes';

export class AuthApiError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'AuthApiError';
  }
}

// `refreshToken` is optional only in the type sense that a pre-multi-device
// backend theoretically wouldn't send one — this app's own backend always
// does. See sessionStorage.ts's REFRESH_TOKEN_KEY doc comment for the one
// case an already-signed-in device won't have one (a session restored from
// before this phase shipped).
type SignInResponse = { token: string; refreshToken?: string; user: AuthUser };
type RefreshResponse = { token: string; refreshToken: string };

async function postJson<T>(path: string, body: unknown, fallbackMessage: string): Promise<T> {
  let response: Response;
  try {
    // Bounded the same way as every other network layer in this app (see
    // fetchWithTimeout's doc comment) — refreshSession() below is reachable
    // mid-sync (authedRequest's 401 retry, itself part of refreshSync()), so
    // a hung refresh call must not be able to leave that stuck forever
    // either.
    response = await fetchWithTimeout(`${apiBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthApiError("We couldn't reach the backend. Check your connection and try again.");
  }

  const payload = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; message: string }
    | null;

  if (!response.ok || !payload || !payload.success) {
    throw new AuthApiError(
      payload && !payload.success && typeof payload.message === 'string' ? payload.message : fallbackMessage,
      response.status,
    );
  }

  return payload.data;
}

const SIGN_IN_FAILED_MESSAGE = "We couldn't sign you in. You can try again or continue without an account.";

export function signInWithGoogleIdToken(idToken: string): Promise<SignInResponse> {
  return postJson('/api/auth/google', { idToken }, SIGN_IN_FAILED_MESSAGE);
}

export function signInWithAppleIdToken(idToken: string): Promise<SignInResponse> {
  return postJson('/api/auth/apple', { idToken }, SIGN_IN_FAILED_MESSAGE);
}

/** Rotates this device's refresh token and returns a new access token — see auth/tokenManager.ts, the only caller. Never affects any other device's session. */
export function refreshSession(refreshToken: string): Promise<RefreshResponse> {
  return postJson('/api/auth/refresh', { refreshToken }, 'Session refresh failed.');
}

/** Best-effort: revokes only this device's session server-side. Local sign-out proceeds regardless of whether this succeeds (see useAuth.tsx's signOut). */
export async function logoutSession(refreshToken: string): Promise<void> {
  try {
    await postJson('/api/auth/logout', { refreshToken }, 'Logout failed.');
  } catch {
    // Never blocks local sign-out — see doc comment above.
  }
}

export async function fetchCurrentUser(sessionToken: string): Promise<AuthUser | null> {
  try {
    // Same bounded timeout as every other request here — this call gates
    // app-startup session restore (see useAuth.tsx), so a hung request must
    // not be able to leave the app on its initial loading state forever.
    const response = await fetchWithTimeout(`${apiBaseUrl}/api/auth/session`, {
      headers: { Authorization: `Bearer ${sessionToken}`, Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { success: true; data: AuthUser } | { success: false };
    return payload.success ? payload.data : null;
  } catch {
    return null;
  }
}
