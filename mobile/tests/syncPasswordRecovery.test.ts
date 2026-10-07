import { randomBytes } from 'node:crypto';

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Forgotten sync password recovery, end to end on the device side: the REAL
 * AuthProvider, key manager (real PBKDF2 + XChaCha20-Poly1305), local
 * storage and reflection/favorite sync, against a fake multi-account,
 * multi-device backend that applies the same reset and key-fingerprint
 * rules as backend/src/controllers/syncController.ts. The password sheet is
 * replaced by a stub exposing its handlers, so the test acts as the user
 * (its UI is covered by syncPasswordRecoverySheet.test.ts).
 */

type Device = { storage: Map<string, string>; secure: Map<string, string> };
type Credential = { provider: 'apple' | 'google'; idToken: string };
type SheetProps = {
  request: { mode: 'create' | 'unlock'; verify?: (value: string) => Promise<boolean>; reset?: (credential: Credential) => Promise<void> } | null;
  accountProvider: 'apple' | 'google' | null;
  onSubmit: (passphrase: string) => void;
  onSignOut: () => void;
  onResetComplete: () => void;
  deleteAccount: () => Promise<void>;
  onAccountDeleted: () => void;
};

const env = vi.hoisted(() => ({
  device: { storage: new Map<string, string>(), secure: new Map<string, string>() } as Device,
  sheet: null as SheetProps | null,
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => env.device.secure.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { env.device.secure.set(key, value); }),
  deleteItemAsync: vi.fn(async (key: string) => { env.device.secure.delete(key); }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => env.device.storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { env.device.storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { env.device.storage.delete(key); }),
} }));
vi.mock('@/crypto/randomBytes', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)) }));
vi.mock('@/components/GuestDataSheet', () => ({ GuestDataSheet: () => null }));
vi.mock('@/components/SyncPassphraseSheet', () => ({
  SyncPassphraseSheet: (props: SheetProps) => {
    env.sheet = props;
    return null;
  },
}));
// useAuth.tsx's deleteAccount calls this hook directly now (Phase B4's
// Apple-reauth-on-deletion retry) — stubbed here since this file's fake
// backend's DELETE /api/account always succeeds outright (never 428), so
// the real module (which pulls in expo-apple-authentication /
// expo-auth-session) is never actually needed.
vi.mock('@/auth/reauthentication', () => ({ useFreshProviderCredential: () => async () => null }));
vi.mock('@/localization/useAppLocale', () => ({
  useAppLocale: () => ({ locale: 'ar', setLocale: vi.fn(), isReady: true }),
}));
vi.mock('@/localization/useQuranTranslationPreference', () => ({
  useQuranTranslationPreference: () => ({
    preference: { displayMode: 'off', translationId: 'en.pickthall.gutenberg16955' },
    setDisplayMode: vi.fn(),
    isReady: true,
  }),
}));
function ayah(verseKey: string) {
  const [surahNumber, ayahNumber] = verseKey.split(':').map(Number);
  return {
    id: verseKey, verseKey, referenceKey: verseKey, surahNumber, ayahNumber,
    surahNameArabic: '', surahNameEnglish: 'Surah', arabicText: 'ARABIC',
    englishTranslation: 'translation', emotions: [], quranTextSource: 'Tanzil', translationSource: 'Pickthall',
  };
}
vi.mock('@/services/quran', () => ({ resolveAyahArabic: async (value: { verseKey: string }) => ({ ...value, arabicText: 'ARABIC' }) }));
vi.mock('@/services/api', () => ({ getAyah: async (verseKey: string) => ayah(verseKey) }));

import { AuthProvider, useAuth, type AuthContextValue } from '@/auth/useAuth';
import { registerSessionExpiredHandler } from '@/auth/tokenManager';
import { decodeBase64 } from '@/crypto/base64';
import { decryptReflectionText, unwrapMasterKey } from '@/crypto/reflectionEncryption';
import { addFavorite, getFavorites } from '@/storage/favorites';
import { getAllReflections, saveReflection } from '@/storage/ayahReflections';
import { resetLocalDataOwnerForTests } from '@/storage/localDataOwner';
import { resetPreferencesSyncStateForTests } from '@/sync/preferencesSyncState';

// ---------------------------------------------------------------------------
// Fake backend
// ---------------------------------------------------------------------------

type CloudKey = { wrappedKey: string; nonce: string; salt: string; kdfIterations: number; encryptionVersion: number; keyFingerprint?: string };
type CloudReflection = { type?: string; verseKey: string; ciphertext?: string; nonce?: string; encryptionVersion?: number; keyFingerprint?: string; createdAt?: string; updatedAt?: string; deletedAt?: string };
type CloudAccount = {
  key: CloudKey | null;
  reflections: Map<string, CloudReflection>;
  favorites: Set<string>;
  preferences: Record<string, unknown> | null;
  resets: number;
  deleted: boolean;
};
let cloud: Record<string, CloudAccount>;
/** Fresh Google ID tokens the fake "Google" will verify, by token → subject. */
let googleIdentities: Map<string, string>;

const emptyAccount = (): CloudAccount => ({ key: null, reflections: new Map(), favorites: new Set(), preferences: null, resets: 0, deleted: false });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data, message: 'error' }), { status });
}

async function fakeBackend(url: string, init?: RequestInit): Promise<Response> {
  const path = new URL(url).pathname;
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;

  if (path === '/api/auth/google') {
    const id = String(body.idToken).replace('id-', '');
    cloud[id] ??= emptyAccount();
    cloud[id].deleted = false;
    return json({ token: `access-${id}`, refreshToken: `refresh-${id}`, user: { id, provider: 'google', createdAt: '2026-01-01T00:00:00.000Z' } });
  }
  if (path === '/api/auth/logout') return json(null);
  const header = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
  const user = /^Bearer access-(\w+)$/.exec(header)?.[1];
  if (!user || !cloud[user] || cloud[user].deleted) return json(null, 401);
  const account = cloud[user];

  if (path === '/api/auth/session') return json({ id: user, provider: 'google', createdAt: '2026-01-01T00:00:00.000Z' });
  if (path === '/api/sync/preferences') {
    if (method === 'PUT' && !account.preferences) account.preferences = body;
    return json(account.preferences);
  }
  if (path === '/api/sync/favorites/sync') {
    return json([...account.favorites].map((verseKey) => ({ type: 'active', verseKey, createdAt: 'x', updatedAt: 'x' })));
  }
  if (path === '/api/sync/favorites') {
    if (method === 'PUT' && 'verseKeys' in body) for (const verseKey of body.verseKeys as string[]) account.favorites.add(verseKey);
    if (method === 'PUT' && 'favorites' in body) {
      for (const record of body.favorites as { type: string; verseKey: string }[]) {
        if (record.type === 'tombstone') account.favorites.delete(record.verseKey);
        else account.favorites.add(record.verseKey);
      }
    }
    return json([...account.favorites].map((verseKey) => ({ verseKey, createdAt: 'x', updatedAt: 'x' })));
  }
  if (path === '/api/sync/key') {
    if (method === 'GET') return json(account.key);
    if (method === 'PUT') {
      if (account.key) return json(null, 409);
      account.key = body;
      if (body.keyFingerprint) {
        for (const [verseKey, record] of account.reflections) {
          if (record.type !== 'tombstone' && record.keyFingerprint !== body.keyFingerprint) account.reflections.delete(verseKey);
        }
      }
      return json(account.key);
    }
  }
  if (path === '/api/sync/reflections/reset' && method === 'POST') {
    // Mirrors backend/src/auth/providerReauthentication.ts: every account
    // here is a Google account whose subject is its id; the fresh token must
    // be a Google token for exactly that subject.
    const subject = body?.provider === 'google' ? googleIdentities.get(body.idToken) : undefined;
    if (subject !== user) return json(null, 403);
    account.key = null;
    account.reflections.clear();
    account.resets += 1;
    return json(null);
  }
  if (path === '/api/sync/reflections') {
    if (method === 'PUT') {
      const fingerprint = account.key?.keyFingerprint;
      if (fingerprint && body.reflections.some((r: CloudReflection) => r.type !== 'tombstone' && r.keyFingerprint !== fingerprint)) {
        return json(null, 409);
      }
      for (const record of body.reflections) account.reflections.set(record.verseKey, record);
      return json({ saved: body.reflections, conflicts: [] });
    }
    return json([...account.reflections.values()]);
  }
  if (path === '/api/account' && method === 'DELETE') {
    cloud[user] = { ...emptyAccount(), deleted: true };
    return json(null);
  }
  return json(null, 404);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let root: ReactTestRenderer | undefined;
let account: AuthContextValue;

function Probe() {
  account = useAuth();
  return null;
}

async function settle(rounds = 40) {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Waits for real KDF work (PBKDF2) to finish as well as ordinary promise chains. */
async function settleUntil(condition: () => boolean, label: string) {
  for (let i = 0; i < 400; i += 1) {
    if (condition()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

function newDevice(): Device {
  return { storage: new Map(), secure: new Map() };
}

async function launchOn(device: Device) {
  if (root) await closeApp();
  env.device = device;
  env.sheet = null;
  resetLocalDataOwnerForTests();
  resetPreferencesSyncStateForTests();
  await act(async () => { root = create(createElement(AuthProvider, null, createElement(Probe))); });
  await settle();
}

async function closeApp() {
  await settle();
  await act(async () => { root?.unmount(); });
  root = undefined;
  registerSessionExpiredHandler(null);
}

const prompt = () => env.sheet?.request ?? null;

async function signIn(user: string) {
  // Not awaited: the sign-in's sync waits on the password sheet.
  await act(async () => { void account.signInWithGoogleIdToken(`id-${user}`); });
  await settleUntil(() => account.status === 'signed-in' && prompt() !== null, `password prompt for ${user}`);
}

async function submitPassword(password: string) {
  const request = prompt()!;
  await act(async () => { env.sheet!.onSubmit(password); });
  await settleUntil(() => prompt() === null || prompt() !== request, 'password accepted');
  await settle();
}

/** Signs in on the current device and creates (or unlocks) the account's sync key. */
async function signInAndUnlock(user: string, password: string) {
  await signIn(user);
  await submitPassword(password);
  await settleUntil(() => !!cachedKey(), 'master key cached');
}

/** The master key this device holds for its signed-in account (from SecureStore). */
function cachedKey(): Uint8Array | null {
  const raw = env.device.secure.get('quran-heals.reflection-master-key.v1');
  return raw ? decodeBase64((JSON.parse(raw) as { key: string }).key) : null;
}

function decryptCloud(user: string, key: Uint8Array): string[] {
  return [...cloud[user].reflections.values()]
    .filter((record) => record.type !== 'tombstone')
    .map((record) => decryptReflectionText(record as { ciphertext: string; nonce: string; encryptionVersion: number }, key));
}

/** A fresh Google ID token that verifies as `subject` (as a real Google re-authentication would return). */
function freshGoogleCredential(subject: string): Credential {
  const idToken = `fresh-google-${subject}-${googleIdentities.size}`;
  googleIdentities.set(idToken, subject);
  return { provider: 'google', idToken };
}

async function forgotPasswordReset(subject: string) {
  const request = prompt()!;
  expect(request.mode).toBe('unlock');
  expect(env.sheet!.accountProvider).toBe('google'); // the account's own provider is the one asked for
  await act(async () => {
    await request.reset!(freshGoogleCredential(subject));
    env.sheet!.onResetComplete();
  });
  await settleUntil(() => prompt()?.mode === 'create', 'new password prompt');
}

beforeEach(() => {
  cloud = {};
  googleIdentities = new Map();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(fakeBackend));
});

afterEach(async () => {
  await closeApp();
  vi.unstubAllGlobals();
});

/** Device 1 sets up sync for `user` and stores `cloudOnlyText` in the cloud only. Returns device 1 and its key. */
async function accountWithCloudReflection(user: string, cloudOnlyText: string) {
  const deviceOne = newDevice();
  await launchOn(deviceOne);
  await signInAndUnlock(user, 'original password');
  await saveReflection('20:1', cloudOnlyText);
  await act(async () => { await account.refreshSync(); });
  await settle();
  expect(decryptCloud(user, cachedKey()!)).toEqual([cloudOnlyText]);
  return { deviceOne, oldKey: cachedKey()! };
}

// ---------------------------------------------------------------------------

describe('Test A/B — the existing unlock flow is unchanged', { timeout: 60_000 }, () => {
  it('A: the correct password on a new device unlocks the key and decrypts synced reflections', async () => {
    await accountWithCloudReflection('A', 'my private reflection');

    await launchOn(newDevice());
    await signIn('A');
    expect(prompt()!.mode).toBe('unlock');
    expect(await prompt()!.verify!('original password')).toBe(true);
    await submitPassword('original password');
    await settleUntil(() => !!cachedKey(), 'unlocked');
    await settle();

    expect((await getAllReflections('A')).map((r) => r.text)).toEqual(['my private reflection']);
  });

  it('B: a wrong password is rejected and unlocks nothing', async () => {
    await accountWithCloudReflection('A', 'my private reflection');

    await launchOn(newDevice());
    await signIn('A');
    expect(await prompt()!.verify!('wrong password')).toBe(false);
    await act(async () => { env.sheet!.onSubmit('wrong password'); }); // the sheet never allows this; the key manager refuses it anyway
    await settle();
    await settleUntil(() => prompt() === null, 'sync ended');

    expect(cachedKey()).toBeNull();
    expect(await getAllReflections('A')).toEqual([]);
    expect(cloud.A.resets).toBe(0);
    expect(cloud.A.key).not.toBeNull();
  });
});

describe('Forgot Password → reset encrypted reflection sync', { timeout: 60_000 }, () => {
  it('C/D/E/F/G: reset removes the cloud key and cloud-only reflections, keeps this device\'s readable reflections (re-encrypted under a NEW key), favorites and preferences', async () => {
    const { oldKey } = await accountWithCloudReflection('A', 'cloud-only reflection');
    await addFavorite(ayah('2:255'));
    await act(async () => { await account.refreshSync(); });
    await settle();
    const preferencesBefore = cloud.A.preferences;
    const oldFingerprint = cloud.A.key!.keyFingerprint;
    expect(oldFingerprint).toBeTruthy();

    // A new device: the user writes a reflection locally, then cannot remember the password.
    const deviceTwo = newDevice();
    deviceTwo.storage.set('quran-heals:app-locale:v1', 'ar');
    await launchOn(deviceTwo);
    await signIn('A');
    await saveReflection('30:1', 'written on this device');
    await forgotPasswordReset('A');

    // C: the cloud key and every cloud reflection are gone; a NEW password is requested.
    expect(cloud.A.resets).toBe(1);
    expect(cloud.A.key).toBeNull();
    expect(cloud.A.reflections.size).toBe(0);

    await submitPassword('new password');
    await settleUntil(() => !!cachedKey() && cloud.A.reflections.size > 0, 'new key and upload');
    await settle();

    // A brand-new master key, never the old one.
    const newKey = cachedKey()!;
    expect(Array.from(newKey)).not.toEqual(Array.from(oldKey));
    expect(cloud.A.key!.keyFingerprint).not.toBe(oldFingerprint);

    // D: the readable local reflection is kept and synced under the new key only.
    expect((await getAllReflections('A')).map((r) => r.text)).toEqual(['written on this device']);
    expect(decryptCloud('A', newKey)).toEqual(['written on this device']);
    expect(() => decryptCloud('A', oldKey)).toThrow();

    // E: the cloud-only reflection is gone, here and in the cloud.
    expect((await getAllReflections('A')).map((r) => r.text)).not.toContain('cloud-only reflection');

    // F: favorites survive (cloud and this device).
    expect(cloud.A.favorites).toEqual(new Set(['2:255']));
    expect((await getFavorites('A')).map((f) => f.verseKey)).toEqual(['2:255']);

    // G: preferences survive (cloud and local).
    expect(cloud.A.preferences).toEqual(preferencesBefore);
    expect(deviceTwo.storage.get('quran-heals:app-locale:v1')).toBe('ar');
  });

  it('E: a second device still holding the OLD key cannot bring old ciphertext back — it is asked to unlock the new key instead', async () => {
    const { deviceOne, oldKey } = await accountWithCloudReflection('A', 'cloud-only reflection');

    // Device two resets and sets a new password.
    await launchOn(newDevice());
    await signIn('A');
    await forgotPasswordReset('A');
    await submitPassword('new password');
    await settleUntil(() => !!cachedKey(), 'new key');
    await settle();
    expect(cloud.A.reflections.size).toBe(0);

    // Device one comes back online with the old key cached and its local copy of the old reflection.
    await launchOn(deviceOne);
    await settleUntil(() => prompt()?.mode === 'unlock', 'device one asked to unlock the new key');

    expect(cloud.A.reflections.size).toBe(0); // nothing uploaded under the old key
    expect(deviceOne.secure.has('quran-heals.reflection-master-key.v1')).toBe(false); // old key discarded
    expect(oldKey).toBeTruthy();

    // An app version that does not check (no fingerprint) is refused by the backend.
    const stale = await fetch('http://localhost:4000/api/sync/reflections', {
      method: 'PUT',
      headers: { Authorization: 'Bearer access-A', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reflections: [{ verseKey: '20:1', ciphertext: 'old', nonce: 'old', encryptionVersion: 1, createdAt: 'x', updatedAt: 'x' }] }),
    });
    expect(stale.status).toBe(409);
    expect(cloud.A.reflections.size).toBe(0);
  });

  it('J: running the reset twice is safe', async () => {
    await accountWithCloudReflection('A', 'cloud-only reflection');
    await launchOn(newDevice());
    await signIn('A');

    await act(async () => {
      await prompt()!.reset!(freshGoogleCredential('A'));
      await prompt()!.reset!(freshGoogleCredential('A'));
      env.sheet!.onResetComplete();
    });
    await settleUntil(() => prompt()?.mode === 'create', 'new password prompt');

    expect(cloud.A.resets).toBe(2);
    await submitPassword('new password');
    await settleUntil(() => !!cachedKey(), 'new key');
    expect(cloud.A.key).not.toBeNull();
  });

  it('K: resetting while signed in as B never touches A', async () => {
    await accountWithCloudReflection('A', 'A private');
    const aKey = cloud.A.key;
    await closeApp();
    await accountWithCloudReflection('B', 'B private');

    await launchOn(newDevice());
    await signIn('B');
    await forgotPasswordReset('B');

    expect(cloud.B.key).toBeNull();
    expect(cloud.A.key).toEqual(aKey);
    expect(cloud.A.reflections.size).toBe(1);
    expect(cloud.A.resets).toBe(0);
  });
});

describe('Test H/I — the password step is never a dead end', { timeout: 60_000 }, () => {
  it('H: account deletion is reachable and completes without the password', async () => {
    await accountWithCloudReflection('A', 'cloud-only reflection');
    await launchOn(newDevice());
    await signIn('A');

    await act(async () => {
      await env.sheet!.deleteAccount();
      env.sheet!.onAccountDeleted();
    });
    await settle();

    expect(cloud.A.deleted).toBe(true);
    expect(account.status).toBe('guest');
    expect(prompt()).toBeNull();
  });

  it('I: sign out is reachable without the password, and changes nothing in the cloud', async () => {
    await accountWithCloudReflection('A', 'cloud-only reflection');
    await launchOn(newDevice());
    await signIn('A');

    await act(async () => { env.sheet!.onSignOut(); });
    await settle();

    expect(account.status).toBe('guest');
    expect(prompt()).toBeNull();
    expect(cloud.A.key).not.toBeNull();
    expect(cloud.A.reflections.size).toBe(1);
  });
});

describe('fresh re-authentication guards the reset', { timeout: 60_000 }, () => {
  it('13: a re-authentication that does not match the account resets nothing — cloud key, reflections and favorites untouched; the user can retry', async () => {
    await accountWithCloudReflection('A', 'cloud-only reflection');
    await addFavorite(ayah('2:255'));
    await act(async () => { await account.refreshSync(); });
    await settle();
    const keyBefore = cloud.A.key;

    await launchOn(newDevice());
    await signIn('A');
    const request = prompt()!;

    // Someone else's Google account, then a made-up token.
    for (const credential of [freshGoogleCredential('someone-else'), { provider: 'google' as const, idToken: 'forged' }]) {
      let failure: unknown;
      await act(async () => { failure = await request.reset!(credential).catch((error: unknown) => error); });
      expect(failure).toMatchObject({ statusCode: 403 });
    }

    expect(cloud.A.resets).toBe(0);
    expect(cloud.A.key).toEqual(keyBefore);
    expect(cloud.A.reflections.size).toBe(1);
    expect(cloud.A.favorites).toEqual(new Set(['2:255']));
    expect(prompt()).toBe(request); // still at the unlock step; nothing advanced
    expect(env.device.secure.has('quran-heals.reflection-master-key.v1')).toBe(false);

    // 14: the correct identity then performs the existing reset.
    await forgotPasswordReset('A');
    expect(cloud.A.resets).toBe(1);
    expect(cloud.A.key).toBeNull();
    expect(cloud.A.favorites).toEqual(new Set(['2:255']));
  });
});

// ---------------------------------------------------------------------------
// Set Password must not come back after the user already set it
// ---------------------------------------------------------------------------

/** The next PUT /api/sync/key fails the way a real network can: 'lost' = the server saved it but the answer never arrived; 'unsent' = it never reached the server. */
function failNextKeyStore(how: 'lost' | 'unsent') {
  let pending = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (pending && new URL(url).pathname === '/api/sync/key' && init?.method === 'PUT') {
      pending = false;
      if (how === 'lost') await fakeBackend(url, init);
      throw new TypeError('Network request failed');
    }
    return fakeBackend(url, init);
  }));
}

/** Every password sheet the app opened, in order. */
function sheetsShown(): string[] {
  return shownSheets;
}
let shownSheets: string[] = [];
let lastRequest: unknown = null;
function recordSheet() {
  const request = prompt();
  if (request && request !== lastRequest) shownSheets.push(request.mode);
  lastRequest = request;
}

async function syncAgain() {
  await act(async () => { void account.refreshSync(); });
  for (let i = 0; i < 60; i += 1) {
    recordSheet();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  recordSheet();
}

describe('Set Password appears once and stays closed', { timeout: 60_000 }, () => {
  beforeEach(() => {
    shownSheets = [];
    lastRequest = null;
  });

  it('a store whose answer was lost (the server saved the key): later syncs use that key — no Set Password, no Enter Password', async () => {
    await launchOn(newDevice());
    await signIn('A');
    recordSheet();
    failNextKeyStore('lost');
    await submitPassword('first password');
    const savedFingerprint = cloud.A.key?.keyFingerprint;
    expect(savedFingerprint).toBeTruthy();

    await syncAgain();
    await syncAgain();

    expect(sheetsShown()).toEqual(['create']);
    expect(cloud.A.key?.keyFingerprint).toBe(savedFingerprint);
    expect(cachedKey()).not.toBeNull();
  });

  it('a store that never reached the server: the next sync stores the SAME key without asking again', async () => {
    await launchOn(newDevice());
    await signIn('A');
    recordSheet();
    failNextKeyStore('unsent');
    await submitPassword('first password');
    expect(cloud.A.key).toBeNull();

    await syncAgain();
    await syncAgain();

    expect(sheetsShown()).toEqual(['create']);
    expect(cloud.A.key).not.toBeNull();
    // The key stored is the one wrapped under the password the user set.
    await closeApp();
    const otherDevice = newDevice();
    await launchOn(otherDevice);
    await signIn('A');
    expect(prompt()?.mode).toBe('unlock');
    expect(await prompt()!.verify!('first password')).toBe(true);
  });

  it('after Forgot Password, a failed store of the new key does not bring Set Password back', async () => {
    await accountWithCloudReflection('A', 'old cloud reflection');
    await launchOn(newDevice());
    await signIn('A');
    recordSheet();
    await forgotPasswordReset('A');
    recordSheet();
    failNextKeyStore('unsent');
    await submitPassword('new password');

    await syncAgain();
    await syncAgain();

    expect(sheetsShown()).toEqual(['unlock', 'create']);
    expect(cloud.A.key).not.toBeNull();
    expect(cachedKey()).not.toBeNull();
  });
});

describe('Set Password across syncs, sessions, accounts and restarts', { timeout: 60_000 }, () => {
  beforeEach(() => {
    shownSheets = [];
    lastRequest = null;
  });

  it('opens once, closes on success, and the syncs right after (and later) never reopen it; data stays readable', async () => {
    await launchOn(newDevice());
    await signIn('A');
    recordSheet();
    await submitPassword('my password');
    expect(prompt()).toBeNull();
    await addFavorite(ayah('30:1'));
    await saveReflection('30:2', 'written after setup');

    await syncAgain();
    await syncAgain();
    await syncAgain();

    expect(sheetsShown()).toEqual(['create']);
    expect(cloud.A.favorites).toEqual(new Set(['30:1']));
    expect(decryptCloud('A', cachedKey()!)).toEqual(['written after setup']);
  });

  it('Account 1 set → sign out → Account 2 set on its own → Account 1 back: Enter Password with its own key', async () => {
    await launchOn(newDevice());
    await signIn('A');
    recordSheet();
    await submitPassword('password of A');
    const keyA = cachedKey()!;
    const cloudKeyA = cloud.A.key;
    await act(async () => { await account.signOut(); });
    await settle();

    await signIn('B');
    recordSheet();
    await submitPassword('password of B');
    const keyB = cachedKey()!;
    await act(async () => { await account.signOut(); });
    await settle();

    await signIn('A');
    recordSheet();
    expect(prompt()?.mode).toBe('unlock');
    await submitPassword('password of A');

    expect(sheetsShown()).toEqual(['create', 'create', 'unlock']);
    expect(Array.from(cachedKey()!)).toEqual(Array.from(keyA));
    expect(Array.from(keyA)).not.toEqual(Array.from(keyB));
    expect(cloud.A.key).toBe(cloudKeyA);
  });

  it("an unfinished setup of Account 1 is dropped at sign-out: never sent with Account 2's session", async () => {
    await launchOn(newDevice());
    await signIn('A');
    failNextKeyStore('unsent');
    await submitPassword('password of A');
    expect(cloud.A.key).toBeNull();
    vi.stubGlobal('fetch', vi.fn(fakeBackend));
    await act(async () => { await account.signOut(); });
    await settle();

    await signIn('B');
    recordSheet();
    await submitPassword('password of B');

    expect(sheetsShown()).toEqual(['create']);
    expect(cloud.A.key).toBeNull();
    // B's stored key opens with B's password only.
    const unwrapped = await unwrapMasterKey(cloud.B.key!, 'password of B');
    expect(Array.from(unwrapped)).toEqual(Array.from(cachedKey()!));
  });

  it('restarting the app after setup, or restoring the session on a device without the cached key, never shows Set Password', async () => {
    const device = newDevice();
    await launchOn(device);
    await signIn('A');
    await submitPassword('my password');
    await settleUntil(() => !!cachedKey(), 'key cached');

    await launchOn(device); // restart
    await syncAgain();
    expect(prompt()).toBeNull();

    device.secure.delete('quran-heals.reflection-master-key.v1'); // e.g. a restored keychain without it
    await launchOn(device);
    await settleUntil(() => prompt() !== null, 'password prompt');
    expect(prompt()?.mode).toBe('unlock');
  });
});
