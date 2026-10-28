import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The settings made account settings on 2026-10-27, end to end on two
 * simulated devices: the REAL AuthProvider (useAuth.tsx's apply switch and
 * the one-time claim), the REAL setting providers in the app's own order,
 * preferencesSync and recentEmotions, against a fake server running the
 * REAL request validator and merge (backend/src/validators/syncValidators.ts,
 * backend/src/services/preferencesMerge.ts). Each device has its own
 * AsyncStorage and Secure Store; switching device is an app restart there.
 * The Sync Password step is short-circuited (only settings and a stubbed
 * reading sync run), as in preferencesSyncLifecycle.test.ts.
 */

const env = vi.hoisted(() => ({ secure: new Map<string, string>(), storage: new Map<string, string>() }));

vi.mock('react-native', () => ({ Platform: { OS: 'web' }, AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) } }));
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
vi.mock('@/localization/deviceLocale', () => ({ getDeviceLanguageTags: () => ['en-US'], deviceUses24HourClock: () => null }));
vi.mock('@/components/GuestDataSheet', () => ({ GuestDataSheet: () => null }));
vi.mock('@/components/SyncPassphraseSheet', () => ({ SyncPassphraseSheet: () => null }));
vi.mock('@/auth/reauthentication', () => ({ useFreshProviderCredential: () => async () => null }));
vi.mock('@/sync/syncKeyManager', () => {
  class SyncPassphraseCancelledError extends Error {}
  return {
    SyncPassphraseCancelledError,
    discardUnfinishedKeySetup: vi.fn(),
    ensureReflectionMasterKey: vi.fn(async () => { throw new SyncPassphraseCancelledError('Settings-only sync for this test.'); }),
  };
});
vi.mock('@/sync/favoritesSync', () => ({ syncFavorites: vi.fn(async () => true) }));
vi.mock('@/sync/reflectionsSync', () => ({ syncReflections: vi.fn() }));
vi.mock('@/sync/readingSync', () => ({ syncReading: vi.fn(async () => true) }));
vi.mock('@/storage/ayahReflections', () => ({ clearAllReflections: vi.fn(), guestHasReflections: vi.fn(async () => false), adoptGuestReflections: vi.fn(async () => true) }));
vi.mock('@/storage/favorites', () => ({ clearAllFavorites: vi.fn(), guestHasFavorites: vi.fn(async () => false), adoptGuestFavorites: vi.fn(async () => true) }));

const { putPreferencesSchema } = await import('../../backend/src/validators/syncValidators');
const { mergePreferences, toPreferencesDto } = await import('../../backend/src/services/preferencesMerge');
type StoredPreferences = import('../../backend/src/services/preferencesMerge').StoredPreferences;

const { AuthProvider, useAuth } = await import('@/auth/useAuth');
const { resetAuthEpochForTests } = await import('@/auth/authEpoch');
const { registerSessionExpiredHandler } = await import('@/auth/tokenManager');
const { FavoriteReciterProvider, useFavoriteReciter } = await import('@/audio/useFavoriteReciter');
const { AppLocaleProvider } = await import('@/localization/useAppLocale');
const { EmotionsLanguageProvider } = await import('@/localization/useEmotionsLanguage');
const { QuranFontSizePreferenceProvider } = await import('@/localization/useQuranFontSizePreference');
const { QuranTranslationPreferenceProvider, useQuranTranslationPreference } = await import('@/localization/useQuranTranslationPreference');
const { MemorizationModeSettingProvider, useMemorizationModeSetting } = await import('@/memorization/useMemorizationModeSetting');
const { KeepAwakePreferenceProvider, useKeepAwakePreference } = await import('@/mushaf/useKeepAwakePreference');
const { WordMeaningsVisibilityProvider, useWordMeaningsVisibility } = await import('@/mushaf/useWordMeaningsVisibility');
const { loadGuideProgress, saveGuideProgress } = await import('@/mushaf/mushafGuide');
const { resetLocalDataOwnerForTests } = await import('@/storage/localDataOwner');
const { loadRecentEmotionKeys, recordEmotionUse } = await import('@/storage/recentEmotions');
const { resetPreferencesSyncStateForTests } = await import('@/sync/preferencesSyncState');
const { AppearancePreferenceProvider } = await import('@/theme/useAppearancePreference');

const USER = { id: 'user-a', provider: 'google' as const, createdAt: '2026-01-01T00:00:00.000Z' };
let stored: StoredPreferences | null = null;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data }), { status });
}
async function fakeServer(url: string, init?: RequestInit): Promise<Response> {
  const path = new URL(url).pathname;
  if (path === '/api/auth/session') return json(USER);
  if (path !== '/api/sync/preferences') return json(null, 404);
  if (init?.method === 'PUT') {
    const parsed = putPreferencesSchema.safeParse(JSON.parse(String(init.body)));
    if (!parsed.success) return json(null, 400);
    const { updatedAt, fieldUpdatedAt = {}, ...values } = parsed.data;
    const instants = Object.fromEntries(Object.entries(fieldUpdatedAt).filter(([, at]) => at).map(([field, at]) => [field, new Date(at as string)]));
    stored = mergePreferences(stored, values, new Date(updatedAt), instants) ?? stored;
  }
  return json(stored ? toPreferencesDto(stored) : null);
}

let root: ReactTestRenderer | undefined;
let account: ReturnType<typeof useAuth>;
let reciter: ReturnType<typeof useFavoriteReciter>;
let keepAwake: ReturnType<typeof useKeepAwakePreference>;
let wordMeanings: ReturnType<typeof useWordMeaningsVisibility>;
let memorization: ReturnType<typeof useMemorizationModeSetting>;
let translation: ReturnType<typeof useQuranTranslationPreference>;
function Probe() {
  account = useAuth();
  reciter = useFavoriteReciter();
  keepAwake = useKeepAwakePreference();
  wordMeanings = useWordMeaningsVisibility();
  memorization = useMemorizationModeSetting();
  translation = useQuranTranslationPreference();
  return null;
}

/** The app's own provider order (app/_layout.tsx), without the reminders' provider (its own tests: notificationsProvider.test.ts). */
const tree = () =>
  createElement(AppearancePreferenceProvider, null,
    createElement(AppLocaleProvider, null,
      createElement(EmotionsLanguageProvider, null,
        createElement(QuranTranslationPreferenceProvider, null,
          createElement(QuranFontSizePreferenceProvider, null,
            createElement(KeepAwakePreferenceProvider, null,
              createElement(WordMeaningsVisibilityProvider, null,
                createElement(MemorizationModeSettingProvider, null,
                  createElement(FavoriteReciterProvider, null,
                    createElement(AuthProvider, null, createElement(Probe)))))))))));

async function settle() {
  await act(async () => {
    for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
  });
}
type Device = { storage: Map<string, string>; secure: Map<string, string> };
const newDevice = (): Device => ({ storage: new Map(), secure: new Map() });
/** Opens the app on `device`, with a session for USER restored (as after an earlier sign-in there). */
async function openSignedIn(device: Device) {
  await act(async () => { root?.unmount(); });
  registerSessionExpiredHandler(null);
  resetPreferencesSyncStateForTests();
  resetLocalDataOwnerForTests();
  resetAuthEpochForTests();
  env.storage = device.storage;
  env.secure = device.secure;
  env.secure.set('quran-heals.auth-session-token.v1', 'access-a');
  env.secure.set('quran-heals.auth-refresh-token.v1', 'refresh-a');
  env.secure.set('quran-heals.auth-cached-user.v1', JSON.stringify(USER));
  await act(async () => { root = create(tree()); });
  await settle();
  expect(account.status).toBe('signed-in');
}

beforeEach(() => {
  stored = null;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(fakeServer));
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  registerSessionExpiredHandler(null);
  vi.unstubAllGlobals();
});

describe('account settings across two devices (end to end)', () => {
  it('chosen on A while signed in, shown on B when it opens: switches, reciter, kept dropdown choice, guide, recent emotions', async () => {
    const a = newDevice();
    const b = newDevice();
    await openSignedIn(a);
    await act(async () => {
      keepAwake.setEnabled(false);
      wordMeanings.setVisible(false);
      memorization.setVisible(false);
      reciter.setReciterId('husary');
      translation.setTranslationMode('always'); // Show Translation is OFF: only the kept choice changes
    });
    await saveGuideProgress({ status: 'done', finished: true });
    await recordEmotionUse('grateful');
    await settle();
    expect(stored).toMatchObject({ keepAwake: false, wordMeaningsVisible: false, memorizationModeVisible: false, favoriteReciter: 'husary', translationEnabledMode: 'always', mushafGuide: 'finished' });
    expect(stored?.recentEmotions?.map((entry) => entry.key)).toEqual(['grateful']);

    await openSignedIn(b);
    expect(keepAwake.enabled).toBe(false);
    expect(wordMeanings.visible).toBe(false);
    expect(memorization.visible).toBe(false);
    expect(reciter.reciterId).toBe('husary');
    expect(translation.preference).toMatchObject({ displayMode: 'off', enabledMode: 'always' });
    expect(await loadGuideProgress()).toEqual({ status: 'done', finished: true });
    expect(await loadRecentEmotionKeys('user-a')).toEqual(['grateful']);
    // Saved on B as B's own copy of the account's values (B shows them after a restart even offline).
    expect(b.storage.get('quran-heals:mushaf-keep-awake:v1')).toBe('false');
  });

  it('B`s own choice saved before this version never replaces the account`s, and B`s defaults never reach the account', async () => {
    const a = newDevice();
    await openSignedIn(a);
    await act(async () => { reciter.setReciterId('shatri'); });
    await settle();

    const b = newDevice();
    b.storage.set('quran-heals:favorite-reciter:v1', 'husary'); // chosen on B before settings synced
    b.storage.set('quran-heals:word-meanings-visible:v1', 'false'); // also chosen on B, unknown to the account
    await openSignedIn(b);
    expect(reciter.reciterId).toBe('shatri');
    expect(stored?.favoriteReciter).toBe('shatri');
    // What the account did not hold yet, B's saved choice provides; B's defaults (never saved) stay off the account.
    expect(stored?.wordMeaningsVisible).toBe(false);
    expect(stored?.keepAwake).toBeUndefined();
    expect(stored?.memorizationModeVisible).toBeUndefined();
  });
});
