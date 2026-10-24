import type { AppLocale } from '@/localization/locales';

/**
 * المعاني's interface text, kept with the feature (the meanings themselves are the source's, never here). The App
 * Language is English or Arabic; Egyptian Arabic (an Emotions Language only) reads the Arabic.
 */
export type WordMeaningsLabels = {
  /** The approved name, on the control and the sheet: «المعاني» / "Meanings" (never «معاني الكلمات»). */
  title: string;
  /** The control's spoken hint. */
  openHint: string;
  close: string;
  /** Under the title: "Page {n}". */
  page: string;
  /** An entry's ayah: "{surah} {ayah}" with the Surah's name in the App Language. */
  ayahReference: string;
  /** A pair of ayahs explained together. */
  ayahRangeReference: string;
  empty: string;
  unavailable: string;
  /** Always shown under the list: the source and its publisher. */
  sourceLine: string;
  /** English only: the meanings are Arabic (no verified English source yet). */
  arabicOnlyNote: string | null;
};

const EN: WordMeaningsLabels = {
  title: 'Meanings',
  openHint: 'Shows short meanings of selected words on this page',
  close: 'Close',
  page: 'Page {n}',
  ayahReference: '{surah} {s}:{ayah}',
  ayahRangeReference: '{surah} {s}:{ayah}–{end}',
  empty: 'No word meanings for this page.',
  unavailable: 'Meanings are not available in this version of the app.',
  sourceLine: 'Source: Al-Muyassar fi Gharib al-Quran al-Karim (الميسر في غريب القرآن الكريم), King Fahd Glorious Qur\'an Printing Complex.',
  arabicOnlyNote: 'The meanings are in Arabic, from the King Fahd Complex. English meanings are not available yet.',
};

const AR: WordMeaningsLabels = {
  title: 'المعاني',
  openHint: 'يعرض معاني مختصرة لكلمات مختارة من هذه الصفحة',
  close: 'إغلاق',
  page: 'صفحة {n}',
  ayahReference: '{surah}، الآية {ayah}',
  ayahRangeReference: '{surah}، الآيتان {ayah}–{end}',
  empty: 'لا توجد معانٍ لهذه الصفحة.',
  unavailable: 'المعاني غير متاحة في هذا الإصدار من التطبيق.',
  sourceLine: 'المصدر: الميسر في غريب القرآن الكريم، مجمع الملك فهد لطباعة المصحف الشريف.',
  arabicOnlyNote: null,
};

export function wordMeaningsLabels(locale: AppLocale): WordMeaningsLabels {
  return locale === 'en' ? EN : AR;
}
