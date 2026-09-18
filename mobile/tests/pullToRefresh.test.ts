import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runGuardedRefresh, type RefreshInFlightRef } from '@/utils/pullToRefresh';

describe('runGuardedRefresh: the actual concurrency guard behind every pull-to-refresh screen', () => {
  it('runs the callback and reports that it ran', async () => {
    const guard: RefreshInFlightRef = { current: false };
    const run = vi.fn(async () => {});

    await expect(runGuardedRefresh(guard, run)).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(guard.current).toBe(false);
  });

  it('a second call made while the first is still in flight is skipped, not queued or overlapped', async () => {
    const guard: RefreshInFlightRef = { current: false };
    let resolveFirst: () => void = () => {};
    let concurrentRunners = 0;
    let maxConcurrentRunners = 0;

    const run = vi.fn(async () => {
      concurrentRunners += 1;
      maxConcurrentRunners = Math.max(maxConcurrentRunners, concurrentRunners);
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      concurrentRunners -= 1;
    });

    const firstCall = runGuardedRefresh(guard, run);
    // Fired synchronously, the way two fast pull gestures would both invoke
    // the RefreshControl's onRefresh before either has had a chance to
    // await anything — this is exactly the race a React-state-only guard
    // (`if (isRefreshing) return`) fails to catch, since setState hasn't
    // committed yet when the second call is made.
    const secondCall = runGuardedRefresh(guard, run);

    expect(guard.current).toBe(true);
    resolveFirst();

    const [firstRan, secondRan] = await Promise.all([firstCall, secondCall]);
    expect(firstRan).toBe(true);
    expect(secondRan).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(maxConcurrentRunners).toBe(1);
    expect(guard.current).toBe(false);
  });

  it('the guard stays locked until the first call actually finishes', async () => {
    const guard: RefreshInFlightRef = { current: false };
    let resolveFirst: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => (resolveFirst = resolve)));

    const pending = runGuardedRefresh(guard, run);
    expect(guard.current).toBe(true);
    // A second attempt while still locked reports it did not run, and does
    // not touch the lock.
    await expect(runGuardedRefresh(guard, run)).resolves.toBe(false);
    expect(guard.current).toBe(true);

    resolveFirst();
    await pending;
    expect(guard.current).toBe(false);
  });

  it('clears the guard even when the callback throws, so a failed refresh can be retried', async () => {
    const guard: RefreshInFlightRef = { current: false };
    const run = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(runGuardedRefresh(guard, run)).rejects.toThrow('network down');
    expect(guard.current).toBe(false);

    // A subsequent pull must be able to run again, not be locked out by the
    // previous failure.
    const retry = vi.fn(async () => {});
    await expect(runGuardedRefresh(guard, retry)).resolves.toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('an error does not permanently disable refresh — many failures in a row can each be retried', async () => {
    const guard: RefreshInFlightRef = { current: false };
    const failing = vi.fn(async () => {
      throw new Error('still down');
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(runGuardedRefresh(guard, failing)).rejects.toThrow('still down');
      expect(guard.current).toBe(false);
    }
    expect(failing).toHaveBeenCalledTimes(3);
  });

  it('runs sequential (non-overlapping) calls independently, one after the other', async () => {
    const guard: RefreshInFlightRef = { current: false };
    const run = vi.fn(async () => {});

    await runGuardedRefresh(guard, run);
    await runGuardedRefresh(guard, run);
    await runGuardedRefresh(guard, run);

    expect(run).toHaveBeenCalledTimes(3);
  });
});

/**
 * Shared harness mirroring the exact `onPullToRefresh` shape every screen
 * uses: `runGuardedRefresh(ref, async () => { setIsRefreshing(true); try {
 * ...reuse existing loader/sync... } finally { setIsRefreshing(false); } })`.
 * Each screen's own test below supplies the real reuse calls (refreshSync,
 * refreshFavorites, refresh, loadEmotions, ...); this just factors out the
 * guard + spinner plumbing so every screen's test proves the same
 * guarantees against the same wiring pattern actually used in source.
 */
function makePullToRefreshHarness(run: () => Promise<void>) {
  const guard: RefreshInFlightRef = { current: false };
  let isRefreshing = false;
  const onPullToRefresh = () =>
    runGuardedRefresh(guard, async () => {
      isRefreshing = true;
      try {
        await run();
      } finally {
        isRefreshing = false;
      }
    });
  return { onPullToRefresh, guard, isRefreshing: () => isRefreshing };
}

describe('Home pull-to-refresh: reuses loadEmotions, no duplicate fetch path', () => {
  it('awaits loadEmotions and always stops the spinner, even on failure', async () => {
    // loadEmotions (src/app/index.tsx) never throws — it catches every
    // failure internally so the screen can keep showing good data — so this
    // only needs to prove the finally still runs given that
    // resolved-without-throwing contract.
    const loadEmotions = vi.fn(async () => {});
    const { onPullToRefresh, guard, isRefreshing } = makePullToRefreshHarness(loadEmotions);

    await onPullToRefresh();
    expect(loadEmotions).toHaveBeenCalledTimes(1);
    expect(isRefreshing()).toBe(false);
    expect(guard.current).toBe(false);
  });

  it('two rapid pulls only trigger one loadEmotions call', async () => {
    let resolveFirst: () => void = () => {};
    const loadEmotions = vi.fn(() => new Promise<void>((resolve) => (resolveFirst = resolve)));
    const { onPullToRefresh } = makePullToRefreshHarness(loadEmotions);

    const first = onPullToRefresh();
    const second = onPullToRefresh();
    resolveFirst();
    await Promise.all([first, second]);

    expect(loadEmotions).toHaveBeenCalledTimes(1);
  });

  it('recovers a stuck/failed initial load: pull retries loadEmotions, and a later retry can succeed', async () => {
    // Mirrors loadEmotions' real never-throws contract: a failed fetch is
    // caught internally and just leaves emotions/isLoading as they were,
    // never rejecting the outer call.
    let emotionsLoaded = false;
    const loadEmotions = vi
      .fn(async () => {
        emotionsLoaded = false; // simulates the failed attempt changing nothing
      })
      .mockImplementationOnce(async () => {
        emotionsLoaded = false;
      })
      .mockImplementationOnce(async () => {
        emotionsLoaded = true;
      });
    const { onPullToRefresh, guard } = makePullToRefreshHarness(loadEmotions);

    await onPullToRefresh(); // first pull: still stuck/failed
    expect(emotionsLoaded).toBe(false);
    expect(guard.current).toBe(false); // guard released, retry remains possible

    await onPullToRefresh(); // second pull: recovers
    expect(emotionsLoaded).toBe(true);
    expect(loadEmotions).toHaveBeenCalledTimes(2);
  });
});

describe('Favorites pull-to-refresh: refreshSync + refreshFavorites, guarded and never left spinning', () => {
  it('calls refreshSync before refreshFavorites, and always stops the spinner, even when refreshSync throws', async () => {
    const order: string[] = [];
    const refreshSync = vi.fn(async () => {
      order.push('refreshSync');
      throw new Error('sync failed');
    });
    const refreshFavorites = vi.fn(async () => {
      order.push('refreshFavorites');
    });
    const { onPullToRefresh, guard, isRefreshing } = makePullToRefreshHarness(async () => {
      await refreshSync();
      await refreshFavorites();
    });

    await expect(onPullToRefresh()).rejects.toThrow('sync failed');
    expect(order).toEqual(['refreshSync']);
    // A failed sync must never skip re-reading local storage's current
    // (untouched, still-good) state permanently, nor leave the pull spinner
    // stuck — the finally above must have run.
    expect(isRefreshing()).toBe(false);
    expect(refreshFavorites).not.toHaveBeenCalled();
    expect(guard.current).toBe(false);
  });

  it('re-reads local favorites after a successful sync, reflecting whatever the sync just wrote', async () => {
    const order: string[] = [];
    const refreshSync = vi.fn(async () => {
      order.push('refreshSync');
    });
    const refreshFavorites = vi.fn(async () => {
      order.push('refreshFavorites');
    });
    const { onPullToRefresh } = makePullToRefreshHarness(async () => {
      await refreshSync();
      await refreshFavorites();
    });

    await onPullToRefresh();
    expect(order).toEqual(['refreshSync', 'refreshFavorites']);
  });

  it('a guest (refreshSync is a no-op) still gets a fresh local-storage read', async () => {
    // Mirrors refreshSync's real guest behavior (useAuth.tsx): resolves
    // immediately without throwing, without touching anything.
    const refreshSync = vi.fn(async () => {});
    const refreshFavorites = vi.fn(async () => {});
    const { onPullToRefresh } = makePullToRefreshHarness(async () => {
      await refreshSync();
      await refreshFavorites();
    });

    await onPullToRefresh();
    expect(refreshSync).toHaveBeenCalledTimes(1);
    expect(refreshFavorites).toHaveBeenCalledTimes(1);
  });

  it('rapid double refresh cannot overlap', async () => {
    let resolveSync: () => void = () => {};
    const refreshSync = vi.fn(() => new Promise<void>((resolve) => (resolveSync = resolve)));
    const refreshFavorites = vi.fn(async () => {});
    const { onPullToRefresh } = makePullToRefreshHarness(async () => {
      await refreshSync();
      await refreshFavorites();
    });

    const first = onPullToRefresh();
    const second = onPullToRefresh();
    resolveSync();
    await Promise.all([first, second]);

    expect(refreshSync).toHaveBeenCalledTimes(1);
    expect(refreshFavorites).toHaveBeenCalledTimes(1);
  });

  it('recovers a stuck/failed initial load (e.g. isReady never flips true) — pull retries refreshFavorites, and another retry remains possible after a failure', async () => {
    const refreshSync = vi.fn(async () => {});
    const refreshFavorites = vi
      .fn()
      .mockRejectedValueOnce(new Error('local read failed'))
      .mockResolvedValueOnce(undefined);
    const { onPullToRefresh, guard } = makePullToRefreshHarness(async () => {
      await refreshSync();
      await refreshFavorites();
    });

    await expect(onPullToRefresh()).rejects.toThrow('local read failed');
    expect(guard.current).toBe(false);

    await onPullToRefresh();
    expect(refreshFavorites).toHaveBeenCalledTimes(2);
  });
});

describe('Reflections pull-to-refresh: refreshSync + local reflection re-read, guest-safe, guarded', () => {
  it('signed-in: runs refreshSync then re-reads local reflections, in that order', async () => {
    const order: string[] = [];
    const refreshSync = vi.fn(async () => {
      order.push('refreshSync');
    });
    const refresh = vi.fn(async () => {
      order.push('refresh');
    });
    const { onPullToRefresh } = makePullToRefreshHarness(async () => {
      await refreshSync();
      await refresh();
    });

    await onPullToRefresh();
    expect(order).toEqual(['refreshSync', 'refresh']);
  });

  it('guest: refreshSync no-ops, local reflections are still re-read', async () => {
    const refreshSync = vi.fn(async () => {});
    const refresh = vi.fn(async () => {});
    const { onPullToRefresh } = makePullToRefreshHarness(async () => {
      await refreshSync();
      await refresh();
    });

    await onPullToRefresh();
    expect(refreshSync).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('newly synced reflection data can appear after refresh — the local re-read runs after sync completes, not before', async () => {
    let cloudReflectionArrived = false;
    const refreshSync = vi.fn(async () => {
      cloudReflectionArrived = true; // simulates a download from another device
    });
    let seenAtLocalRead = false;
    const refresh = vi.fn(async () => {
      seenAtLocalRead = cloudReflectionArrived;
    });
    const { onPullToRefresh } = makePullToRefreshHarness(async () => {
      await refreshSync();
      await refresh();
    });

    await onPullToRefresh();
    expect(seenAtLocalRead).toBe(true);
  });

  it('failure does not delete local reflections — a rejected sync never calls the local re-read, leaving stored data untouched', async () => {
    const refreshSync = vi.fn(async () => {
      throw new Error('sync failed');
    });
    const refresh = vi.fn(async () => {});
    const { onPullToRefresh, guard } = makePullToRefreshHarness(async () => {
      await refreshSync();
      await refresh();
    });

    await expect(onPullToRefresh()).rejects.toThrow('sync failed');
    expect(refresh).not.toHaveBeenCalled();
    expect(guard.current).toBe(false);
  });

  it('stuck initial load recovers: pull retries the local reflection loader, and a later retry can succeed', async () => {
    const refreshSync = vi.fn(async () => {});
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error('storage read failed'))
      .mockResolvedValueOnce(undefined);
    const { onPullToRefresh, guard } = makePullToRefreshHarness(async () => {
      await refreshSync();
      await refresh();
    });

    await expect(onPullToRefresh()).rejects.toThrow('storage read failed');
    expect(guard.current).toBe(false);

    await onPullToRefresh();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe('Settings pull-to-refresh: reuses refreshSync only, no duplicate preference sync', () => {
  it('signed-in: calls the existing refreshSync (which already applies synced preferences via shared context state)', async () => {
    const refreshSync = vi.fn(async () => {});
    const { onPullToRefresh } = makePullToRefreshHarness(refreshSync);

    await onPullToRefresh();
    expect(refreshSync).toHaveBeenCalledTimes(1);
  });

  it('guest: refreshSync no-ops harmlessly, refresh completes and clears the spinner', async () => {
    const refreshSync = vi.fn(async () => {});
    const { onPullToRefresh, isRefreshing, guard } = makePullToRefreshHarness(refreshSync);

    await onPullToRefresh();
    expect(isRefreshing()).toBe(false);
    expect(guard.current).toBe(false);
  });

  it('a failed sync clears the spinner and guard, and a later retry is possible', async () => {
    const refreshSync = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(undefined);
    const { onPullToRefresh, guard } = makePullToRefreshHarness(refreshSync);

    await expect(onPullToRefresh()).rejects.toThrow('network down');
    expect(guard.current).toBe(false);

    await onPullToRefresh();
    expect(refreshSync).toHaveBeenCalledTimes(2);
  });
});

describe('Screen wiring (source-scan): each screen is actually connected to the guarded refresh helper', () => {
  const favoritesSource = readFileSync(resolve(__dirname, '../src/app/favorites.tsx'), 'utf-8');
  const homeSource = readFileSync(resolve(__dirname, '../src/app/index.tsx'), 'utf-8');
  const reflectionsSource = readFileSync(resolve(__dirname, '../src/app/reflections.tsx'), 'utf-8');
  const settingsSource = readFileSync(resolve(__dirname, '../src/app/settings.tsx'), 'utf-8');
  const ayahExperienceSource = readFileSync(resolve(__dirname, '../src/components/AyahExperience.tsx'), 'utf-8');

  it('Favorites renders a RefreshControl on its ScrollView', () => {
    expect(favoritesSource).toMatch(/from 'react-native'/);
    expect(favoritesSource).toMatch(/RefreshControl/);
    expect(favoritesSource).toMatch(/refreshControl=\{/);
  });

  it('Favorites uses the shared guard, not an ad hoc `if (isRefreshing) return` re-implementation', () => {
    expect(favoritesSource).toMatch(/from '@\/utils\/pullToRefresh'/);
    expect(favoritesSource).toMatch(/runGuardedRefresh\(/);
    expect(favoritesSource).not.toMatch(/if \(isRefreshing\) return;/);
  });

  it('Favorites reuses the existing full sync and local re-read — never a duplicate sync/fetch implementation', () => {
    expect(favoritesSource).toMatch(/refreshSync\(\)/);
    expect(favoritesSource).toMatch(/from '@\/auth\/useAuth'/);
    expect(favoritesSource).toMatch(/await refreshFavorites\(\)/);
  });

  it('Home renders a RefreshControl and uses the shared guard, not React state alone', () => {
    expect(homeSource).toMatch(/RefreshControl/);
    expect(homeSource).toMatch(/refreshControl=\{/);
    expect(homeSource).toMatch(/from '@\/utils\/pullToRefresh'/);
    expect(homeSource).toMatch(/runGuardedRefresh\(/);
    expect(homeSource).not.toMatch(/if \(isPullRefreshing\) return;/);
  });

  it('Home reuses loadEmotions for its pull-to-refresh instead of a second fetch implementation', () => {
    const pullBlock = homeSource.match(/const onPullToRefresh = useCallback\(async \(\) => \{[\s\S]*?\n {2}\}, \[loadEmotions\]\);/)?.[0] ?? '';
    expect(pullBlock).toMatch(/await loadEmotions\(\)/);
    expect(pullBlock).not.toMatch(/getEmotions\(/);
    expect(pullBlock).not.toMatch(/withRetry\(/);
  });

  it('Reflections renders a RefreshControl on its FlatList and uses the shared guard', () => {
    expect(reflectionsSource).toMatch(/RefreshControl/);
    expect(reflectionsSource).toMatch(/refreshControl=\{/);
    expect(reflectionsSource).toMatch(/from '@\/utils\/pullToRefresh'/);
    expect(reflectionsSource).toMatch(/runGuardedRefresh\(/);
  });

  it('Reflections reuses refreshSync and the existing local reflection loader — never a duplicate reflection-sync path', () => {
    expect(reflectionsSource).toMatch(/from '@\/auth\/useAuth'/);
    expect(reflectionsSource).toMatch(/await refreshSync\(\)/);
    expect(reflectionsSource).toMatch(/await refresh\(\)/);
    expect(reflectionsSource).not.toMatch(/syncReflections\(/);
    expect(reflectionsSource).not.toMatch(/decryptReflectionText\(/);
  });

  it('Settings renders a RefreshControl on its ScrollView and uses the shared guard', () => {
    expect(settingsSource).toMatch(/RefreshControl/);
    expect(settingsSource).toMatch(/refreshControl=\{/);
    expect(settingsSource).toMatch(/from '@\/utils\/pullToRefresh'/);
    expect(settingsSource).toMatch(/runGuardedRefresh\(/);
  });

  it('Settings reuses refreshSync only — no separate/duplicate preference-sync call', () => {
    expect(settingsSource).toMatch(/from '@\/auth\/useAuth'/);
    expect(settingsSource).toMatch(/await refreshSync\(\)/);
    expect(settingsSource).not.toMatch(/reconcilePreferencesOnSignIn\(/);
    expect(settingsSource).not.toMatch(/putCloudPreferences\(/);
  });

  it('Settings never touches auth/sign-in/sign-out/delete-account/Sync Password UI', () => {
    expect(settingsSource).not.toMatch(/signInWith(Google|Apple)IdToken/);
    expect(settingsSource).not.toMatch(/signOut\(/);
    expect(settingsSource).not.toMatch(/deleteAccount\(/);
    expect(settingsSource).not.toMatch(/SyncPassphraseSheet/);
  });

  it('AyahExperience renders a RefreshControl and uses the shared guard', () => {
    expect(ayahExperienceSource).toMatch(/RefreshControl/);
    expect(ayahExperienceSource).toMatch(/refreshControl=\{/);
    expect(ayahExperienceSource).toMatch(/from '@\/utils\/pullToRefresh'/);
    expect(ayahExperienceSource).toMatch(/runGuardedRefresh\(/);
  });
});
