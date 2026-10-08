import mongoose from 'mongoose';

import { AppError } from '../errors/AppError';
import { UserModel } from '../models/User';

/**
 * Closes the Phase B3 race: a sync request can pass requireAuth (B2) and
 * then, before its write actually commits, lose to a concurrent account
 * deletion — deleting every user-scoped document and then the User row
 * itself (MongooseAccountDeletionService). Without this guard, a write
 * like `addFavorites`'s upsert would simply recreate a document for a
 * userId that no longer exists, because nothing re-checks the account's
 * existence at the moment the write actually happens — only once, much
 * earlier, in requireAuth.
 *
 * A plain "check the user exists, then write" (not atomic) is NOT enough:
 * account deletion could still complete in the gap between the check and
 * the write. Instead, the existence check here is itself a WRITE to the
 * User document (a harmless touch of `updatedAt`, not just a read), run in
 * the same transaction as `operation`. Account deletion's own transaction
 * also writes to that exact document (it deletes it) — so if the two ever
 * genuinely overlap, MongoDB's transaction conflict detection forces
 * whichever one would otherwise violate isolation to abort and retry
 * (`session.withTransaction` already retries automatically on that kind of
 * transient conflict). Whichever side's retry re-runs against the
 * post-deletion state correctly finds the user gone. A plain read-only
 * check inside a transaction would NOT give this guarantee on its own:
 * snapshot isolation prevents dirty/non-repeatable reads of the SAME
 * document, but does not by itself stop write skew across two DIFFERENT
 * documents (a classic case where one transaction's read becomes stale the
 * instant another commits) — forcing a real write-write dependency on the
 * User document is what closes that gap.
 *
 * Throws AppError(401) — the same response B2 already returns for an
 * unauthorized request — if the user is gone, so a write that loses this
 * race is indistinguishable from a request that was never authorized in
 * the first place (see Part B §7 / B2's generic-401 convention). Never
 * reveals that a write specifically lost a race.
 */
export async function withExistingUser<T>(
  userId: string,
  operation: (session: mongoose.ClientSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const user = await UserModel.findOneAndUpdate(
        { _id: userId },
        { $set: { updatedAt: new Date() } },
        { session, returnDocument: 'after' },
      );
      if (!user) {
        throw new AppError('Sign in required.', 401);
      }
      return operation(session);
    });
  } finally {
    await session.endSession();
  }
}
