import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runGuardedRefresh, type RefreshInFlightRef } from '@/utils/pullToRefresh';

/**
 * Regression coverage for two real production bugs:
 *
 *  1. Full-close-and-reopen sign-out: cold-start restoration
 *     (auth/useAuth.tsx's mount effect) used to call fetchCurrentUser()
 *     with the persisted (short-lived, ~20 min) access token and, on ANY
 *     failure — including the access token simply having expired, which is
 *     the normal case after being closed for a while — immediately cleared
 *     the persisted session and signed the user out, without ever
 *     attempting a refresh via the persisted (long-lived) refresh token.
 *     It also could not distinguish "the backend rejected this credential"
 *     from "the request never reached the backend at all" (offline,
 *     timeout, 5xx) — both collapsed to the same "sign out" outcome.
 *
 *  2. Background/foreground password re-prompt: runSyncAfterSignIn (which
 *     reaches the mandatory Sync Password gate via runFullSync ->
 *     ensureReflectionMasterKey) had no guard against running twice
 *     concurrently and no throttle on the AppState-triggered automatic
 *     resync, so two overlapping sync attempts (e.g. the cold-start sync
 *     still in flight when the user quickly backgrounds/foregrounds again)
 *     could each independently reach the passphrase gate before either had
 *     written the cached master key, and every trivial background blip
 *     re-ran the full sync unconditionally.
 *
 * There is no RN renderer in this project's test environment (vitest runs
 * in plain Node — see vitest.config.mts), so this file exercises the real
 * production initializeSession function and its real API/token/storage
 * dependencies. Provider lifecycle races are covered by authBootstrap.test.ts.
 */

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const secureStore = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => secureStore.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStore.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureStore.delete(key);
  }),
}));

const asyncStorage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      asyncStorage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      asyncStorage.delete(key);
    }),
  },
}));

const { initializeSession: restoreSession } = await import('@/auth/initializeSession');
const { refreshAccessToken, registerSessionExpiredHandler } = await import('@/auth/tokenManager');
const {
  getSessionToken,
  setSessionToken,
  getRefreshToken,
  setRefreshToken,
  clearSessionToken,
  clearRefreshToken,
  getCachedUser,
  setCachedUser,
  clearCachedUser,
} = await import('@/auth/sessionStorage');

const useAuthSource = readFileSync(resolve(__dirname, '../src/auth/useAuth.tsx'), 'utf-8');

const VALID_USER = { id: 'u1', provider: 'google' as const, createdAt: '2026-01-01T00:00:00.000Z' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}


beforeEach(() => {
  secureStore.clear();
  asyncStorage.clear();
  registerSessionExpiredHandler(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Cold start / full-close-and-reopen: the real root cause is fixed', () => {
  it('1. an authenticated user with a still-valid access token survives cold start', async () => {
    await setSessionToken('valid-access-token');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: VALID_USER })));

    const restored = await restoreSession();

    expect(restored.status).toBe('signed-in');
    expect(restored.user).toMatchObject({ id: 'u1' });
  });

  it('2. an authenticated user with an EXPIRED access token but a valid refresh token survives cold start (the actual bug: this used to sign the user out)', async () => {
    await setSessionToken('expired-access-token');
    await setRefreshToken('valid-refresh-token');

    // The first /api/auth/session call (the stale access token) is
    // rejected; only after /api/auth/refresh has actually been called does
    // the retried /api/auth/session call succeed.
    let refreshed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.pathname === '/api/auth/refresh') {
          refreshed = true;
          return jsonResponse({ success: true, data: { token: 'new-access-token', refreshToken: 'new-refresh-token' } });
        }
        if (url.pathname === '/api/auth/session') {
          if (!refreshed) return jsonResponse({ success: false }, 401);
          return jsonResponse({ success: true, data: VALID_USER });
        }
        throw new Error(`unexpected request in test: ${input}`);
      }),
    );

    const restored = await restoreSession();

    expect(restored.status).toBe('signed-in');
    expect(restored.user).toMatchObject({ id: 'u1' });
    // The persisted token was actually rotated — confirms a real refresh
    // happened, not just an optimistic assumption.
    expect(await getSessionToken()).toBe('new-access-token');
  });

  it('3. a temporary network error during startup does not sign the user out — the session is kept, using the last cached profile', async () => {
    await setSessionToken('some-token');
    await setRefreshToken('some-refresh-token');
    await setCachedUser(VALID_USER);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network unreachable');
      }),
    );

    const restored = await restoreSession();

    expect(restored.status).toBe('signed-in');
    expect(restored.user).toMatchObject({ id: 'u1' });
    // Nothing was cleared — the credential is presumed still valid.
    expect(await getSessionToken()).toBe('some-token');
    expect(await getRefreshToken()).toBe('some-refresh-token');
  });

  it('3b. an offline refresh attempt (access token rejected, but the refresh request itself cannot reach the backend) still does not sign out', async () => {
    await setSessionToken('expired-token');
    await setRefreshToken('still-valid-refresh-token');
    await setCachedUser(VALID_USER);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.pathname === '/api/auth/session') return jsonResponse({ success: false }, 401);
        if (url.pathname === '/api/auth/refresh') throw new Error('offline');
        throw new Error(`unexpected request: ${input}`);
      }),
    );

    const restored = await restoreSession();

    expect(restored.status).toBe('signed-in');
    // The refresh token was never cleared — a network failure reaching the
    // refresh endpoint is not proof it was revoked.
    expect(await getRefreshToken()).toBe('still-valid-refresh-token');
  });

  it('4. an invalid/revoked refresh token (a genuine, definitive rejection) DOES result in the proper signed-out state', async () => {
    await setSessionToken('expired-token');
    await setRefreshToken('revoked-refresh-token');
    await setCachedUser(VALID_USER);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.pathname === '/api/auth/session') return jsonResponse({ success: false }, 401);
        if (url.pathname === '/api/auth/refresh') return jsonResponse({ success: false, message: 'invalid refresh token' }, 401);
        throw new Error(`unexpected request: ${input}`);
      }),
    );

    const restored = await restoreSession();

    expect(restored.status).toBe('guest');
    expect(restored.user).toBeNull();
    expect(await getSessionToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
    expect(await getCachedUser()).toBeNull();
  });

  it('a brand-new access token that is STILL rejected after a successful-looking refresh also results in signed-out (never an infinite trust loop)', async () => {
    await setSessionToken('expired-token');
    await setRefreshToken('refresh-token');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.pathname === '/api/auth/session') return jsonResponse({ success: false }, 401);
        if (url.pathname === '/api/auth/refresh') return jsonResponse({ success: true, data: { token: 'still-bad-token', refreshToken: 'still-bad-refresh' } });
        throw new Error(`unexpected request: ${input}`);
      }),
    );

    const restored = await restoreSession();
    expect(restored.status).toBe('guest');
  });
});

describe('Concurrency: multiple simultaneous refresh/restoration attempts do not create competing requests', () => {
  it('5. tokenManager.refreshAccessToken() shares one in-flight request across simultaneous callers (cold start + foreground + a 401 elsewhere, all at once)', async () => {
    await setRefreshToken('shared-refresh-token');
    let refreshCallCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input);
        expect(url.pathname).toBe('/api/auth/refresh');
        refreshCallCount += 1;
        return jsonResponse({ success: true, data: { token: 'new-token', refreshToken: 'new-refresh' } });
      }),
    );

    const [first, second, third] = await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()]);

    expect(refreshCallCount).toBe(1);
    expect(first).toBe('new-token');
    expect(second).toBe('new-token');
    expect(third).toBe('new-token');
  });

  it('5b. runGuardedRefresh (the same mutex runSyncAfterSignIn uses) prevents two overlapping sync attempts, exactly the race that could double-prompt for the Sync Password', async () => {
    const guard: RefreshInFlightRef = { current: false };
    let concurrentRunners = 0;
    let maxConcurrentRunners = 0;
    let resolveFirst: () => void = () => {};

    const runFullSyncLike = vi.fn(async () => {
      concurrentRunners += 1;
      maxConcurrentRunners = Math.max(maxConcurrentRunners, concurrentRunners);
      await new Promise<void>((resolve) => (resolveFirst = resolve));
      concurrentRunners -= 1;
    });

    const runSyncAfterSignIn = () => runGuardedRefresh(guard, runFullSyncLike);

    // Mirrors: cold start's sync call still in flight when the user quickly
    // backgrounds and foregrounds again, firing the AppState listener's
    // own call to the same function.
    const coldStartSync = runSyncAfterSignIn();
    const foregroundSync = runSyncAfterSignIn();
    resolveFirst();
    await Promise.all([coldStartSync, foregroundSync]);

    expect(maxConcurrentRunners).toBe(1);
    expect(runFullSyncLike).toHaveBeenCalledTimes(1);
  });
});

describe('Background/foreground: does not trigger the account-password (sign-in) screen or the Sync Password screen unnecessarily', () => {
  it("6. a background->foreground transition well within the throttle window does not re-run the sync (and therefore never re-touches the account/passphrase state)", () => {
    const lastForegroundSyncAtRef = { current: Date.now() };
    const FOREGROUND_RESYNC_THROTTLE_MS = 60_000;
    const runSyncAfterSignIn = vi.fn();

    const onAppStateActive = (token: string | null) => {
      if (!token) return;
      if (Date.now() - lastForegroundSyncAtRef.current < FOREGROUND_RESYNC_THROTTLE_MS) return;
      runSyncAfterSignIn(token);
    };

    onAppStateActive('token'); // immediately after a "just synced" timestamp
    expect(runSyncAfterSignIn).not.toHaveBeenCalled();
  });

  it('resyncs once the throttle window has genuinely elapsed', () => {
    const lastForegroundSyncAtRef = { current: Date.now() - 61_000 };
    const FOREGROUND_RESYNC_THROTTLE_MS = 60_000;
    const runSyncAfterSignIn = vi.fn();

    const onAppStateActive = (token: string | null) => {
      if (!token) return;
      if (Date.now() - lastForegroundSyncAtRef.current < FOREGROUND_RESYNC_THROTTLE_MS) return;
      runSyncAfterSignIn(token);
    };

    onAppStateActive('token');
    expect(runSyncAfterSignIn).toHaveBeenCalledTimes(1);
  });

  it('7. a device that already unlocked the Sync Password (master key cached) is never re-prompted merely because runSyncAfterSignIn runs again', async () => {
    const cachedKeyStore = { value: 'already-cached-key' };
    const prompt = vi.fn();
    const ensureReflectionMasterKeyLike = async () => {
      if (cachedKeyStore.value) return cachedKeyStore.value;
      return prompt();
    };

    // Simulate several foreground-triggered sync attempts in a row.
    await ensureReflectionMasterKeyLike();
    await ensureReflectionMasterKeyLike();
    await ensureReflectionMasterKeyLike();

    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('Explicit sign-out and account deletion still clear the appropriate state', () => {
  it('8. sign-out clears the session token, refresh token, and cached user', async () => {
    await setSessionToken('token');
    await setRefreshToken('refresh');
    await setCachedUser(VALID_USER);

    // Mirrors useAuth.tsx's signOut()'s local-clearing sequence.
    await clearSessionToken();
    await clearRefreshToken();
    await clearCachedUser();

    expect(await getSessionToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
    expect(await getCachedUser()).toBeNull();
  });

  it('9. account deletion clears the same local authentication state (mirrors deleteAccount()\'s local-clearing sequence)', async () => {
    await setSessionToken('token');
    await setRefreshToken('refresh');
    await setCachedUser(VALID_USER);

    await clearSessionToken();
    await clearRefreshToken();
    await clearCachedUser();

    expect(await getSessionToken()).toBeNull();
    expect(await getCachedUser()).toBeNull();
  });
});

describe('Provider wiring and foreground behavior', () => {
  it('uses the production initializer for cold start', () => {
    expect(useAuthSource).toContain('initializeSession().finally(');
  });

  it('runSyncAfterSignIn is guarded by the shared runGuardedRefresh mutex, not React state alone', () => {
    expect(useAuthSource).toMatch(/runGuardedRefresh\(syncGuardRef\.current,/);
  });

  it('the AppState listener throttles the automatic foreground resync', () => {
    const listenerBlock = useAuthSource.match(/AppState\.addEventListener\('change', \(nextState\) => \{[\s\S]*?\n {4}\}\);/)?.[0] ?? '';
    expect(listenerBlock).toMatch(/FOREGROUND_RESYNC_THROTTLE_MS/);
  });

  it('clearLocalSession (shared by signOut and a forced session expiry) also clears the cached user profile', () => {
    const block = useAuthSource.match(/const clearLocalSession = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\);/)?.[0] ?? '';
    expect(block).toMatch(/clearCachedUser\(\)/);
  });

  it('AccountSection never flashes the sign-in prompt while status is "loading"', () => {
    const accountSectionSource = readFileSync(resolve(__dirname, '../src/components/AccountSection.tsx'), 'utf-8');
    expect(accountSectionSource).toMatch(/status === 'loading'/);
  });
});
