import type { AppLocale } from '@/localization/locales';

/**
 * عن السورة's interface text, kept with the feature (the introductions themselves are the source's, never here). The
 * App Language is English or Arabic; Egyptian Arabic (an Emotions Language only) reads the Arabic.
 */
export type SurahPreviewLabels = {
  /** The approved name, on the button and the sheet: «عن السورة» / "Surah Preview". */
  title: string;
  /** The button's spoken hint. */
  openHint: string;
  close: string;
  /** Above the surah choice when more than one Surah begins on the page. */
  chooseSurah: string;
  makki: string;
  madani: string;
  /** "{n} ayahs" / «{n} آية» or «{n} آيات» (ayahCountLabel picks the Arabic form). */
  ayahCount: (n: number, formatted: string) => string;
  /** "Surah {n}" / «السورة {n}». */
  surahNumber: string;
  purpose: string;
  /** «موضوعاتها» / "Topics". */
  themes: string;
  /** In place of the themes while none is available for this Surah (the gap is shown, never a filler). */
  themesUnavailable: string;
  unavailable: string;
  /** Shown when the introduction is in Arabic because the App Language's text is not available. */
  arabicOnlyNote: string | null;
};

/**
 * Arabic counted noun after a numeral: آيات after 3–10 (and 103–110, …), آية otherwise (11–99, 100, 101, 200, …), as
 * in the approved «١١٠ آيات» and «٢٨٦ آية». Every Surah has at least 3 ayahs, so the dual and singular forms never arise.
 */
export function arabicAyahNoun(n: number): string {
  const r = n % 100;
  return r >= 3 && r <= 10 ? 'آيات' : 'آية';
}

const EN: SurahPreviewLabels = {
  title: 'Surah Preview',
  openHint: 'Shows a short introduction to the surah that begins on this page',
  close: 'Close',
  chooseSurah: 'Surahs beginning on this page',
  makki: 'Makki',
  madani: 'Madani',
  ayahCount: (_n, formatted) => `${formatted} ayahs`,
  surahNumber: 'Surah {n}',
  purpose: 'Main Purpose',
  themes: 'Topics',
  themesUnavailable: 'Not available yet.',
  unavailable: 'Surah Preview is not available in this version of the app.',
  arabicOnlyNote: 'Shown in Arabic, as the source has it: a verified English text is not available yet.',
};

const AR: SurahPreviewLabels = {
  title: 'عن السورة',
  openHint: 'يعرض تعريفًا موجزًا بالسورة التي تبدأ في هذه الصفحة',
  close: 'إغلاق',
  chooseSurah: 'السور التي تبدأ في هذه الصفحة',
  makki: 'مكية',
  madani: 'مدنية',
  ayahCount: (n, formatted) => `${formatted} ${arabicAyahNoun(n)}`,
  surahNumber: 'السورة {n}',
  purpose: 'مقصد السورة',
  themes: 'موضوعاتها',
  themesUnavailable: 'غير متاحة بعد.',
  unavailable: 'خاصية «عن السورة» غير متاحة في هذا الإصدار من التطبيق.',
  arabicOnlyNote: null,
};

export function surahPreviewLabels(locale: AppLocale): SurahPreviewLabels {
  return locale === 'en' ? EN : AR;
}
