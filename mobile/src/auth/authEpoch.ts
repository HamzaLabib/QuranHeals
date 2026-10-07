/**
 * Which sign-in session is current. Every sign-in and sign-out starts a new
 * epoch, so work begun for an earlier session (a slow sync, a token refresh,
 * a sign-out still clearing storage) can tell that it is stale and must not
 * touch the current session's tokens or data.
 *
 * Access tokens are remembered with the epoch they belong to. A request made
 * with an earlier session's token must never be "rescued" by refreshing:
 * the refresh credential stored now belongs to the CURRENT session, possibly
 * another account, and retrying with its token would send the old account's
 * data to the new one.
 *
 * Deliberately dependency-free (no SecureStore), so syncApi.ts can import it.
 */

let epoch = 0;
const tokenEpochs = new Map<string, number>();

export function beginAuthEpoch(): number {
  epoch += 1;
  return epoch;
}

export function currentAuthEpoch(): number {
  return epoch;
}

/** Records that `token` is an access token of session `ofEpoch`. */
export function recordSessionToken(token: string, ofEpoch: number = epoch): void {
  tokenEpochs.set(token, ofEpoch);
}

/** True only for a token known to belong to an earlier session. */
export function isStaleSessionToken(token: string): boolean {
  const ofEpoch = tokenEpochs.get(token);
  return ofEpoch !== undefined && ofEpoch !== epoch;
}

/** Test-only. */
export function resetAuthEpochForTests(): void {
  epoch = 0;
  tokenEpochs.clear();
}
