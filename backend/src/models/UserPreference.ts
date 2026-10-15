import { Schema, model, models } from 'mongoose';

import type { UserPreferenceEntity } from '../types/accountDomain';

const TRANSLATION_DISPLAY_MODES = ['always', 'on-demand', 'off'] as const;

const userPreferenceSchema = new Schema<UserPreferenceEntity>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
    },
    locale: {
      type: String,
      trim: true,
    },
    translationDisplayMode: {
      type: String,
      enum: TRANSLATION_DISPLAY_MODES,
    },
    translationId: {
      type: String,
      trim: true,
    },
    // Added with per-field instants (services/preferencesMerge.ts); validated by syncValidators.ts.
    quranLanguage: { type: String, trim: true },
    emotionsLanguage: { type: String, trim: true },
    appearance: { type: String, trim: true },
    quranFontSize: { type: Number },
    // When each field was last changed, as declared by the device that
    // changed it. Absent on records stored before it existed: each stored
    // field then counts as changed at `updatedAt`.
    fieldUpdatedAt: {
      type: new Schema(
        {
          locale: Date,
          translationDisplayMode: Date,
          translationId: Date,
          quranLanguage: Date,
          emotionsLanguage: Date,
          appearance: Date,
          quranFontSize: Date,
        },
        { _id: false },
      ),
      default: undefined,
    },
    // Client-declared "when the user changed this" timestamp, not the
    // server's write time — last-write-wins merge (Part F §31) compares
    // devices' own notion of recency. This trusts device clocks; see
    // docs/data-privacy-and-sync.md for the documented limitation.
    updatedAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: false,
  },
);

export const UserPreferenceModel =
  models.UserPreference || model<UserPreferenceEntity>('UserPreference', userPreferenceSchema);
