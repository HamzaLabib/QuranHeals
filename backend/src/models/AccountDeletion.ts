import { Schema, model, models } from 'mongoose';

/**
 * The deletion register: one entry per account deletion (in the app or by the email-deletion tool), written in the
 * same transaction as the deletion itself (services/MongooseAccountDeletionService.ts). Its only purpose is to keep a
 * deleted account deleted when a database backup taken before the deletion is restored
 * (scripts/restoreDeletionRegister.ts; docs/database-restore.md).
 *
 * It holds the internal account id and the time only: no email, provider identifier or content. MongoDB's TTL monitor
 * removes each entry at `purgeAt`, ACCOUNT_DELETION_REGISTER_DAYS after the deletion, which is longer than any backup
 * is kept (Atlas Flex keeps daily snapshots for at most 8 days), so every backup that could still contain the account
 * is covered. Never deleted with the account (it is the record that the account was deleted).
 */
export const ACCOUNT_DELETION_REGISTER_DAYS = 30;
export const ACCOUNT_DELETION_REGISTER_COLLECTION = 'accountdeletions';

export type AccountDeletionEntity = { userId: string; deletedAt: Date; purgeAt: Date };

const accountDeletionSchema = new Schema<AccountDeletionEntity>(
  {
    userId: { type: String, required: true, index: true },
    deletedAt: { type: Date, required: true },
    purgeAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { collection: ACCOUNT_DELETION_REGISTER_COLLECTION, versionKey: false },
);

export const AccountDeletionModel = models.AccountDeletion || model<AccountDeletionEntity>('AccountDeletion', accountDeletionSchema);

export function registerEntry(userId: string, now: Date): AccountDeletionEntity {
  return { userId, deletedAt: now, purgeAt: new Date(now.getTime() + ACCOUNT_DELETION_REGISTER_DAYS * 24 * 60 * 60 * 1000) };
}
