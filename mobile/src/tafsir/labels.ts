import type { AppLocale } from '@/localization/locales';

/**
 * The tafsir reader's interface text, kept with the feature (as surahPreview/labels.ts and wordMeanings/labels.ts are).
 * The tafsir texts themselves are the sources' Arabic, never here. Edition titles are the works' Arabic titles in every
 * language (editions.ts). Egyptian Arabic follows the Arabic wording, with the colloquial forms the app's Egyptian
 * dictionary uses for actions and hints (localization/messages.ts).
 */
export type TafsirLabels = {
  /** The screen's name. */
  title: string;
  back: string;
  /** Above the edition chips (screen readers). */
  chooseEdition: string;
  /** Each chip's status line. {percent}: 0–100, already formatted. {size}: e.g. "2.4 MB". */
  ready: string;
  selected: string;
  download: string;
  downloadSize: string;
  downloading: string;
  verifying: string;
  failed: string;
  retry: string;
  unavailable: string;
  /** A chip's spoken hint by state. */
  selectHint: string;
  downloadHint: string;
  unavailableHint: string;
  /** A passage's heading: «تفسير الآيات {from}–{to}» / "Ayahs {from}–{to}". */
  rangeHeading: string;
  /** On an ayah inside a passage: a link to that passage's commentary below. */
  jumpToRange: string;
  /** The reference above each ayah: "{surah} · {ayah}". */
  ayahReference: string;
  loading: string;
  /** The edition could not be read (it was damaged): الميسر is shown instead. */
  fellBack: string;
  /** No edition can be read on this device (none is verified in this build). */
  noEdition: string;
  /** The Surah's verified Arabic could not be read from the device. */
  quranFailed: string;
  /** Under the edition name at the top: where the text comes from. */
  sourceLine: string;
  /** The digital edition: "{distributor}, version {version}" (QuranEnc's terms ask to name the source and version). */
  editionLine: string;
  /** Where a failed download is explained. */
  failedNetwork: string;
  failedVerification: string;
  failedStorage: string;
  /** Shown once: the commentary is in Arabic whatever the app language. */
  arabicOnlyNote: string | null;
};

const EN: TafsirLabels = {
  title: 'Tafsir',
  back: 'Back to the Mushaf',
  chooseEdition: 'Tafsir edition',
  ready: 'On this device',
  selected: 'Reading',
  download: 'Download',
  downloadSize: 'Download · {size}',
  downloading: 'Downloading {percent}%',
  verifying: 'Checking…',
  failed: 'Download failed',
  retry: 'Retry',
  unavailable: 'Not available yet',
  selectHint: 'Shows this tafsir',
  downloadHint: 'Downloads this tafsir for offline reading',
  unavailableHint: 'This tafsir is not available in this version of the app',
  rangeHeading: 'Commentary on ayahs {from}–{to}',
  jumpToRange: 'Commentary on ayahs {from}–{to} below',
  ayahReference: '{surah} · {ayah}',
  loading: 'Loading…',
  fellBack: 'That tafsir could not be opened, so At-Tafsir Al-Muyassar is shown. You can download it again.',
  noEdition: 'Tafsir is not available in this version of the app.',
  quranFailed: 'The Quran text could not be opened. Please go back and try again.',
  sourceLine: '{title} — {publisher}',
  editionLine: 'Source: {distributor}, version {version}',
  failedNetwork: 'The download stopped. Check your connection and retry.',
  failedVerification: 'The downloaded file did not match the verified edition and was deleted. Please retry.',
  failedStorage: 'The tafsir could not be saved on this device.',
  arabicOnlyNote: 'The tafsir texts are in Arabic.',
};

const AR: TafsirLabels = {
  title: 'التفسير',
  back: 'العودة إلى المصحف',
  chooseEdition: 'اختيار التفسير',
  ready: 'على الجهاز',
  selected: 'المعروض',
  download: 'تنزيل',
  downloadSize: 'تنزيل · {size}',
  downloading: 'جارٍ التنزيل {percent}٪',
  verifying: 'جارٍ التحقق…',
  failed: 'تعذّر التنزيل',
  retry: 'إعادة المحاولة',
  unavailable: 'غير متاح بعد',
  selectHint: 'يعرض هذا التفسير',
  downloadHint: 'ينزّل هذا التفسير للقراءة دون اتصال',
  unavailableHint: 'هذا التفسير غير متاح في هذا الإصدار من التطبيق',
  rangeHeading: 'تفسير الآيات {from}–{to}',
  jumpToRange: 'تفسير الآيات {from}–{to} في الأسفل',
  ayahReference: '{surah} · {ayah}',
  loading: 'جارٍ التحميل…',
  fellBack: 'تعذّر فتح ذلك التفسير، فعُرض التفسير الميسر. يمكنك تنزيله مرة أخرى.',
  noEdition: 'التفسير غير متاح في هذا الإصدار من التطبيق.',
  quranFailed: 'تعذّر فتح نص القرآن. يرجى الرجوع وإعادة المحاولة.',
  sourceLine: '{title} — {publisher}',
  editionLine: 'المصدر: {distributor}، الإصدار {version}',
  failedNetwork: 'توقف التنزيل. تحقّق من الاتصال وأعد المحاولة.',
  failedVerification: 'لم يطابق الملف المنزّل النسخة الموثّقة فحُذف. يرجى إعادة المحاولة.',
  failedStorage: 'تعذّر حفظ التفسير على هذا الجهاز.',
  arabicOnlyNote: null,
};

const AR_EG: TafsirLabels = {
  ...AR,
  selectHint: 'بيعرض التفسير ده',
  quranFailed: 'نص القرآن ما اتفتحش. ارجع وجرّب تاني.',
  downloadHint: 'بينزّل التفسير ده عشان تقراه من غير إنترنت',
  failedNetwork: 'التنزيل وقف. اتأكد من الاتصال وجرّب تاني.',
  failedVerification: 'الملف اللي نزل ماطابقش النسخة الموثّقة فاتمسح. جرّب تاني.',
};

export function tafsirLabels(locale: AppLocale): TafsirLabels {
  return locale === 'en' ? EN : locale === 'ar-EG' ? AR_EG : AR;
}
