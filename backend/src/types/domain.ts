import type { LocalizedText } from '../emotions/emotionCatalog';

export type EmotionEntity = {
  key: string;
  /** @deprecated Use `names.en` — retained for backward-compatible reads of pre-localization live documents. */
  name: string;
  /** @deprecated Use `names.ar` — retained for backward-compatible reads of pre-localization live documents. */
  arabicName: string;
  /** @deprecated Use `descriptions.en` — retained for backward-compatible reads of pre-localization live documents. */
  description: string;
  /** Canonical localized display names, keyed by AppLocale (`en`/`ar`/`ar-EG`, open for future locales). Optional at the schema level only because live documents written before localization landed do not have it yet — see `backend/src/services/MongooseQuranRepository.ts`'s `toEmotionDto` for the fallback-to-catalog-by-key behavior. */
  names?: LocalizedText;
  /** Canonical localized descriptions. Data-ready only — not rendered in the app UI yet. See `names` above for the same optionality rationale. */
  descriptions?: LocalizedText;
  icon: string;
  order: number;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

export type AyahEntity = {
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
  createdAt?: Date;
  updatedAt?: Date;
};

export type QuranScriptType = 'uthmani';

export type EmotionMappingStatus =
  | 'development'
  | 'draft'
  | 'reviewed'
  | 'approved'
  | 'rejected';

export type VerseEntity = {
  referenceKey: string;
  surahNumber: number;
  surahNameArabic: string;
  surahNameEnglish: string;
  ayahNumber: number;
  arabicText: string;
  scriptType: QuranScriptType;
  quranTextSource: string;
  sourceVersion: string;
  checksum: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type VerseTranslationEntity = {
  verseReferenceKey: string;
  language: string;
  translator: string;
  text: string;
  source: string;
  sourceVersion: string;
  license: string;
  checksum: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type EmotionVerseMappingEntity = {
  verseReferenceKey: string;
  emotionKey: string;
  status: EmotionMappingStatus;
  rationale?: string;
  confidence?: number;
  mappingVersion: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  contextNotes?: string;
  tafsirReferences: string[];
  createdAt?: Date;
  updatedAt?: Date;
};
