import { Schema, model, models } from 'mongoose';

import type { VerseEntity } from '../types/domain';

const checksumPattern = /^[a-f0-9]{64}$/;
const referenceKeyPattern = /^[1-9]\d{0,2}:[1-9]\d{0,2}$/;

const verseSchema = new Schema<VerseEntity>(
  {
    referenceKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: referenceKeyPattern,
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
    },
    scriptType: {
      type: String,
      required: true,
      enum: ['uthmani'],
      default: 'uthmani',
    },
    quranTextSource: {
      type: String,
      required: true,
      trim: true,
    },
    sourceVersion: {
      type: String,
      required: true,
      trim: true,
    },
    checksum: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: checksumPattern,
    },
  },
  {
    timestamps: true,
  },
);

verseSchema.index({ surahNumber: 1, ayahNumber: 1 }, { unique: true });

export const VerseModel = models.Verse || model<VerseEntity>('Verse', verseSchema);
