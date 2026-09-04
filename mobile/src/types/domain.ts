export type Emotion = {
  id: string;
  key: string;
  name: string;
  arabicName: string;
  description: string;
  icon: string;
  order: number;
  active: boolean;
};

export type Ayah = {
  id: string;
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

