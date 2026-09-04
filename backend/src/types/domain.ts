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

