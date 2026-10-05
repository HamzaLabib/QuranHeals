import { randomBytes } from 'node:crypto';

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression coverage for cross-account local-data upload: local reflections
 * and favorites used to be device-wide, so after Account A signed out and
 * Account B signed in, B's full sync encrypted A's reflections under B's key
 * and uploaded them — and A's favorites — into B's account.
 *
 * Runs the REAL AuthProvider, ownership model, reflection/favorite storage,
 * and reflection/favorite sync (with real XChaCha20-Poly1305 encryption)
 * against a fake multi-account backend. Only the Sync Password prompt is
 * replaced: each account has its own fixed master key, and every key
 * request is recorded with the account it was requested for.
 */

const env = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  storage: new Map<string, string>(),
  keyRequests: [] as string[],
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
vi.mock('@/crypto/randomBytes', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)) }));
vi.mock('@/components/SyncPassphraseSheet', () => ({ SyncPassphraseSheet: () => null }));
vi.mock('@/localization/useAppLocale', () => ({
  useAppLocale: () => ({ locale: 'en', setLocale: vi.fn(), isReady: true }),
}));
vi.mock('@/localization/useQuranTranslationPreference', () => ({
  useQuranTranslationPreference: () => ({
    preference: { displayMode: 'always', translationId: 'en.pickthall.gutenberg16955' },
    setDisplayMode: vi.fn(),
    isReady: true,
  }),
}));
const MASTER_KEYS = vi.hoisted(() => ({
  A: new Uint8Array(32).fill(0xa1),
  B: new Uint8Array(32).fill(0xb2),
} as Record<string, Uint8Array>));
vi.mock('@/sync/syncKeyManager', () => ({
  SyncPassphraseCancelledError: class extends Error {},
  ensureReflectionMasterKey: vi.fn(async (_token: string, _prompt: unknown, ownerUserId: string) => {
    env.keyRequests.push(ownerUserId);
    return MASTER_KEYS[ownerUserId];
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
import * as sessionStorage from '@/auth/sessionStorage';
import { registerSessionExpiredHandler } from '@/auth/tokenManager';
import { decryptReflectionText, encryptReflectionText } from '@/crypto/reflectionEncryption';
import { addFavorite, getFavorites } from '@/storage/favorites';
import { getAllReflections, saveReflection } from '@/storage/ayahReflections';
import { GUEST_FAVORITES_KEY, GUEST_REFLECTIONS_KEY, resetLocalDataOwnerForTests } from '@/storage/localDataOwner';
import { activateLocalDataForAccount } from '@/storage/localDataOwnership';
import { syncReflections } from '@/sync/reflectionsSync';

// ---------------------------------------------------------------------------
// Fake backend: per-account cloud state and a log of every upload.
// ---------------------------------------------------------------------------

type UploadedReflection = { type?: string; verseKey: string; ciphertext?: string; nonce?: string; encryptionVersion?: number; deletedAt?: string };
type CloudAccount = {
  favorites: Set<string>;
  reflections: Map<string, UploadedReflection & { createdAt?: string; updatedAt?: string }>;
  uploadedFavorites: string[];
  uploadedReflections: UploadedReflection[];
  deleted: boolean;
};
let cloud: Record<string, CloudAccount>;

function emptyAccount(): CloudAccount {
  return { favorites: new Set(), reflections: new Map(), uploadedFavorites: [], uploadedReflections: [], deleted: false };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data, message: 'x' }), { status });
}

function accountFor(init?: RequestInit): string | null {
  const header = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
  const match = /^Bearer access-(\w+)$/.exec(header);
  return match && !cloud[match[1]].deleted ? match[1] : null;
}

async function fakeBackend(url: string, init?: RequestInit): Promise<Response> {
  const path = new URL(url).pathname;
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;

  if (path === '/api/auth/google') {
    const id = String(body.idToken).replace('id-', '');
    cloud[id].deleted = false;
    return json({ token: `access-${id}`, refreshToken: `refresh-${id}`, user: { id, provider: 'google', createdAt: '2026-01-01T00:00:00.000Z' } });
  }
  if (path === '/api/auth/logout') return json(null);

  const user = accountFor(init);
  if (path === '/api/auth/session') {
    return user ? json({ id: user, provider: 'google', createdAt: '2026-01-01T00:00:00.000Z' }) : json(null, 401);
  }
  if (!user) return json(null, 401);
  const account = cloud[user];

  if (path === '/api/sync/preferences') return json(method === 'PUT' ? body : null);
  if (path === '/api/sync/favorites') {
    if (method === 'PUT') {
      account.uploadedFavorites.push(...body.verseKeys);
      for (const verseKey of body.verseKeys) account.favorites.add(verseKey);
    }
    return json([...account.favorites].map((verseKey) => ({ verseKey, createdAt: 'x', updatedAt: 'x' })));
  }
  if (path === '/api/sync/reflections') {
    if (method === 'PUT') {
      account.uploadedReflections.push(...body.reflections);
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

/** Decrypts every active reflection ever uploaded to `user` — with THAT account's key; throws if any was encrypted under another key. */
function decryptedUploads(user: string): string[] {
  return cloud[user].uploadedReflections
    .filter((record) => record.type !== 'tombstone')
    .map((record) => decryptReflectionText(record as { ciphertext: string; nonce: string; encryptionVersion: number }, MASTER_KEYS[user]));
}

function uploadedVerseKeys(user: string): string[] {
  return cloud[user].uploadedReflections.map((record) => record.verseKey);
}

// ---------------------------------------------------------------------------
// App harness
// ---------------------------------------------------------------------------

let root: ReactTestRenderer | undefined;
let account: AuthContextValue;

function Probe() {
  account = useAuth();
  return null;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function launchApp() {
  await act(async () => { root = create(createElement(AuthProvider, null, createElement(Probe))); });
  await settle();
}

async function closeApp() {
  await act(async () => { root?.unmount(); });
  root = undefined;
  registerSessionExpiredHandler(null);
  resetLocalDataOwnerForTests();
}

async function signIn(user: 'A' | 'B') {
  await act(async () => { await account.signInWithGoogleIdToken(`id-${user}`); });
  await settle();
  expect(account.status).toBe('signed-in');
  expect(account.user?.id).toBe(user);
}

async function signOut() {
  await act(async () => { await account.signOut(); });
  await settle();
  expect(account.status).toBe('guest');
}

async function sync() {
  await act(async () => { await account.refreshSync(); });
  await settle();
}

beforeEach(() => {
  env.secure.clear();
  env.storage.clear();
  env.keyRequests.length = 0;
  cloud = { A: emptyAccount(), B: emptyAccount() };
  resetLocalDataOwnerForTests();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(fakeBackend));
});

afterEach(async () => {
  await settle();
  await closeApp();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe('Test A — the same account returns', () => {
  it("A's data stays available after sign-out, and syncs only to A when A signs back in", async () => {
    await launchApp();
    await signIn('A');
    await saveReflection('1:1', 'A-private reflection');
    await addFavorite(ayah('1:2'));
    await sync();
    expect(decryptedUploads('A')).toEqual(['A-private reflection']);

    await signOut();
    // Current product behavior: sign-out keeps the account's local data on its device.
    expect((await getAllReflections()).map((r) => r.text)).toEqual(['A-private reflection']);
    await saveReflection('1:3', 'A written while signed out');

    await signIn('A');
    await sync();

    expect(new Set(decryptedUploads('A'))).toEqual(new Set(['A-private reflection', 'A written while signed out']));
    expect(cloud.A.favorites).toEqual(new Set(['1:2']));
    expect(cloud.B.uploadedReflections).toEqual([]);
    expect(cloud.B.uploadedFavorites).toEqual([]);
  });
});

describe('Test B — reflections never cross to a different account', () => {
  it("B's sync never uploads A's reflections (synced or not), and B cannot read them", async () => {
    await launchApp();
    await signIn('A');
    await saveReflection('2:255', 'A-private reflection');
    await sync();
    await saveReflection('2:256', 'A unsynced reflection');
    await signOut();
    await saveReflection('2:257', 'A written while signed out');

    await signIn('B');
    await sync();

    expect(uploadedVerseKeys('B')).toEqual([]);
    expect(await getAllReflections()).toEqual([]);

    await saveReflection('3:3', 'B-private reflection');
    await sync();
    expect(uploadedVerseKeys('B')).toEqual(['3:3']);
    expect(decryptedUploads('B')).toEqual(['B-private reflection']);
    expect(decryptedUploads('A')).not.toContain('B-private reflection');
  });

  it("A's deletion markers are never sent to B either (they would reveal A's verseKeys and could delete B's reflection)", async () => {
    await launchApp();
    await signIn('A');
    await saveReflection('4:4', 'A text');
    await saveReflection('4:4', ''); // A deletes it → local tombstone
    await signOut();

    await signIn('B');
    await sync();

    expect(cloud.B.uploadedReflections).toEqual([]);
  });
});

describe('Test C — favorites never cross to a different account', () => {
  it("B's sync never uploads A's favorites, and B does not see them", async () => {
    await launchApp();
    await signIn('A');
    await addFavorite(ayah('1:5'));
    await sync();
    await signOut();
    await addFavorite(ayah('1:6')); // added while signed out: still A's

    await signIn('B');
    await sync();

    expect(cloud.B.uploadedFavorites).toEqual([]);
    expect(cloud.B.favorites.size).toBe(0);
    expect(await getFavorites()).toEqual([]);
  });
});

describe('Test D — encryption isolation', () => {
  it("A's reflections are never encrypted under B's key nor uploaded to B; B's key is only ever requested for B's own data", async () => {
    await launchApp();
    await signIn('A');
    await saveReflection('5:5', 'A-secret');
    await sync();
    const keyRequestsBeforeB = env.keyRequests.length;
    expect(env.keyRequests.every((owner) => owner === 'A')).toBe(true);

    await signOut();
    await signIn('B');
    await saveReflection('6:6', 'B-secret');
    await sync();

    expect(env.keyRequests.slice(keyRequestsBeforeB).every((owner) => owner === 'B')).toBe(true);
    // Every B upload decrypts with B's key (throws otherwise) and none is A's.
    expect(decryptedUploads('B')).toEqual(['B-secret']);
    // A's ciphertext is not decryptable by B's key and was never sent to B.
    const aCiphertexts = new Set(cloud.A.uploadedReflections.map((record) => record.ciphertext));
    expect(cloud.B.uploadedReflections.some((record) => aCiphertexts.has(record.ciphertext))).toBe(false);
  });

  it("an in-flight sync for A keeps writing only to A's partition if the device switches to B mid-sync", async () => {
    await activateLocalDataForAccount('A', { restored: false });
    // A reflection A wrote on another device, waiting in A's cloud.
    const fromOtherDevice = encryptReflectionText('A from another device', MASTER_KEYS.A, (n) => new Uint8Array(randomBytes(n)));
    cloud.A.reflections.set('7:1', {
      type: 'active', verseKey: '7:1', ...fromOtherDevice,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });

    let releaseGet!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGet = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname === '/api/sync/reflections' && (init?.method ?? 'GET') === 'GET') await gate;
      return fakeBackend(url, init);
    }));
    const syncingA = syncReflections('access-A', MASTER_KEYS.A, 'A');

    await activateLocalDataForAccount('B', { restored: false });
    releaseGet();
    await syncingA;

    expect(await getAllReflections()).toEqual([]); // B (active) never receives A's decrypted reflection
    expect((await getAllReflections('A')).map((r) => r.text)).toEqual(['A from another device']);
  });
});

describe('Test E — guest data (fresh install)', () => {
  it('is adopted by the first account to sign in, and by no other account afterwards', async () => {
    await launchApp();
    await saveReflection('8:1', 'guest reflection');
    await addFavorite(ayah('8:2'));

    await signIn('A');
    await sync();
    expect(decryptedUploads('A')).toEqual(['guest reflection']);
    expect(cloud.A.favorites).toEqual(new Set(['8:2']));
    expect(env.storage.has(GUEST_REFLECTIONS_KEY)).toBe(false);
    expect(env.storage.has(GUEST_FAVORITES_KEY)).toBe(false);

    await signOut();
    await signIn('B');
    await sync();
    expect(cloud.B.uploadedReflections).toEqual([]);
    expect(cloud.B.uploadedFavorites).toEqual([]);
  });
});

describe('Test F — switching A → B → A', () => {
  it('each account sees and syncs only its own data', async () => {
    await launchApp();
    await signIn('A');
    await saveReflection('9:1', 'A one');
    await addFavorite(ayah('9:2'));
    await sync();
    await signOut();

    await signIn('B');
    await saveReflection('9:3', 'B one');
    await addFavorite(ayah('9:4'));
    await sync();
    expect((await getAllReflections()).map((r) => r.text)).toEqual(['B one']);
    await signOut();

    await signIn('A');
    await saveReflection('9:5', 'A two');
    await sync();

    expect((await getAllReflections()).map((r) => r.text).sort()).toEqual(['A one', 'A two']);
    expect((await getFavorites()).map((f) => f.verseKey)).toEqual(['9:2']);
    expect(new Set(decryptedUploads('A'))).toEqual(new Set(['A one', 'A two']));
    expect(decryptedUploads('B')).toEqual(['B one']);
    expect(new Set(cloud.A.uploadedFavorites)).toEqual(new Set(['9:2']));
    expect(new Set(cloud.B.uploadedFavorites)).toEqual(new Set(['9:4']));
  });
});

describe('Test G — account deletion', () => {
  it("A's deleted data cannot be uploaded to B", async () => {
    await launchApp();
    await signIn('A');
    await saveReflection('10:1', 'A before deletion');
    await addFavorite(ayah('10:2'));
    await sync();

    await act(async () => { await account.deleteAccount(); });
    await settle();
    expect(account.status).toBe('guest');
    expect(await getAllReflections()).toEqual([]);

    await signIn('B');
    await sync();
    expect(cloud.B.uploadedReflections).toEqual([]);
    expect(cloud.B.uploadedFavorites).toEqual([]);
    expect([...env.storage.keys()].some((key) => key.endsWith(':account:A'))).toBe(false);
  });
});

describe('Migration of data stored before ownership existed', () => {
  const LEGACY_SYNCED = JSON.stringify({
    '11:1': { verseKey: '11:1', text: 'legacy reflection', createdAt: 1, updatedAt: 1, syncState: 'synced' },
  });
  const LEGACY_GUEST_ONLY = JSON.stringify({
    '11:1': { verseKey: '11:1', text: 'legacy guest reflection', createdAt: 1, updatedAt: 1 },
  });

  it('is kept by the session that was already signed in across the upgrade (it was already syncing all of it to that account)', async () => {
    env.storage.set(GUEST_REFLECTIONS_KEY, LEGACY_SYNCED);
    await sessionStorage.setSessionToken('access-A');
    await sessionStorage.setRefreshToken('refresh-A');

    await launchApp();
    expect(account.user?.id).toBe('A');

    expect((await getAllReflections('A')).map((r) => r.text)).toEqual(['legacy reflection']);
    expect(env.storage.has(GUEST_REFLECTIONS_KEY)).toBe(false);
    expect(decryptedUploads('A')).toEqual(['legacy reflection']);
    expect(cloud.B.uploadedReflections).toEqual([]);
  });

  it('is NOT given to a later sign-in when it shows an account synced it and nobody was signed in at upgrade', async () => {
    env.storage.set(GUEST_REFLECTIONS_KEY, LEGACY_SYNCED);
    env.storage.set(GUEST_FAVORITES_KEY, JSON.stringify([{ ...ayah('11:2'), savedAt: 'x' }]));

    await launchApp();
    await signIn('B');
    await sync();

    expect(cloud.B.uploadedReflections).toEqual([]);
    expect(cloud.B.uploadedFavorites).toEqual([]);
    // Kept, untouched, never deleted.
    expect(env.storage.get(GUEST_REFLECTIONS_KEY)).toBe(LEGACY_SYNCED);
    expect(env.storage.has(GUEST_FAVORITES_KEY)).toBe(true);
  });

  it('is adopted by the first sign-in when it shows no sign of any account (a never-signed-in guest)', async () => {
    env.storage.set(GUEST_REFLECTIONS_KEY, LEGACY_GUEST_ONLY);

    await launchApp();
    await signIn('A');
    await sync();

    expect(decryptedUploads('A')).toEqual(['legacy guest reflection']);
  });
});
