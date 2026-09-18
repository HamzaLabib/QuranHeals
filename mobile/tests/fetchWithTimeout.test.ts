import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from '@/services/fetchWithTimeout';

/**
 * The one shared bound behind this app's entire "stuck loading is
 * recoverable" guarantee (see fetchWithTimeout.ts's doc comment). Without
 * it, a `fetch()` call that the OS/network stack neither resolves nor
 * rejects leaves every `finally` that depends on it — Home's
 * `isFetchingRef`, Ayah's `isLoadingRef`, every screen's pull-to-refresh
 * `runGuardedRefresh` mutex — permanently unable to run, since a `finally`
 * only ever runs once its `try` settles.
 */

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

describe('fetchWithTimeout: bounds a genuinely hung request', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects once the timeout elapses, even though the underlying fetch never settles on its own', async () => {
    const hungFetch = neverSettlingFetch();
    vi.stubGlobal('fetch', hungFetch);

    const pending = fetchWithTimeout('https://example.test/api', {}, 5000);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(hungFetch).toHaveBeenCalledTimes(1);
  });

  it('does not reject early — the hang survives right up until (but not past) the timeout', async () => {
    const hungFetch = neverSettlingFetch();
    vi.stubGlobal('fetch', hungFetch);

    let settled = false;
    const pending = fetchWithTimeout('https://example.test/api', {}, 5000).catch(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it('never fires the timeout if the request settles first — a normal (even slow) response is unaffected', async () => {
    const response = new Response(JSON.stringify({ success: true, data: null }), { status: 200 });
    const slowFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(response), 3000);
        }),
    );
    vi.stubGlobal('fetch', slowFetch);

    const pending = fetchWithTimeout('https://example.test/api', {}, 5000);
    await vi.advanceTimersByTimeAsync(3000);
    const result = await pending;

    expect(result.status).toBe(200);
  });

  it('clears its internal timer on success, so it can never fire late and affect a later unrelated call', async () => {
    const response = new Response(null, { status: 204 });
    const fastFetch = vi.fn(async () => response);
    vi.stubGlobal('fetch', fastFetch);

    await fetchWithTimeout('https://example.test/api', {}, 5000);
    // If the timer weren't cleared, this would be the moment it fires —
    // nothing should throw or reject as a result, since nothing is pending.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fastFetch).toHaveBeenCalledTimes(1);
  });

  it('uses the documented 8-second default when no explicit timeout is given', async () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(8000);

    const hungFetch = neverSettlingFetch();
    vi.stubGlobal('fetch', hungFetch);

    const pending = fetchWithTimeout('https://example.test/api');
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS);
    await assertion;
  });
});
