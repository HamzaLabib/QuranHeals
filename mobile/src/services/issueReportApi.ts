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
  | 'other';

export type IssueReportInput = {
  category: IssueReportCategory;
  comment?: string;
  email?: string;
  verseKey?: string;
  surahNumber?: number;
  ayahNumber?: number;
  emotionKey?: string;
  appLocale: AppLocale;
  translationDisplayMode: TranslationDisplayMode;
};

export class IssueReportApiError extends Error {}

/**
 * Submits an issue report. Works with or without an account (Part I §34) —
 * no Authorization header is ever attached here, so a signed-in user's
 * report is indistinguishable from a guest's at the network layer, and no
 * account/profile data can leak into it by accident. Reflection content is
 * never a parameter of this function's input type, so it is structurally
 * impossible for a caller to pass it through here — see Part I §38.
 */
export async function submitIssueReport(input: IssueReportInput): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        ...input,
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
