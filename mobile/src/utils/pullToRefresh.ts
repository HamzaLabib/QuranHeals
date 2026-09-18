export type RefreshInFlightRef = { current: boolean };

/**
 * Runs `run` unless a previous call made through this same ref is still in
 * flight — the guard against two rapid pull-to-refresh gestures starting
 * overlapping refresh operations (duplicate syncs/fetches racing each
 * other). Deliberately backed by a plain mutable ref rather than React
 * state: state updates are applied asynchronously, so a second call fired
 * in the same tick as the first (two fast pulls) could still observe the
 * pre-update (false) state and slip through, whereas a ref mutation is
 * visible to the very next synchronous check.
 *
 * Returns whether `run` actually executed (`false` means this call was
 * skipped because one was already in flight). Always clears the guard,
 * including when `run` throws, so a failed refresh never leaves the screen
 * permanently unable to refresh again.
 */
export async function runGuardedRefresh(inFlightRef: RefreshInFlightRef, run: () => Promise<void>): Promise<boolean> {
  if (inFlightRef.current) return false;
  inFlightRef.current = true;
  try {
    await run();
    return true;
  } finally {
    inFlightRef.current = false;
  }
}
