import { Schema, model, models } from 'mongoose';

import { isValidVerseKey } from '../quran/referenceKeys';
import type { UserReflectionEntity } from '../types/accountDomain';

/**
 * Ciphertext-only reflection storage. Deliberately has NO plaintext/preview/
 * summary/keyword/sentiment field — see Part D §21/§22. `ciphertext` and
 * `nonce` are opaque base64 strings produced entirely on-device
 * (mobile/src/crypto/reflectionEncryption.ts); this backend never sees, and
 * has no way to derive, the plaintext reflection.
 *
 * `deleted: true` turns a row into a durable deletion tombstone instead of
 * hard-deleting the document — see
 * docs/auth-and-sync/reflection-privacy.md's "Deletion tombstones" section.
 * A tombstone keeps `userId`/`verseKey`/`updatedAt` (reused as the deletion
 * timestamp) but has no ciphertext/nonce/encryptionVersion/createdAt, so it
 * carries no reflection content. `ciphertext`/`nonce`/`encryptionVersion`/
 * `createdAt` are conditionally required — only when `deleted` is not true —
 * so existing pre-tombstone documents (which never set `deleted` at all)
 * keep validating exactly as before.
 */
const userReflectionSchema = new Schema<UserReflectionEntity>(
  {
    userId: {
      type: String,
      required: true,
    },
    verseKey: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (value: string) => isValidVerseKey(value),
        message: 'UserReflection.verseKey must be a valid Quran reference.',
      },
    },
    deleted: {
      type: Boolean,
      required: true,
      default: false,
    },
    ciphertext: {
      type: String,
      required: function (this: { deleted?: boolean }) {
        return !this.deleted;
      },
      maxlength: 8000,
    },
    nonce: {
      type: String,
      required: function (this: { deleted?: boolean }) {
        return !this.deleted;
      },
      maxlength: 128,
    },
    encryptionVersion: {
      type: Number,
      required: function (this: { deleted?: boolean }) {
        return !this.deleted;
      },
      min: 1,
    },
    conflictVersions: {
      type: [
        {
          _id: false,
          ciphertext: { type: String, required: true },
          nonce: { type: String, required: true },
          encryptionVersion: { type: Number, required: true, min: 1 },
          createdAt: { type: Date, required: true },
        },
      ],
      default: [],
    },
    // Client-declared timestamps (Part D §29 compares "updatedAt" across
    // devices) — deliberately not Mongoose's auto server-time timestamps.
    // Trusts device clocks; see docs/data-privacy-and-sync.md. `updatedAt` is
    // the single last-write-wins timestamp for BOTH an active record and a
    // tombstone (a tombstone's conceptual "deletedAt" IS its `updatedAt`).
    createdAt: {
      type: Date,
      required: function (this: { deleted?: boolean }) {
        return !this.deleted;
      },
    },
    updatedAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: false,
  },
);

userReflectionSchema.index({ userId: 1, verseKey: 1 }, { unique: true });

export const UserReflectionModel =
  models.UserReflection || model<UserReflectionEntity>('UserReflection', userReflectionSchema);
