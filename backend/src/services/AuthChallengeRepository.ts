/**
 * Single-use sign-in challenges (auth/signInChallenge.ts), stored by the SHA-256 of their nonce only.
 *  - consumed: an unexpired, unused challenge matched and is now used up (atomically: two requests can't both win);
 *  - replayed: it matched a challenge already used — the same ID token presented again;
 *  - expired: it matched a challenge issued too long ago;
 *  - unknown: no challenge of this server (an older app build, or a nonce the client made up itself).
 */
export type ChallengeUse = 'consumed' | 'replayed' | 'expired' | 'unknown';

/**
 * How the provider signed the nonce into its token: as sent ('raw') or as its SHA-256 ('sha256'). Recorded on the
 * consumed challenge, so a device test shows what each provider's native flow actually does.
 */
export type NonceForm = 'raw' | 'sha256';

export interface AuthChallengeRepository {
  issue(nonceHash: string, expiresAt: Date, purgeAt: Date): Promise<void>;
  /**
   * `candidates`: the stored hash each form of this nonce claim would have, in order (signInChallenge.ts). A consumed
   * challenge is then kept until `retainUntil`, so a replay is recognised.
   */
  consume(candidates: readonly { hash: string; form: NonceForm }[], now: Date, retainUntil: Date): Promise<{ use: ChallengeUse; form?: NonceForm }>;
}
