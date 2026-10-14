import { z } from 'zod';

import { isValidVerseKey } from '../quran/referenceKeys';
import { ISSUE_REPORT_CATEGORIES } from '../types/accountDomain';
import type { IssueReportInput } from '../types/accountDto';

const verseKeySchema = z.string().trim().refine((key) => isValidVerseKey(key), 'Invalid verse key.');

/** The longest message or description accepted, in characters (the app's input limit). */
export const REPORT_MESSAGE_MAX_LENGTH = 2000;

// C0 controls except tab and newline, DEL, and C1 controls: never meaningful in a message.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/** User-written text: line breaks normalized, control characters removed, trimmed, then 1..2000 characters. */
const messageSchema = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '').trim())
  .pipe(z.string().min(1).max(REPORT_MESSAGE_MAX_LENGTH));

const commonFields = {
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  appLocale: z.enum(['en', 'ar', 'ar-EG']).optional(),
  appVersion: z.string().trim().min(1).max(40).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
};

/**
 * Deliberately whitelists exactly the safe automatic-context fields from
 * Part I §37 — a caller sending an extra `reflection`/`reflectionText`/
 * anything-else field gets it silently stripped by zod's default (non-strict)
 * object parsing, so it can never reach IssueReportRepository.create. See
 * Part I §38.
 *
 * An issue keeps the original shape, so app versions that send no `type`
 * or `source` are accepted exactly as before (their description stays
 * optional). Current versions send `source` and always a description.
 */
const issueSchema = z.object({
  type: z.literal('issue').optional(),
  category: z.enum(ISSUE_REPORT_CATEGORIES),
  comment: messageSchema.optional(),
  source: z.enum(['ayah', 'settings']).optional(),
  verseKey: verseKeySchema.optional(),
  surahNumber: z.number().int().min(1).max(114).optional(),
  ayahNumber: z.number().int().min(1).optional(),
  // No emotionKey: which emotion led to an ayah is never kept with a report.
  // Older app versions still send one; it is dropped like any unknown field,
  // and their report is accepted as before.
  translationDisplayMode: z.enum(['always', 'on-demand', 'off']).optional(),
  ...commonFields,
}).refine((issue) => issue.source === undefined || issue.comment !== undefined, 'A description is required.');

/** Feedback carries only the message and the same safe context; anything else (a category, an ayah, account data) is dropped. */
const feedbackSchema = z.object({
  type: z.literal('feedback'),
  comment: messageSchema,
  source: z.literal('home').optional(),
  ...commonFields,
});

export const createIssueReportSchema = z
  .union([feedbackSchema, issueSchema])
  .transform((input): IssueReportInput => input);
