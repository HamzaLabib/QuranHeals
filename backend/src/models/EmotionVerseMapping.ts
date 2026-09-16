import { Schema, model, models } from 'mongoose';
import type { ClientSession } from 'mongoose';

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

const emotionKeyPattern = /^[a-z][a-z_-]{1,40}$/;
const referenceKeyPattern = /^[1-9]\d{0,2}:[1-9]\d{0,2}$/;

/**
 * Per-session cache of emotion keys already confirmed to exist. Only ~29
 * distinct emotionKey values exist across any realistic number of mapping
 * documents, so within one session/transaction (e.g. a bulk activation
 * inserting hundreds of mappings) this turns O(n) existence-check round
 * trips into effectively O(distinct keys). Keyed by session object so it
 * never outlives or leaks across sessions (WeakMap); only positive results
 * are cached, so a key that doesn't exist yet is always re-checked live.
 */
const confirmedEmotionKeysBySession = new WeakMap<ClientSession, Set<string>>();

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
        // Non-arrow function: must run as a document (or query) method so we
        // can read the session it's running under. Mongoose validators can
        // fire with `this` bound to either a Document (create/save) or a
        // Query (update with runValidators) — untyped here because the two
        // shapes share no useful common type. Without the session, this
        // existence check reads outside the transaction's snapshot and
        // can't see an Emotion document created earlier in the same
        // not-yet-committed transaction (e.g.
        // activateApprovedEmotionMappings.ts creating a new emotion and its
        // mappings together).
        validator: async function (this: any, value: string) {
          const session: ClientSession | null =
            typeof this?.$session === 'function' ? this.$session() : (this?.getOptions?.().session ?? null);

          if (session) {
            const confirmed = confirmedEmotionKeysBySession.get(session);
            if (confirmed?.has(value)) return true;
          }

          const query = EmotionModel.exists({ key: value });
          if (session) query.session(session);
          const exists = Boolean(await query);

          if (exists && session) {
            const confirmed = confirmedEmotionKeysBySession.get(session) ?? new Set<string>();
            confirmed.add(value);
            confirmedEmotionKeysBySession.set(session, confirmed);
          }

          return exists;
        },
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
