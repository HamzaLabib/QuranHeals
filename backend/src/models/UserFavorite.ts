import { Schema, model, models } from 'mongoose';

import { isValidVerseKey } from '../quran/referenceKeys';
import type { UserFavoriteEntity } from '../types/accountDomain';

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
  },
  {
    timestamps: true,
  },
);

userFavoriteSchema.index({ userId: 1, verseKey: 1 }, { unique: true });

export const UserFavoriteModel =
  models.UserFavorite || model<UserFavoriteEntity>('UserFavorite', userFavoriteSchema);
