import { ApiError, type ApiErrorKind } from './api';

// Transient — worth a short automatic retry. Never invalid_request/no_ayah
// (a permanent 4xx: retrying it would always fail the same way) — see Part
// 4 of the background/resume-reliability phase: "Do not blindly retry:
// invalid request, validation failures, permanent 4xx errors."
const RETRYABLE_KINDS: ReadonlySet<ApiErrorKind> = new Set<ApiErrorKind>([
  'network',
  'timeout',
  'backend_unavailable',
  'rate_limited',
  'server',
]);

function isRetryable(error: unknown): boolean {
  return error instanceof ApiError && RETRYABLE_KINDS.has(error.kind);
}

// Short, bounded exponential-ish backoff — three attempts total, then stop
// and let the caller's existing manual "Try Again" action take over. Never
// an unbounded/indefinite retry loop.
const BACKOFF_MS = [500, 1500] as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps a single API call with a short bounded retry for transient failures
 * (network hiccups, timeouts, 5xx, 429/408) — exactly the class of failure
 * a device coming back from background/lock is prone to hitting once. Not a
 * generic retry-everything wrapper: permanent failures (4xx other than
 * 408/429) are rethrown on the first attempt.
 */
export async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === BACKOFF_MS.length) {
        throw error;
      }
      await delay(BACKOFF_MS[attempt]);
    }
  }

  // Unreachable — the loop above always returns or throws — but keeps
  // TypeScript satisfied that every path returns T.
  throw lastError;
}
