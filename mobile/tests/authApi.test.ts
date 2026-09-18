import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const { signInWithGoogleIdToken, signInWithAppleIdToken, fetchCurrentUser, AuthApiError } = await import('@/auth/authApi');

afterEach(() => vi.unstubAllGlobals());

describe('signInWithGoogleIdToken / signInWithAppleIdToken', () => {
  it('posts only the idToken — never any client-chosen identity fields', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/api/auth/google');
      expect(JSON.parse(String(init?.body))).toEqual({ idToken: 'the-token' });
      return new Response(JSON.stringify({ success: true, data: { token: 'session', user: { id: 'u1', provider: 'google', createdAt: '' } } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await signInWithGoogleIdToken('the-token');
    expect(result.token).toBe('session');
    expect(result.user.id).toBe('u1');
  });

  it('surfaces the backend failure message on a rejected sign-in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false, message: 'Google sign-in could not be verified.' }), { status: 401 })),
    );

    await expect(signInWithGoogleIdToken('bad-token')).rejects.toMatchObject({
      message: 'Google sign-in could not be verified.',
    });
  });

  it('falls back to the shared failure copy when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

    await expect(signInWithAppleIdToken('token')).rejects.toBeInstanceOf(AuthApiError);
  });
});

describe('fetchCurrentUser', () => {
  // A three-outcome result (never a bare boolean/null) is the whole point:
  // useAuth.tsx's cold-start restoration must be able to tell "this
  // specific access token was rejected" (worth trying a refresh before
  // giving up) apart from "couldn't even reach the backend" (never proof of
  // anything, must never sign the user out) — see authApi.ts's
  // CurrentUserResult doc comment.
  it('returns { outcome: "invalid" } (never throws) for an explicit 401 — an expired access token, not proof the session itself is bad', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    expect(await fetchCurrentUser('expired')).toEqual({ outcome: 'invalid' });
  });

  it('returns { outcome: "valid", user } for a valid session token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer valid-token');
        return new Response(JSON.stringify({ success: true, data: { id: 'u1', provider: 'apple', createdAt: '' } }), { status: 200 });
      }),
    );

    const result = await fetchCurrentUser('valid-token');
    expect(result.outcome).toBe('valid');
    expect(result).toMatchObject({ outcome: 'valid', user: { id: 'u1' } });
  });

  it('returns { outcome: "unreachable" } (never "invalid") when the request never reaches the backend at all — a network failure is never proof of an invalid credential', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await fetchCurrentUser('any-token')).toEqual({ outcome: 'unreachable' });
  });

  it('returns { outcome: "unreachable" } (never "invalid") for a backend/server-side failure (5xx) — only an explicit 401 means the credential itself is bad', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect(await fetchCurrentUser('any-token')).toEqual({ outcome: 'unreachable' });
  });

  it('returns { outcome: "unreachable" } for a malformed/unsuccessful payload on an otherwise-ok response, rather than treating it as a valid user', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })));
    expect(await fetchCurrentUser('any-token')).toEqual({ outcome: 'unreachable' });
  });
});
