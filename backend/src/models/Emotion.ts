import { Schema, model, models } from 'mongoose';

import type { EmotionEntity } from '../types/domain';

const emotionSchema = new Schema<EmotionEntity>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z][a-z_-]{1,40}$/,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    arabicName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    icon: {
      type: String,
      required: true,
      trim: true,
    },
    order: {
      type: Number,
      required: true,
      min: 1,
    },
    active: {
      type: Boolean,
      required: true,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

emotionSchema.index({ active: 1, order: 1 });

export const EmotionModel = models.Emotion || model<EmotionEntity>('Emotion', emotionSchema);

