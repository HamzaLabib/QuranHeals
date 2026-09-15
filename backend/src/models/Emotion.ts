import { Schema, model, models } from 'mongoose';

import { APP_LOCALES } from '../emotions/emotionCatalog';
import type { EmotionEntity } from '../types/domain';

/**
 * Validates a `names`/`descriptions` localized-text map: must be a plain
 * object, every value must be a non-empty string, and — when the field is
 * present at all — every currently-required `AppLocale` (`en`/`ar`/`ar-EG`)
 * must have an entry. Extra locale keys beyond the three current ones are
 * allowed (future locales), so this never needs to change when a new
 * locale is added. The field itself stays optional at the schema level
 * (see below) so pre-localization live documents — which have neither
 * `names` nor `descriptions` yet — remain perfectly valid.
 *
 * Deliberately `Schema.Types.Mixed`, not Mongoose's `Map` type: a `Map`
 * field is well known to sometimes deserialize as a real `Map` instance
 * rather than a plain object depending on the read path (`.lean()` vs. a
 * hydrated document vs. `.toJSON()`), which would silently break any
 * `JSON.stringify`/spread-based DTO conversion. `Mixed` always reads back
 * as an ordinary plain object on every read path, matching what the API
 * DTO needs to hand back as JSON with zero extra conversion — verified by
 * `backend/tests/emotions/emotion-model.test.ts`.
 */
function validateLocalizedText(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;

  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.every(([, text]) => typeof text === 'string' && text.trim().length > 0)) return false;

  const keys = new Set(Object.keys(value as Record<string, unknown>));
  return APP_LOCALES.every((locale) => keys.has(locale));
}

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
    // Deprecated legacy flat fields — retained, optional, for
    // pre-localization live documents and rollback compatibility. Never
    // required on new writes going forward; see `names`/`descriptions`.
    name: {
      type: String,
      required: false,
      trim: true,
    },
    arabicName: {
      type: String,
      required: false,
      trim: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    // Canonical localized fields (see backend/src/emotions/emotionCatalog.ts).
    // Optional at the schema level: a live document written before this
    // localization work landed has neither field, and must remain valid.
    names: {
      type: Schema.Types.Mixed,
      required: false,
      validate: {
        validator: validateLocalizedText,
        message: `Emotion.names must be a plain object with non-empty string values for at least: ${APP_LOCALES.join(', ')}.`,
      },
    },
    descriptions: {
      type: Schema.Types.Mixed,
      required: false,
      validate: {
        validator: validateLocalizedText,
        message: `Emotion.descriptions must be a plain object with non-empty string values for at least: ${APP_LOCALES.join(', ')}.`,
      },
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
