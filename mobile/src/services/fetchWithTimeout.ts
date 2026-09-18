/**
 * The one shared bound on every network request this app makes — the
 * Quran/emotions API (services/api.ts), the account/sync API
 * (sync/syncApi.ts), and the auth API (auth/authApi.ts) all funnel their
 * `fetch()` calls through this instead of each inventing (or, worse, each
 * omitting) their own timeout.
 *
 * Without this, a request that the OS/network stack neither resolves nor
 * rejects (a dead TCP connection with no RST, a captive portal that never
 * responds, some VPN/firewall failure modes) leaves its awaited promise
 * pending forever. Every "in-flight" ref this app uses to guard against
 * overlapping work (Home's `isFetchingRef`, Ayah's `isLoadingRef`, every
 * screen's pull-to-refresh `runGuardedRefresh` mutex) is only ever released
 * from a `finally` — and a `finally` never runs if the thing it's wrapped
 * around never settles. A bounded timeout is what turns "hangs forever"
 * into "fails after a bounded wait," which is the only way any of those
 * `finally` blocks — and therefore pull-to-refresh's stuck-loading recovery
 * — can ever actually run.
 *
 * 8 seconds matches the timeout services/api.ts already used for
 * Quran/emotions requests before this helper existed — reused here rather
 * than inventing a second number so every network call in the app times out
 * the same way. It's long enough that it should never fire on an ordinary
 * slow mobile connection (well past typical round-trip times, even on 3G),
 * but short enough that a genuinely dead request always surfaces as a
 * normal, retryable failure within a few pull-to-refresh-sized attention
 * spans rather than hanging indefinitely.
 *
 * An aborted request rejects with a DOMException/Error named "AbortError",
 * exactly like a `fetch()` call a caller aborted for any other reason.
 * Every existing caller already wraps its fetch in a try/catch that turns
 * *any* thrown error (network failure, abort, DNS failure, ...) into its
 * own ordinary error type (ApiError/SyncApiError/AuthApiError) — so a
 * timeout here needs no special-casing to avoid an unhandled rejection; it
 * is handled by the exact same code path as "the network is down".
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 8000;

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
