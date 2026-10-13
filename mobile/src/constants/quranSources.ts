import type { Messages } from '@/localization/messages';

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
 * See docs/mushaf.md, "Authorization and terms".
 *
 * Checked on 2026-10-11: the Tanzil and Quran Foundation URLs answer 200.
 * qurancomplex.gov.sa did not answer from the checking network (it is often
 * unreachable outside Saudi Arabia); it is the Complex's official domain.
 */
export type QuranSource = {
  key: 'tanzil' | 'quranFoundation' | 'kingFahd' | 'amiri';
  name: (copy: Messages['credits']) => string;
  work: (copy: Messages['credits']) => string;
  links: { label: 'website' | 'license' | 'terms'; url: string }[];
};

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
];
