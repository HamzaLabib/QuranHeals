import { afterEach, describe, expect, it, vi } from 'vitest';

const storedRefreshToken = vi.hoisted(() => ({ value: null as string | null }));
const clearedTokens = vi.hoisted(() => ({ count: 0 }));

vi.mock('@/auth/sessionStorage', () => ({
  getRefreshToken: vi.fn(async () => storedRefreshToken.value),
  setRefreshToken: vi.fn(async (token: string) => {
    storedRefreshToken.value = token;
  }),
  clearRefreshToken: vi.fn(async () => {
    storedRefreshToken.value = null;
    clearedTokens.count += 1;
  }),
  setSessionToken: vi.fn(async () => undefined),
  clearSessionToken: vi.fn(async () => {
    clearedTokens.count += 1;
  }),
}));

class FakeAuthApiError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'AuthApiError';
  }
}

const refreshSession = vi.fn();
vi.mock('@/auth/authApi', () => ({
  refreshSession,
  AuthApiError: FakeAuthApiError,
}));

const { refreshAccessToken, registerSessionExpiredHandler } = await import('@/auth/tokenManager');
const { getRefreshToken, setSessionToken, setRefreshToken } = await import('@/auth/sessionStorage');

afterEach(() => {
  storedRefreshToken.value = null;
  clearedTokens.count = 0;
  refreshSession.mockReset();
  registerSessionExpiredHandler(null);
});

describe('refreshAccessToken', () => {
  it('returns null when there is no refresh token stored (guest / never signed in)', async () => {
    expect(await refreshAccessToken()).toBeNull();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('rotates and returns the new access token on success', async () => {
    storedRefreshToken.value = 'old-refresh-token';
    refreshSession.mockResolvedValue({ token: 'new-access-token', refreshToken: 'new-refresh-token' });

    expect(await refreshAccessToken()).toBe('new-access-token');
    expect(storedRefreshToken.value).toBe('new-refresh-token');
  });

  it('collapses concurrent callers into a single /api/auth/refresh call (single-flight)', async () => {
    storedRefreshToken.value = 'old-refresh-token';
    let resolveRefresh: (value: { token: string; refreshToken: string }) => void = () => {};
    refreshSession.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const first = refreshAccessToken();
    const second = refreshAccessToken();
    resolveRefresh({ token: 'shared-token', refreshToken: 'shared-refresh' });

    expect(await first).toBe('shared-token');
    expect(await second).toBe('shared-token');
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('signs the user out (clears tokens, notifies handler) only on a definitive 401 rejection', async () => {
    storedRefreshToken.value = 'revoked-refresh-token';
    refreshSession.mockRejectedValue(new FakeAuthApiError('Session is invalid or has expired.', 401));
    const handler = vi.fn();
    registerSessionExpiredHandler(handler);

    expect(await refreshAccessToken()).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(storedRefreshToken.value).toBeNull();
  });

  it('does not sign the user out on a network-level failure (no AuthApiError/401)', async () => {
    storedRefreshToken.value = 'still-valid-refresh-token';
    refreshSession.mockRejectedValue(new TypeError('Network request failed'));
    const handler = vi.fn();
    registerSessionExpiredHandler(handler);

    expect(await refreshAccessToken()).toBeNull();
    expect(handler).not.toHaveBeenCalled();
    expect(storedRefreshToken.value).toBe('still-valid-refresh-token');
  });

  it('a later call starts a fresh refresh after the previous one finished (not stuck single-flight forever)', async () => {
    storedRefreshToken.value = 'token-1';
    refreshSession.mockResolvedValueOnce({ token: 'access-1', refreshToken: 'token-2' });
    expect(await refreshAccessToken()).toBe('access-1');

    refreshSession.mockResolvedValueOnce({ token: 'access-2', refreshToken: 'token-3' });
    expect(await refreshAccessToken()).toBe('access-2');
    expect(refreshSession).toHaveBeenCalledTimes(2);
  });

  it('clears the shared promise after a failed refresh request', async () => {
    storedRefreshToken.value = 'refresh';
    refreshSession.mockRejectedValueOnce(new Error('Unexpected refresh failure'));
    const first = refreshAccessToken();
    expect(refreshAccessToken()).toBe(first);
    await expect(first).resolves.toBeNull();

    refreshSession.mockResolvedValueOnce({ token: 'recovered', refreshToken: 'rotated' });
    const second = refreshAccessToken();
    expect(second).not.toBe(first);
    await expect(second).resolves.toBe('recovered');
    expect(refreshSession).toHaveBeenCalledTimes(2);
  });

  it('clears the shared promise even when an unexpected storage error rejects it', async () => {
    vi.mocked(getRefreshToken).mockRejectedValueOnce(new Error('Unexpected read failure'));
    const first = refreshAccessToken();
    expect(refreshAccessToken()).toBe(first);
    await expect(first).rejects.toThrow('Unexpected read failure');

    storedRefreshToken.value = 'refresh';
    refreshSession.mockResolvedValueOnce({ token: 'recovered', refreshToken: 'rotated' });
    const second = refreshAccessToken();
    expect(second).not.toBe(first);
    await expect(second).resolves.toBe('recovered');
  });

  it.each(['access', 'refresh'])('clears the shared promise after a %s token write failure', async (write) => {
    storedRefreshToken.value = 'refresh';
    refreshSession.mockResolvedValue({ token: 'access', refreshToken: 'rotated' });
    vi.mocked(write === 'access' ? setSessionToken : setRefreshToken)
      .mockRejectedValueOnce(new Error('Write failure'));
    const first = refreshAccessToken();
    await expect(first).resolves.toBeNull();
    const second = refreshAccessToken();
    expect(second).not.toBe(first);
    await expect(second).resolves.toBe('access');
  });

  it('clears the shared promise if the session-expired callback throws', async () => {
    storedRefreshToken.value = 'revoked';
    refreshSession.mockRejectedValueOnce(new FakeAuthApiError('Revoked', 401));
    registerSessionExpiredHandler(() => { throw new Error('Callback failure'); });
    const first = refreshAccessToken();
    await expect(first).rejects.toThrow('Callback failure');
    expect(storedRefreshToken.value).toBeNull();
    const second = refreshAccessToken();
    expect(second).not.toBe(first);
    await expect(second).resolves.toBeNull();
  });
});
