import { Schema, model, models } from 'mongoose';

import type { AyahEntity } from '../types/domain';

const emotionKeyPattern = /^[a-z][a-z-]{1,40}$/;

const ayahSchema = new Schema<AyahEntity>(
  {
    referenceKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    surahNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 114,
    },
    surahNameArabic: {
      type: String,
      required: true,
      trim: true,
    },
    surahNameEnglish: {
      type: String,
      required: true,
      trim: true,
    },
    ayahNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    arabicText: {
      type: String,
      required: true,
      trim: true,
    },
    englishTranslation: {
      type: String,
      required: true,
      trim: true,
    },
    emotions: {
      type: [String],
      required: true,
      validate: {
        validator: (values: string[]) =>
          values.length > 0 && values.every((value) => emotionKeyPattern.test(value)),
        message: 'Ayah emotions must contain valid emotion keys.',
      },
    },
    quranTextSource: {
      type: String,
      required: true,
      trim: true,
    },
    translationSource: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

ayahSchema.index({ emotions: 1 });
ayahSchema.index({ surahNumber: 1, ayahNumber: 1 }, { unique: true });

export const AyahModel = models.Ayah || model<AyahEntity>('Ayah', ayahSchema);

