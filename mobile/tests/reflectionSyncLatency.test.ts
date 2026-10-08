import { randomBytes } from 'node:crypto';

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * When a reflection saved or deleted on one device reaches the cloud, and
 * so other devices. End to end on the device side: the REAL AuthProvider,
 * key manager (real PBKDF2 + XChaCha20-Poly1305), local storage and sync,
 * against a fake backend that records every request. Devices run one after
 * another (each "launch" is the app opened on that device); the password
 * sheet is a stub exposing its handlers.
 */

type Device = { storage: Map<string, string>; secure: Map<string, string> };
type SheetProps = {
  request: { mode: 'create' | 'unlock' } | null;
  onSubmit: (passphrase: string) => void;
};

const env = vi.hoisted(() => ({
  device: { storage: new Map<string, string>(), secure: new Map<string, string>() } as Device,
  sheet: null as SheetProps | null,
  appState: [] as ((state: string) => void)[],
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  AppState: { addEventListener: vi.fn((_event: string, listener: (state: string) => void) => {
    env.appState.push(listener);
    return { remove: () => { env.appState = env.appState.filter((entry) => entry !== listener); } };
  }) },
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
vi.mock('@/auth/reauthentication', () => ({ useFreshProviderCredential: () => async () => null }));
vi.mock('@/localization/useAppLocale', () => ({
  useAppLocale: () => ({ locale: 'en', setLocale: vi.fn(), isReady: true }),
}));
vi.mock('@/localization/useQuranTranslationPreference', () => ({
  useQuranTranslationPreference: () => ({
    preference: { displayMode: 'off', translationId: 'en.pickthall.gutenberg16955' },
    setDisplayMode: vi.fn(),
    isReady: true,
  }),
}));
vi.mock('@/services/quran', () => ({ resolveAyahArabic: async (value: { verseKey: string }) => ({ ...value, arabicText: 'ARABIC' }) }));
vi.mock('@/services/api', () => ({
  getAyah: async (verseKey: string) => {
    const [surahNumber, ayahNumber] = verseKey.split(':').map(Number);
    return {
      id: verseKey, verseKey, referenceKey: verseKey, surahNumber, ayahNumber,
      surahNameArabic: '', surahNameEnglish: 'Surah', arabicText: 'ARABIC',
      englishTranslation: 'translation', emotions: [], quranTextSource: 'Tanzil', translationSource: 'Pickthall',
    };
  },
}));

import { AuthProvider, useAuth, type AuthContextValue } from '@/auth/useAuth';
import { registerSessionExpiredHandler } from '@/auth/tokenManager';
import { addFavorite } from '@/storage/favorites';
import { getAllReflections, getAllTombstones, saveReflection } from '@/storage/ayahReflections';
import { getConflictVersionsFor } from '@/storage/reflectionConflicts';
import { resetLocalDataOwnerForTests } from '@/storage/localDataOwner';
import { resetPreferencesSyncStateForTests } from '@/sync/preferencesSyncState';
import { notifyLocalChange } from '@/storage/localChanges';

// ---------------------------------------------------------------------------
// Fake backend (one account, "A"), recording every request.
// ---------------------------------------------------------------------------

type CloudReflection = { type?: string; verseKey: string; ciphertext?: string; updatedAt?: string; deletedAt?: string; keyFingerprint?: string };
let cloud: { key: unknown; reflections: Map<string, CloudReflection>; favorites: Set<string> };
let requests: { method: string; path: string; body: string }[];
let offline: boolean;
/** While set, GET /api/sync/reflections waits for it: a sync held in flight. */
let holdReflectionsRead: Promise<void> | null;
let validAccessTokens: Set<string>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data, message: 'error' }), { status });
}

async function fakeBackend(url: string, init?: RequestInit): Promise<Response> {
  if (offline) throw new TypeError('Network request failed');
  const path = new URL(url).pathname;
  const method = init?.method ?? 'GET';
  const rawBody = init?.body ? String(init.body) : '';
  requests.push({ method, path, body: rawBody });
  const body = rawBody ? JSON.parse(rawBody) : undefined;

  if (path === '/api/auth/google') {
    validAccessTokens.add('access-A-1');
    return json({ token: 'access-A-1', refreshToken: 'refresh-A', user: { id: 'A', provider: 'google', createdAt: '2026-01-01T00:00:00.000Z' } });
  }
  if (path === '/api/auth/refresh') {
    const token = `access-A-${validAccessTokens.size + 1}`;
    validAccessTokens.add(token);
    return json({ token, refreshToken: 'refresh-A' });
  }
  const token = ((init?.headers as Record<string, string> | undefined)?.Authorization ?? '').replace('Bearer ', '');
  if (!validAccessTokens.has(token)) return json(null, 401);

  if (path === '/api/auth/session') return json({ id: 'A', provider: 'google', createdAt: '2026-01-01T00:00:00.000Z' });
  if (path === '/api/sync/preferences') return json(null);
  if (path === '/api/sync/favorites/sync') {
    return json([...cloud.favorites].map((verseKey) => ({ type: 'active', verseKey, createdAt: 'x', updatedAt: '2026-01-01T00:00:00.000Z' })));
  }
  if (path === '/api/sync/favorites' && method === 'PUT') {
    for (const record of (body.favorites ?? []) as { type: string; verseKey: string }[]) {
      if (record.type === 'tombstone') cloud.favorites.delete(record.verseKey);
      else cloud.favorites.add(record.verseKey);
    }
    return json([]);
  }
  if (path === '/api/sync/key') {
    if (method === 'GET') return json(cloud.key);
    if (cloud.key) return json(null, 409);
    cloud.key = body;
    return json(cloud.key);
  }
  if (path === '/api/sync/reflections') {
    if (method === 'PUT') {
      for (const record of body.reflections) cloud.reflections.set(record.verseKey, record);
      return json({ saved: body.reflections, conflicts: [] });
    }
    if (holdReflectionsRead) await holdReflectionsRead;
    return json([...cloud.reflections.values()]);
  }
  if (path === '/api/sync/reflections/conflicts') return json([]);
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
async function settleUntil(condition: () => boolean, label: string) {
  for (let i = 0; i < 400; i += 1) {
    if (condition()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

const newDevice = (): Device => ({ storage: new Map(), secure: new Map() });
const prompt = () => env.sheet?.request ?? null;
/** One request per full sync: the key manager reads the account's key first. */
const syncCount = () => requests.filter((r) => r.method === 'GET' && r.path === '/api/sync/key').length;
const reflectionUploads = () => requests.filter((r) => r.method === 'PUT' && r.path === '/api/sync/reflections');
const cachedKeyPresent = () => env.device.secure.has('quran-heals.reflection-master-key.v1');

async function closeApp() {
  await settle();
  await act(async () => { root?.unmount(); });
  root = undefined;
  registerSessionExpiredHandler(null);
}

async function launchOn(device: Device) {
  if (root) await closeApp();
  env.device = device;
  env.sheet = null;
  env.appState = [];
  resetLocalDataOwnerForTests();
  resetPreferencesSyncStateForTests();
  await act(async () => { root = create(createElement(AuthProvider, null, createElement(Probe))); });
  await settle();
}

/** Signs in on this device and creates (first device) or unlocks the account's key. */
async function signInAndUnlock() {
  await act(async () => { void account.signInWithGoogleIdToken('id-A'); });
  await settleUntil(() => account.status === 'signed-in' && prompt() !== null, 'password prompt');
  await act(async () => { env.sheet!.onSubmit('my sync password'); });
  await settleUntil(() => cachedKeyPresent(), 'key cached');
  await settle();
}

/** What ReflectionSheet does on Save / Delete: write locally, then signal the change. */
async function saveOnDevice(verseKey: string, text: string) {
  await act(async () => {
    await saveReflection(verseKey, text);
    notifyLocalChange();
  });
}

const activeCloudText = (verseKey: string) => cloud.reflections.get(verseKey);

beforeEach(() => {
  cloud = { key: null, reflections: new Map(), favorites: new Set() };
  requests = [];
  offline = false;
  holdReflectionsRead = null;
  validAccessTokens = new Set();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(fakeBackend));
});
afterEach(async () => {
  holdReflectionsRead = null;
  await closeApp();
  vi.unstubAllGlobals();
});

describe('a saved reflection is uploaded right away', { timeout: 60_000 }, () => {
  it('creation: saved locally at once, uploaded encrypted without waiting for a foreground or pull-to-refresh', async () => {
    await launchOn(newDevice());
    await signInAndUnlock();
    const before = syncCount();

    await saveOnDevice('2:255', 'my private reflection');
    // Local first: visible immediately, whatever the network does.
    expect((await getAllReflections('A')).map((r) => r.text)).toEqual(['my private reflection']);

    await settleUntil(() => cloud.reflections.has('2:255'), 'uploaded');
    expect(syncCount()).toBe(before + 1); // exactly one sync for one save
    expect(reflectionUploads()).toHaveLength(1);
    // Only ciphertext ever leaves the device.
    expect(activeCloudText('2:255')!.ciphertext).toBeTruthy();
    expect(requests.some((r) => r.body.includes('my private reflection'))).toBe(false);
  });

  it('deletion: the tombstone is uploaded right away, and the reflection never comes back', async () => {
    await launchOn(newDevice());
    await signInAndUnlock();
    await saveOnDevice('2:255', 'to be deleted');
    await settleUntil(() => cloud.reflections.has('2:255'), 'uploaded');

    await saveOnDevice('2:255', ''); // ReflectionSheet's delete path
    expect(await getAllReflections('A')).toEqual([]);
    await settleUntil(() => activeCloudText('2:255')?.type === 'tombstone', 'tombstone uploaded');

    await act(async () => { await account.refreshSync(); });
    await settle();
    expect(await getAllReflections('A')).toEqual([]);
    expect((await getAllTombstones('A')).map((t) => t.verseKey)).toEqual(['2:255']);
  });

  it('a guest save sends nothing', async () => {
    await launchOn(newDevice());
    await saveOnDevice('2:255', 'guest reflection');
    await settle();
    expect(requests).toEqual([]);
  });
});

describe('across devices', { timeout: 60_000 }, () => {
  it('creation and deletion on device one reach device two at its next sync (here: opening the app)', async () => {
    const one = newDevice();
    const two = newDevice();
    await launchOn(one);
    await signInAndUnlock();
    await launchOn(two);
    await signInAndUnlock();

    await launchOn(one);
    await saveOnDevice('94:5', 'with hardship comes ease');
    await settleUntil(() => cloud.reflections.has('94:5'), 'uploaded from device one');

    await launchOn(two);
    await waitFor(async () => (await getAllReflections('A')).length === 1, 'device two received it');
    expect((await getAllReflections('A')).map((r) => r.text)).toEqual(['with hardship comes ease']);

    await launchOn(one);
    await saveOnDevice('94:5', '');
    await settleUntil(() => activeCloudText('94:5')?.type === 'tombstone', 'deletion uploaded');

    await launchOn(two);
    await waitFor(async () => (await getAllReflections('A')).length === 0, 'device two received the deletion');
    expect((await getAllTombstones('A')).map((t) => t.verseKey)).toEqual(['94:5']);
  });
});

describe('the upload is single-flight and never lost', { timeout: 60_000 }, () => {
  it('saves made while a sync is running get exactly one follow-up sync, which uploads them', async () => {
    await launchOn(newDevice());
    await signInAndUnlock();
    let release!: () => void;
    holdReflectionsRead = new Promise<void>((resolve) => { release = resolve; });

    await act(async () => { void account.refreshSync(); });
    await settleUntil(() => requests.some((r) => r.method === 'GET' && r.path === '/api/sync/reflections'), 'sync held');
    const syncsWhileHeld = syncCount();

    await saveOnDevice('1:1', 'first');
    await saveOnDevice('1:2', 'second');
    await saveOnDevice('1:3', 'third');
    expect(syncCount()).toBe(syncsWhileHeld); // nothing started in parallel

    holdReflectionsRead = null;
    release();
    await settleUntil(() => cloud.reflections.size === 3, 'all three uploaded');
    await settle();
    expect(syncCount()).toBe(syncsWhileHeld + 1); // one follow-up for all three
  });

  it('offline: saved locally, nothing retried in a loop, uploaded by the next sync', async () => {
    await launchOn(newDevice());
    await signInAndUnlock();
    offline = true;
    const before = requests.length;

    await saveOnDevice('3:286', 'written offline');
    await settle();
    expect((await getAllReflections('A')).map((r) => r.text)).toEqual(['written offline']);
    expect(requests.length).toBe(before); // every attempt failed before reaching the server
    expect(cloud.reflections.size).toBe(0);

    offline = false;
    await act(async () => { await account.refreshSync(); });
    await settleUntil(() => cloud.reflections.has('3:286'), 'uploaded once online');
  });

  it('an expired access token is refreshed once and the change still uploads', async () => {
    await launchOn(newDevice());
    await signInAndUnlock();
    validAccessTokens.clear(); // the 20-minute access token expired

    await saveOnDevice('18:10', 'after token expiry');
    await settleUntil(() => cloud.reflections.has('18:10'), 'uploaded after refresh');
    expect(requests.filter((r) => r.path === '/api/auth/refresh')).toHaveLength(1);
  });

  it('the upload counts as the recent sync: returning to the app right after starts no second one', async () => {
    await launchOn(newDevice());
    await signInAndUnlock();
    await saveOnDevice('2:286', 'hello');
    await settleUntil(() => cloud.reflections.has('2:286'), 'uploaded');
    await settle();
    const before = requests.length;

    await act(async () => { env.appState.forEach((listener) => { listener('background'); listener('active'); }); });
    await settle();
    expect(requests.length).toBe(before);
  });

  it('favorites still sync in the same run, unchanged', async () => {
    await launchOn(newDevice());
    await signInAndUnlock();
    await act(async () => {
      const { getAyah } = await import('@/services/api');
      await addFavorite(await getAyah('2:255') as never);
    });
    await saveOnDevice('2:255', 'reflection and favorite');
    await settleUntil(() => cloud.reflections.has('2:255') && cloud.favorites.has('2:255'), 'both uploaded');
  });
});

describe('conflicts are handled exactly as before', { timeout: 60_000 }, () => {
  async function twoDevicesWith(text: string) {
    const one = newDevice();
    const two = newDevice();
    await launchOn(one);
    await signInAndUnlock();
    await saveOnDevice('1:1', text);
    await settleUntil(() => cloud.reflections.has('1:1'), 'uploaded');
    await launchOn(two);
    await signInAndUnlock();
    await waitFor(async () => (await getAllReflections('A')).length === 1, 'device two has it');
    return { one, two };
  }

  /** Device two's own edit is made offline; device one then changes the same reflection (newer). */
  async function concurrentChange(deviceOneText: string) {
    const { one, two } = await twoDevicesWith('original');
    offline = true;
    await saveOnDevice('1:1', 'device two edit');
    await settle();
    offline = false;

    await launchOn(one);
    const uploads = reflectionUploads().length;
    await saveOnDevice('1:1', deviceOneText);
    await settleUntil(() => reflectionUploads().length > uploads, 'device one change uploaded');

    await launchOn(two); // back online: its next sync meets the newer change
    await waitFor(async () => (await getConflictVersionsFor('1:1', 'A')).length > 0, 'device two merged');
  }

  it('edit/edit: the newer edit is current, and device two\'s text is kept as another version', async () => {
    await concurrentChange('device one edit');
    expect((await getAllReflections('A')).map((r) => r.text)).toEqual(['device one edit']);
    expect((await getConflictVersionsFor('1:1', 'A')).map((v) => v.text)).toEqual(['device two edit']);
  });

  it('edit/delete: the newer deletion wins, and device two\'s edit is kept, never silently lost', async () => {
    await concurrentChange('');
    expect(await getAllReflections('A')).toEqual([]);
    const kept = await getConflictVersionsFor('1:1', 'A');
    expect(kept.map((v) => v.text)).toEqual(['device two edit']);
    expect(kept[0].supersededByDeletion).toBe(true);
  });
});

async function waitFor(condition: () => Promise<boolean>, label: string) {
  for (let i = 0; i < 400; i += 1) {
    if (await condition()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  throw new Error(`Timed out waiting for: ${label}`);
}
