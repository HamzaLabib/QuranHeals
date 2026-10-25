import { RECITERS } from '@/audio/reciters';
import type { Messages } from '@/localization/messages';
import { isSurahPreviewBundled } from '@/surahPreview/bundledDataset';
import { SURAH_PREVIEW_ENABLED } from '@/surahPreview/config';

/**
 * The core Quran/Mushaf sources are credited on Home; the full source list,
 * including Amiri for the running heads, is on /credits with official sites
 * and terms:
 * - Tanzil: "provided that its source (Tanzil Project) is clearly indicated,
 *   and a link is made to tanzil.net".
 * - Quran Foundation (fonts and layout): credit "in a reasonably accessible
 *   place in the Application or its associated credits".
 * - King Fahd Complex: copyright holder of the QCF V1 fonts and the artwork.
 * - Amiri Project Authors: the Amiri Bold font used for Surah names.
 * - MP3Quran: the recitations and their ayah timing (audio/reciters.ts); its published rights statement (the
 *   "Copyrights" section of its privacy page) allows any visitor or developer to copy and use its material.
 * - Tafsir Center for Quranic Studies: Surah Preview's main purpose (مقصد السورة), from «المختصر في تفسير القرآن
 *   الكريم» via QuranEnc.com (the dataset's own `sources`, assets/surah-preview/surah-preview.json). Listed only in
 *   builds that carry that dataset (surahPreview/bundledDataset.ts). Its Makki/Madani and ayah counts are Tanzil's.
 * - Quranpedia.net: Surah Preview's topics («موضوعاتها», pending scholarly review), from its Surah information, citing
 *   «التفسير الموضوعي لسور القرآن الكريم» (a group of tafsir scholars, University of Sharjah, 2010), and for Surahs 42
 *   and 44 al-Fairuzabadi's «بصائر ذوي التمييز» (ed. al-Najjar) via Quranpedia: the dataset's `quranpedia-surahs`,
 *   `tafsir-mawdui` and `basair-firuzabadi` sources, credited together, naming each original work and its publisher,
 *   without implying their endorsement. Its licence asks no in-app attribution; the cited books have their own
 *   rights. Same builds as above.
 * See docs/mushaf.md, "Authorization and terms", and docs/audio/source-audit.md.
 *
 * Checked on 2026-10-11: the Tanzil and Quran Foundation URLs answer 200.
 * qurancomplex.gov.sa did not answer from the checking network (it is often
 * unreachable outside Saudi Arabia); it is the Complex's official domain.
 */
export type QuranSource = {
  key: 'tanzil' | 'quranFoundation' | 'kingFahd' | 'amiri' | 'mp3quran' | 'tafsirCenter' | 'quranpedia' | 'way2quran' | 'assabile' | 'archive' | 'quranicaudio' | 'everyayah';
  name: (copy: Messages['credits']) => string;
  work: (copy: Messages['credits']) => string;
  links: { label: 'website' | 'license' | 'terms'; url: string }[];
  /** Whether this build uses the source at all (omitted: always). */
  inThisBuild?: () => boolean;
};

/**
 * The hosts of the timed whole-surah recordings this build plays (audio/timedPreview.ts): in a release, only those that
 * passed every release gate (generated/timingRelease.ts), the owner's permission statement included; in development
 * builds, the whole preview. A host is credited exactly when its files can play.
 */
export function timedRecordingHosts(reciters: readonly { timedPreview?: { surahs: Readonly<Record<number, { provider: string }>> } }[] = RECITERS): ReadonlySet<string> {
  return new Set(reciters.flatMap((r) => Object.values(r.timedPreview?.surahs ?? {}).map((x) => x.provider)));
}

export const QURAN_SOURCES: readonly QuranSource[] = [
  {
    key: 'tanzil',
    name: (copy) => copy.tanzilName,
    work: (copy) => copy.tanzilWork,
    links: [
      { label: 'website', url: 'https://tanzil.net/' },
      { label: 'license', url: 'https://tanzil.net/docs/text_license' },
    ],
  },
  {
    key: 'quranFoundation',
    name: (copy) => copy.quranFoundationName,
    work: (copy) => copy.quranFoundationWork,
    links: [
      { label: 'website', url: 'https://quran.foundation/' },
      { label: 'terms', url: 'https://api-docs.quran.foundation/legal/developer-terms/' },
    ],
  },
  {
    key: 'kingFahd',
    name: (copy) => copy.kingFahdName,
    work: (copy) => copy.kingFahdWork,
    links: [{ label: 'website', url: 'https://qurancomplex.gov.sa/' }],
  },
  {
    key: 'amiri',
    name: (copy) => copy.amiriName,
    work: (copy) => copy.amiriWork,
    links: [
      { label: 'website', url: 'https://github.com/aliftype/amiri' },
      { label: 'license', url: 'https://openfontlicense.org/' },
    ],
  },
  {
    key: 'mp3quran',
    name: (copy) => copy.mp3quranName,
    work: (copy) => copy.mp3quranWork,
    links: [
      { label: 'website', url: 'https://www.mp3quran.net/' },
      { label: 'license', url: 'https://www.mp3quran.net/eng/privacy' },
    ],
  },
  {
    key: 'tafsirCenter',
    name: (copy) => copy.tafsirCenterName,
    work: (copy) => copy.tafsirCenterWork,
    links: [{ label: 'website', url: 'https://quranenc.com/ar/browse/arabic_mokhtasar' }],
    inThisBuild: () => SURAH_PREVIEW_ENABLED && isSurahPreviewBundled(),
  },
  {
    key: 'quranpedia',
    name: (copy) => copy.quranpediaName,
    work: (copy) => copy.quranpediaWork,
    links: [{ label: 'website', url: 'https://quranpedia.net' }],
    inThisBuild: () => SURAH_PREVIEW_ENABLED && isSurahPreviewBundled(),
  },
  {
    key: 'way2quran',
    name: (copy) => copy.way2quranName,
    work: (copy) => copy.way2quranWork,
    links: [{ label: 'website', url: 'https://way2quran.com/' }],
    inThisBuild: () => timedRecordingHosts().has('way2quran'),
  },
  {
    key: 'assabile',
    name: (copy) => copy.assabileName,
    work: (copy) => copy.assabileWork,
    links: [{ label: 'website', url: 'https://www.assabile.com/' }],
    inThisBuild: () => timedRecordingHosts().has('assabile'),
  },
  {
    key: 'archive',
    name: (copy) => copy.archiveName,
    work: (copy) => copy.archiveWork,
    links: [{ label: 'website', url: 'https://archive.org/' }],
    inThisBuild: () => timedRecordingHosts().has('archive'),
  },
  {
    key: 'quranicaudio',
    name: (copy) => copy.quranicaudioName,
    work: (copy) => copy.quranicaudioWork,
    links: [{ label: 'website', url: 'https://quranicaudio.com/' }],
    inThisBuild: () => timedRecordingHosts().has('quranicaudio'),
  },
  {
    // Per-ayah recordings (audio/perAyah.ts): development previews, or in a release only those released by
    // tools/quran-audio/per-ayah/release-gate.mjs (generated/perAyahRelease.ts).
    key: 'everyayah',
    name: (copy) => copy.everyayahName,
    work: (copy) => copy.everyayahWork,
    links: [{ label: 'website', url: 'https://everyayah.com/' }],
    inThisBuild: () => RECITERS.some((reciter) => reciter.perAyah?.provider === 'everyayah'),
  },
];
