import type { AdminAccount, AdminAccountStore, RecordCounts } from '../admin/adminAccountDeletion';
import { AppleCredentialModel } from '../models/AppleCredential';
import { IssueReportModel } from '../models/IssueReport';
import { SessionModel } from '../models/Session';
import { UserModel } from '../models/User';
import { UserFavoriteModel } from '../models/UserFavorite';
import { UserPreferenceModel } from '../models/UserPreference';
import { UserReflectionModel } from '../models/UserReflection';
import { UserSyncKeyModel } from '../models/UserSyncKey';
import type { AuthProvider } from '../types/accountDomain';
import { isObjectIdHex } from '../utils/objectId';

type UserDoc = { _id: unknown; provider: AuthProvider; email?: string; emailVerified?: boolean; createdAt?: Date };

function toAccount(doc: UserDoc): AdminAccount {
  return {
    userId: String(doc._id),
    provider: doc.provider,
    email: doc.email,
    emailVerified: doc.emailVerified,
    createdAt: doc.createdAt?.toISOString(),
  };
}

/**
 * The admin deletion tool's view of MongoDB (admin/adminAccountDeletion.ts).
 * Reads only the fields it needs — never ciphertext, token hashes or keys —
 * and counts documents rather than loading them. The account deletion
 * itself goes through MongooseAccountDeletionService, not this class.
 */
export class MongooseAdminAccountStore implements AdminAccountStore {
  async findAccountsByEmail(email: string, provider?: AuthProvider): Promise<AdminAccount[]> {
    const docs = await UserModel.find({ email, ...(provider ? { provider } : {}) })
      .select('provider email emailVerified createdAt')
      .lean<UserDoc[]>();
    return docs.map(toAccount);
  }

  async findAccountById(userId: string): Promise<AdminAccount | null> {
    if (!isObjectIdHex(userId)) return null;
    const doc = await UserModel.findById(userId).select('provider email emailVerified createdAt').lean<UserDoc>();
    return doc ? toAccount(doc) : null;
  }

  async countRecords(userId: string): Promise<RecordCounts> {
    const [user, session, favorite, favoriteTombstones, preference, reflection, reflectionTombstones, syncKey, appleCredential] = await Promise.all([
      isObjectIdHex(userId) ? UserModel.countDocuments({ _id: userId }) : Promise.resolve(0),
      SessionModel.countDocuments({ userId }),
      UserFavoriteModel.countDocuments({ userId }),
      UserFavoriteModel.countDocuments({ userId, deleted: true }),
      UserPreferenceModel.countDocuments({ userId }),
      UserReflectionModel.countDocuments({ userId }),
      UserReflectionModel.countDocuments({ userId, deleted: true }),
      UserSyncKeyModel.countDocuments({ userId }),
      AppleCredentialModel.countDocuments({ userId }),
    ]);
    return {
      User: user,
      Session: session,
      UserFavorite: favorite,
      UserPreference: preference,
      UserReflection: reflection,
      UserSyncKey: syncKey,
      AppleCredential: appleCredential,
      tombstones: { UserFavorite: favoriteTombstones, UserReflection: reflectionTombstones },
    };
  }

  async countIssueReportsByEmail(email: string): Promise<number> {
    return IssueReportModel.countDocuments({ email });
  }

  async deleteIssueReportsByEmail(email: string): Promise<number> {
    const result = await IssueReportModel.deleteMany({ email });
    return result.deletedCount;
  }
}
