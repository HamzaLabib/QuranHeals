import { apiBaseUrl } from '@/services/apiBase';
import type { AuthUser } from './authTypes';

export class AuthApiError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'AuthApiError';
  }
}

type SignInResponse = { token: string; user: AuthUser };

async function postAuth(path: string, idToken: string): Promise<SignInResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ idToken }),
    });
  } catch {
    throw new AuthApiError("We couldn't reach the backend. Check your connection and try again.");
  }

  const payload = (await response.json().catch(() => null)) as
    | { success: true; data: SignInResponse }
    | { success: false; message: string }
    | null;

  if (!response.ok || !payload || !payload.success) {
    throw new AuthApiError(
      payload && !payload.success && typeof payload.message === 'string'
        ? payload.message
        : "We couldn't sign you in. You can try again or continue without an account.",
      response.status,
    );
  }

  return payload.data;
}

export function signInWithGoogleIdToken(idToken: string): Promise<SignInResponse> {
  return postAuth('/api/auth/google', idToken);
}

export function signInWithAppleIdToken(idToken: string): Promise<SignInResponse> {
  return postAuth('/api/auth/apple', idToken);
}

export async function fetchCurrentUser(sessionToken: string): Promise<AuthUser | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/session`, {
      headers: { Authorization: `Bearer ${sessionToken}`, Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { success: true; data: AuthUser } | { success: false };
    return payload.success ? payload.data : null;
  } catch {
    return null;
  }
}
