import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runGuardedRefresh, type RefreshInFlightRef } from '@/utils/pullToRefresh';
import { openTestDatabase } from './helpers/sqlite';

/**
 * Proves the actual "stuck loading is recoverable" guarantee end to end
 * against real production code (services/api.ts's getEmotions/getAyah,
 * sync/syncApi.ts's cloud sync calls, services/retry.ts's withRetry), not a
 * mirrored mock — using a `fetch` that never settles on its own, exactly
 * the failure mode a plain `try/finally` cannot recover from. Only
 * fetchWithTimeout's AbortController turns that hang into a bounded
 * rejection; this file is what verifies that actually happens for each
 * affected screen's real network call, not just for fetchWithTimeout in
 * isolation (see fetchWithTimeout.test.ts for that unit-level proof).
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

const { getEmotions, getAyah } = await import('@/services/api');
const { getRandomVerseKey } = await import('@/services/quran');
const { withRetry } = await import('@/services/retry');
const { getCloudFavorites, getCloudReflections, getCloudPreferences } = await import('@/sync/syncApi');
const { DEFAULT_FETCH_TIMEOUT_MS } = await import('@/services/fetchWithTimeout');

/** A `fetch` that never resolves or rejects on its own — only an abort (the timeout) settles it. Mirrors a dead TCP connection / captive portal. */
function neverSettlingFetch() {
  return vi.fn(
    (_input: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('This operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  );
}

/** withRetry's own backoff delays (services/retry.ts) plus fetchWithTimeout's timeout, generously bounded for a fully-drained worst case across all attempts. */
const WORST_CASE_BOUND_MS = DEFAULT_FETCH_TIMEOUT_MS * 3 + 500 + 1500 + 1000;

beforeEach(() => {
  state.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Home: a hung getEmotions() request is bounded, releasing the in-flight guard for a later retry', () => {
  it('never resolves on its own, times out, and a subsequent call (the retry) succeeds', async () => {
    const hungThenRecoveredFetch = vi.fn();
    let requestCount = 0;
    hungThenRecoveredFetch.mockImplementation((_input: string, init?: RequestInit) => {
      requestCount += 1;
      if (requestCount === 1) {
        // The very first request hangs forever — only the abort settles it.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data: [{ key: 'grateful' }] }), { status: 200 }),
      );
    });
    vi.stubGlobal('fetch', hungThenRecoveredFetch);

    // Mirrors Home's own isFetchingRef guard (src/app/index.tsx) — the
    // real loadEmotions() can't be imported/rendered here (no RN renderer),
    // but the guard shape and the getEmotions()/withRetry() calls inside it
    // are the real, unmocked production functions.
    let isFetchingRef = false;
    let emotions: unknown[] = [];
    const loadEmotions = async () => {
      if (isFetchingRef) return;
      isFetchingRef = true;
      try {
        emotions = await withRetry(() => getEmotions());
      } catch {
        // never blanks existing emotions — mirrors index.tsx's real catch
      } finally {
        isFetchingRef = false;
      }
    };

    const firstLoad = loadEmotions();
    await vi.advanceTimersByTimeAsync(WORST_CASE_BOUND_MS);
    await firstLoad;

    // The hang was bounded: the guard was released, not left stuck.
    expect(isFetchingRef).toBe(false);

    // Pull-to-refresh can now run — a real runGuardedRefresh-driven retry.
    const guard: RefreshInFlightRef = { current: false };
    const ran = await runGuardedRefresh(guard, loadEmotions);
    expect(ran).toBe(true);
    expect(guard.current).toBe(false);
    expect(emotions).toEqual([{ key: 'grateful' }]);
  }, 20000);
});

describe('Ayah: a hung getAyah() content-load is bounded, and the same selected verse is recovered afterward', () => {
  it('the general-mode verse selected before the hang is still the one displayed once recovery succeeds', async () => {
    let selectedVerseKey: string | null = null;
    let requestCount = 0;
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      requestCount += 1;
      const url = new URL(input);
      const verseKey = decodeURIComponent(url.pathname.match(/\/api\/ayahs\/([^/]+)$/)![1]);
      selectedVerseKey ??= verseKey;
      if (requestCount === 1) {
        // Hangs forever on the very first request — only a timeout/abort
        // settles it.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }
      if (requestCount <= 3) {
        // withRetry's remaining two bounded attempts (services/retry.ts
        // allows 3 total) also fail — fast this time, so this first
        // top-level loadAyah() call exhausts its retries and genuinely
        // throws, leaving nothing "usable" yet. Only the 4th request (the
        // second top-level loadAyah() call below, standing in for a
        // pull-to-refresh recovery attempt) succeeds.
        return Promise.reject(new Error('simulated network failure'));
      }
      const [surah, ayah] = verseKey.split(':').map(Number);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: `backend-${verseKey}`,
              referenceKey: verseKey,
              surahNumber: surah,
              ayahNumber: ayah,
              surahNameArabic: '',
              surahNameEnglish: 'Test Surah',
              arabicText: 'UNTRUSTED_BACKEND_SNAPSHOT',
              englishTranslation: 'Test translation',
              emotions: [],
              quranTextSource: 'Test source',
              translationSource: 'Test source',
            },
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    // Mirrors AyahExperience's pendingGeneralVerseKeyRef + isLoadingRef.
    const pendingGeneralVerseKeyRef: { current: string | null } = { current: null };
    let isLoadingRef = false;

    const resolveGeneralVerseKey = async (exclude: string[]): Promise<string> => {
      if (pendingGeneralVerseKeyRef.current) return pendingGeneralVerseKeyRef.current;
      const verseKey = await getRandomVerseKey(exclude);
      pendingGeneralVerseKeyRef.current = verseKey;
      return verseKey;
    };

    const loadAyah = async () => {
      if (isLoadingRef) return null;
      isLoadingRef = true;
      try {
        return await withRetry(async () => {
          const verseKey = await resolveGeneralVerseKey([]);
          const resolvedAyah = await getAyah(verseKey);
          pendingGeneralVerseKeyRef.current = null;
          return resolvedAyah;
        });
      } finally {
        isLoadingRef = false;
      }
    };

    const firstAttempt = loadAyah().catch(() => null);
    await vi.advanceTimersByTimeAsync(WORST_CASE_BOUND_MS);
    await firstAttempt;

    // The hang was bounded: the loading guard was released, not left stuck.
    expect(isLoadingRef).toBe(false);

    // A second attempt (pull-to-refresh's recovery call) resolves the SAME
    // verse the first attempt had already chosen before it hung.
    const recovered = await loadAyah();
    expect(recovered?.referenceKey).toBe(selectedVerseKey);
  }, 20000);
});

describe('Sync-backed screens (Favorites/Reflections/Settings): a hung refreshSync()-reachable request cannot spin the pull-to-refresh guard forever', () => {
  it('a hung cloud-favorites request (reachable from refreshSync -> runFullSync -> syncFavorites) times out, clearing the guard and spinner for a later retry', async () => {
    const hungFetch = neverSettlingFetch();
    vi.stubGlobal('fetch', hungFetch);

    const guard: RefreshInFlightRef = { current: false };
    let isRefreshing = false;

    // getCloudFavorites is the exact same authedRequest-backed call every
    // sync-backed screen's refreshSync() eventually reaches — the real,
    // unmocked production function from sync/syncApi.ts.
    const hungSyncCall = () => getCloudFavorites('token');

    const onPullToRefresh = () =>
      runGuardedRefresh(guard, async () => {
        isRefreshing = true;
        try {
          await hungSyncCall();
        } catch {
          // mirrors refreshSync()'s own never-throws contract at the
          // useAuth.tsx level for a real screen; here we only need to prove
          // the call itself settles and the guard/spinner clear either way
        } finally {
          isRefreshing = false;
        }
      });

    const firstPull = onPullToRefresh();
    await vi.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS + 1000);
    await firstPull;

    expect(isRefreshing).toBe(false);
    expect(guard.current).toBe(false);

    // Another pull is possible immediately afterward.
    const recoveredFetch = vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }));
    vi.stubGlobal('fetch', recoveredFetch);
    const secondPullRan = await onPullToRefresh();
    expect(secondPullRan).toBe(true);
    expect(guard.current).toBe(false);
  }, 20000);

  it.each([
    ['Reflections', () => getCloudReflections('token')],
    ['Settings', () => getCloudPreferences('token')],
  ])('%s: the same guarantee holds for its own cloud sync call', async (_screen, hungSyncCall) => {
    vi.stubGlobal('fetch', neverSettlingFetch());

    const guard: RefreshInFlightRef = { current: false };
    let isRefreshing = false;

    const onPullToRefresh = () =>
      runGuardedRefresh(guard, async () => {
        isRefreshing = true;
        try {
          await hungSyncCall();
        } catch {
          // mirrors refreshSync()'s own never-throws contract for a real
          // screen — here just proving the call settles either way
        } finally {
          isRefreshing = false;
        }
      });

    const firstPull = onPullToRefresh();
    await vi.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS + 1000);
    await firstPull;

    expect(isRefreshing).toBe(false);
    expect(guard.current).toBe(false);
  }, 20000);
});
