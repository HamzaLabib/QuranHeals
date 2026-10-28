import { describe, expect, it, vi } from 'vitest';

/**
 * Release audit B7 follow-up (2026-10-28): every value this app can store for
 * a synced setting is one the server's validator accepts. A value the server
 * refuses would leave that setting pending forever on the device, so it would
 * never reach the account. Complements accountSettingsSync.test.ts, which
 * runs the sync itself against the real server rules.
 */
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined), removeItem: vi.fn(async () => undefined) },
}));

const { putPreferencesSchema } = await import('../../../backend/src/validators/syncValidators');
const { PREFERENCE_FIELDS, RECENT_EMOTIONS_LIMIT } = await import('../../../backend/src/services/preferencesMerge');
const { SYNCED_PREFERENCE_FIELDS } = await import('@/sync/preferenceFields');
const { RECITERS } = await import('@/audio/reciters');
const { QURAN_FONT_SIZES } = await import('@/localization/quranFontSizePreference');
const { EMOTIONS_LANGUAGES } = await import('@/localization/emotionsLanguage');
const { WEEKDAYS } = await import('@/notifications/types');
const { DEFAULT_NOTIFICATION_PREFERENCES, storedReminder } = await import('@/notifications/preferences');

const accepts = (values: Record<string, unknown>) => putPreferencesSchema.safeParse({ ...values, updatedAt: '2026-10-28T12:00:00.000Z' });
const reminder = (change: Record<string, unknown>) => ({ enabled: true, frequency: 'daily', time: '21:00', weekday: null, anchor: null, ...change });

describe('synced setting values the app can produce are accepted by the server', () => {
  it('every synced field is a server field', () => {
    for (const field of SYNCED_PREFERENCE_FIELDS) expect(PREFERENCE_FIELDS).toContain(field);
    expect(PREFERENCE_FIELDS).toContain('recentEmotions');
  });

  it('every reciter id', () => {
    expect(RECITERS.length).toBeGreaterThan(10);
    for (const reciter of RECITERS) expect(accepts({ favoriteReciter: reciter.id }).success, reciter.id).toBe(true);
  });

  it('every Quran text size', () => {
    for (const size of QURAN_FONT_SIZES) expect(accepts({ quranFontSize: size }).success, String(size)).toBe(true);
  });

  it('every Emotions Language and appearance', () => {
    for (const emotionsLanguage of EMOTIONS_LANGUAGES) expect(accepts({ emotionsLanguage }).success, emotionsLanguage).toBe(true);
    for (const appearance of ['system', 'light', 'dark']) expect(accepts({ appearance }).success, appearance).toBe(true);
  });

  it('every reminder frequency and weekday, and the default reminders as the app stores them', () => {
    for (const frequency of ['daily', 'every3days', 'weekly', 'twiceDaily']) {
      expect(accepts({ notificationWird: reminder({ frequency }) }).success, frequency).toBe(true);
    }
    for (const weekday of WEEKDAYS) {
      expect(accepts({ notificationWird: reminder({ frequency: 'weekly', weekday }) }).success, String(weekday)).toBe(true);
    }
    const defaults = DEFAULT_NOTIFICATION_PREFERENCES;
    expect(accepts({
      notificationWird: storedReminder('wird', defaults.wird),
      notificationRandomAyah: storedReminder('randomAyah', defaults.randomAyah),
      notificationEmotionCheckIn: storedReminder('emotionCheckIn', { ...defaults.emotionCheckIn, frequency: 'twiceDaily' }),
    }).success).toBe(true);
  });

  it('a full recent-emotions history', () => {
    const history = Array.from({ length: RECENT_EMOTIONS_LIMIT }, (_, i) => ({ key: `faith_shaken${i}`, at: '2026-10-28T12:00:00.000Z' }));
    expect(accepts({ recentEmotions: history }).success).toBe(true);
  });
});
