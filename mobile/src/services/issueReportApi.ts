import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { AppLocale } from '@/localization/locales';
import type { TranslationDisplayMode } from '@/localization/quranTranslationPreference';
import { apiBaseUrl } from './apiBase';

export type IssueReportCategory =
  | 'ayah_not_relevant'
  | 'quran_text_display'
  | 'translation_issue'
  | 'app_technical_issue'
  | 'audio_issue'
  | 'other';

/** An Audio Issue's kind of problem (audioIssue/). */
export type AudioIssueProblem = 'not_playing' | 'wrong_reciter' | 'missing_ayah' | 'timing_highlight' | 'stopped' | 'other';

/** Where a report was sent from: an ayah's flag action, or Settings (general issues). */
export type IssueReportSource = 'ayah' | 'settings';

export type IssueReportInput = {
  source: IssueReportSource;
  category: IssueReportCategory;
  /** Required: the user's description of the issue. */
  comment: string;
  email?: string;
  verseKey?: string;
  surahNumber?: number;
  ayahNumber?: number;
  /** Audio Issues only: the problem, and the recording's identifiers as the app knew them (audioIssue/context.ts). */
  audioProblem?: AudioIssueProblem;
  reciterId?: string;
  audioSource?: string;
  playbackContext?: string;
  appLocale: AppLocale;
  translationDisplayMode: TranslationDisplayMode;
};

/** General feedback from Home: the message, an optional email and the App Language — nothing else. */
export type FeedbackInput = {
  comment: string;
  email?: string;
  appLocale: AppLocale;
};

export class IssueReportApiError extends Error {}

/**
 * Feedback and issue reports both go to the one reporting endpoint
 * (/api/issues), so they share its validation, storage, email
 * notifications and per-IP rate limit. Works with or without an account
 * (Part I §34) — no Authorization header is ever attached here, so a
 * signed-in user's report is indistinguishable from a guest's at the
 * network layer, and no account/profile data can leak into it by accident.
 * Reflection, Khatma, reading or emotion-history content is never a
 * parameter of either input type, so it is structurally impossible for a
 * caller to pass it through here — see Part I §38.
 *
 * Resolves only once the backend has accepted the submission (2xx).
 */
async function postReport(body: Record<string, unknown>): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        ...body,
        appVersion: Constants.expoConfig?.version,
        platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web',
      }),
    });
  } catch {
    throw new IssueReportApiError("We couldn't send your report. Please try again.");
  }

  if (!response.ok) {
    throw new IssueReportApiError("We couldn't send your report. Please try again.");
  }
}

export function submitIssueReport(input: IssueReportInput): Promise<void> {
  return postReport({ type: 'issue', ...input });
}

export function submitFeedback(input: FeedbackInput): Promise<void> {
  return postReport({ type: 'feedback', source: 'home', comment: input.comment, email: input.email, appLocale: input.appLocale });
}
