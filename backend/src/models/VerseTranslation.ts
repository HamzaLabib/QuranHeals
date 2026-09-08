import { Schema, model, models } from 'mongoose';

import type { VerseTranslationEntity } from '../types/domain';

const checksumPattern = /^[a-f0-9]{64}$/;
const referenceKeyPattern = /^[1-9]\d{0,2}:[1-9]\d{0,2}$/;

const verseTranslationSchema = new Schema<VerseTranslationEntity>(
  {
    verseReferenceKey: {
      type: String,
      required: true,
      trim: true,
      match: referenceKeyPattern,
    },
    language: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[a-z]{2,8}(-[a-z]{2,8})?$/,
    },
    translator: {
      type: String,
      required: true,
      trim: true,
    },
    text: {
      type: String,
      required: true,
    },
    source: {
      type: String,
      required: true,
      trim: true,
    },
    sourceVersion: {
      type: String,
      required: true,
      trim: true,
    },
    license: {
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

verseTranslationSchema.index(
  { verseReferenceKey: 1, language: 1, translator: 1, sourceVersion: 1 },
  { unique: true },
);
verseTranslationSchema.index({ language: 1, translator: 1 });

export const VerseTranslationModel =
  models.VerseTranslation || model<VerseTranslationEntity>('VerseTranslation', verseTranslationSchema);
