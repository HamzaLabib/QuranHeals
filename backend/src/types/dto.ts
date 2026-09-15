import type { LocalizedText } from '../emotions/emotionCatalog';

export type EmotionDto = {
  id: string;
  key: string;
  /** Canonical localized display names (see backend/src/emotions/emotionCatalog.ts). New clients should read this, not `name`/`arabicName`. */
  names: LocalizedText;
  /** Canonical localized descriptions. Data-ready only — not rendered anywhere in the app yet. */
  descriptions: LocalizedText;
  /** @deprecated Derived from `names.en` — kept only for older clients during rollout. */
  name: string;
  /** @deprecated Derived from `names.ar` — kept only for older clients during rollout. */
  arabicName: string;
  /** @deprecated Derived from `descriptions.en` — kept only for older clients during rollout. */
  description: string;
  icon: string;
  order: number;
  active: boolean;
};

export type AyahDto = {
  id: string;
  verseKey: string;
  referenceKey: string;
  surahNumber: number;
  surahNameArabic: string;
  surahNameEnglish: string;
  ayahNumber: number;
  arabicText: string;
  englishTranslation: string;
  emotions: string[];
  quranTextSource: string;
  translationSource: string;
};

export type ApiResponse<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      message: string;
    };
