import { z } from 'zod';

import { isValidVerseKey } from '../quran/referenceKeys';
import { ISSUE_REPORT_CATEGORIES } from '../types/accountDomain';

const emotionKeySchema = z.string().trim().toLowerCase().regex(/^[a-z][a-z_-]{1,40}$/);
const verseKeySchema = z.string().trim().refine((key) => isValidVerseKey(key), 'Invalid verse key.');

/**
 * Deliberately whitelists exactly the safe automatic-context fields from
 * Part I §37 — a caller sending an extra `reflection`/`reflectionText`/
 * anything-else field gets it silently stripped by zod's default (non-strict)
 * object parsing, so it can never reach IssueReportRepository.create. See
 * Part I §38.
 */
export const createIssueReportSchema = z.object({
  category: z.enum(ISSUE_REPORT_CATEGORIES),
  comment: z.string().trim().min(1).max(2000).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  verseKey: verseKeySchema.optional(),
  surahNumber: z.number().int().min(1).max(114).optional(),
  ayahNumber: z.number().int().min(1).optional(),
  emotionKey: emotionKeySchema.optional(),
  appLocale: z.enum(['en', 'ar', 'ar-EG']).optional(),
  translationDisplayMode: z.enum(['always', 'on-demand', 'off']).optional(),
  appVersion: z.string().trim().min(1).max(40).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});
