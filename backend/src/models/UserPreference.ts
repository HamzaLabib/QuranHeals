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
    // Added 2026-10-27 (services/preferencesMerge.ts; validated by syncValidators.ts). Reminders and the recent
    // emotions are stored in the app's own form, already checked field by field.
    translationEnabledMode: { type: String, trim: true },
    favoriteReciter: { type: String, trim: true },
    keepAwake: { type: Boolean },
    wordMeaningsVisible: { type: Boolean },
    memorizationModeVisible: { type: Boolean },
    notificationWird: { type: Schema.Types.Mixed },
    notificationRandomAyah: { type: Schema.Types.Mixed },
    notificationEmotionCheckIn: { type: Schema.Types.Mixed },
    mushafGuide: { type: String, trim: true },
    memorizationGuide: { type: String, trim: true },
    recentEmotions: { type: Schema.Types.Mixed, default: undefined },
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
          translationEnabledMode: Date,
          favoriteReciter: Date,
          keepAwake: Date,
          wordMeaningsVisible: Date,
          memorizationModeVisible: Date,
          notificationWird: Date,
          notificationRandomAyah: Date,
          notificationEmotionCheckIn: Date,
          mushafGuide: Date,
          memorizationGuide: Date,
          recentEmotions: Date,
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
