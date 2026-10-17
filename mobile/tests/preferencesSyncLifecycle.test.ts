import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settings sync end to end on simulated devices: the REAL settings
 * providers, AuthProvider, preferencesSync and preferencesSyncState, against
 * a fake backend that applies the server's per-field rules
 * (backend/src/services/preferencesMerge.ts) — or, in `legacy` mode, the
 * previous server's single-timestamp rule. Each simulated device has its
 * own AsyncStorage and Secure Store; switching devices is an app restart
 * with that device's storage. The mandatory Sync Password step is
 * short-circuited (as if the user signed out of it), so only settings (and
 * a stubbed reading sync) run.
 *
 * Covers: signed-in changes never reverted; offline edits; app restart;
 * newer values from another device; two devices changing different
 * settings; Guest → Account A → sign-out → Account B (nothing crosses
 * accounts, nothing is uploaded from a guest); the earlier versions'
 * device-wide timestamp; and a server that does not know the new settings.
 */

const env = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  storage: new Map<string, string>(),
  // When set, reads of these AsyncStorage keys wait on the given promise
  // (simulates slow preference hydration at app start).
  delayedReads: new Map<string, Promise<void>>(),
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
  getItem: vi.fn(async (key: string) => {
    await env.delayedReads.get(key);
    return env.storage.get(key) ?? null;
  }),
  setItem: vi.fn(async (key: string, value: string) => { env.storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { env.storage.delete(key); }),
} }));
vi.mock('@/components/GuestDataSheet', () => ({ GuestDataSheet: () => null }));
vi.mock('@/components/SyncPassphraseSheet', () => ({ SyncPassphraseSheet: () => null }));
vi.mock('@/auth/reauthentication', () => ({ useFreshProviderCredential: () => async () => null }));
vi.mock('@/sync/syncKeyManager', () => {
  class SyncPassphraseCancelledError extends Error {}
  return {
    SyncPassphraseCancelledError,
    discardUnfinishedKeySetup: vi.fn(),
    ensureReflectionMasterKey: vi.fn(async () => {
      throw new SyncPassphraseCancelledError('Preferences-only sync for this test.');
    }),
  };
});
// Never reached here (the password step ends the sync first); mocked only
// because their real imports need native Expo modules.
vi.mock('@/sync/favoritesSync', () => ({ syncFavorites: vi.fn() }));
vi.mock('@/sync/reflectionsSync', () => ({ syncReflections: vi.fn() }));
vi.mock('@/sync/readingSync', () => ({ syncReading: vi.fn(async () => true) }));
vi.mock('@/storage/ayahReflections', () => ({ clearAllReflections: vi.fn(), guestHasReflections: vi.fn(async () => false), adoptGuestReflections: vi.fn(async () => true) }));
vi.mock('@/storage/favorites', () => ({ clearAllFavorites: vi.fn(), guestHasFavorites: vi.fn(async () => false), adoptGuestFavorites: vi.fn(async () => true) }));

import { AuthProvider, useAuth, type AuthContextValue } from '@/auth/useAuth';
import { resetAuthEpochForTests } from '@/auth/authEpoch';
import { registerSessionExpiredHandler } from '@/auth/tokenManager';
import { EMOTIONS_LANGUAGE_STORAGE_KEY } from '@/localization/emotionsLanguage';
import { APP_LOCALE_STORAGE_KEY, AppLocaleProvider, useAppLocale, type AppLocaleContextValue } from '@/localization/useAppLocale';
import { EmotionsLanguageProvider, useEmotionsLanguage, type EmotionsLanguageContextValue } from '@/localization/useEmotionsLanguage';
import { QuranFontSizePreferenceProvider, useQuranFontSizePreference, type QuranFontSizePreferenceContextValue } from '@/localization/useQuranFontSizePreference';
import {
  QuranTranslationPreferenceProvider,
  useQuranTranslationPreference,
  type QuranTranslationPreferenceContextValue,
} from '@/localization/useQuranTranslationPreference';
import { resetLocalDataOwnerForTests } from '@/storage/localDataOwner';
import { LEGACY_PREFERENCES_UPDATED_AT_KEY, resetPreferencesSyncStateForTests } from '@/sync/preferencesSyncState';
import { AppearancePreferenceProvider, useAppearancePreference, type AppearancePreferenceContextValue } from '@/theme/useAppearancePreference';

type TestUser = { id: string; provider: 'google' | 'apple'; createdAt: string };
const USER_A: TestUser = { id: 'user-a', provider: 'google', createdAt: '2026-01-01T00:00:00.000Z' };
const USER_B: TestUser = { id: 'user-b', provider: 'apple', createdAt: '2026-01-01T00:00:00.000Z' };
const TOKENS: Record<string, TestUser> = { 'access-a': USER_A, 'access-b': USER_B };
const T0 = '2026-01-01T00:00:00.000Z';
const OLD_CLOUD = { locale: 'en', translationDisplayMode: 'always', translationId: 'en.pickthall.gutenberg16955', updatedAt: T0 };
const FIELDS = ['locale', 'translationDisplayMode', 'translationId', 'quranLanguage', 'emotionsLanguage', 'appearance', 'quranFontSize'] as const;
const LEGACY_FIELDS = ['locale', 'translationDisplayMode', 'translationId'] as const;

type Stored = Record<string, unknown> & { updatedAt: string; fieldUpdatedAt?: Record<string, string> };
const server = {
  records: new Map<string, Stored>(),
  online: true,
  /** The previous server: three fields, one timestamp, no fieldUpdatedAt. */
  legacy: false,
  puts: [] as { userId: string; body: Stored }[],
};

const instantOf = (record: Stored, field: string) => (record[field] === undefined ? null : record.fieldUpdatedAt?.[field] ?? record.updatedAt);

/** The server's rules (backend/src/services/preferencesMerge.ts), or the previous server's. */
function serverPut(userId: string, body: Stored): Stored | null {
  const existing = server.records.get(userId) ?? null;
  if (server.legacy) {
    if (existing && Date.parse(existing.updatedAt) >= Date.parse(body.updatedAt)) return existing;
    const next: Stored = { ...(existing ?? {}), updatedAt: body.updatedAt };
    for (const field of LEGACY_FIELDS) if (body[field] !== undefined) next[field] = body[field];
    server.records.set(userId, next);
    return next;
  }
  const next: Stored = { updatedAt: existing?.updatedAt ?? new Date(0).toISOString(), fieldUpdatedAt: {} };
  for (const field of FIELDS) {
    const at = existing && instantOf(existing, field);
    if (at) {
      next[field] = existing![field];
      next.fieldUpdatedAt![field] = at;
    }
  }
  let changed = false;
  for (const field of FIELDS) {
    if (body[field] === undefined) continue;
    const at = body.fieldUpdatedAt?.[field] ?? body.updatedAt;
    const stored = next.fieldUpdatedAt![field];
    if (stored && Date.parse(at) <= Date.parse(stored)) continue;
    next[field] = body[field];
    next.fieldUpdatedAt![field] = at;
    if (Date.parse(at) > Date.parse(next.updatedAt)) next.updatedAt = at;
    changed = true;
  }
  if (!changed) return existing;
  server.records.set(userId, next);
  return next;
}

function serverGet(userId: string): Stored | null {
  const record = server.records.get(userId);
  if (!record) return null;
  if (server.legacy) return record;
  const out: Stored = { updatedAt: record.updatedAt, fieldUpdatedAt: {} };
  for (const field of FIELDS) {
    const at = instantOf(record, field);
    if (!at) continue;
    out[field] = record[field];
    out.fieldUpdatedAt![field] = at;
  }
  return out;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status === 200, data }), { status });
}

async function fakeBackend(url: string, init?: RequestInit): Promise<Response> {
  const path = new URL(url).pathname;
  const token = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '').replace('Bearer ', '');
  const user = TOKENS[token];
  if (path === '/api/auth/session') return user ? json(user) : json(null, 401);
  if (path === '/api/sync/preferences') {
    if (!server.online) throw new TypeError('Network request failed');
    if (!user) return json(null, 401);
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Stored;
      server.puts.push({ userId: user.id, body });
      serverPut(user.id, body);
    }
    return json(serverGet(user.id));
  }
  return json(null, 404);
}

let root: ReactTestRenderer | undefined;
let account: AuthContextValue;
let appLocale: AppLocaleContextValue;
let translation: QuranTranslationPreferenceContextValue;
let appearance: AppearancePreferenceContextValue;
let fontSize: QuranFontSizePreferenceContextValue;
let emotions: EmotionsLanguageContextValue;

function Probe() {
  account = useAuth();
  appLocale = useAppLocale();
  translation = useQuranTranslationPreference();
  appearance = useAppearancePreference();
  fontSize = useQuranFontSizePreference();
  emotions = useEmotionsLanguage();
  return null;
}

/** The app's own provider order (app/_layout.tsx). */
function tree() {
  return createElement(AppearancePreferenceProvider, null,
    createElement(AppLocaleProvider, null,
      createElement(EmotionsLanguageProvider, null,
        createElement(QuranTranslationPreferenceProvider, null,
          createElement(QuranFontSizePreferenceProvider, null,
            createElement(AuthProvider, null, createElement(Probe)))))));
}

/**
 * Lets every pending promise chain (storage, fetch, effects) run to completion.
 * setImmediate, not setTimeout(0): each turns the event loop once, but on
 * Windows a setTimeout(0) waits for the ~15.6 ms system timer tick (unless
 * another program has raised the timer resolution). That made one settle() take
 * ~0.4 s, pushed the two-device test past the 5 s timeout depending on
 * what else was running, and its still-running body then leaked device
 * storage into the tests after it.
 */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 25; i += 1) await new Promise((resolve) => setImmediate(resolve));
  });
}

async function launchApp() {
  await act(async () => { root = create(tree()); });
  await settle();
}

async function closeApp() {
  await act(async () => { root?.unmount(); });
  root = undefined;
  registerSessionExpiredHandler(null);
  // A real restart loses all in-memory state; only the device's storage remains.
  resetPreferencesSyncStateForTests();
  resetLocalDataOwnerForTests();
  resetAuthEpochForTests();
}

type Device = { storage: Map<string, string>; secure: Map<string, string> };
const newDevice = (): Device => ({ storage: new Map(), secure: new Map() });
/** Closes the app on the current device and continues on `device` (its own storage). */
async function switchTo(device: Device) {
  await settle();
  await closeApp();
  env.storage = device.storage;
  env.secure = device.secure;
}

/** A restored session for `user` on the current device (as after an earlier sign-in). */
function signedInAs(user: TestUser) {
  const token = user.id === USER_A.id ? 'access-a' : 'access-b';
  env.secure.set('quran-heals.auth-session-token.v1', token);
  env.secure.set('quran-heals.auth-refresh-token.v1', `refresh-${user.id}`);
  env.secure.set('quran-heals.auth-cached-user.v1', JSON.stringify(user));
}

async function refresh() {
  await act(async () => { await account.refreshSync(); });
  await settle();
}

beforeEach(() => {
  env.storage = new Map();
  env.secure = new Map();
  env.delayedReads.clear();
  server.records.clear();
  server.online = true;
  server.legacy = false;
  server.puts = [];
  resetPreferencesSyncStateForTests();
  resetLocalDataOwnerForTests();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(fakeBackend));
});

afterEach(async () => {
  await settle();
  await closeApp();
  vi.unstubAllGlobals();
});

describe('signed-in setting changes are never reverted by a later sync', () => {
  it('sign in → set locale to Arabic → full sync → locale remains Arabic, and the account receives Arabic (only that field)', async () => {
    server.records.set(USER_A.id, { ...OLD_CLOUD });
    signedInAs(USER_A);
    await launchApp();
    expect(account.status).toBe('signed-in');
    expect(appLocale.locale).toBe('en');

    await act(async () => { appLocale.setLocale('ar'); });
    await settle();
    expect(server.records.get(USER_A.id)).toMatchObject({ locale: 'ar', translationDisplayMode: 'always' });
    const upload = server.puts.at(-1)!.body;
    expect(Object.keys(upload).sort()).toEqual(['fieldUpdatedAt', 'locale', 'updatedAt']);

    await refresh();
    expect(appLocale.locale).toBe('ar');
    expect(env.storage.get(APP_LOCALE_STORAGE_KEY)).toBe('ar');
  });

  it('each newly synced setting: Appearance, Quran font size, Emotions Language, translation', async () => {
    signedInAs(USER_A);
    await launchApp();

    await act(async () => { appearance.setMode('dark'); });
    await act(async () => { fontSize.increase(); });
    await act(async () => { emotions.setPreference('ar-EG'); });
    await act(async () => { translation.setDisplayMode('always'); });
    await settle();

    expect(server.records.get(USER_A.id)).toMatchObject({ appearance: 'dark', quranFontSize: 28, emotionsLanguage: 'ar-EG', translationDisplayMode: 'always' });
    // The device-only dropdown choice and anything not chosen here are never uploaded.
    expect(server.records.get(USER_A.id)).not.toHaveProperty('locale');
    expect(server.puts.every(({ body }) => !('enabledMode' in body))).toBe(true);
  });

  it('a change made offline survives and reaches the account on the first sync after reconnecting', async () => {
    server.records.set(USER_A.id, { ...OLD_CLOUD });
    signedInAs(USER_A);
    await launchApp();

    server.online = false;
    await act(async () => { appLocale.setLocale('ar'); });
    await act(async () => { appearance.setMode('light'); });
    await refresh(); // offline sync attempt fails quietly
    expect(server.records.get(USER_A.id)).toMatchObject({ locale: 'en' });
    expect(appLocale.locale).toBe('ar');

    server.online = true;
    await refresh();
    expect(server.records.get(USER_A.id)).toMatchObject({ locale: 'ar', appearance: 'light' });
    expect(appLocale.locale).toBe('ar');
    expect(appearance.mode).toBe('light');
  });

  it('reopening the app keeps the newer local choice even when the account still holds an older value', async () => {
    server.records.set(USER_A.id, { ...OLD_CLOUD });
    signedInAs(USER_A);
    await launchApp();
    server.online = false;
    await act(async () => { appLocale.setLocale('ar'); });
    await settle();
    await closeApp();

    server.online = true;
    await launchApp();
    expect(appLocale.locale).toBe('ar');
    expect(server.records.get(USER_A.id)).toMatchObject({ locale: 'ar' });
  });

  it('a genuinely newer account value (changed on another device) is still applied', async () => {
    server.records.set(USER_A.id, { ...OLD_CLOUD });
    signedInAs(USER_A);
    await launchApp();
    await act(async () => { appLocale.setLocale('ar'); });
    await settle();

    const later = new Date(Date.now() + 60_000).toISOString();
    server.records.set(USER_A.id, { ...server.records.get(USER_A.id)!, locale: 'en', fieldUpdatedAt: { ...server.records.get(USER_A.id)!.fieldUpdatedAt, locale: later }, updatedAt: later });
    await refresh();
    expect(appLocale.locale).toBe('en');
  });

  it('an older device`s Egyptian Arabic from the account: Arabic interface, Egyptian Arabic emotions (unless chosen otherwise)', async () => {
    server.records.set(USER_A.id, { ...OLD_CLOUD, locale: 'ar-EG', updatedAt: new Date(Date.now() + 60_000).toISOString() });
    signedInAs(USER_A);
    await launchApp();
    expect(appLocale.locale).toBe('ar');
    expect(env.storage.get(APP_LOCALE_STORAGE_KEY)).toBe('ar');
    expect(env.storage.get(EMOTIONS_LANGUAGE_STORAGE_KEY)).toBe('ar-EG');

    await closeApp();
    env.storage.set(EMOTIONS_LANGUAGE_STORAGE_KEY, 'en');
    server.records.set(USER_A.id, { ...OLD_CLOUD, locale: 'ar-EG', updatedAt: new Date(Date.now() + 120_000).toISOString() });
    await launchApp();
    expect(appLocale.locale).toBe('ar');
    expect(env.storage.get(EMOTIONS_LANGUAGE_STORAGE_KEY)).toBe('en');
  });
});

describe('same account on two devices', () => {
  it('Device A changes, Device B receives; Device B changes, Device A receives', async () => {
    const deviceA = env as unknown as Device;
    const deviceB = newDevice();
    signedInAs(USER_A);
    await launchApp();
    await act(async () => { appearance.setMode('dark'); });
    await act(async () => { fontSize.decrease(); });
    await settle();

    await switchTo(deviceB);
    signedInAs(USER_A);
    await launchApp();
    expect(appearance.mode).toBe('dark');
    expect(fontSize.preferredSize).toBe(24);
    await act(async () => { appLocale.setLocale('ar'); });
    await act(async () => { appearance.setMode('light'); });
    await settle();

    await switchTo({ storage: deviceA.storage, secure: deviceA.secure });
    await launchApp();
    expect(appLocale.locale).toBe('ar');
    expect(appearance.mode).toBe('light');
    expect(fontSize.preferredSize).toBe(24);
  });

  it('two devices change DIFFERENT settings while offline: both changes survive, in either upload order', async () => {
    const deviceA = { storage: env.storage, secure: env.secure };
    const deviceB = newDevice();
    signedInAs(USER_A);
    await launchApp();
    await switchTo(deviceB);
    signedInAs(USER_A);
    await launchApp();

    // B (later) changes Appearance offline; A (earlier) changes the language offline.
    server.online = false;
    await switchTo(deviceA);
    await launchApp();
    await act(async () => { appLocale.setLocale('ar'); });
    await settle();
    await switchTo(deviceB);
    await launchApp();
    await act(async () => { appearance.setMode('dark'); });
    await settle();

    // B reconnects first, then A.
    server.online = true;
    await refresh();
    await switchTo(deviceA);
    await launchApp();
    expect(server.records.get(USER_A.id)).toMatchObject({ locale: 'ar', appearance: 'dark' });
    expect(appearance.mode).toBe('dark');
    expect(appLocale.locale).toBe('ar');
    await switchTo(deviceB);
    await launchApp();
    expect(appLocale.locale).toBe('ar');
    expect(appearance.mode).toBe('dark');
  });

  it('the SAME setting changed on two devices: the later change wins everywhere', async () => {
    const deviceA = { storage: env.storage, secure: env.secure };
    const deviceB = newDevice();
    signedInAs(USER_A);
    await launchApp();
    server.online = false;
    await act(async () => { appearance.setMode('light'); });
    await settle();
    await switchTo(deviceB);
    signedInAs(USER_A);
    await launchApp();
    await act(async () => { appearance.setMode('dark'); }); // later
    await settle();

    server.online = true;
    await refresh(); // B uploads dark
    await switchTo(deviceA);
    await launchApp(); // A's older light is refused and dark applied
    expect(appearance.mode).toBe('dark');
    expect(server.records.get(USER_A.id)).toMatchObject({ appearance: 'dark' });
  });
});

describe('Guest → Account A → sign-out → Account B', () => {
  it('nothing chosen as a guest or under another account is ever uploaded, and each account sees only its own settings', async () => {
    server.records.set(USER_B.id, { locale: 'en', appearance: 'light', updatedAt: T0, fieldUpdatedAt: { locale: T0, appearance: T0 } });

    // Guest: changes settings — stay on the device.
    await launchApp();
    expect(account.status).toBe('guest');
    await act(async () => { appLocale.setLocale('ar'); });
    await act(async () => { appearance.setMode('dark'); });
    await settle();

    // Account A (no account settings yet): signing in uploads nothing and changes nothing here.
    await closeApp();
    signedInAs(USER_A);
    await launchApp();
    expect(account.status).toBe('signed-in');
    expect(server.puts).toHaveLength(0);
    expect(server.records.has(USER_A.id)).toBe(false);
    expect(appLocale.locale).toBe('ar');
    expect(appearance.mode).toBe('dark');

    // A's own change is A's.
    await act(async () => { fontSize.increase(); });
    await settle();
    expect(server.records.get(USER_A.id)).toEqual(expect.objectContaining({ quranFontSize: 28 }));
    expect(server.records.get(USER_A.id)).not.toHaveProperty('appearance');

    // Sign out; as a guest again, another change.
    await act(async () => { await account.signOut(); });
    await settle();
    expect(account.status).toBe('guest');
    await act(async () => { fontSize.increase(); }); // 30, guest only
    await settle();

    // Account B: its own settings are applied; nothing of the guest's or A's is uploaded to it.
    await closeApp();
    signedInAs(USER_B);
    const putsBefore = server.puts.length;
    await launchApp();
    expect(appLocale.locale).toBe('en');
    expect(appearance.mode).toBe('light');
    expect(fontSize.preferredSize).toBe(30); // B never chose a size: the device keeps its own
    expect(server.puts.slice(putsBefore).filter((put) => put.userId === USER_B.id)).toHaveLength(0);
    expect(server.records.get(USER_B.id)).not.toHaveProperty('quranFontSize');
    expect(server.records.get(USER_A.id)).toMatchObject({ quranFontSize: 28 });
    expect(server.records.get(USER_A.id)).not.toHaveProperty('locale');
  });

  it('a change recorded for Account A that never reached the account is uploaded to A later — never to B', async () => {
    signedInAs(USER_A);
    await launchApp();
    server.online = false;
    await act(async () => { appearance.setMode('dark'); });
    await settle();
    await act(async () => { await account.signOut(); });
    await settle();

    server.online = true;
    await closeApp();
    signedInAs(USER_B);
    await launchApp();
    expect(server.records.has(USER_B.id)).toBe(false);

    await act(async () => { await account.signOut(); });
    await settle();
    await closeApp();
    signedInAs(USER_A);
    await launchApp();
    expect(server.records.get(USER_A.id)).toMatchObject({ appearance: 'dark' });
    expect(server.records.has(USER_B.id)).toBe(false);
  });
});

describe('startup hydration', () => {
  it('an account value is never applied before the device`s own settings have loaded (it would be replaced), and nothing is uploaded at launch', async () => {
    server.records.set(USER_A.id, { ...OLD_CLOUD, appearance: 'dark', fieldUpdatedAt: { appearance: T0 } });
    env.storage.set(APP_LOCALE_STORAGE_KEY, 'ar');
    env.storage.set('quran-heals:appearance-preference:v1', JSON.stringify('light'));
    let finishHydration!: () => void;
    env.delayedReads.set(APP_LOCALE_STORAGE_KEY, new Promise<void>((resolve) => { finishHydration = resolve; }));
    signedInAs(USER_A);

    await launchApp();
    expect(account.status).toBe('signed-in');
    expect(appearance.mode).toBe('light');
    expect(server.puts).toHaveLength(0);

    await act(async () => { finishHydration(); });
    await settle();
    expect(appLocale.locale).toBe('en');
    expect(appearance.mode).toBe('dark');
    expect(server.puts).toHaveLength(0);
  });
});

describe('upgrading from the device-wide timestamp of earlier versions', () => {
  it('a restored session inherits it: a newer local language is uploaded, as before — but never a default the user did not choose', async () => {
    server.records.set(USER_A.id, { ...OLD_CLOUD });
    env.storage.set(APP_LOCALE_STORAGE_KEY, 'ar');
    env.storage.set(LEGACY_PREFERENCES_UPDATED_AT_KEY, String(Date.parse('2026-02-01T00:00:00.000Z')));
    signedInAs(USER_A);
    await launchApp();

    expect(appLocale.locale).toBe('ar');
    expect(server.records.get(USER_A.id)).toMatchObject({ locale: 'ar', translationDisplayMode: 'always' });
    expect(env.storage.has(LEGACY_PREFERENCES_UPDATED_AT_KEY)).toBe(false);
  });

  it('an older device-wide timestamp loses to the account, as before', async () => {
    server.records.set(USER_A.id, { ...OLD_CLOUD, updatedAt: '2026-03-01T00:00:00.000Z' });
    env.storage.set(APP_LOCALE_STORAGE_KEY, 'ar');
    env.storage.set(LEGACY_PREFERENCES_UPDATED_AT_KEY, String(Date.parse('2026-02-01T00:00:00.000Z')));
    signedInAs(USER_A);
    await launchApp();

    expect(appLocale.locale).toBe('en');
    expect(server.puts).toHaveLength(0);
  });

  it('a guest launch never claims it for any account; signing out discards it', async () => {
    env.storage.set(APP_LOCALE_STORAGE_KEY, 'ar');
    env.storage.set(LEGACY_PREFERENCES_UPDATED_AT_KEY, String(Date.parse('2026-02-01T00:00:00.000Z')));
    await launchApp();
    expect(account.status).toBe('guest');
    expect(server.puts).toHaveLength(0);
    expect([...env.storage.keys()].some((key) => key.startsWith('quran-heals:preferences-sync:v2'))).toBe(false);

    // The session of an account restored later claims it (that account was signed in when it was written)…
    await closeApp();
    signedInAs(USER_A);
    await launchApp();
    expect(env.storage.has(LEGACY_PREFERENCES_UPDATED_AT_KEY)).toBe(false);
    // …and a sign-out always discards any that is left.
    env.storage.set(LEGACY_PREFERENCES_UPDATED_AT_KEY, String(Date.parse('2026-02-01T00:00:00.000Z')));
    await act(async () => { await account.signOut(); });
    await settle();
    expect(env.storage.has(LEGACY_PREFERENCES_UPDATED_AT_KEY)).toBe(false);
  });
});

describe('a server from before per-field sync', () => {
  it('App Language and translation still sync; the new settings stay pending on the device without errors', async () => {
    server.legacy = true;
    server.records.set(USER_A.id, { ...OLD_CLOUD });
    signedInAs(USER_A);
    await launchApp();

    await act(async () => { appLocale.setLocale('ar'); });
    await act(async () => { appearance.setMode('dark'); });
    await settle();
    await refresh();

    expect(server.records.get(USER_A.id)).toMatchObject({ locale: 'ar' });
    expect(server.records.get(USER_A.id)).not.toHaveProperty('appearance');
    expect(appLocale.locale).toBe('ar');
    expect(appearance.mode).toBe('dark');

    // Once the server is updated, the pending setting goes up at the next sync.
    server.legacy = false;
    await refresh();
    expect(server.records.get(USER_A.id)).toMatchObject({ locale: 'ar', appearance: 'dark' });
  });
});

describe('refreshReading (أورادي وختماتي pull-to-refresh)', () => {
  it('a guest: resolves without any account sync', async () => {
    const { syncReading } = await import('@/sync/readingSync');
    vi.mocked(syncReading).mockClear();
    await launchApp();
    expect(account.status).toBe('guest');
    await act(async () => { await account.refreshReading(); });
    expect(syncReading).not.toHaveBeenCalled();
  });

  it('signed in: runs the reading-only sync for this account and resolves only once it has finished', async () => {
    const { syncReading } = await import('@/sync/readingSync');
    signedInAs(USER_A);
    await launchApp();
    vi.mocked(syncReading).mockClear();
    let finish!: (synced: boolean) => void;
    vi.mocked(syncReading).mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));

    let done = false;
    let refreshing!: Promise<void>;
    await act(async () => { refreshing = account.refreshReading().then(() => { done = true; }); });
    await settle();
    expect(syncReading).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncReading).mock.calls[0][1]).toBe(USER_A.id);
    expect(done).toBe(false);

    await act(async () => { finish(true); await refreshing; });
    expect(done).toBe(true);
  });
});
