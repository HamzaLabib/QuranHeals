import { Schema, model, models } from 'mongoose';

import { isValidVerseKey } from '../quran/referenceKeys';
import type { UserFavoriteEntity } from '../types/accountDomain';

/**
 * `deleted: true` turns a row into a durable deletion tombstone instead of
 * hard-deleting the document — mirrors UserReflection.ts's tombstone design
 * — so another device (or a stale cloud copy) can never resurrect a
 * favorite that was already removed. A tombstone keeps `userId`/`verseKey`/
 * `updatedAt` (reused as the deletion timestamp) but has no `createdAt`,
 * since it carries no content beyond "this verseKey was deleted at this
 * instant". `createdAt` is conditionally required — only when `deleted` is
 * not true — so existing pre-tombstone documents (which never set `deleted`
 * at all) keep validating exactly as before. Client-declared timestamps
 * (not Mongoose's auto server-time ones) so the same last-write-wins
 * comparison used for reflections works here too.
 */
const userFavoriteSchema = new Schema<UserFavoriteEntity>(
  {
    userId: {
      type: String,
      required: true,
    },
    // Stable Quran reference only — never Quran Arabic/translation text, and
    // never a localized emotion/surah label. See Part E §24.
    verseKey: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (value: string) => isValidVerseKey(value),
        message: 'UserFavorite.verseKey must be a valid Quran reference.',
      },
    },
    deleted: {
      type: Boolean,
      required: true,
      default: false,
    },
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

userFavoriteSchema.index({ userId: 1, verseKey: 1 }, { unique: true });

export const UserFavoriteModel =
  models.UserFavorite || model<UserFavoriteEntity>('UserFavorite', userFavoriteSchema);
