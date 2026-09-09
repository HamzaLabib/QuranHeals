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
    // Retained for legacy/compatibility data only; the API no longer reads
    // this field (see backend/src/quran/quranSource.ts). Not required,
    // preparing for its eventual removal once MongoDB becomes reference-only.
    arabicText: {
      type: String,
      required: false,
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
    // Checksums arabicText; meaningless once that field is removed. Not
    // required, for the same reason as arabicText above.
    checksum: {
      type: String,
      required: false,
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
