import { AppError } from '../errors/AppError';
import type { UserRepository } from '../services/UserRepository';
import type { AuthProvider } from '../types/accountDomain';
import type { AppleTokenVerifier } from './appleTokenVerifier';
import type { GoogleTokenVerifier } from './googleTokenVerifier';

/**
 * Fresh provider re-authentication for destructive account actions
 * (currently: resetting encrypted reflection sync after a forgotten sync
 * password). A valid Quran Heals session alone is not enough — the person
 * must prove, right now, that they control the Apple/Google identity that
 * owns this Quran Heals account.
 */

/** A provider ID token older than this (by its own `iat`) is not "fresh". */
export const REAUTH_MAX_AGE_MS = 10 * 60 * 1000;
/** Tolerated provider-clock skew for a token that appears issued in the future. */
const FUTURE_SKEW_MS = 60 * 1000;

const REAUTH_FAILED_MESSAGE = 'Identity verification failed.';

export type ProviderCredential = { provider: AuthProvider; idToken: string };

export type ReauthenticationDeps = {
  userRepository: UserRepository;
  googleVerifier: GoogleTokenVerifier;
  appleVerifier: AppleTokenVerifier;
};

/**
 * Throws AppError(403) — one generic message for every failure, so it
 * reveals nothing about which check failed — unless ALL of these hold:
 *  1. the Quran Heals user (from the verified session — `userId` is never
 *     client-supplied) still exists;
 *  2. the credential is for that account's own provider — each account
 *     has exactly one provider identity (no linking exists), so an Apple
 *     account can only be confirmed with Apple, a Google account only with
 *     Google;
 *  3. the provider token verifies with that provider (signature, issuer,
 *     audience, expiry — the same verifiers as sign-in);
 *  4. its verified subject is exactly the account's stored providerSubject
 *     (the stable identity sign-in uses; email is never compared);
 *  5. it was issued within REAUTH_MAX_AGE_MS;
 *  6. it was issued at or after `notIssuedBefore`, when given — the reset
 *     passes the current sync key's creation time, so one provider token can
 *     never be replayed to delete a key created after it.
 * Uses provider-issued time (`iat`) and the server clock only.
 */
export async function verifyFreshProviderReauthentication(
  deps: ReauthenticationDeps,
  userId: string,
  credential: ProviderCredential,
  options: { notIssuedBefore?: Date | null; now?: number } = {},
): Promise<void> {
  const now = options.now ?? Date.now();
  const fail = () => new AppError(REAUTH_FAILED_MESSAGE, 403);

  const account = await deps.userRepository.findProviderIdentity(userId);
  if (!account || account.provider !== credential.provider) throw fail();

  const verifier = account.provider === 'apple' ? deps.appleVerifier : deps.googleVerifier;
  let verified: { providerSubject: string; issuedAt?: number };
  try {
    verified = await verifier.verifyIdToken(credential.idToken);
  } catch {
    throw fail();
  }

  if (verified.providerSubject !== account.providerSubject) throw fail();

  if (typeof verified.issuedAt !== 'number' || !Number.isFinite(verified.issuedAt)) throw fail();
  const issuedAtMs = verified.issuedAt * 1000;
  if (issuedAtMs > now + FUTURE_SKEW_MS || now - issuedAtMs > REAUTH_MAX_AGE_MS) throw fail();
  // `iat` has whole-second precision: compare in whole seconds, so a token
  // issued in the same second the key was created is not wrongly refused.
  if (options.notIssuedBefore && verified.issuedAt < Math.floor(options.notIssuedBefore.getTime() / 1000)) throw fail();
}
