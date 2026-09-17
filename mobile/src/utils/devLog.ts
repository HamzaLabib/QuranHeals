/**
 * Dev-only diagnostics for lifecycle/auth/network issues (Part 4 of the
 * background/resume-reliability phase) — a no-op in production builds.
 * Never pass a token, password, reflection text, or other sensitive value
 * as `detail`; these calls are for things like "emotions fetch failed:
 * network, attempt 2" or "app foregrounded after 4m32s in background."
 */
export function devLog(scope: string, message: string, detail?: Record<string, unknown>): void {
  if (!__DEV__) return;
  if (detail) {
    console.log(`[${scope}] ${message}`, detail);
  } else {
    console.log(`[${scope}] ${message}`);
  }
}
