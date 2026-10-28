import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The settings made account settings on 2026-10-27 (sync/preferenceFields.ts)
 * and Home's recent emotions, across simulated devices: each device has its
 * own AsyncStorage (switching device = an app restart with that device's
 * storage), and one fake server runs the REAL server rules — the request
 * validator (backend/src/validators/syncValidators.ts) and the merge
 * (backend/src/services/preferencesMerge.ts). Covers restoring on another
 * device, offline edits, conflicts, account switching, older servers and
 * accounts with missing fields, and the one-time claim of saved device
 * choices (sync/devicePreferencesClaim.ts).
 */

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const env = vi.hoisted(() => ({ storage: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => env.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { env.storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { env.storage.delete(key); }),
  },
}));

const { putPreferencesSchema } = await import('../../../backend/src/validators/syncValidators');
const { mergePreferences, toPreferencesDto, PREFERENCE_FIELDS } = await import('../../../backend/src/services/preferencesMerge');
type StoredPreferences = import('../../../backend/src/services/preferencesMerge').StoredPreferences;

const { syncPreferences, pushPreferences } = await import('@/sync/preferencesSync');
const { hasUnsyncedPreferences, loadAccountPreferenceState, recordLocalPreferenceChange, resetPreferencesSyncStateForTests } = await import('@/sync/preferencesSyncState');
const { claimDevicePreferences, forgoDevicePreferencesClaim, SEED_AT } = await import('@/sync/devicePreferencesClaim');
const { setLocalDataOwnerState, resetLocalDataOwnerForTests } = await import('@/storage/localDataOwner');
const { loadRecentEmotionKeys, loadRecentEmotionUses, recordEmotionUse, RECENT_EMOTIONS_STORAGE_KEY } = await import('@/storage/recentEmotions');

// ── One fake server (per account), running the real rules ─────────────────

const NEW_FIELDS = [
  'translationEnabledMode', 'favoriteReciter', 'keepAwake', 'wordMeaningsVisible', 'memorizationModeVisible', 'notificationWird',
  'notificationRandomAyah', 'notificationEmotionCheckIn', 'mushafGuide', 'memorizationGuide', 'recentEmotions',
] as const;

const server = {
  accounts: new Map<string, StoredPreferences | null>(),
  offline: false,
  /** A server from before 2026-10-27: it strips the new fields, as its validator did. */
  old: false,
  puts: [] as { user: string; body: Record<string, unknown> }[],
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data, message: 'error' }), { status });
}

/** Tokens are `token-<user>`: the account the request is for. */
async function fakeServer(_url: string, init?: RequestInit): Promise<Response> {
  if (server.offline) throw new TypeError('Network request failed');
  const user = String((init?.headers as Record<string, string>).Authorization).replace('Bearer token-', '');
  const stored = server.accounts.get(user) ?? null;
  if (init?.method !== 'PUT') return json(stored ? toPreferencesDto(stored) : null);
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  server.puts.push({ user, body });
  const parsed = putPreferencesSchema.safeParse(body);
  if (!parsed.success) return json(null, 400);
  const { updatedAt, fieldUpdatedAt = {}, ...values } = parsed.data;
  if (server.old) for (const field of NEW_FIELDS) delete (values as Record<string, unknown>)[field];
  const instants = Object.fromEntries(Object.entries(fieldUpdatedAt).filter(([field, at]) => at && (!server.old || !NEW_FIELDS.includes(field as never))).map(([field, at]) => [field, new Date(at as string)]));
  const merged = mergePreferences(stored, values, new Date(updatedAt), instants);
  if (merged) server.accounts.set(user, merged);
  const now = server.accounts.get(user) ?? null;
  return json(now ? toPreferencesDto(now) : { updatedAt, fieldUpdatedAt: {} });
}

// ── Devices ────────────────────────────────────────────────────────────────

const devices = new Map<string, Map<string, string>>();
/** Opens the app on `device`, signed in to `user` (null: a guest). */
function useDevice(device: string, user: string | null) {
  if (!devices.has(device)) devices.set(device, new Map());
  env.storage = devices.get(device)!;
  resetPreferencesSyncStateForTests();
  resetLocalDataOwnerForTests();
  setLocalDataOwnerState({ activeUserId: user, keptSeparate: [], resolved: true });
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const applied = () => {
  const calls: [string, unknown][] = [];
  return { calls, apply: (field: string, value: unknown) => { calls.push([field, value]); } };
};
const sync = (user: string, apply = applied().apply) => syncPreferences(`token-${user}`, user, apply as never);
const accountValue = (user: string, field: string) => (server.accounts.get(user) as Record<string, unknown> | null | undefined)?.[field];

const WIRD_EVENING = { enabled: true, frequency: 'daily', time: '20:30', weekday: null, anchor: null };
const CHECK_IN_TWICE = { enabled: true, frequency: 'twiceDaily', time: '21:00', weekday: null, anchor: null, twice: { morning: '07:15', evening: '22:45' } };

beforeEach(() => {
  server.accounts.clear();
  server.offline = false;
  server.old = false;
  server.puts = [];
  devices.clear();
  vi.stubGlobal('fetch', vi.fn(fakeServer));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('restoring on another device', () => {
  it('every new setting chosen on A is applied on B, which uploads nothing of its own', async () => {
    useDevice('A', 'user-1');
    recordLocalPreferenceChange('favoriteReciter', 'husary');
    recordLocalPreferenceChange('keepAwake', false);
    recordLocalPreferenceChange('wordMeaningsVisible', false);
    recordLocalPreferenceChange('memorizationModeVisible', false);
    recordLocalPreferenceChange('translationEnabledMode', 'always');
    recordLocalPreferenceChange('notificationWird', WIRD_EVENING as never);
    recordLocalPreferenceChange('notificationEmotionCheckIn', CHECK_IN_TWICE as never);
    recordLocalPreferenceChange('mushafGuide', 'finished');
    recordLocalPreferenceChange('memorizationGuide', 'done');
    await flush();
    await pushPreferences('token-user-1', 'user-1', () => {});
    expect(await hasUnsyncedPreferences('user-1')).toBe(false);

    useDevice('B', 'user-1');
    const b = applied();
    await sync('user-1', b.apply);

    expect(Object.fromEntries(b.calls)).toEqual({
      favoriteReciter: 'husary',
      keepAwake: false,
      wordMeaningsVisible: false,
      memorizationModeVisible: false,
      translationEnabledMode: 'always',
      notificationWird: WIRD_EVENING,
      notificationEmotionCheckIn: CHECK_IN_TWICE,
      mushafGuide: 'finished',
      memorizationGuide: 'done',
    });
    // The kept dropdown choice is applied after the display mode it belongs to.
    expect(server.puts.filter((put) => put.user === 'user-1')).toHaveLength(1);
  });

  it('a setting the account never stored is never applied (no default reaches the device), and nothing is uploaded for it', async () => {
    useDevice('A', 'user-1');
    recordLocalPreferenceChange('keepAwake', false);
    await flush();
    await pushPreferences('token-user-1', 'user-1', () => {});

    useDevice('B', 'user-1');
    const b = applied();
    await sync('user-1', b.apply);
    expect(b.calls).toEqual([['keepAwake', false]]);
    expect(accountValue('user-1', 'favoriteReciter')).toBeUndefined();
    expect(accountValue('user-1', 'notificationRandomAyah')).toBeUndefined();
  });

  it('a reminder applied from the account is not uploaded back (the same value in another key order is the same value)', async () => {
    useDevice('A', 'user-1');
    recordLocalPreferenceChange('notificationEmotionCheckIn', CHECK_IN_TWICE as never);
    await flush();
    await pushPreferences('token-user-1', 'user-1', () => {});
    const puts = server.puts.length;
    await sync('user-1');
    expect(server.puts).toHaveLength(puts);
    expect(await hasUnsyncedPreferences('user-1')).toBe(false);
  });
});

describe('offline edits', () => {
  it('a change made offline stays pending, survives a restart, and is uploaded at the next sync', async () => {
    useDevice('A', 'user-1');
    server.offline = true;
    recordLocalPreferenceChange('wordMeaningsVisible', false);
    await flush();
    await expect(pushPreferences('token-user-1', 'user-1', () => {})).rejects.toThrow();
    expect(await hasUnsyncedPreferences('user-1')).toBe(true);

    useDevice('A', 'user-1'); // restart
    server.offline = false;
    await sync('user-1');
    expect(accountValue('user-1', 'wordMeaningsVisible')).toBe(false);
    expect(await hasUnsyncedPreferences('user-1')).toBe(false);
  });

  it('an offline change newer than the account`s is kept and uploaded; an older one gives way to it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-10-27T10:00:00.000Z'));
    useDevice('B', 'user-1');
    server.offline = true;
    recordLocalPreferenceChange('favoriteReciter', 'shatri'); // B, 10:00, offline
    await flush();

    vi.setSystemTime(Date.parse('2026-10-27T11:00:00.000Z'));
    useDevice('A', 'user-1');
    server.offline = false;
    recordLocalPreferenceChange('favoriteReciter', 'husary'); // A, 11:00, online
    await flush();
    await pushPreferences('token-user-1', 'user-1', () => {});

    useDevice('B', 'user-1'); // back online: its 10:00 change is older
    const b = applied();
    await sync('user-1', b.apply);
    expect(b.calls).toContainEqual(['favoriteReciter', 'husary']);
    expect(accountValue('user-1', 'favoriteReciter')).toBe('husary');
  });
});

describe('conflicts', () => {
  it('the same setting changed on two devices: the later change wins on both', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-10-27T10:00:00.000Z'));
    useDevice('A', 'user-1');
    recordLocalPreferenceChange('keepAwake', false);
    await flush();
    vi.setSystemTime(Date.parse('2026-10-27T10:05:00.000Z'));
    useDevice('B', 'user-1');
    recordLocalPreferenceChange('keepAwake', true);
    await flush();
    // B uploads first, A (older) afterwards.
    await pushPreferences('token-user-1', 'user-1', () => {});
    useDevice('A', 'user-1');
    const a = applied();
    await pushPreferences('token-user-1', 'user-1', a.apply as never);
    expect(accountValue('user-1', 'keepAwake')).toBe(true);
    expect(a.calls).toEqual([['keepAwake', true]]);
    expect(await hasUnsyncedPreferences('user-1')).toBe(false);
  });

  it('two devices changing two different reminders never undo each other', async () => {
    useDevice('A', 'user-1');
    recordLocalPreferenceChange('notificationWird', WIRD_EVENING as never);
    await flush();
    useDevice('B', 'user-1');
    recordLocalPreferenceChange('notificationRandomAyah', { enabled: false, frequency: 'daily', time: '08:00', weekday: null, anchor: null } as never);
    await flush();
    await pushPreferences('token-user-1', 'user-1', () => {});
    useDevice('A', 'user-1');
    await pushPreferences('token-user-1', 'user-1', () => {});
    expect(accountValue('user-1', 'notificationWird')).toEqual(WIRD_EVENING);
    expect(accountValue('user-1', 'notificationRandomAyah')).toMatchObject({ enabled: false });
  });

  it('the Mushaf guide only moves forward: a later "closed" never replaces "finished", and the closing device adopts "finished"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-10-27T10:00:00.000Z'));
    useDevice('A', 'user-1');
    recordLocalPreferenceChange('mushafGuide', 'finished');
    await flush();
    await pushPreferences('token-user-1', 'user-1', () => {});

    vi.setSystemTime(Date.parse('2026-10-27T12:00:00.000Z'));
    useDevice('B', 'user-1');
    server.offline = true; // B closed it early without having seen A's finish
    recordLocalPreferenceChange('mushafGuide', 'closed');
    await flush();
    server.offline = false;
    const b = applied();
    await pushPreferences('token-user-1', 'user-1', b.apply as never);

    expect(accountValue('user-1', 'mushafGuide')).toBe('finished');
    expect(b.calls).toEqual([['mushafGuide', 'finished']]);
    expect(await hasUnsyncedPreferences('user-1')).toBe(false);
  });

  it('an invalid value from a damaged or newer app is refused by the server and never applied by this app', async () => {
    useDevice('A', 'user-1');
    server.accounts.set('user-1', { updatedAt: new Date(1000), keepAwake: 'sometimes' as never, favoriteReciter: 'Not A Reciter!' as never, fieldUpdatedAt: { keepAwake: new Date(1000), favoriteReciter: new Date(1000) } });
    const a = applied();
    await sync('user-1', a.apply);
    expect(a.calls).toEqual([]);
  });
});

describe('account switching', () => {
  it('a change made under account A is never uploaded to B, and B`s settings never move into A', async () => {
    useDevice('phone', 'user-a');
    recordLocalPreferenceChange('keepAwake', false);
    await flush();

    useDevice('phone', 'user-b'); // A signed out, B signed in on the same device
    recordLocalPreferenceChange('favoriteReciter', 'shatri');
    await flush();
    await sync('user-b');
    expect(accountValue('user-b', 'keepAwake')).toBeUndefined();
    expect(accountValue('user-b', 'favoriteReciter')).toBe('shatri');

    useDevice('phone', 'user-a');
    await sync('user-a');
    expect(accountValue('user-a', 'keepAwake')).toBe(false);
    expect(accountValue('user-a', 'favoriteReciter')).toBeUndefined();
  });

  it('a guest`s change is recorded for no account', async () => {
    useDevice('phone', null);
    recordLocalPreferenceChange('memorizationModeVisible', false);
    await flush();
    useDevice('phone', 'user-a');
    await sync('user-a');
    expect(server.puts).toEqual([]);
    expect((await loadAccountPreferenceState('user-a')).fields).toEqual({});
  });
});

describe('older servers and older apps', () => {
  it('a server from before the new settings: they stay pending (no error, no loop), the earlier ones still sync', async () => {
    server.old = true;
    useDevice('A', 'user-1');
    recordLocalPreferenceChange('appearance', 'dark');
    recordLocalPreferenceChange('keepAwake', false);
    await flush();
    await pushPreferences('token-user-1', 'user-1', () => {});
    const { fields } = await loadAccountPreferenceState('user-1');
    expect(fields.appearance?.synced).toBe(true);
    expect(fields.keepAwake?.synced).toBe(false);

    // Once the server is updated, the pending change goes up at the next sync.
    server.old = false;
    await sync('user-1');
    expect(accountValue('user-1', 'keepAwake')).toBe(false);
  });

  it('an older app`s write (only the earlier settings) keeps the new ones exactly as stored', async () => {
    useDevice('A', 'user-1');
    recordLocalPreferenceChange('keepAwake', false);
    recordLocalPreferenceChange('notificationWird', WIRD_EVENING as never);
    await flush();
    await pushPreferences('token-user-1', 'user-1', () => {});
    // An older app on another device changes App Language only.
    await fetch('http://x/api/sync/preferences', { method: 'PUT', headers: { Authorization: 'Bearer token-user-1' }, body: JSON.stringify({ locale: 'ar', updatedAt: new Date(Date.now() + 1000).toISOString() }) });
    expect(accountValue('user-1', 'locale')).toBe('ar');
    expect(accountValue('user-1', 'keepAwake')).toBe(false);
    expect(accountValue('user-1', 'notificationWird')).toEqual(WIRD_EVENING);
  });

  it('every new account field is one the server knows', () => {
    for (const field of NEW_FIELDS) expect(PREFERENCE_FIELDS).toContain(field);
  });
});

describe('the one-time claim of choices saved on the device (2026-10-27)', () => {
  function saveDeviceChoices() {
    env.storage.set('quran-heals:favorite-reciter:v1', 'husary');
    env.storage.set('quran-heals:mushaf-keep-awake:v1', 'false');
    env.storage.set('quran-heals:mushaf-guide:v1', JSON.stringify({ status: 'done', finished: false }));
    env.storage.set('quran-heals:notification-preferences:v1', JSON.stringify({ schema: 1, wird: WIRD_EVENING }));
  }

  it('the restored account takes only what was actually saved (never a default), at the earliest instant, and uploads it', async () => {
    useDevice('A', 'user-1');
    saveDeviceChoices();
    await claimDevicePreferences('user-1');
    const { fields } = await loadAccountPreferenceState('user-1');
    expect(Object.keys(fields).sort()).toEqual(['favoriteReciter', 'keepAwake', 'mushafGuide', 'notificationWird']);
    expect(fields.keepAwake).toEqual({ value: false, updatedAt: SEED_AT, synced: false });

    await sync('user-1');
    expect(accountValue('user-1', 'favoriteReciter')).toBe('husary');
    expect(accountValue('user-1', 'mushafGuide')).toBe('closed');
    expect(accountValue('user-1', 'wordMeaningsVisible')).toBeUndefined();
  });

  it('never over what the account already holds: a second device adopts the account`s value', async () => {
    useDevice('A', 'user-1');
    recordLocalPreferenceChange('favoriteReciter', 'shatri');
    await flush();
    await pushPreferences('token-user-1', 'user-1', () => {});

    useDevice('B', 'user-1');
    saveDeviceChoices();
    await claimDevicePreferences('user-1');
    const b = applied();
    await sync('user-1', b.apply);
    expect(accountValue('user-1', 'favoriteReciter')).toBe('shatri');
    expect(b.calls).toContainEqual(['favoriteReciter', 'shatri']);
    // What the account did not hold yet, B's saved choice provides.
    expect(accountValue('user-1', 'keepAwake')).toBe(false);
  });

  it('never over a change this account already recorded here', async () => {
    useDevice('A', 'user-1');
    saveDeviceChoices();
    recordLocalPreferenceChange('keepAwake', true);
    await flush();
    await claimDevicePreferences('user-1');
    expect((await loadAccountPreferenceState('user-1')).fields.keepAwake).toMatchObject({ value: true });
    expect((await loadAccountPreferenceState('user-1')).fields.keepAwake?.updatedAt).toBeGreaterThan(SEED_AT);
  });

  it('only once; and never after a guest launch or an interactive sign-in', async () => {
    useDevice('A', 'user-1');
    saveDeviceChoices();
    await claimDevicePreferences('user-1');
    await claimDevicePreferences('user-2');
    expect((await loadAccountPreferenceState('user-2')).fields).toEqual({});

    useDevice('C', null);
    saveDeviceChoices();
    await forgoDevicePreferencesClaim();
    await claimDevicePreferences('user-3');
    expect((await loadAccountPreferenceState('user-3')).fields).toEqual({});
  });
});

describe('Home`s recent emotions', () => {
  it('two devices` choices merge: one entry per emotion, its latest use first', async () => {
    useDevice('A', 'user-1');
    await recordEmotionUse('sad', 1_000);
    await recordEmotionUse('anxious', 2_000);
    await sync('user-1');

    useDevice('B', 'user-1');
    await recordEmotionUse('lonely', 3_000);
    await recordEmotionUse('sad', 4_000); // chosen again, later
    await sync('user-1');
    expect(await loadRecentEmotionKeys('user-1')).toEqual(['sad', 'lonely', 'anxious']);

    useDevice('A', 'user-1');
    await sync('user-1');
    expect(await loadRecentEmotionKeys('user-1')).toEqual(['sad', 'lonely', 'anxious']);
    expect(accountValue('user-1', 'recentEmotions')).toHaveLength(3);
  });

  it('the history limit (12) holds after merging, keeping the most recent', async () => {
    useDevice('A', 'user-1');
    for (let i = 0; i < 8; i += 1) await recordEmotionUse(`a${i}`, 1_000 + i * 10);
    await sync('user-1');
    useDevice('B', 'user-1');
    for (let i = 0; i < 8; i += 1) await recordEmotionUse(`b${i}`, 1_005 + i * 10);
    await sync('user-1');
    const merged = await loadRecentEmotionKeys('user-1');
    expect(merged).toHaveLength(12);
    expect(merged.slice(0, 2)).toEqual(['b7', 'a7']);
    expect(merged).not.toContain('a0');
    expect(merged).not.toContain('b0');
  });

  it('a choice made offline goes up at the next sync; a sync with nothing new uploads nothing', async () => {
    useDevice('A', 'user-1');
    server.offline = true;
    await recordEmotionUse('grateful', 5_000);
    await expect(sync('user-1')).rejects.toThrow();
    server.offline = false;
    await sync('user-1');
    expect(accountValue('user-1', 'recentEmotions')).toEqual([{ key: 'grateful', at: new Date(5_000).toISOString() }]);
    const puts = server.puts.length;
    await sync('user-1');
    expect(server.puts).toHaveLength(puts);
  });

  it('a list saved before uses were timed keeps its order, below any emotion chosen since on another device', async () => {
    useDevice('A', 'user-1');
    env.storage.set(`${RECENT_EMOTIONS_STORAGE_KEY}:account:user-1`, JSON.stringify(['patience', 'hopeful']));
    expect(await loadRecentEmotionKeys('user-1')).toEqual(['patience', 'hopeful']);
    useDevice('B', 'user-1');
    await recordEmotionUse('tired', 9_000);
    await sync('user-1');
    useDevice('A', 'user-1');
    await sync('user-1');
    expect(await loadRecentEmotionKeys('user-1')).toEqual(['tired', 'patience', 'hopeful']);
  });

  it('kept per account and never uploaded for a guest', async () => {
    useDevice('phone', null);
    await recordEmotionUse('afraid', 1_000);
    useDevice('phone', 'user-1');
    await sync('user-1');
    expect(server.puts).toEqual([]);
    expect(await loadRecentEmotionKeys('user-1')).toEqual([]);
    expect(await loadRecentEmotionUses(null)).toEqual([{ key: 'afraid', at: 1_000 }]);
  });

  it('account switching: B never receives A`s history', async () => {
    useDevice('phone', 'user-a');
    await recordEmotionUse('sad', 1_000);
    await sync('user-a');
    useDevice('phone', 'user-b');
    await sync('user-b');
    expect(await loadRecentEmotionKeys('user-b')).toEqual([]);
    expect(accountValue('user-b', 'recentEmotions')).toBeUndefined();
  });
});
