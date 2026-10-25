import { createHash, randomBytes } from 'node:crypto';

import { AppError } from '../errors/AppError';
import type { AuthChallengeRepository, NonceForm } from '../services/AuthChallengeRepository';

/**
 * Request binding for sign-in: the app asks POST /api/auth/challenge for a random nonce and passes it to the provider —
 * Sign in with Apple's `nonce` (mobile/src/auth/appleAuth.ts), Google's OpenID Connect `nonce` request parameter
 * (mobile/src/auth/googleAuth.ts) — which signs it into the ID token. At sign-in, a token whose `nonce` claim matches
 * one of this server's challenges must consume it — once. A stolen token bound to a challenge can therefore never start
 * a second session.
 *
 * Nonce form: OpenID Connect passes the nonce through unchanged, and Google documents doing so. Apple's API documents
 * only "an arbitrary string" (expo-apple-authentication `nonce`), and some integrations send its SHA-256. Both forms
 * are accepted, and the form that matched is recorded on the challenge (`consumedForm`), so a device test establishes
 * what each native flow really does instead of assuming it.
 *
 * Tokens with no nonce, or a nonce this server never issued (app builds before this change; expo-auth-session's own
 * random nonce), keep working while AUTH_NONCE_REQUIRED is 'off' (the default). 'on' refuses them: switch it on only
 * after both native flows are verified on devices and every supported app build binds both providers.
 *
 * Retries: a challenge is consumed as soon as its token verifies, even if the sign-in then fails (no age declaration,
 * a server error). The app asks for a new challenge for every attempt, and a provider token is never reused, so a retry
 * is a new, separately bound sign-in.
 */
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
/** A consumed challenge is kept beyond Apple's and Google's one-hour ID-token lifetime, so its replay is always recognised. */
export const CHALLENGE_RETENTION_MS = 2 * 60 * 60 * 1000;
/**
 * A challenge never used is purged this long after it expires: storage stays bounded by the issue rate (the endpoint is
 * under the global per-IP limit always, and the session limit when ENDPOINT_RATE_LIMITS is on).
 */
export const UNUSED_CHALLENGE_GRACE_MS = 10 * 60 * 1000;

const SIGN_IN_FAILED_MESSAGE = 'Sign-in could not be verified. Please try again.';
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export async function issueSignInChallenge(repository: AuthChallengeRepository, now = new Date()): Promise<{ nonce: string; expiresAt: string }> {
  const nonce = randomBytes(32).toString('hex');
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  await repository.issue(sha256(nonce), expiresAt, new Date(expiresAt.getTime() + UNUSED_CHALLENGE_GRACE_MS));
  return { nonce, expiresAt: expiresAt.toISOString() };
}

/**
 * The stored hash each reading of a nonce claim would have: the claim is the nonce itself ('raw': its SHA-256 is
 * stored), or — if the provider signed the nonce's SHA-256 — the claim is the stored hash itself ('sha256').
 */
export function candidateHashes(claim: string): { hash: string; form: NonceForm }[] {
  const raw = { hash: sha256(claim), form: 'raw' as const };
  return /^[0-9a-f]{64}$/.test(claim) ? [raw, { hash: claim, form: 'sha256' as const }] : [raw];
}

export type SignInBinding = { bound: true; form: NonceForm } | { bound: false };

/**
 * Throws AppError(401) for a replayed challenge always; for an expired one, or a token not bound to any, only when
 * binding is required. While it is not, an expired challenge (a sign-in sheet left open, a web page asleep past its
 * refresh) counts as unbound, which is no weaker than the unbound tokens accepted anyway — but a replay never passes.
 */
export async function bindSignIn(repository: AuthChallengeRepository, nonceClaim: string | undefined, options: { required: boolean; now?: Date }): Promise<SignInBinding> {
  if (nonceClaim) {
    const now = options.now ?? new Date();
    const { use, form } = await repository.consume(candidateHashes(nonceClaim), now, new Date(now.getTime() + CHALLENGE_RETENTION_MS));
    if (use === 'consumed' && form) return { bound: true, form };
    if (use === 'replayed' || (use === 'expired' && options.required)) throw new AppError(SIGN_IN_FAILED_MESSAGE, 401);
  }
  if (options.required) throw new AppError(SIGN_IN_FAILED_MESSAGE, 401);
  return { bound: false };
}
