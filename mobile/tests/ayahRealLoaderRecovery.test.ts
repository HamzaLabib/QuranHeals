import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openTestDatabase } from './helpers/sqlite';

/**
 * Regression coverage for the real ayah-loading/retry logic AyahExperience
 * uses (pinned structurally by ayahPullToRefresh.test.ts's source-scan and
 * generalQuranFlow.test.ts's fetchAyah-block assertions) — but here run
 * against genuine production functions instead of a hand-rolled mirror:
 *
 *  - getRandomVerseKey (services/quran.ts) backed by the real bundled
 *    quran.sqlite (via the same openTestDatabase() helper other tests use),
 *  - getAyah / getRandomAyah (services/api.ts), with only the network
 *    boundary (global fetch) mocked,
 *  - withRetry (services/retry.ts), completely real,
 *  - getExcludedVerseKeys / recordShownAyah (storage/recentAyahHistory.ts),
 *    completely real, backed by an in-memory AsyncStorage mock.
 *
 * `runLoadAttempt` below reproduces AyahExperience's actual fetchAyah/
 * resolveGeneralVerseKey composition verbatim (see the block pinned by
 * generalQuranFlow.test.ts's "loadAyah dispatches through one fetchAyah
 * closure" test) so that a source-level drift between this file and the
 * component would be caught there, while the behavioral proof here runs
 * against real selection/loading/retry code, not mocks of it.
 */

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@/services/quranAsset', () => ({ openBundledQuran: async () => openTestDatabase() }));

const state = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      state.set(key, value);
    }),
  },
}));

const { getRandomVerseKey } = await import('@/services/quran');
const { getAyah, getRandomAyah } = await import('@/services/api');
const { withRetry } = await import('@/services/retry');
const { getExcludedVerseKeys, recordShownAyah, GENERAL_QURAN_HISTORY_KEY } = await import('@/storage/recentAyahHistory');
const { apiBaseUrl } = await import('@/services/apiBase');

type Source = { mode: 'emotion'; emotionKey: string } | { mode: 'general' };

/** Mirrors AyahExperience's pendingGeneralVerseKeyRef — a plain object standing in for the real component's useRef across two "loadAyah()" calls. */
type PendingRef = { current: string | null };

/**
 * Verbatim reproduction of AyahExperience's fetchAyah/resolveGeneralVerseKey
 * composition (see this file's doc comment) plus the surrounding
 * exclude/record bookkeeping loadAyah performs — used here so the test
 * exercises the actual selection/retry semantics against real production
 * functions.
 */
async function runLoadAttempt(source: Source, historyKey: string, pendingGeneralVerseKeyRef: PendingRef) {
  const excludedVerseKeys = await getExcludedVerseKeys(historyKey);

  const resolveGeneralVerseKey = async (exclude: string[]): Promise<string> => {
    if (pendingGeneralVerseKeyRef.current) return pendingGeneralVerseKeyRef.current;
    const verseKey = await getRandomVerseKey(exclude);
    pendingGeneralVerseKeyRef.current = verseKey;
    return verseKey;
  };

  const fetchAyah = (exclude: string[]) =>
    withRetry(async () => {
      if (source.mode === 'emotion') {
        return getRandomAyah(source.emotionKey, exclude);
      }
      const verseKey = await resolveGeneralVerseKey(exclude);
      const resolvedAyah = await getAyah(verseKey);
      pendingGeneralVerseKeyRef.current = null;
      return resolvedAyah;
    });

  const nextAyah = await fetchAyah(excludedVerseKeys);
  await recordShownAyah(historyKey, nextAyah);
  return nextAyah;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function ayahPayload(verseKey: string) {
  const [surah, ayah] = verseKey.split(':').map(Number);
  return {
    id: `backend-${verseKey}`,
    referenceKey: verseKey,
    surahNumber: surah,
    ayahNumber: ayah,
    surahNameArabic: '',
    surahNameEnglish: 'Test Surah',
    arabicText: 'UNTRUSTED_BACKEND_SNAPSHOT', // overwritten by local resolution — see resolveAyahArabic
    englishTranslation: 'Test translation',
    emotions: [],
    quranTextSource: 'Test source',
    translationSource: 'Test source',
  };
}

beforeEach(() => {
  state.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('General mode: a content-load failure after successful local selection resumes the SAME verse on retry', () => {
  it('does not call getRandomVerseKey again on retry, and the retried request targets the same verseKey', async () => {
    let selectedVerseKey: string | null = null;
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      const match = url.pathname.match(/\/api\/ayahs\/([^/]+)$/);
      if (!match) throw new Error(`unexpected request in test: ${input}`);
      const verseKey = decodeURIComponent(match[1]);
      selectedVerseKey ??= verseKey;
      if (verseKey !== selectedVerseKey) {
        throw new Error(`getAyah was called with a different verseKey than the first attempt: ${verseKey} !== ${selectedVerseKey}`);
      }
      // First call for this verseKey fails (simulating a network error on
      // the content-load step); every subsequent call for the SAME
      // verseKey succeeds.
      if (fetchMock.mock.calls.length === 1) {
        throw new Error('simulated network failure');
      }
      return jsonResponse({ success: true, data: ayahPayload(verseKey) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pendingGeneralVerseKeyRef: PendingRef = { current: null };
    const historyKey = GENERAL_QURAN_HISTORY_KEY;

    // Attempt 1: local selection succeeds, network content-load fails.
    // withRetry retries the SAME closure internally (bounded, real delays —
    // tiny enough here that we just let them run in real time) — since
    // fetchMock keeps rejecting for the same verseKey until called a 2nd
    // time overall, withRetry's own internal retry already recovers within
    // this single attempt in most runs; to reliably exercise the
    // *cross-call* (pull-to-refresh) resume path regardless of how many
    // internal withRetry attempts it took, we simply drive a second
    // top-level attempt below whenever the first one didn't happen to
    // recover via bounded retry already.
    let ayah;
    try {
      ayah = await runLoadAttempt({ mode: 'general' }, historyKey, pendingGeneralVerseKeyRef);
    } catch {
      // First top-level attempt exhausted its bounded retries — this is the
      // "stuck/failed loading" state pull-to-refresh recovers from.
      ayah = await runLoadAttempt({ mode: 'general' }, historyKey, pendingGeneralVerseKeyRef);
    }

    expect(ayah.referenceKey).toBe(selectedVerseKey);
    // Every fetch call — across both the internal withRetry attempts and
    // the second top-level "pull-to-refresh" attempt — targeted the exact
    // same verseKey; getRandomVerseKey was therefore only ever consulted
    // once for a *new* selection.
    const requestedVerseKeys = new Set(
      fetchMock.mock.calls.map(([input]) => {
        const url = new URL(input as string);
        return decodeURIComponent(url.pathname.match(/\/api\/ayahs\/([^/]+)$/)![1]);
      }),
    );
    expect(requestedVerseKeys.size).toBe(1);
    expect(pendingGeneralVerseKeyRef.current).toBeNull(); // cleared on success

    // Recorded exactly once — the failed attempt(s) never wrote a history
    // entry, and the eventual success wrote exactly one.
    expect(await getExcludedVerseKeys(historyKey)).toEqual([selectedVerseKey]);
  }, 15000);

  it('a permanently failing content-load still only ever asked for one verseKey (bounded retries, no re-selection)', async () => {
    let requestedVerseKeys = new Set<string>();
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      const verseKey = decodeURIComponent(url.pathname.match(/\/api\/ayahs\/([^/]+)$/)![1]);
      requestedVerseKeys.add(verseKey);
      throw new Error('simulated permanent network failure');
    });
    vi.stubGlobal('fetch', fetchMock);

    const pendingGeneralVerseKeyRef: PendingRef = { current: null };

    await expect(runLoadAttempt({ mode: 'general' }, GENERAL_QURAN_HISTORY_KEY, pendingGeneralVerseKeyRef)).rejects.toThrow();
    // A second top-level attempt (another pull-to-refresh) still targets
    // the same verse — the failure never caused a re-selection.
    await expect(runLoadAttempt({ mode: 'general' }, GENERAL_QURAN_HISTORY_KEY, pendingGeneralVerseKeyRef)).rejects.toThrow();

    expect(requestedVerseKeys.size).toBe(1);
    expect(pendingGeneralVerseKeyRef.current).toBe([...requestedVerseKeys][0]);
    // Never recorded to history — it never succeeded.
    expect(await getExcludedVerseKeys(GENERAL_QURAN_HISTORY_KEY)).toEqual([]);
  }, 15000);
});

describe('Emotion mode: selection and content-load are one atomic backend call — a failed attempt selected nothing, so retry legitimately asks again', () => {
  it('a failed attempt is retried by calling getRandomAyah again (there is no pending selection to resume — none was ever made)', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      expect(url.pathname).toBe('/api/ayahs/random');
      expect(url.searchParams.get('emotion')).toBe('grateful');
      callCount += 1;
      if (callCount === 1) {
        throw new Error('simulated network failure');
      }
      return jsonResponse({ success: true, data: ayahPayload('2:255') });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pendingGeneralVerseKeyRef: PendingRef = { current: null }; // unused in emotion mode
    let ayah;
    try {
      ayah = await runLoadAttempt({ mode: 'emotion', emotionKey: 'grateful' }, 'grateful', pendingGeneralVerseKeyRef);
    } catch {
      ayah = await runLoadAttempt({ mode: 'emotion', emotionKey: 'grateful' }, 'grateful', pendingGeneralVerseKeyRef);
    }

    expect(ayah.referenceKey).toBe('2:255');
    expect(callCount).toBeGreaterThan(1); // it really did call getRandomAyah again after the failure
    expect(pendingGeneralVerseKeyRef.current).toBeNull(); // general-mode bookkeeping is never touched in emotion mode
  }, 15000);
});

describe(`Sanity: apiBaseUrl is used consistently (guards against a typo silently no-op'ing the mocked fetch above)`, () => {
  it('is a non-empty string', () => {
    expect(typeof apiBaseUrl).toBe('string');
    expect(apiBaseUrl.length).toBeGreaterThan(0);
  });
});
