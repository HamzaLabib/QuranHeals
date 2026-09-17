import mongoose from 'mongoose';

import { SessionModel } from '../models/Session';
import { UserModel } from '../models/User';
import { UserFavoriteModel } from '../models/UserFavorite';
import { UserPreferenceModel } from '../models/UserPreference';
import { UserReflectionModel } from '../models/UserReflection';
import { UserSyncKeyModel } from '../models/UserSyncKey';
import type { AccountDeletionService } from './AccountDeletionService';

/**
 * Deletes every user-owned document in one transaction. This backend's
 * MongoDB is always a replica set (Atlas `mongodb+srv://` connections
 * always are), so transactions are available — see backend/src/scripts/*.ts
 * for the same `mongoose.startSession()`/`withTransaction` pattern already
 * used for other multi-collection writes in this codebase.
 *
 * Deliberately never touches: Ayah/Emotion/EmotionVerseMapping/Verse/
 * VerseTranslation (global Quran data, not user-owned) or IssueReport
 * (never carries a userId — see types/accountDomain.ts's doc comment).
 *
 * `deleteMany`/`deleteOne` matching zero documents is not an error in
 * Mongoose, so calling this twice for the same (now-deleted) userId is
 * safe and does nothing further on the second call.
 */
export class MongooseAccountDeletionService implements AccountDeletionService {
  async deleteAccount(userId: string): Promise<void> {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Promise.all([
          UserFavoriteModel.deleteMany({ userId }).session(session),
          UserPreferenceModel.deleteMany({ userId }).session(session),
          UserReflectionModel.deleteMany({ userId }).session(session),
          UserSyncKeyModel.deleteMany({ userId }).session(session),
          SessionModel.deleteMany({ userId }).session(session),
        ]);
        await UserModel.deleteOne({ _id: userId }).session(session);
      });
    } finally {
      await session.endSession();
    }
  }
}
