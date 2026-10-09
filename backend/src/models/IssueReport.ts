import { Schema, model, models } from 'mongoose';

import { isValidVerseKey } from '../quran/referenceKeys';
import { ISSUE_REPORT_CATEGORIES, ISSUE_REPORT_NOTIFICATION_STATES } from '../types/accountDomain';
import type { IssueReportEntity, IssueReportNotificationState } from '../types/accountDomain';

const TRANSLATION_DISPLAY_MODES = ['always', 'on-demand', 'off'] as const;

/**
 * The email-notification outbox entry, embedded in the report so it is
 * created in the same single-document write (no transaction needed) and
 * deleted with the report by the retention purge. Metadata only: the email
 * is built from the report's own fields at send time.
 */
const notificationSchema = new Schema<IssueReportNotificationState>(
  {
    state: { type: String, required: true, enum: ISSUE_REPORT_NOTIFICATION_STATES },
    attempts: { type: Number, required: true, min: 0, default: 0 },
    nextAttemptAt: { type: Date },
    claimToken: { type: String },
    lastError: { type: String, maxlength: 40 },
    acceptedAt: { type: Date },
    providerMessageId: { type: String, maxlength: 64 },
    failedAt: { type: Date },
  },
  { _id: false },
);

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
    notification: {
      type: notificationSchema,
      required: false,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

issueReportSchema.index({ createdAt: -1 });
// Finds due notification jobs. Partial: nextAttemptAt is unset once a
// notification is accepted or failed, so only active jobs are indexed.
issueReportSchema.index(
  { 'notification.nextAttemptAt': 1 },
  { partialFilterExpression: { 'notification.nextAttemptAt': { $exists: true } } },
);

export const IssueReportModel =
  models.IssueReport || model<IssueReportEntity>('IssueReport', issueReportSchema);
