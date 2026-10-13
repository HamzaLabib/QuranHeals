import { Schema, model, models } from 'mongoose';

import type { ReadingData } from '../services/readingSync';

/**
 * One synced أورادي وختماتي record (docs/auth-and-sync/reading-sync.md):
 * a ورد ('wird'), a confirmed Khatma ('khatma'), or the account's active
 * ورد selection ('active', always recordId 'active').
 *
 * Account-based, like favorites: `data` is the record's content (the ورد's
 * name, page and cycle; a Khatma's dates and Ramadan classification),
 * validated by readingSyncValidators.ts and stored for the authenticated
 * account only. Not end-to-end encrypted; protected in transit (HTTPS) and
 * at rest by the database provider. Alongside it:
 *  - `revision` (per record, for compare-and-swap updates) and `changeSeq`
 *    (the account's change counter, for incremental downloads);
 *  - `deleted`: a permanent deletion marker, without content;
 *  - for a Khatma, `cycleId`, so one cycle is never counted twice (the
 *    partial unique index below).
 *
 * Legacy fields: an unreleased development build stored the content
 * encrypted (`ciphertext`, `nonce`, `encryptionVersion`, `keyFingerprint`,
 * no `data`). Such a record is never served. When a device uploads its own
 * copy, the ciphertext moves to `legacyEncrypted` (kept, not deleted); a
 * legacy Khatma blocking its cycle becomes kind 'legacy-khatma' (out of
 * the index and every query, kept). See readingSync.ts.
 */
export type ReadingRecordKind = 'wird' | 'khatma' | 'active';

type LegacyEncrypted = { ciphertext: string; nonce: string; encryptionVersion: number; keyFingerprint?: string };

export type UserReadingRecordEntity = {
  userId: string;
  kind: ReadingRecordKind | 'legacy-khatma';
  recordId: string;
  revision: number;
  changeSeq: number;
  deleted: boolean;
  cycleId?: string;
  data?: ReadingData;
  // Legacy (unreleased encrypted format): read only, never written.
  ciphertext?: string;
  nonce?: string;
  encryptionVersion?: number;
  keyFingerprint?: string;
  legacyEncrypted?: LegacyEncrypted;
  createdAt: Date;
  updatedAt: Date;
};

const userReadingRecordSchema = new Schema<UserReadingRecordEntity>(
  {
    userId: { type: String, required: true },
    kind: { type: String, required: true, enum: ['wird', 'khatma', 'active', 'legacy-khatma'] },
    recordId: { type: String, required: true, maxlength: 128 },
    revision: { type: Number, required: true, min: 1 },
    changeSeq: { type: Number, required: true, min: 1 },
    deleted: { type: Boolean, required: true, default: false },
    cycleId: { type: String, maxlength: 128 },
    data: { type: Schema.Types.Mixed },
    ciphertext: { type: String, maxlength: 8000 },
    nonce: { type: String, maxlength: 128 },
    encryptionVersion: { type: Number, min: 1 },
    keyFingerprint: { type: String, maxlength: 128 },
    legacyEncrypted: {
      type: new Schema<LegacyEncrypted>({ ciphertext: String, nonce: String, encryptionVersion: Number, keyFingerprint: String }, { _id: false }),
      default: undefined,
    },
  },
  { timestamps: true, minimize: false },
);

userReadingRecordSchema.index({ userId: 1, kind: 1, recordId: 1 }, { unique: true });
userReadingRecordSchema.index({ userId: 1, changeSeq: 1 });
// One confirmed (not deleted) Khatma per reading cycle per account.
userReadingRecordSchema.index(
  { userId: 1, cycleId: 1 },
  { unique: true, partialFilterExpression: { kind: 'khatma', deleted: false } },
);

export const UserReadingRecordModel =
  models.UserReadingRecord || model<UserReadingRecordEntity>('UserReadingRecord', userReadingRecordSchema);
