import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The 16+ account-age declaration sent with sign-in. The backend requires
 * it to create a NEW account and ignores its absence for an existing one.
 * Covers the request body (authApi) and what the REAL AuthProvider does
 * when the backend refuses to create an account (no session, no loop).
 * The gate that decides when the declaration is attached is covered in
 * accountAgeConfirmation.test.ts.
 */

const env = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  storage: new Map<string, string>(),
  requests: [] as { path: string; body: unknown }[],
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => env.secure.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { env.secure.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { env.secure.delete(key); }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => env.storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { env.storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { env.storage.delete(key); }),
} }));
vi.mock('@/components/SyncPassphraseSheet', () => ({ SyncPassphraseSheet: () => null }));
vi.mock('@/components/GuestDataSheet', () => ({ GuestDataSheet: () => null }));
vi.mock('@/auth/reauthentication', () => ({ useFreshProviderCredential: () => async () => null }));
// A refused sign-in never reaches sync; these only keep native modules out of the import graph.
vi.mock('@/crypto/randomBytes', () => ({ getRandomBytes: (n: number) => new Uint8Array(n) }));
vi.mock('@/sync/syncKeyManager', () => ({
  SyncPassphraseCancelledError: class extends Error {},
  discardUnfinishedKeySetup: vi.fn(),
  ensureReflectionMasterKey: vi.fn(),
}));
vi.mock('@/services/quran', () => ({ resolveAyahArabic: vi.fn(), getVerseByKey: vi.fn() }));
vi.mock('@/services/api', () => ({ getAyah: vi.fn() }));
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: 'en', setLocale: vi.fn(), isReady: true }) }));
vi.mock('@/localization/useQuranTranslationPreference', () => ({
  useQuranTranslationPreference: () => ({
    preference: { displayMode: 'always', translationId: 'en.pickthall.gutenberg16955' },
    setDisplayMode: vi.fn(),
    isReady: true,
  }),
}));

import { accountAgeDeclaration, AGE_CONFIRMATION_POLICY_VERSION } from '@/auth/ageConfirmation';
import { signInWithAppleIdToken, signInWithGoogleIdToken } from '@/auth/authApi';
import { resetAuthEpochForTests } from '@/auth/authEpoch';
import { AuthProvider, useAuth, type AuthContextValue } from '@/auth/useAuth';
import { registerSessionExpiredHandler } from '@/auth/tokenManager';
import { resetLocalDataOwnerForTests } from '@/storage/localDataOwner';

const BACKEND_AGE_MESSAGE =
  'To create a Quran Heals account, please update the app to the latest version and confirm that you meet the minimum age requirement.';

function stubBackend(signInStatus: number) {
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    env.requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === '/api/auth/google' || path === '/api/auth/apple') {
      return signInStatus === 403
        ? new Response(JSON.stringify({ success: false, message: BACKEND_AGE_MESSAGE }), { status: 403 })
        : new Response(JSON.stringify({ success: false, message: 'Something went wrong.' }), { status: signInStatus });
    }
    throw new Error(`unexpected request in test: ${path}`);
  }));
}

beforeEach(() => {
  env.secure.clear();
  env.storage.clear();
  env.requests = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('authApi: the declaration is only in the body when it was given', () => {
  it('the declaration is just the current policy version, nothing else', () => {
    expect(accountAgeDeclaration()).toEqual({ policyVersion: AGE_CONFIRMATION_POLICY_VERSION });
    expect(AGE_CONFIRMATION_POLICY_VERSION).toBe(1);
  });

  it('Google: with a declaration → { idToken, accountAgeConfirmation: { policyVersion } } only', async () => {
    stubBackend(403);
    await signInWithGoogleIdToken('g', accountAgeDeclaration()).catch(() => undefined);
    expect(env.requests).toEqual([{ path: '/api/auth/google', body: { idToken: 'g', accountAgeConfirmation: { policyVersion: 1 } } }]);
  });

  it('Apple: with a declaration and a code → all three, nothing else', async () => {
    stubBackend(403);
    await signInWithAppleIdToken('a', 'code', accountAgeDeclaration()).catch(() => undefined);
    expect(env.requests).toEqual([
      { path: '/api/auth/apple', body: { idToken: 'a', authorizationCode: 'code', accountAgeConfirmation: { policyVersion: 1 } } },
    ]);
  });

  it('without a declaration the field is absent (never false, null or a default)', async () => {
    stubBackend(403);
    await signInWithGoogleIdToken('g').catch(() => undefined);
    await signInWithAppleIdToken('a', null, undefined).catch(() => undefined);
    expect(env.requests.map((request) => request.body)).toEqual([{ idToken: 'g' }, { idToken: 'a' }]);
  });

  it('only the policy version is copied from the declaration, whatever else the object holds', async () => {
    stubBackend(403);
    const extra = { policyVersion: 1, confirmedAt: '2026-10-09T00:00:00.000Z', dateOfBirth: 'x' } as never;
    await signInWithGoogleIdToken('g', extra).catch(() => undefined);
    expect(env.requests[0].body).toEqual({ idToken: 'g', accountAgeConfirmation: { policyVersion: 1 } });
  });
});

describe('AuthProvider: a refused new account is handled safely', () => {
  let account: AuthContextValue;
  let root: ReactTestRenderer | undefined;
  function Probe() {
    account = useAuth();
    return null;
  }

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetLocalDataOwnerForTests();
    resetAuthEpochForTests();
    stubBackend(403);
    await act(async () => { root = create(createElement(AuthProvider, null, createElement(Probe))); });
    for (let i = 0; i < 5 && account.status === 'loading'; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  });
  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = undefined;
    registerSessionExpiredHandler(null);
  });

  it.each(['google', 'apple'] as const)('%s: 403 → stays a guest, shows the backend message, stores no session, sends one request', async (provider) => {
    expect(account.status).toBe('guest');

    await act(async () => {
      if (provider === 'google') await account.signInWithGoogleIdToken('id', accountAgeDeclaration());
      else await account.signInWithAppleIdToken('id', 'code', accountAgeDeclaration());
    });

    expect(account.status).toBe('guest');
    expect(account.user).toBeNull();
    expect(account.lastError).toBe(BACKEND_AGE_MESSAGE);
    expect([...env.secure.keys()].filter((key) => /token|session/i.test(key))).toEqual([]);
    // Exactly one sign-in request: no automatic retry, no loop.
    expect(env.requests.filter((request) => request.path.startsWith('/api/auth/'))).toHaveLength(1);
  });

  it('a later attempt is a fresh, user-started request; clearLastError clears the message', async () => {
    await act(async () => { await account.signInWithGoogleIdToken('id'); });
    expect(account.lastError).toBe(BACKEND_AGE_MESSAGE);
    await act(async () => { account.clearLastError(); });
    expect(account.lastError).toBeNull();
    expect(env.requests).toHaveLength(1);
  });
});
