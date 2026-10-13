import { Schema, model, models } from 'mongoose';

/**
 * Per-account reading-sync counter (see UserReadingRecord.ts).
 *
 *  - `seq`: incremented once per written record, in the same transaction;
 *    each record stores the value it got as `changeSeq`. Every write
 *    increments this one document first, so concurrent writes for an
 *    account serialize and commit in `changeSeq` order: a device that has
 *    downloaded up to N can never miss a change numbered below N.
 *  - `syncId`: replaced whenever stored encrypted content is discarded (a
 *    forgotten-password reset, or a new sync key). A device that sees a new
 *    `syncId` re-uploads its own copy (deletion markers are kept, so
 *    nothing deleted comes back).
 */
export type UserReadingSyncStateEntity = {
  userId: string;
  seq: number;
  syncId: string;
};

const userReadingSyncStateSchema = new Schema<UserReadingSyncStateEntity>(
  {
    userId: { type: String, required: true, unique: true },
    seq: { type: Number, required: true, default: 0, min: 0 },
    syncId: { type: String, required: true },
  },
  { timestamps: true },
);

export const UserReadingSyncStateModel =
  models.UserReadingSyncState || model<UserReadingSyncStateEntity>('UserReadingSyncState', userReadingSyncStateSchema);
