import { AuthChallengeModel } from '../models/AuthChallenge';
import type { AuthChallengeRepository, ChallengeUse, NonceForm } from './AuthChallengeRepository';

export class MongooseAuthChallengeRepository implements AuthChallengeRepository {
  async issue(nonceHash: string, expiresAt: Date, purgeAt: Date): Promise<void> {
    await AuthChallengeModel.create({ nonceHash, expiresAt, purgeAt, consumedAt: null });
  }

  async consume(candidates: readonly { hash: string; form: NonceForm }[], now: Date, retainUntil: Date): Promise<{ use: ChallengeUse; form?: NonceForm }> {
    // One atomic update per form: of two concurrent sign-ins with the same token, only one finds consumedAt still null.
    for (const { hash, form } of candidates) {
      const won = await AuthChallengeModel.findOneAndUpdate(
        { nonceHash: hash, consumedAt: null, expiresAt: { $gt: now } },
        { $set: { consumedAt: now, consumedForm: form, purgeAt: retainUntil } },
      ).lean();
      if (won) return { use: 'consumed', form };
    }
    const seen = await AuthChallengeModel.findOne({ nonceHash: { $in: candidates.map((c) => c.hash) } }).lean<{ consumedAt: Date | null }>();
    if (!seen) return { use: 'unknown' };
    return { use: seen.consumedAt ? 'replayed' : 'expired' };
  }
}
