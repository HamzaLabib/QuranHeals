export type EmotionEntity = {
  key: string;
  name: string;
  arabicName: string;
  description: string;
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
