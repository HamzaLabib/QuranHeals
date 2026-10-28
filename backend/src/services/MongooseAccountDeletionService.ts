import mongoose from 'mongoose';

import { AccountDeletionModel, registerEntry } from '../models/AccountDeletion';
import { AppleCredentialModel } from '../models/AppleCredential';
import { SessionModel } from '../models/Session';
import { UserModel } from '../models/User';
import { UserFavoriteModel } from '../models/UserFavorite';
import { UserPreferenceModel } from '../models/UserPreference';
import { UserReadingRecordModel } from '../models/UserReadingRecord';
import { UserReadingSyncStateModel } from '../models/UserReadingSyncState';
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
  constructor(private readonly now: () => Date = () => new Date()) {}

  async deleteAccount(userId: string): Promise<void> {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(() => this.deleteSteps(userId, session));
    } finally {
      await session.endSession();
    }
  }

  /**
   * The same steps without a transaction, for a restored backup started as a standalone mongod (which has no
   * transactions): scripts/restoreDeletionRegister.ts only. Never used by the API, where all-or-nothing matters.
   */
  async deleteAccountOnStandaloneRestore(userId: string): Promise<void> {
    await this.deleteSteps(userId, null);
  }

  private async deleteSteps(userId: string, session: mongoose.ClientSession | null): Promise<void> {
    // Sequential, not Promise.all: a single MongoDB session can only
    // have one operation in flight on its active transaction at a time
    // (running several `.session(session)` calls concurrently throws
    // "Only servers in a sharded cluster can start a new transaction at
    // the active transaction number", code 117). Everything still runs
    // inside the one atomic transaction (deleteAccount).
    await UserFavoriteModel.deleteMany({ userId }).session(session);
    await UserPreferenceModel.deleteMany({ userId }).session(session);
    await UserReflectionModel.deleteMany({ userId }).session(session);
    await UserSyncKeyModel.deleteMany({ userId }).session(session);
    // أورادي وختماتي: every ورد, Khatma, deletion marker and the change counter.
    await UserReadingRecordModel.deleteMany({ userId }).session(session);
    await UserReadingSyncStateModel.deleteMany({ userId }).session(session);
    await AppleCredentialModel.deleteMany({ userId }).session(session);
    await SessionModel.deleteMany({ userId }).session(session);

    await UserModel.deleteOne({ _id: userId }).session(session);
    // The deletion register (models/AccountDeletion.ts): in the same transaction, so a deletion is never
    // recorded without happening, or done without being recorded. It keeps the account deleted if a backup
    // taken earlier is ever restored. Calling this again for the same id adds another entry, which is harmless.
    await AccountDeletionModel.create([registerEntry(userId, this.now())], session ? { session } : {});
  }
}
