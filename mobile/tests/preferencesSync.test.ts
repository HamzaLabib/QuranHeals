import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { reconcilePreferencesOnSignIn, pushPreferences } = await import('@/sync/preferencesSync');
const {
  getLocalPreferencesUpdatedAt,
  hasUnsyncedLocalPreferences,
  recordLocalPreferencesUpdatedAt,
  resetPreferencesSyncStateForTests,
} = await import('@/sync/preferencesSyncState');

beforeEach(() => {
  asyncStorage.clear();
  resetPreferencesSyncStateForTests();
});

afterEach(() => vi.unstubAllGlobals());

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe('reconcilePreferencesOnSignIn', () => {
  it('uploads the local preference when the account has never stored one', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === undefined) {
        // GET /api/sync/preferences
        return new Response(JSON.stringify({ success: true, data: null }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, data: JSON.parse(String(init.body)) }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const applyLocally = vi.fn();

    await reconcilePreferencesOnSignIn(
      'token',
      { locale: 'ar', translationDisplayMode: 'on-demand', translationId: 'pickthall' },
      applyLocally,
    );

    expect(applyLocally).not.toHaveBeenCalled();
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(putCall).toBeDefined();
    const body = JSON.parse(String(putCall![1]!.body));
    expect(body).toMatchObject({ locale: 'ar', translationDisplayMode: 'on-demand', translationId: 'pickthall' });
  });

  it('applies the cloud preference locally when the account already has one', async () => {
    mockFetchOnce({
      success: true,
      data: { locale: 'en', translationDisplayMode: 'off', updatedAt: '2026-01-01T00:00:00.000Z' },
    });
    const applyLocally = vi.fn();

    await reconcilePreferencesOnSignIn('token', { locale: 'ar', translationDisplayMode: 'always', translationId: 'x' }, applyLocally);

    expect(applyLocally).toHaveBeenCalledWith({ locale: 'en', translationDisplayMode: 'off', translationId: undefined });
  });
});

describe('pushPreferences', () => {
  it('sends the current local preference as the new account-wide value', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ success: true, data: JSON.parse(String(init!.body)) }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await pushPreferences('token', { locale: 'ar-EG', translationDisplayMode: 'always', translationId: 'x' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('PUT');
    const body = JSON.parse(String(init!.body));
    expect(body.locale).toBe('ar-EG');
    expect(typeof body.updatedAt).toBe('string');
  });
});

const OLDER = '2026-01-01T00:00:00.000Z';
const NEWER = '2026-06-01T00:00:00.000Z';
const LOCAL_AR = { locale: 'ar' as const, translationDisplayMode: 'on-demand' as const, translationId: 'pickthall' };

/** A fake backend preferences endpoint with the same last-write-wins rule as MongooseSyncRepository.putPreferences. */
function fakePreferencesServer(initial: Record<string, unknown> | null) {
  const server = { stored: initial, puts: [] as Record<string, unknown>[] };
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      server.puts.push(body);
      if (!server.stored || Date.parse(String(body.updatedAt)) > Date.parse(String(server.stored.updatedAt))) server.stored = body;
    }
    return new Response(JSON.stringify({ success: true, data: server.stored }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return server;
}

describe('reconcilePreferencesOnSignIn: last-write-wins by timestamp', () => {
  it('a newer local preference wins over an older cloud preference and is uploaded with its own change time', async () => {
    recordLocalPreferencesUpdatedAt(Date.parse(NEWER));
    const server = fakePreferencesServer({ locale: 'en', translationDisplayMode: 'always', updatedAt: OLDER });
    const applyLocally = vi.fn();

    await reconcilePreferencesOnSignIn('token', LOCAL_AR, applyLocally);

    expect(applyLocally).not.toHaveBeenCalled();
    expect(server.puts).toHaveLength(1);
    expect(server.puts[0]).toMatchObject({ locale: 'ar', translationDisplayMode: 'on-demand', updatedAt: NEWER });
    expect(server.stored).toMatchObject({ locale: 'ar', updatedAt: NEWER });
    expect(await hasUnsyncedLocalPreferences()).toBe(false);
  });

  it('a newer cloud preference (another device) still wins over an older local one', async () => {
    recordLocalPreferencesUpdatedAt(Date.parse(OLDER));
    const server = fakePreferencesServer({ locale: 'ar-EG', translationDisplayMode: 'off', updatedAt: NEWER });
    const applyLocally = vi.fn();

    await reconcilePreferencesOnSignIn('token', LOCAL_AR, applyLocally);

    expect(applyLocally).toHaveBeenCalledWith({ locale: 'ar-EG', translationDisplayMode: 'off', translationId: undefined });
    expect(server.puts).toHaveLength(0);
    expect(await getLocalPreferencesUpdatedAt()).toBe(Date.parse(NEWER));
  });

  it('equal timestamps mean the device and account already agree: no upload, no local overwrite', async () => {
    recordLocalPreferencesUpdatedAt(Date.parse(NEWER));
    const server = fakePreferencesServer({ locale: 'ar', translationDisplayMode: 'on-demand', updatedAt: NEWER });
    const applyLocally = vi.fn();

    await reconcilePreferencesOnSignIn('token', LOCAL_AR, applyLocally);

    expect(applyLocally).not.toHaveBeenCalled();
    expect(server.puts).toHaveLength(0);
  });

  it('a change made while the cloud request is in flight is the value uploaded (read at decision time, not a stale snapshot)', async () => {
    let current = { locale: 'en' as 'en' | 'ar', translationDisplayMode: 'always' as const, translationId: 'pickthall' };
    let releaseGet!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGet = resolve; });
    const puts: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        puts.push(body);
        return new Response(JSON.stringify({ success: true, data: body }), { status: 200 });
      }
      await gate;
      return new Response(JSON.stringify({ success: true, data: { locale: 'en', updatedAt: OLDER } }), { status: 200 });
    }));
    const applyLocally = vi.fn();

    const reconciling = reconcilePreferencesOnSignIn('token', () => current, applyLocally);
    current = { ...current, locale: 'ar' };
    recordLocalPreferencesUpdatedAt(Date.parse(NEWER));
    releaseGet();
    await reconciling;

    expect(applyLocally).not.toHaveBeenCalled();
    expect(puts).toEqual([expect.objectContaining({ locale: 'ar', updatedAt: NEWER })]);
  });

  it('a device that never recorded a change adopts the existing account preference, as before', async () => {
    const server = fakePreferencesServer({ locale: 'ar', translationDisplayMode: 'off', updatedAt: OLDER });
    const applyLocally = vi.fn();

    await reconcilePreferencesOnSignIn('token', { ...LOCAL_AR, locale: 'en' }, applyLocally);

    expect(applyLocally).toHaveBeenCalledWith({ locale: 'ar', translationDisplayMode: 'off', translationId: undefined });
    expect(server.puts).toHaveLength(0);
  });
});

describe('pushPreferences: change timestamps', () => {
  it('uploads with the recorded change time, never a later "now" that could beat a genuinely newer value elsewhere', async () => {
    recordLocalPreferencesUpdatedAt(Date.parse(OLDER));
    const server = fakePreferencesServer({ locale: 'ar-EG', translationDisplayMode: 'off', updatedAt: NEWER });

    await pushPreferences('token', LOCAL_AR);

    expect(server.puts[0]).toMatchObject({ locale: 'ar', updatedAt: OLDER });
    expect(server.stored).toMatchObject({ locale: 'ar-EG', updatedAt: NEWER });
    // Not confirmed by the account, so it is not marked synced.
    expect(await hasUnsyncedLocalPreferences()).toBe(true);
  });

  it('the recorded change time survives an app restart', async () => {
    recordLocalPreferencesUpdatedAt(Date.parse(NEWER));
    await vi.waitFor(() => expect(asyncStorage.get('quran-heals:preferences-updated-at:v1')).toBe(String(Date.parse(NEWER))));

    resetPreferencesSyncStateForTests();

    expect(await getLocalPreferencesUpdatedAt()).toBe(Date.parse(NEWER));
  });

  it('the recorded change time never moves backwards', async () => {
    recordLocalPreferencesUpdatedAt(Date.parse(NEWER));
    recordLocalPreferencesUpdatedAt(Date.parse(OLDER));
    expect(await getLocalPreferencesUpdatedAt()).toBe(Date.parse(NEWER));
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
