import { Schema, model, models } from 'mongoose';

/**
 * A single-use sign-in challenge (auth/signInChallenge.ts). Only the SHA-256 of the nonce is kept, with no user, device
 * or address: it is not personal data. `consumedForm` records how the provider signed the nonce ('raw' or 'sha256'),
 * the evidence the device tests read. MongoDB's TTL monitor deletes each document at `purgeAt`, which is kept past the
 * providers' ID-token lifetime so a consumed nonce is still recognised (and refused) if its token is replayed.
 */
type AuthChallengeEntity = { nonceHash: string; expiresAt: Date; consumedAt: Date | null; consumedForm?: 'raw' | 'sha256'; purgeAt: Date };

const authChallengeSchema = new Schema<AuthChallengeEntity>({
  nonceHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  consumedForm: { type: String, enum: ['raw', 'sha256'] },
  purgeAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

export const AuthChallengeModel = models.AuthChallenge || model<AuthChallengeEntity>('AuthChallenge', authChallengeSchema);
