import type { AppLocale } from '@/localization/locales';

/** Mirrors backend EmotionDto/emotionCatalog's LocalizedText — required current locales, open for future ones. */
export type LocalizedText = Record<AppLocale, string> & Record<string, string>;

export type Emotion = {
  id: string;
  key: string;
  /** Canonical localized display names — prefer this over `name`/`arabicName`. */
  names: LocalizedText;
  /** Canonical localized descriptions. Data-ready only — not rendered on emotion cards yet. */
  descriptions: LocalizedText;
  /** @deprecated Use `names.en`. */
  name: string;
  /** @deprecated Use `names.ar`. */
  arabicName: string;
  /** @deprecated Use `descriptions.en`. */
  description: string;
  icon: string;
  order: number;
  active: boolean;
};

export type Ayah = {
  id: string;
  // Optional on legacy API/storage records; local resolution always supplies it.
  verseKey?: string;
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

export type FavoriteAyah = Ayah & {
  savedAt: string;
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
