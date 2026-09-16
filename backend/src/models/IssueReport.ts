import { Schema, model, models } from 'mongoose';

import { isValidVerseKey } from '../quran/referenceKeys';
import { ISSUE_REPORT_CATEGORIES } from '../types/accountDomain';
import type { IssueReportEntity } from '../types/accountDomain';

const TRANSLATION_DISPLAY_MODES = ['always', 'on-demand', 'off'] as const;

/**
 * Deliberately its own collection, separate from every Quran/emotion
 * collection (Part I §40) — never touches Emotion, EmotionVerseMapping,
 * Verse, or VerseTranslation. Deliberately has NO field for reflection
 * text/ciphertext of any kind — see Part I §38; the validator
 * (issueValidators.ts) only ever reads the fields declared here, so an
 * extra `reflection`/`reflectionText` field on the request body is silently
 * dropped, never persisted.
 */
const issueReportSchema = new Schema<IssueReportEntity>(
  {
    category: {
      type: String,
      required: true,
      enum: ISSUE_REPORT_CATEGORIES,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    verseKey: {
      type: String,
      trim: true,
      validate: {
        validator: (value: string) => !value || isValidVerseKey(value),
        message: 'IssueReport.verseKey must be a valid Quran reference.',
      },
    },
    surahNumber: {
      type: Number,
      min: 1,
      max: 114,
    },
    ayahNumber: {
      type: Number,
      min: 1,
    },
    emotionKey: {
      type: String,
      trim: true,
      lowercase: true,
    },
    appLocale: {
      type: String,
      trim: true,
    },
    translationDisplayMode: {
      type: String,
      enum: TRANSLATION_DISPLAY_MODES,
    },
    appVersion: {
      type: String,
      trim: true,
      maxlength: 40,
    },
    platform: {
      type: String,
      trim: true,
      maxlength: 40,
    },
    status: {
      type: String,
      required: true,
      enum: ['new'],
      default: 'new',
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

issueReportSchema.index({ createdAt: -1 });

export const IssueReportModel =
  models.IssueReport || model<IssueReportEntity>('IssueReport', issueReportSchema);
