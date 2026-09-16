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
  it('returns null (never throws) for an invalid/expired session token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    expect(await fetchCurrentUser('expired')).toBeNull();
  });

  it('returns the user for a valid session token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer valid-token');
        return new Response(JSON.stringify({ success: true, data: { id: 'u1', provider: 'apple', createdAt: '' } }), { status: 200 });
      }),
    );

    expect(await fetchCurrentUser('valid-token')).toMatchObject({ id: 'u1' });
  });
});
