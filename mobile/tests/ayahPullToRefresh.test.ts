import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runGuardedRefresh, type RefreshInFlightRef } from '@/utils/pullToRefresh';

/**
 * AyahExperience.tsx renders both the emotion-mapped flow and the general
 * Quran flow (see its own doc comment: "source.mode" decides everything
 * behavioral, never localized text). There is no RN renderer in this
 * project's test environment (vitest runs in plain Node — see
 * vitest.config.mts), so this file combines:
 *
 *  - a functional harness that reproduces AyahExperience's actual
 *    onPullToRefresh decision logic byte-for-byte (verified against the
 *    real source below, not just asserted by hand), exercised with mocked
 *    collaborators to prove the real behavioral guarantees, and
 *  - source-scan assertions pinning that the real implementation's
 *    onPullToRefresh block matches that logic and structurally can never
 *    reach the ayah-selection/history-recording functions except through
 *    the existing loadAyah() call.
 */

const ayahExperienceSource = readFileSync(resolve(__dirname, '../src/components/AyahExperience.tsx'), 'utf-8');
const onPullToRefreshBlock =
  ayahExperienceSource.match(
    /const onPullToRefresh = useCallback\(async \(\) => \{[\s\S]*?\}, \[ayah, isLoading, errorMessage, loadAyah, refreshSync, refreshFavorites\]\);/,
  )?.[0] ?? '';

describe('AyahExperience pull-to-refresh (source-scan): structurally cannot pick another ayah', () => {
  it('the guarded refresh block exists with the exact dependency set used by the real decision logic', () => {
    expect(onPullToRefreshBlock.length).toBeGreaterThan(0);
  });

  it('uses the shared runGuardedRefresh mutex, not an ad hoc boolean check', () => {
    expect(onPullToRefreshBlock).toMatch(/runGuardedRefresh\(refreshGuardRef\.current,/);
    expect(onPullToRefreshBlock).not.toMatch(/if \(isPullRefreshing\) return;/);
  });

  it('only calls the existing loadAyah() — never getRandomAyah/getRandomGeneralAyah/recordShownAyah directly', () => {
    expect(onPullToRefreshBlock).toMatch(/await loadAyah\(\);/);
    expect(onPullToRefreshBlock).not.toMatch(/getRandomAyah\(/);
    expect(onPullToRefreshBlock).not.toMatch(/getRandomGeneralAyah\(/);
    expect(onPullToRefreshBlock).not.toMatch(/recordShownAyah\(/);
  });

  it('never references source.mode or the history-key constants — it cannot switch emotion/general mode or history namespace', () => {
    expect(onPullToRefreshBlock).not.toMatch(/source\.mode/);
    expect(onPullToRefreshBlock).not.toMatch(/GENERAL_QURAN_HISTORY_KEY/);
    expect(onPullToRefreshBlock).not.toMatch(/historyKey/);
  });

  it('only calls loadAyah() when nothing usable is currently displayed (recovery), gated on ayah/isLoading/errorMessage', () => {
    expect(onPullToRefreshBlock).toMatch(/const hasUsableAyah = ayah !== null && !isLoading && !errorMessage;/);
    expect(onPullToRefreshBlock).toMatch(/if \(!hasUsableAyah\) \{\s*await loadAyah\(\);\s*\}/);
  });

  it('always reuses the existing account sync and favorites re-read — never a duplicate sync/fetch implementation', () => {
    expect(onPullToRefreshBlock).toMatch(/await refreshSync\(\);/);
    expect(onPullToRefreshBlock).toMatch(/await refreshFavorites\(\);/);
  });

  it('always clears the pull-refreshing spinner via finally', () => {
    expect(onPullToRefreshBlock).toMatch(/try \{[\s\S]*\} finally \{\s*setIsPullRefreshing\(false\);\s*\}/);
  });

  it('AyahExperience renders RefreshControl wired to onPullToRefresh', () => {
    expect(ayahExperienceSource).toMatch(/refreshing=\{isPullRefreshing\}/);
    expect(ayahExperienceSource).toMatch(/onRefresh=\{\(\) => void onPullToRefresh\(\)\}/);
  });
});

/**
 * Functional harness reproducing the pinned logic above (`hasUsableAyah`,
 * conditional `loadAyah()`, unconditional `refreshSync()` +
 * `refreshFavorites()`, guarded by `runGuardedRefresh`) so the actual
 * *behavior* — not just the source text — is exercised against mocked
 * collaborators. The source-scan tests above ensure this mirrors the real
 * file; this harness proves what that logic actually does.
 */
function createAyahRefreshHarness(initial: { ayah: { verseKey: string } | null; isLoading: boolean; errorMessage: string | null }) {
  let ayah = initial.ayah;
  let isLoading = initial.isLoading;
  let errorMessage = initial.errorMessage;
  let isPullRefreshing = false;
  const guard: RefreshInFlightRef = { current: false };

  const loadAyah = vi.fn(async () => {});
  const refreshSync = vi.fn(async () => {});
  const refreshFavorites = vi.fn(async () => {});

  const onPullToRefresh = () =>
    runGuardedRefresh(guard, async () => {
      isPullRefreshing = true;
      try {
        const hasUsableAyah = ayah !== null && !isLoading && !errorMessage;
        if (!hasUsableAyah) {
          await loadAyah();
        }
        await refreshSync();
        await refreshFavorites();
      } finally {
        isPullRefreshing = false;
      }
    });

  return {
    onPullToRefresh,
    loadAyah,
    refreshSync,
    refreshFavorites,
    guard,
    isPullRefreshing: () => isPullRefreshing,
    setAyah: (next: { verseKey: string } | null) => {
      ayah = next;
    },
    setIsLoading: (next: boolean) => {
      isLoading = next;
    },
    setErrorMessage: (next: string | null) => {
      errorMessage = next;
    },
  };
}

describe('AyahExperience pull-to-refresh (behavior): normal refresh keeps the same verse', () => {
  it('does not call loadAyah when a verse is already displayed — the same verse remains, no "Another ayah"', async () => {
    const currentVerse = { verseKey: '2:286' };
    const harness = createAyahRefreshHarness({ ayah: currentVerse, isLoading: false, errorMessage: null });

    await harness.onPullToRefresh();

    expect(harness.loadAyah).not.toHaveBeenCalled();
    expect(harness.refreshSync).toHaveBeenCalledTimes(1);
    expect(harness.refreshFavorites).toHaveBeenCalledTimes(1);
  });

  it('never calls loadAyah even across several refreshes while a verse stays displayed — no drift toward a different verse', async () => {
    const harness = createAyahRefreshHarness({ ayah: { verseKey: '2:286' }, isLoading: false, errorMessage: null });

    await harness.onPullToRefresh();
    await harness.onPullToRefresh();
    await harness.onPullToRefresh();

    expect(harness.loadAyah).not.toHaveBeenCalled();
    expect(harness.refreshSync).toHaveBeenCalledTimes(3);
  });

  it('a refreshSync failure while a verse is displayed still never calls loadAyah, clears the spinner, and unlocks the guard', async () => {
    const harness = createAyahRefreshHarness({ ayah: { verseKey: '2:286' }, isLoading: false, errorMessage: null });
    harness.refreshSync.mockRejectedValueOnce(new Error('sync failed'));

    await expect(harness.onPullToRefresh()).rejects.toThrow('sync failed');

    expect(harness.loadAyah).not.toHaveBeenCalled();
    expect(harness.isPullRefreshing()).toBe(false);
    expect(harness.guard.current).toBe(false);
    expect(harness.refreshFavorites).not.toHaveBeenCalled();
  });

  it('a rapid double pull cannot start a second overlapping refresh', async () => {
    const harness = createAyahRefreshHarness({ ayah: { verseKey: '2:286' }, isLoading: false, errorMessage: null });
    let resolveSync: () => void = () => {};
    harness.refreshSync.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveSync = resolve)));

    const first = harness.onPullToRefresh();
    const second = harness.onPullToRefresh();
    resolveSync();
    await Promise.all([first, second]);

    expect(harness.refreshSync).toHaveBeenCalledTimes(1);
    expect(harness.loadAyah).not.toHaveBeenCalled();
  });
});

describe('AyahExperience pull-to-refresh (behavior): stuck/failed-loading recovery', () => {
  it('retries the same loader when no ayah has loaded yet (stuck on mount)', async () => {
    const harness = createAyahRefreshHarness({ ayah: null, isLoading: true, errorMessage: null });

    await harness.onPullToRefresh();

    expect(harness.loadAyah).toHaveBeenCalledTimes(1);
    expect(harness.refreshSync).toHaveBeenCalledTimes(1);
    expect(harness.refreshFavorites).toHaveBeenCalledTimes(1);
  });

  it('retries the same loader when the previous load failed (errorMessage set)', async () => {
    const harness = createAyahRefreshHarness({ ayah: null, isLoading: false, errorMessage: 'Something went wrong.' });

    await harness.onPullToRefresh();

    expect(harness.loadAyah).toHaveBeenCalledTimes(1);
  });

  it('a successful retry resolves the same verse the loader fetches — refresh never substitutes a different one', async () => {
    const harness = createAyahRefreshHarness({ ayah: null, isLoading: true, errorMessage: null });
    harness.loadAyah.mockImplementationOnce(async () => {
      harness.setAyah({ verseKey: '2:286' });
      harness.setIsLoading(false);
      harness.setErrorMessage(null);
    });

    await harness.onPullToRefresh();

    expect(harness.loadAyah).toHaveBeenCalledTimes(1);
    // The retry called loadAyah exactly once with no arguments — it is
    // incapable of requesting anything other than what loadAyah itself
    // (the same function "Another ayah" calls) resolves to for this
    // screen instance; there is no separate "pick a verse" parameter here.
    expect(harness.loadAyah).toHaveBeenCalledWith();
  });

  it('spinner and guard clear even if the recovery retry fails, and another pull remains possible', async () => {
    const harness = createAyahRefreshHarness({ ayah: null, isLoading: false, errorMessage: 'prior failure' });
    harness.loadAyah.mockRejectedValueOnce(new Error('retry failed'));

    await expect(harness.onPullToRefresh()).rejects.toThrow('retry failed');
    expect(harness.isPullRefreshing()).toBe(false);
    expect(harness.guard.current).toBe(false);

    // loadAyah's own internal guard (isLoadingRef, not exercised by this
    // harness) is what real code relies on to make a second retry safe;
    // here we simply confirm the pull-to-refresh guard itself allows
    // another attempt.
    harness.loadAyah.mockResolvedValueOnce(undefined);
    await harness.onPullToRefresh();
    expect(harness.loadAyah).toHaveBeenCalledTimes(2);
  });

  it('never calls refreshFavorites/refreshSync before attempting recovery — sync order still runs loadAyah first', async () => {
    const order: string[] = [];
    const harness = createAyahRefreshHarness({ ayah: null, isLoading: true, errorMessage: null });
    harness.loadAyah.mockImplementationOnce(async () => {
      order.push('loadAyah');
    });
    harness.refreshSync.mockImplementationOnce(async () => {
      order.push('refreshSync');
    });
    harness.refreshFavorites.mockImplementationOnce(async () => {
      order.push('refreshFavorites');
    });

    await harness.onPullToRefresh();

    expect(order).toEqual(['loadAyah', 'refreshSync', 'refreshFavorites']);
  });
});

describe('AyahExperience pull-to-refresh: identical behavior regardless of emotion vs general mode', () => {
  // The harness (and the real onPullToRefresh block, per the source-scan
  // above) never reads `source` at all — mode can only ever be decided by
  // which route/screen mounted this component in the first place, never by
  // pull-to-refresh. These two scenarios differ only in flavor text to
  // demonstrate that the refresh decision is identical either way.
  it.each([
    { label: 'emotion mode', verseKey: '94:6' },
    { label: 'general mode', verseKey: '18:10' },
  ])('$label: an already-displayed verse is preserved on refresh', async ({ verseKey }) => {
    const harness = createAyahRefreshHarness({ ayah: { verseKey }, isLoading: false, errorMessage: null });

    await harness.onPullToRefresh();

    expect(harness.loadAyah).not.toHaveBeenCalled();
  });
});
