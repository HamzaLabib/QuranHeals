import { createElement, StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  cache: new Map<string, string>(),
  locale: 'en',
  displayMode: 'always',
  setLocale: vi.fn(),
  setDisplayMode: vi.fn(),
  sync: vi.fn(async () => {}),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => native.secure.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { native.secure.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { native.secure.delete(key); }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => native.cache.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { native.cache.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { native.cache.delete(key); }),
} }));
vi.mock('@/localization/useAppLocale', () => ({
  useAppLocale: () => ({ locale: native.locale, setLocale: native.setLocale }),
}));
vi.mock('@/localization/useQuranTranslationPreference', () => ({
  useQuranTranslationPreference: () => ({
    preference: { displayMode: native.displayMode, translationId: 'en.pickthall.gutenberg16955' },
    setDisplayMode: native.setDisplayMode,
  }),
}));
vi.mock('@/components/SyncPassphraseSheet', () => ({ SyncPassphraseSheet: () => null }));
vi.mock('@/sync/syncOrchestrator', () => ({ runFullSync: native.sync }));
vi.mock('@/sync/syncKeyManager', () => ({ SyncPassphraseCancelledError: class extends Error {} }));
vi.mock('@/storage/ayahReflections', () => ({ clearAllReflections: vi.fn() }));
vi.mock('@/storage/favorites', () => ({ clearAllFavorites: vi.fn() }));
vi.mock('@/sync/syncApi', () => ({ deleteAccountRequest: vi.fn() }));

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as authApi from '@/auth/authApi';
import * as initialization from '@/auth/initializeSession';
import * as storage from '@/auth/sessionStorage';
import * as tokens from '@/auth/tokenManager';
import { AuthProvider, useAuth, type AuthContextValue } from '@/auth/useAuth';

const USER = { id: 'user-1', provider: 'google' as const, createdAt: '2026-01-01T00:00:00.000Z' };
let root: ReactTestRenderer | undefined;
let account: AuthContextValue;

function Probe() {
  account = useAuth();
  return null;
}

function tree(strict = false) {
  const provider = createElement(AuthProvider, { children: createElement(Probe) });
  return strict ? createElement(StrictMode, null, provider) : provider;
}

async function mount(strict = false) {
  await act(async () => { root = create(tree(strict)); });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status === 200, data }), { status });
}

async function persistedSession() {
  await storage.setSessionToken('persisted-access');
  await storage.setRefreshToken('persisted-refresh');
  await storage.setCachedUser(USER);
}

beforeEach(() => {
  native.secure.clear();
  native.cache.clear();
  native.locale = 'en';
  native.displayMode = 'always';
  native.sync.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async () => json(USER)));
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  tokens.registerSessionExpiredHandler(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Actual AuthProvider cold-start initialization', () => {
  it('valid access exits loading as signed-in', async () => {
    await persistedSession();
    const initialize = vi.spyOn(initialization, 'initializeSession');
    await mount();
    await expect(initialize.mock.results[0].value).resolves.toMatchObject({ status: 'signed-in', user: USER });
    expect(account.status).toBe('signed-in');
    expect(account.user).toEqual(USER);
  });

  it('expired access refreshes, writes tokens, and retries /me with the new token', async () => {
    await persistedSession();
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(null, 401))
      .mockResolvedValueOnce(json({ token: 'new-access', refreshToken: 'new-refresh' }))
      .mockResolvedValueOnce(json(USER));
    vi.stubGlobal('fetch', fetch);
    await mount();
    expect(account.status).toBe('signed-in');
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname))
      .toEqual(['/api/auth/session', '/api/auth/refresh', '/api/auth/session']);
    expect(fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer new-access');
    expect(await storage.getSessionToken()).toBe('new-access');
    expect(await storage.getRefreshToken()).toBe('new-refresh');
  });

  it('network unreachable preserves the persisted account and exits loading', async () => {
    await persistedSession();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network unreachable')));
    await mount();
    expect(account.status).toBe('signed-in');
    expect(account.user).toEqual(USER);
    expect(native.sync).not.toHaveBeenCalled();
  });

  it('a revoked refresh resolves to guest', async () => {
    await persistedSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(null, 401)));
    await mount();
    expect(account.status).toBe('guest');
    expect(account.user).toBeNull();
    expect(await storage.getSessionToken()).toBeNull();
    expect(await storage.getRefreshToken()).toBeNull();
  });

  it('no credentials resolves to guest without a request', async () => {
    await mount();
    expect(account.status).toBe('guest');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('an unexpected refresh exception resolves initialization and exits loading', async () => {
    await persistedSession();
    vi.spyOn(authApi, 'fetchCurrentUser').mockResolvedValue({ outcome: 'invalid' });
    vi.spyOn(tokens, 'refreshAccessToken').mockRejectedValue(new Error('Unexpected refresh exception'));
    const initialize = vi.spyOn(initialization, 'initializeSession');
    await mount();
    await expect(initialize.mock.results[0].value).resolves.toMatchObject({ status: 'signed-in', shouldSync: false });
    expect(account.status).toBe('signed-in');
  });

  it('an unexpected /me retry exception exits loading with the persisted refreshed session', async () => {
    await persistedSession();
    vi.spyOn(authApi, 'fetchCurrentUser')
      .mockResolvedValueOnce({ outcome: 'invalid' })
      .mockRejectedValueOnce(new Error('Unexpected retry exception'));
    vi.spyOn(authApi, 'refreshSession').mockResolvedValue({ token: 'new-access', refreshToken: 'new-refresh' });
    await mount();
    expect(account.status).toBe('signed-in');
    expect(account.user).toEqual(USER);
    expect(await storage.getSessionToken()).toBe('new-access');
  });

  it.each(['locale', 'translation', 'strict replay'] as const)(
    '%s while /me is pending cannot cancel the only status commit', async (change) => {
      await persistedSession();
      const response = deferred<Response>();
      vi.stubGlobal('fetch', vi.fn(() => response.promise));
      const initialize = vi.spyOn(initialization, 'initializeSession');
      await mount(change === 'strict replay');
      expect(account.status).toBe('loading');
      if (change !== 'strict replay') {
        if (change === 'locale') native.locale = 'ar';
        else native.displayMode = 'off';
        await act(async () => { root!.update(tree()); });
      }
      await act(async () => { response.resolve(json(USER)); });
      expect(account.status).toBe('signed-in');
      expect(initialize).toHaveBeenCalledTimes(1);
      await expect(initialize.mock.results[0].value).resolves.toMatchObject({ status: 'signed-in' });
      expect(native.sync).toHaveBeenCalledTimes(1);
      if (change === 'locale') expect(native.sync.mock.calls[0]).toEqual(expect.arrayContaining([
        expect.objectContaining({ local: expect.objectContaining({ locale: 'ar' }) }),
      ]));
    },
  );

  it('preference hydration during refresh still commits the retried account', async () => {
    await persistedSession();
    const refresh = deferred<{ token: string; refreshToken: string }>();
    vi.spyOn(authApi, 'fetchCurrentUser')
      .mockResolvedValueOnce({ outcome: 'invalid' })
      .mockResolvedValueOnce({ outcome: 'valid', user: USER });
    vi.spyOn(authApi, 'refreshSession').mockReturnValue(refresh.promise);
    await mount();
    native.locale = 'ar';
    await act(async () => { root!.update(tree()); });
    await act(async () => { refresh.resolve({ token: 'new-access', refreshToken: 'new-refresh' }); });
    expect(account.status).toBe('signed-in');
  });

  it('waiting for the sync password does not hold authentication in loading', async () => {
    await persistedSession();
    const sync = deferred<void>();
    native.sync.mockReturnValueOnce(sync.promise);
    await mount();
    expect(account.status).toBe('signed-in');
    await act(async () => { sync.resolve(); });
  });

  it('an interrupted access-token write is recoverable from the refresh token', async () => {
    await storage.setRefreshToken('persisted-refresh');
    vi.spyOn(authApi, 'refreshSession').mockResolvedValue({ token: 'new-access', refreshToken: 'new-refresh' });
    await mount();
    expect(account.status).toBe('signed-in');
  });

  it('corrupt cached JSON cannot strand offline initialization', async () => {
    await persistedSession();
    native.cache.set('quran-heals.auth-cached-user.v1', '{broken');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Offline')));
    await mount();
    expect(account.status).toBe('signed-in');
    expect(account.user).toBeNull();
  });

  it('failed SecureStore reads resolve safely to guest', async () => {
    vi.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('Keychain unavailable'));
    await mount();
    expect(account.status).toBe('guest');
  });

  it('an unexpected cached-user read rejection still exits loading', async () => {
    await persistedSession();
    vi.spyOn(authApi, 'fetchCurrentUser').mockResolvedValue({ outcome: 'unreachable' });
    vi.spyOn(storage, 'getCachedUser').mockRejectedValue(new Error('Unexpected storage failure'));
    await mount();
    expect(account.status).toBe('signed-in');
    expect(account.user).toBeNull();
  });

  it('a refresh access-token write failure exits loading without clearing the session', async () => {
    await persistedSession();
    vi.spyOn(authApi, 'fetchCurrentUser').mockResolvedValue({ outcome: 'invalid' });
    vi.spyOn(authApi, 'refreshSession').mockResolvedValue({ token: 'new-access', refreshToken: 'new-refresh' });
    vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Keychain write failed'));
    await mount();
    expect(account.status).toBe('signed-in');
    expect(await storage.getRefreshToken()).toBe('persisted-refresh');
  });

  it('a failed cached-user write does not delay a confirmed account', async () => {
    await persistedSession();
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('Disk full'));
    await mount();
    expect(account.status).toBe('signed-in');
  });
});
