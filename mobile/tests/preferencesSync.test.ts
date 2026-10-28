import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Per-field settings sync, unit level (sync/preferencesSync.ts,
 * sync/preferencesSyncState.ts). End-to-end flows with the real providers
 * and AuthProvider: preferencesSyncLifecycle.test.ts.
 */

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

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

const { syncPreferences, pushPreferences } = await import('@/sync/preferencesSync');
const { parseCloudPreferences } = await import('@/sync/preferenceFields');
const {
  hasUnsyncedPreferences,
  loadAccountPreferenceState,
  recordLocalPreferenceChange,
  resetPreferencesSyncStateForTests,
  subscribeToLocalPreferenceChanges,
} = await import('@/sync/preferencesSyncState');
const { setLocalDataOwnerState, resetLocalDataOwnerForTests } = await import('@/storage/localDataOwner');

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-01-02T00:00:00.000Z';
const T3 = '2026-01-03T00:00:00.000Z';

type Body = Record<string, unknown> & { updatedAt: string; fieldUpdatedAt?: Record<string, string> };

/** A fake endpoint: GET returns `cloud`; PUT records the body and returns `reply(body)` (default: the body as stored). */
function backend(cloud: unknown, reply?: (body: Body) => unknown) {
  const puts: Body[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Body;
      puts.push(body);
      return new Response(JSON.stringify({ success: true, data: reply ? reply(body) : body }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, data: cloud }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { puts, fetchMock };
}

function activeOwner(userId: string | null) {
  setLocalDataOwnerState({ activeUserId: userId, keptSeparate: [], resolved: true });
}

/** Lets fire-and-forget recording finish. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  asyncStorage.clear();
  resetPreferencesSyncStateForTests();
  resetLocalDataOwnerForTests();
});

afterEach(() => vi.unstubAllGlobals());

describe('recording the user`s own changes', () => {
  it('is per account: recorded for the active account only, never for a guest', async () => {
    activeOwner(null);
    recordLocalPreferenceChange('appearance', 'dark');
    await flush();
    activeOwner('user-a');
    recordLocalPreferenceChange('quranFontSize', 30);
    await flush();

    expect((await loadAccountPreferenceState('user-a')).fields).toEqual({ quranFontSize: { value: 30, updatedAt: expect.any(Number), synced: false } });
    expect([...asyncStorage.keys()].filter((key) => key.startsWith('quran-heals:preferences-sync'))).toEqual(['quran-heals:preferences-sync:v2:account:user-a']);
  });

  it('notifies the upload listener with the account the change belongs to; instants never repeat', async () => {
    activeOwner('user-a');
    const owners: string[] = [];
    const unsubscribe = subscribeToLocalPreferenceChanges((owner) => owners.push(owner));
    recordLocalPreferenceChange('appearance', 'dark');
    recordLocalPreferenceChange('locale', 'ar');
    await flush();
    unsubscribe();

    expect(owners).toEqual(['user-a', 'user-a']);
    const { fields } = await loadAccountPreferenceState('user-a');
    expect(fields.locale!.updatedAt).toBeGreaterThan(fields.appearance!.updatedAt);
  });

  it('survives an app restart', async () => {
    activeOwner('user-a');
    recordLocalPreferenceChange('emotionsLanguage', 'en');
    await flush();
    resetPreferencesSyncStateForTests();

    expect(await hasUnsyncedPreferences('user-a')).toBe(true);
    expect((await loadAccountPreferenceState('user-a')).fields.emotionsLanguage).toMatchObject({ value: 'en', synced: false });
  });
});

describe('syncPreferences', () => {
  it('applies every account value this device has not changed since, and uploads nothing when nothing is pending', async () => {
    const { puts } = backend({ locale: 'ar', appearance: 'dark', quranFontSize: 30, updatedAt: T2, fieldUpdatedAt: { locale: T1, appearance: T2, quranFontSize: T2 } });
    const apply = vi.fn();

    await syncPreferences('token', 'user-a', apply);

    expect(apply.mock.calls).toEqual([['locale', 'ar'], ['appearance', 'dark'], ['quranFontSize', 30]]);
    expect(puts).toHaveLength(0);
    expect(await hasUnsyncedPreferences('user-a')).toBe(false);
  });

  it('an account that never stored settings: nothing is applied and nothing is uploaded', async () => {
    const { puts } = backend(null);
    const apply = vi.fn();
    await syncPreferences('token', 'user-a', apply);
    expect(apply).not.toHaveBeenCalled();
    expect(puts).toHaveLength(0);
  });

  it('a pending change newer than the account is kept and uploaded alone, with its own instant', async () => {
    activeOwner('user-a');
    recordLocalPreferenceChange('appearance', 'light');
    await flush();
    const { appearance } = (await loadAccountPreferenceState('user-a')).fields;
    const { puts } = backend({ appearance: 'dark', locale: 'en', updatedAt: T1, fieldUpdatedAt: { appearance: T1, locale: T1 } });
    const apply = vi.fn();

    await syncPreferences('token', 'user-a', apply);

    expect(apply.mock.calls).toEqual([['locale', 'en']]);
    expect(puts).toEqual([{ appearance: 'light', fieldUpdatedAt: { appearance: new Date(appearance!.updatedAt).toISOString() }, updatedAt: new Date(appearance!.updatedAt).toISOString() }]);
    expect(await hasUnsyncedPreferences('user-a')).toBe(false);
  });

  it('an account value newer than the pending change wins (and an exact tie keeps the account`s)', async () => {
    activeOwner('user-a');
    recordLocalPreferenceChange('appearance', 'light');
    recordLocalPreferenceChange('quranFontSize', 22);
    await flush();
    const { fields } = await loadAccountPreferenceState('user-a');
    const later = new Date(fields.appearance!.updatedAt + 1000).toISOString();
    const tie = new Date(fields.quranFontSize!.updatedAt).toISOString();
    const { puts } = backend({ appearance: 'dark', quranFontSize: 32, updatedAt: later, fieldUpdatedAt: { appearance: later, quranFontSize: tie } });
    const apply = vi.fn();

    await syncPreferences('token', 'user-a', apply);

    expect(apply.mock.calls).toEqual([['appearance', 'dark'], ['quranFontSize', 32]]);
    expect(puts).toHaveLength(0);
  });

  it('never applies an unknown or invalid account value (a newer app`s, or damaged data)', async () => {
    backend({ appearance: 'sepia', quranFontSize: 27, emotionsLanguage: 'fr', locale: 'en', updatedAt: T1 });
    const apply = vi.fn();
    await syncPreferences('token', 'user-a', apply);
    expect(apply.mock.calls).toEqual([['locale', 'en']]);
  });

  it('applies nothing on the device once its session has ended, but keeps the account`s state', async () => {
    backend({ appearance: 'dark', updatedAt: T1, fieldUpdatedAt: { appearance: T1 } });
    const apply = vi.fn();
    await syncPreferences('token', 'user-a', apply, { isCurrent: () => false });
    expect(apply).not.toHaveBeenCalled();
    expect((await loadAccountPreferenceState('user-a')).fields.appearance).toMatchObject({ value: 'dark', synced: true });
  });
});

describe('pushPreferences', () => {
  it('a change made while the upload is in flight stays pending for the next upload (never marked synced by the earlier one)', async () => {
    activeOwner('user-a');
    recordLocalPreferenceChange('appearance', 'light');
    await flush();
    const { puts } = backend(null, (body) => {
      // The user changes it again while this request is in flight.
      recordLocalPreferenceChange('appearance', 'dark');
      return body;
    });

    await pushPreferences('token', 'user-a', vi.fn());
    await flush();

    expect(puts).toHaveLength(1);
    expect((await loadAccountPreferenceState('user-a')).fields.appearance).toMatchObject({ value: 'dark', synced: false });
  });

  it('a server from before per-field sync: a stored field is confirmed, a field it does not know stays pending', async () => {
    activeOwner('user-a');
    recordLocalPreferenceChange('locale', 'ar');
    recordLocalPreferenceChange('appearance', 'dark');
    await flush();
    // The previous server keeps only its three fields and one timestamp.
    backend(null, (body) => ({ locale: body.locale, updatedAt: body.updatedAt }));
    const apply = vi.fn();

    await pushPreferences('token', 'user-a', apply);

    const { fields } = await loadAccountPreferenceState('user-a');
    expect(fields.locale).toMatchObject({ value: 'ar', synced: true });
    expect(fields.appearance).toMatchObject({ value: 'dark', synced: false });
    expect(apply).not.toHaveBeenCalled();
  });

  it('the previous server refusing an older upload: the account`s newer value is adopted and applied', async () => {
    activeOwner('user-a');
    recordLocalPreferenceChange('locale', 'ar');
    await flush();
    const future = new Date(Date.now() + 60_000).toISOString();
    backend(null, () => ({ locale: 'en', updatedAt: future }));
    const apply = vi.fn();

    await pushPreferences('token', 'user-a', apply);

    expect(apply.mock.calls).toEqual([['locale', 'en']]);
    expect((await loadAccountPreferenceState('user-a')).fields.locale).toMatchObject({ value: 'en', synced: true });
  });

  it('a device clock running ahead: the account stores its own, earlier instant; it is kept here (synced), so a later change elsewhere still wins', async () => {
    activeOwner('user-a');
    recordLocalPreferenceChange('appearance', 'light');
    await flush();
    const sentAt = (await loadAccountPreferenceState('user-a')).fields.appearance!.updatedAt;
    // The server's time (backend/src/services/clientInstants.ts): earlier than this device's clock.
    const storedAt = new Date(sentAt - 60 * 60_000).toISOString();
    const { puts } = backend(null, (body) => ({ ...body, updatedAt: storedAt, fieldUpdatedAt: { appearance: storedAt } }));
    const apply = vi.fn();

    await pushPreferences('token', 'user-a', apply);

    expect(puts).toHaveLength(1);
    expect(apply).not.toHaveBeenCalled();
    expect((await loadAccountPreferenceState('user-a')).fields.appearance).toEqual({ value: 'light', updatedAt: Date.parse(storedAt), synced: true });
    expect(await hasUnsyncedPreferences('user-a')).toBe(false);

    // Another device (correct clock) changes it a little later — still before this device's own clock.
    const laterAt = new Date(Date.parse(storedAt) + 1000).toISOString();
    const second = backend({ appearance: 'dark', updatedAt: laterAt, fieldUpdatedAt: { appearance: laterAt } });
    await syncPreferences('token', 'user-a', apply);
    expect(apply.mock.calls).toEqual([['appearance', 'dark']]);
    expect(second.puts).toHaveLength(0);
  });

  it('a failed upload (offline) leaves the change pending and throws for the caller to ignore', async () => {
    activeOwner('user-a');
    recordLocalPreferenceChange('quranFontSize', 24);
    await flush();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network request failed'); }));

    await expect(pushPreferences('token', 'user-a', vi.fn())).rejects.toThrow();
    expect(await hasUnsyncedPreferences('user-a')).toBe(true);
  });
});

describe('parseCloudPreferences', () => {
  it('reads a record from before per-field instants as changed at its updatedAt', () => {
    expect(parseCloudPreferences({ locale: 'ar', translationDisplayMode: 'off', updatedAt: T3 })).toEqual({
      locale: { value: 'ar', at: Date.parse(T3) },
      translationDisplayMode: { value: 'off', at: Date.parse(T3) },
    });
  });
});

describe('recent-ayah history is never part of preferences sync', () => {
  it('preferencesSync.ts does not import the recent-ayah history module', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../src/sync/preferencesSync.ts'), 'utf-8');
    expect(source).not.toMatch(/recentAyahHistory|recentAyahs/);
  });
});

describe('Quran Translation (synced as quranLanguage)', () => {
  it("the value synced while it was called Quran Language is None's own id; anything else is never applied", async () => {
    const { isSyncedPreferenceValue } = await import('@/sync/preferenceFields');
    const { DEFAULT_QURAN_READING_MODE, QURAN_READING_MODES } = await import('@/localization/quranLanguage');
    expect(QURAN_READING_MODES).toEqual([{ id: 'quran-text', labelKey: 'quranTranslationNone' }]);
    expect(DEFAULT_QURAN_READING_MODE).toBe('quran-text');
    expect(isSyncedPreferenceValue('quranLanguage', 'quran-text')).toBe(true);
    for (const unsupported of ['english', 'en', 'turkish', 'none', '', null, 3]) expect(isSyncedPreferenceValue('quranLanguage', unsupported)).toBe(false);
  });
});

describe('device-only settings are never synced', () => {
  it('the account fields (2026-10-27): offline download and the last browsed page are still never account fields', async () => {
    const { SYNCED_PREFERENCE_FIELDS } = await import('@/sync/preferenceFields');
    expect([...SYNCED_PREFERENCE_FIELDS].sort()).toEqual([
      'appearance', 'emotionsLanguage', 'favoriteReciter', 'keepAwake', 'locale', 'memorizationGuide', 'memorizationModeVisible', 'mushafGuide',
      'notificationEmotionCheckIn', 'notificationRandomAyah', 'notificationWird', 'quranFontSize', 'quranLanguage', 'translationDisplayMode',
      'translationEnabledMode', 'translationId', 'wordMeaningsVisible',
    ]);
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const file of ['../src/sync/preferencesSync.ts', '../src/sync/preferenceFields.ts', '../src/sync/preferencesSyncState.ts', '../src/sync/devicePreferencesClaim.ts']) {
      expect(readFileSync(resolve(__dirname, file), 'utf-8')).not.toMatch(/mushaf-offline-auto|mushaf-last-page|lastBrowsedPage|autoDownload/);
    }
  });
});
