import { Schema, model, models } from 'mongoose';

import { isValidVerseKey } from '../quran/referenceKeys';
import type { EmotionMappingStatus, EmotionVerseMappingEntity } from '../types/domain';
import { EmotionModel } from './Emotion';

export const emotionMappingStatuses: EmotionMappingStatus[] = [
  'development',
  'draft',
  'reviewed',
  'approved',
  'rejected',
];

const emotionKeyPattern = /^[a-z][a-z-]{1,40}$/;
const referenceKeyPattern = /^[1-9]\d{0,2}:[1-9]\d{0,2}$/;

const emotionVerseMappingSchema = new Schema<EmotionVerseMappingEntity>(
  {
    verseReferenceKey: {
      type: String,
      required: true,
      trim: true,
      match: referenceKeyPattern,
      validate: {
        validator: (value: string) => isValidVerseKey(value),
        message: 'Emotion mapping verseReferenceKey must be a valid Quran reference.',
      },
    },
    emotionKey: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: emotionKeyPattern,
      validate: {
        validator: async (value: string) => Boolean(await EmotionModel.exists({ key: value })),
        message: 'Emotion mapping emotionKey must reference an existing emotion.',
      },
    },
    status: {
      type: String,
      required: true,
      enum: emotionMappingStatuses,
      default: 'development',
    },
    rationale: {
      type: String,
      trim: true,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
    },
    mappingVersion: {
      type: String,
      required: true,
      trim: true,
    },
    reviewedBy: {
      type: String,
      trim: true,
    },
    reviewedAt: {
      type: Date,
    },
    contextNotes: {
      type: String,
      trim: true,
    },
    tafsirReferences: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

emotionVerseMappingSchema.index({ verseReferenceKey: 1, emotionKey: 1 }, { unique: true });
emotionVerseMappingSchema.index({ emotionKey: 1, status: 1 });

export const EmotionVerseMappingModel =
  models.EmotionVerseMapping ||
  model<EmotionVerseMappingEntity>('EmotionVerseMapping', emotionVerseMappingSchema);
