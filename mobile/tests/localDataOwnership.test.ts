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
  /** How the "Add your local data to this account?" question is answered; 'hold' leaves it open (see heldGuestChoice). */
  guestAnswer: 'keep-separate' as 'add' | 'keep-separate' | 'hold',
  guestPrompts: 0,
  guestSheetVisible: false,
  heldGuestChoice: null as null | ((choice: 'add' | 'keep-separate') => void),
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
// The guest-data question, answered as env.guestAnswer says (each time it opens).
vi.mock('@/components/GuestDataSheet', () => ({
  GuestDataSheet: ({ visible, onChoose }: { visible: boolean; onChoose: (choice: 'add' | 'keep-separate') => void }) => {
    if (visible && !env.guestSheetVisible) {
      env.guestPrompts += 1;
      if (env.guestAnswer === 'hold') env.heldGuestChoice = onChoose;
      else {
        const answer = env.guestAnswer;
        setTimeout(() => onChoose(answer), 0);
      }
    }
    env.guestSheetVisible = visible;
    return null;
  },
}));
// useAuth.tsx's deleteAccount calls this hook directly now (Phase B4's
// Apple-reauth-on-deletion retry) — stubbed here since this file's accounts
// never hit the 428/reauth-required path, and the real module pulls in
// expo-apple-authentication / expo-auth-session.
vi.mock('@/auth/reauthentication', () => ({ useFreshProviderCredential: () => async () => null }));
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
  discardUnfinishedKeySetup: vi.fn(),
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
vi.mock('@/services/quran', () => ({
  resolveAyahArabic: async (value: { verseKey: string }) => ({ ...value, arabicText: 'ARABIC' }),
  getVerseByKey: async (verseKey: string) => {
    const [surah, ayahNumber] = verseKey.split(':').map(Number);
    return { surah, ayah: ayahNumber, arabicText: 'ARABIC' };
  },
}));
vi.mock('@/services/api', () => ({ getAyah: async (verseKey: string) => ayah(verseKey) }));

import { AuthProvider, useAuth, type AuthContextValue } from '@/auth/useAuth';
import { resetAuthEpochForTests } from '@/auth/authEpoch';
import * as sessionStorage from '@/auth/sessionStorage';
import { registerSessionExpiredHandler } from '@/auth/tokenManager';
import { decryptReflectionText, encryptReflectionText } from '@/crypto/reflectionEncryption';
import { useFavorites } from '@/hooks/useFavorites';
import { useReflections } from '@/hooks/useReflections';
import { addFavorite, getFavorites, removeFavorite } from '@/storage/favorites';
import { getAllReflections, saveReflection } from '@/storage/ayahReflections';
import { GUEST_FAVORITES_KEY, GUEST_REFLECTIONS_KEY, resetLocalDataOwnerForTests } from '@/storage/localDataOwner';
import { activateLocalDataForAccount } from '@/storage/localDataOwnership';
import { syncReflections } from '@/sync/reflectionsSync';

// ---------------------------------------------------------------------------
// Fake backend: per-account cloud state and a log of every upload.
// ---------------------------------------------------------------------------

type UploadedReflection = { type?: string; verseKey: string; ciphertext?: string; nonce?: string; encryptionVersion?: number; deletedAt?: string };
type CloudAccount = {
  /** Active verseKeys only — what GET /api/sync/favorites (legacy) returns. */
  favorites: Set<string>;
  /** createdAt/updatedAt per active verseKey, so /api/sync/favorites/sync can hand back real timestamps instead of a placeholder. */
  favoriteTimestamps: Map<string, { createdAt: string; updatedAt: string }>;
  /** verseKey -> deletedAt, for deletion tombstones only tombstone-aware sync (/api/sync/favorites/sync) ever sees. */
  favoriteTombstones: Map<string, string>;
  reflections: Map<string, UploadedReflection & { createdAt?: string; updatedAt?: string }>;
  uploadedFavorites: string[];
  uploadedReflections: UploadedReflection[];
  deleted: boolean;
};
let cloud: Record<string, CloudAccount>;

function emptyAccount(): CloudAccount {
  return {
    favorites: new Set(),
    favoriteTimestamps: new Map(),
    favoriteTombstones: new Map(),
    reflections: new Map(),
    uploadedFavorites: [],
    uploadedReflections: [],
    deleted: false,
  };
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
  if (path === '/api/auth/refresh') {
    // A rotation for whichever account the presented refresh token belongs to.
    const id = String(body.refreshToken).replace('refresh-', '');
    return json({ token: `access-${id}`, refreshToken: `refresh-${id}` });
  }

  const user = accountFor(init);
  if (path === '/api/auth/session') {
    return user ? json({ id: user, provider: 'google', createdAt: '2026-01-01T00:00:00.000Z' }) : json(null, 401);
  }
  if (!user) return json(null, 401);
  const account = cloud[user];

  if (path === '/api/sync/preferences') return json(method === 'PUT' ? body : null);
  if (path === '/api/sync/favorites/sync') {
    const active = [...account.favorites].map((verseKey) => ({
      type: 'active' as const,
      verseKey,
      ...(account.favoriteTimestamps.get(verseKey) ?? { createdAt: 'x', updatedAt: 'x' }),
    }));
    const tombstones = [...account.favoriteTombstones].map(([verseKey, deletedAt]) => ({ type: 'tombstone' as const, verseKey, deletedAt }));
    return json([...active, ...tombstones]);
  }
  if (path === '/api/sync/favorites') {
    if (method === 'PUT' && 'verseKeys' in body) {
      // Legacy union-add: never resurrects an existing tombstone.
      account.uploadedFavorites.push(...body.verseKeys);
      for (const verseKey of body.verseKeys as string[]) {
        if (!account.favoriteTombstones.has(verseKey)) account.favorites.add(verseKey);
      }
    } else if (method === 'PUT' && 'favorites' in body) {
      for (const record of body.favorites as { type: string; verseKey: string; createdAt?: string; updatedAt?: string; deletedAt?: string }[]) {
        account.uploadedFavorites.push(record.verseKey);
        if (record.type === 'tombstone') {
          account.favorites.delete(record.verseKey);
          account.favoriteTimestamps.delete(record.verseKey);
          account.favoriteTombstones.set(record.verseKey, record.deletedAt!);
        } else {
          account.favorites.add(record.verseKey);
          account.favoriteTombstones.delete(record.verseKey);
          account.favoriteTimestamps.set(record.verseKey, { createdAt: record.createdAt!, updatedAt: record.updatedAt! });
        }
      }
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

/** Every rendered frame of the real Favorites/Reflections hooks: what the user could have seen. */
type Frame = { user: string | null; favorites: string[]; reflections: string[] };
let frames: Frame[] = [];

function Probe() {
  account = useAuth();
  const { favorites } = useFavorites();
  const { items } = useReflections();
  frames.push({
    user: account.user?.id ?? null,
    favorites: favorites.map((favorite) => favorite.verseKey ?? favorite.id),
    reflections: items.map((item) => item.reflection.text),
  });
  return null;
}

/** The latest rendered frame. */
function screen(): Frame {
  return frames[frames.length - 1];
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

/**
 * Starts `action` inside act() but lets it finish across later act() rounds:
 * React flushes renders only when an act() scope ends, and an action that
 * waits for a question rendered meanwhile (the guest-data sheet) would
 * otherwise never see it.
 */
async function perform(action: () => Promise<void>) {
  let outcome: { error?: unknown } | null = null;
  await act(async () => {
    void action().then(() => { outcome = {}; }, (error: unknown) => { outcome = { error }; });
  });
  for (let round = 0; round < 50 && !outcome; round += 1) await settle();
  await settle();
  if (!outcome) throw new Error('The action never finished.');
  if ((outcome as { error?: unknown }).error) throw (outcome as { error?: unknown }).error;
}

async function signIn(user: 'A' | 'B') {
  await perform(() => account.signInWithGoogleIdToken(`id-${user}`));
  expect(account.status).toBe('signed-in');
  expect(account.user?.id).toBe(user);
}

async function signOut() {
  await perform(() => account.signOut());
  expect(account.status).toBe('guest');
}

async function sync() {
  await perform(() => account.refreshSync());
}

beforeEach(() => {
  env.secure.clear();
  env.storage.clear();
  env.keyRequests.length = 0;
  env.guestAnswer = 'keep-separate';
  env.guestPrompts = 0;
  env.guestSheetVisible = false;
  env.heldGuestChoice = null;
  frames = [];
  cloud = { A: emptyAccount(), B: emptyAccount() };
  resetLocalDataOwnerForTests();
  resetAuthEpochForTests();
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
  it("A's data is hidden after sign-out (guest edits stay guest data) and is A's again when A signs back in", async () => {
    await launchApp();
    await signIn('A');
    await saveReflection('1:1', 'A-private reflection');
    await addFavorite(ayah('1:2'));
    await sync();
    expect(decryptedUploads('A')).toEqual(['A-private reflection']);

    await signOut();
    expect(await getAllReflections()).toEqual([]);
    expect(await getFavorites()).toEqual([]);
    await saveReflection('1:3', 'written while signed out');

    await signIn('A'); // asked about the guest reflection: kept separate
    await sync();

    expect(env.guestPrompts).toBe(1);
    expect(decryptedUploads('A')).toEqual(['A-private reflection']);
    expect((await getAllReflections()).map((r) => r.text)).toEqual(['A-private reflection']);
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
    await saveReflection('2:257', 'written while signed out (guest data, kept separate)');

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
    await addFavorite(ayah('1:6')); // added while signed out: guest data, kept separate

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
    await activateLocalDataForAccount('A');
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

    await activateLocalDataForAccount('B');
    releaseGet();
    await syncingA;

    expect(await getAllReflections()).toEqual([]); // B (active) never receives A's decrypted reflection
    expect((await getAllReflections('A')).map((r) => r.text)).toEqual(['A from another device']);
  });
});

describe('Test E — guest data (fresh install)', () => {
  it('joins the account only after "Add to this account", and no other account afterwards', async () => {
    await launchApp();
    await saveReflection('8:1', 'guest reflection');
    await addFavorite(ayah('8:2'));

    env.guestAnswer = 'add';
    await signIn('A');
    expect(env.guestPrompts).toBe(1);
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

describe('Existing local data whose owner cannot be proven', () => {
  // Stored before ownership existed: it sits in the guest keys with no owner marker.
  const LEGACY_SYNCED = JSON.stringify({
    '11:1': { verseKey: '11:1', text: 'legacy reflection', createdAt: 1, updatedAt: 1, syncState: 'synced' },
  });

  it('is guest data even for a session signed in across the upgrade: asked once, and kept separate it is never uploaded', async () => {
    env.storage.set(GUEST_REFLECTIONS_KEY, LEGACY_SYNCED);
    await sessionStorage.setSessionToken('access-A');
    await sessionStorage.setRefreshToken('refresh-A');

    await launchApp();
    expect(account.user?.id).toBe('A');
    expect(env.guestPrompts).toBe(1);
    expect(cloud.A.uploadedReflections).toEqual([]);
    expect(await getAllReflections('A')).toEqual([]);
    expect(env.storage.get(GUEST_REFLECTIONS_KEY)).toBe(LEGACY_SYNCED);

    // The restored session does not ask the same account again on the next launch.
    await closeApp();
    await launchApp();
    expect(account.user?.id).toBe('A');
    expect(env.guestPrompts).toBe(1);
  });

  it('is added to the restored account only when the user chooses "Add to this account"', async () => {
    env.storage.set(GUEST_REFLECTIONS_KEY, LEGACY_SYNCED);
    await sessionStorage.setSessionToken('access-A');
    await sessionStorage.setRefreshToken('refresh-A');
    env.guestAnswer = 'add';

    await launchApp();

    expect(decryptedUploads('A')).toEqual(['legacy reflection']);
    expect(env.storage.has(GUEST_REFLECTIONS_KEY)).toBe(false);
    expect(cloud.B.uploadedReflections).toEqual([]);
  });

  it('is never silently given to a later sign-in, and stays untouched when kept separate', async () => {
    env.storage.set(GUEST_REFLECTIONS_KEY, LEGACY_SYNCED);
    env.storage.set(GUEST_FAVORITES_KEY, JSON.stringify([{ ...ayah('11:2'), savedAt: '2026-01-01T00:00:00.000Z' }]));

    await launchApp();
    await signIn('B');
    await sync();

    expect(env.guestPrompts).toBe(1);
    expect(cloud.B.uploadedReflections).toEqual([]);
    expect(cloud.B.uploadedFavorites).toEqual([]);
    expect(env.storage.get(GUEST_REFLECTIONS_KEY)).toBe(LEGACY_SYNCED);
    expect(env.storage.has(GUEST_FAVORITES_KEY)).toBe(true);
  });

  it("an account partition left active by the previous version after sign-out is hidden at launch, never shown as guest data", async () => {
    // The previous version kept the signed-out account's partition active.
    env.storage.set('quran-heals:local-data-owner:v1', JSON.stringify({ activeUserId: 'A', guestAdoptable: false }));
    env.storage.set(`${GUEST_REFLECTIONS_KEY}:account:A`, JSON.stringify({
      '12:1': { verseKey: '12:1', text: 'A old-version reflection', createdAt: 1, updatedAt: 1, syncState: 'synced' },
    }));

    await launchApp();

    expect(account.status).toBe('guest');
    expect(frames.some((frame) => frame.reflections.includes('A old-version reflection'))).toBe(false);
    expect(await getAllReflections()).toEqual([]);
    // Still on the device for A alone.
    expect((await getAllReflections('A')).map((r) => r.text)).toEqual(['A old-version reflection']);
  });
});

// ---------------------------------------------------------------------------
// Account boundaries: Guest → (optionally merge) → A → sign out → Guest → B
// ---------------------------------------------------------------------------

const AT = '2026-01-01T00:00:00.000Z';
function cloudFavorite(user: 'A' | 'B', verseKey: string) {
  cloud[user].favorites.add(verseKey);
  cloud[user].favoriteTimestamps.set(verseKey, { createdAt: AT, updatedAt: AT });
}
function cloudReflection(user: 'A' | 'B', verseKey: string, text: string) {
  const encrypted = encryptReflectionText(text, MASTER_KEYS[user], (n) => new Uint8Array(randomBytes(n)));
  cloud[user].reflections.set(verseKey, { type: 'active', verseKey, ...encrypted, createdAt: AT, updatedAt: AT });
}
async function sortedFavorites(owner?: string | null) {
  return (await getFavorites(owner)).map((favorite) => favorite.id).sort();
}
async function sortedReflections(owner?: string | null) {
  return (await getAllReflections(owner)).map((reflection) => reflection.text).sort();
}

describe('Account boundaries', () => {
  it('1. guest empty → A → sign-out → guest empty; A keeps its data for itself and nothing remote is deleted', async () => {
    await launchApp();
    expect(screen()).toEqual({ user: null, favorites: [], reflections: [] });

    await signIn('A');
    await saveReflection('20:1', 'A note');
    await addFavorite(ayah('20:2'));
    await sync();
    expect(screen()).toEqual({ user: 'A', favorites: ['20:2'], reflections: ['A note'] });
    const remoteBefore = JSON.stringify([[...cloud.A.favorites], [...cloud.A.reflections.keys()]]);

    await signOut();

    expect(screen()).toEqual({ user: null, favorites: [], reflections: [] });
    expect(await getFavorites()).toEqual([]);
    expect(await getAllReflections()).toEqual([]);
    expect(JSON.stringify([[...cloud.A.favorites], [...cloud.A.reflections.keys()]])).toBe(remoteBefore);
    expect(await sortedReflections('A')).toEqual(['A note']);
    expect(env.guestPrompts).toBe(0);
  });

  it("2/7/16. guest empty → A → sign-out → B shows only B's data, and no frame after A's sign-out ever shows A's data", async () => {
    cloudFavorite('B', '21:9');
    cloudReflection('B', '21:8', 'B cloud note');
    await launchApp();
    await signIn('A');
    await saveReflection('21:1', 'A note');
    await addFavorite(ayah('21:2'));
    await sync();
    expect(screen().favorites).toEqual(['21:2']);

    const signOutFrame = frames.length;
    await signOut();
    await signIn('B');
    await sync();

    expect(screen()).toEqual({ user: 'B', favorites: ['21:9'], reflections: ['B cloud note'] });
    expect(await sortedFavorites()).toEqual(['21:9']);
    for (const frame of frames.slice(signOutFrame)) {
      expect(frame.favorites).not.toContain('21:2');
      expect(frame.reflections).not.toContain('A note');
    }
    expect(cloud.B.uploadedFavorites).toEqual([]);
    expect(cloud.B.uploadedReflections).toEqual([]);
  });

  async function guestWithData0AndAccountWithData1() {
    cloudFavorite('A', '22:1');
    cloudReflection('A', '22:2', 'A cloud note');
    await launchApp();
    await saveReflection('22:3', 'guest note');
    await addFavorite(ayah('22:4'));
  }

  it('3. guest data0 → A → "Add to this account" → A has data1 + data0, uploaded, guest copy gone', async () => {
    await guestWithData0AndAccountWithData1();
    env.guestAnswer = 'add';
    await signIn('A');

    expect(env.guestPrompts).toBe(1);
    expect(await sortedFavorites()).toEqual(['22:1', '22:4']);
    expect(await sortedReflections()).toEqual(['A cloud note', 'guest note']);
    expect(screen().favorites.sort()).toEqual(['22:1', '22:4']);
    expect(cloud.A.favorites).toEqual(new Set(['22:1', '22:4']));
    expect(decryptedUploads('A')).toEqual(['guest note']);
    expect(env.storage.has(GUEST_FAVORITES_KEY)).toBe(false);
    expect(env.storage.has(GUEST_REFLECTIONS_KEY)).toBe(false);
  });

  it('4/5. "Keep separate" → A has only data1; after sign-out the guest sees data0 again', async () => {
    await guestWithData0AndAccountWithData1();
    await signIn('A');

    expect(env.guestPrompts).toBe(1);
    expect(await sortedFavorites()).toEqual(['22:1']);
    expect(await sortedReflections()).toEqual(['A cloud note']);
    expect(screen()).toEqual({ user: 'A', favorites: ['22:1'], reflections: ['A cloud note'] });
    expect(cloud.A.uploadedFavorites).toEqual([]);
    expect(cloud.A.uploadedReflections).toEqual([]);

    await signOut();
    expect(screen()).toEqual({ user: null, favorites: ['22:4'], reflections: ['guest note'] });
  });

  it('6. data added to an account is not offered again; data kept separate is asked about at the next sign-in', async () => {
    await guestWithData0AndAccountWithData1();
    env.guestAnswer = 'add';
    await signIn('A');
    await signOut();
    await signIn('A');
    expect(env.guestPrompts).toBe(1);
    await signOut();

    await saveReflection('22:9', 'new guest note');
    env.guestAnswer = 'keep-separate';
    await signIn('B');
    expect(env.guestPrompts).toBe(2);
    await signOut();
    await signIn('B');
    expect(env.guestPrompts).toBe(3);
    expect(cloud.B.uploadedReflections).toEqual([]);
  });

  it("8. A's sync finishing after B signed in never writes into B's data or shows on B's screen", async () => {
    await launchApp();
    await signIn('A');
    cloudFavorite('A', '23:1'); // added on another of A's devices
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname === '/api/sync/favorites/sync' && accountFor(init) === 'A') await gate;
      return fakeBackend(url, init);
    }));

    let syncingA!: Promise<void>;
    await act(async () => { syncingA = account.refreshSync(); });
    await settle();
    await signOut();
    let signingInB!: Promise<void>;
    await act(async () => { signingInB = account.signInWithGoogleIdToken('id-B'); });
    await settle();
    expect(account.user?.id).toBe('B');
    const bFrame = frames.length;

    release();
    await act(async () => { await syncingA; await signingInB; });
    await settle();

    expect(await sortedFavorites()).toEqual([]);
    expect(frames.slice(bFrame).some((frame) => frame.favorites.includes('23:1'))).toBe(false);
    expect(cloud.B.uploadedFavorites).toEqual([]);
    expect(env.keyRequests).toContain('B'); // B's own sync still ran
  });

  it("8b. a request of A's ending in 401 after B signed in is never retried with B's refreshed token", async () => {
    await launchApp();
    await signIn('A');
    await addFavorite(ayah('24:1'));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === '/api/sync/favorites' && init?.method === 'PUT' && accountFor(init) === 'A') {
        await gate;
        return json(null, 401); // A's session was revoked by its sign-out
      }
      return fakeBackend(url, init);
    }));

    let syncingA!: Promise<void>;
    await act(async () => { syncingA = account.refreshSync(); });
    await settle();
    await signOut();
    let signingInB!: Promise<void>;
    await act(async () => { signingInB = account.signInWithGoogleIdToken('id-B'); });
    await settle();
    release();
    await act(async () => { await syncingA; await signingInB; });
    await settle();

    expect(cloud.B.uploadedFavorites).not.toContain('24:1');
    expect(cloud.B.favorites.has('24:1')).toBe(false);
    expect(await sessionStorage.getSessionToken()).toBe('access-B');
    expect(account.user?.id).toBe('B');
  });

  it('9. a sign-out still finishing (slow storage, slow revocation) never clears the B session that signed in meanwhile', async () => {
    await launchApp();
    await signIn('A');
    let releaseLogout!: () => void;
    const logoutGate = new Promise<void>((resolve) => { releaseLogout = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname === '/api/auth/logout') await logoutGate;
      return fakeBackend(url, init);
    }));

    let signingOut!: Promise<void>;
    await act(async () => { signingOut = account.signOut(); });
    await settle();
    expect(account.status).toBe('guest');
    await signIn('B');
    releaseLogout();
    await act(async () => { await signingOut; });
    await settle();

    expect(account.user?.id).toBe('B');
    expect(await sessionStorage.getSessionToken()).toBe('access-B');
    expect(await sessionStorage.getRefreshToken()).toBe('refresh-B');
  });

  it("10. sign-out clears the session's keys, tokens and cached profile, and closes its open questions unanswered", async () => {
    await launchApp();
    await saveReflection('26:1', 'guest note');
    env.guestAnswer = 'hold';
    await act(async () => { void account.signInWithGoogleIdToken('id-A'); });
    await settle();
    expect(env.guestPrompts).toBe(1);
    env.secure.set('quran-heals.reflection-master-key.v1', JSON.stringify({ userId: 'A', key: 'AAAA' }));

    await signOut();

    expect(env.guestSheetVisible).toBe(false);
    expect(env.secure.size).toBe(0);
    expect(await sessionStorage.getCachedUser()).toBeNull();
    // The stale answer arriving now changes nothing.
    await act(async () => { env.heldGuestChoice?.('add'); });
    await settle();
    expect(await sortedReflections()).toEqual(['guest note']);
    expect(await sortedReflections('A')).toEqual([]);
    expect(cloud.A.uploadedReflections).toEqual([]);
  });

  it("14. an account's own deletion stays deleted across sign-out/in; guest deletion markers kept separate never reach it", async () => {
    await launchApp();
    await addFavorite(ayah('25:2'));
    await removeFavorite('25:2'); // guest deletion marker
    await addFavorite(ayah('25:3'));

    await signIn('A'); // kept separate
    cloudFavorite('A', '25:2');
    await addFavorite(ayah('25:1'));
    await sync();
    await removeFavorite('25:1');
    await sync();
    expect(cloud.A.favoriteTombstones.has('25:1')).toBe(true);

    await signOut();
    await signIn('A');
    await sync();

    expect(await sortedFavorites()).toEqual(['25:2']);
    expect(cloud.A.favorites.has('25:1')).toBe(false);
    expect(cloud.A.favorites.has('25:2')).toBe(true);
    expect(cloud.A.favoriteTombstones.has('25:2')).toBe(false);
  });
});

describe('mergeGuestDataIntoAccount', () => {
  it('moves nothing into an account whose session already ended', async () => {
    const { mergeGuestDataIntoAccount } = await import('@/storage/localDataOwnership');
    await saveReflection('27:1', 'guest note');
    expect(await mergeGuestDataIntoAccount('A', () => false)).toBe(false);
    expect(await sortedReflections()).toEqual(['guest note']);
    expect(await sortedReflections('A')).toEqual([]);
  });
});
