import { PAGE_FIRST_AYAH } from '@/mushaf/generated/pageStarts';
import { MUSHAF_PAGE_COUNT } from '@/mushaf/mushafPage';
import { pageOfAyah } from '@/mushaf/navigation';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

/** One ayah of the Quran. */
export type AyahPosition = { surah: number; ayah: number };

export const FIRST_AYAH: AyahPosition = { surah: 1, ayah: 1 };
export const LAST_AYAH: AyahPosition = { surah: 114, ayah: SURAH_AYAH_COUNTS[113] };

export function isValidPosition(position: AyahPosition): boolean {
  const { surah, ayah } = position;
  return Number.isInteger(surah) && Number.isInteger(ayah) && surah >= 1 && surah <= 114 && ayah >= 1 && ayah <= SURAH_AYAH_COUNTS[surah - 1];
}

export const samePosition = (a: AyahPosition | null, b: AyahPosition | null) => a !== null && b !== null && a.surah === b.surah && a.ayah === b.ayah;

export const verseKeyOf = (position: AyahPosition) => `${position.surah}:${position.ayah}`;

export function positionOfVerseKey(verseKey: string): AyahPosition | null {
  const match = /^(\d{1,3}):(\d{1,3})$/.exec(verseKey);
  if (!match) return null;
  const position = { surah: Number(match[1]), ayah: Number(match[2]) };
  return isValidPosition(position) ? position : null;
}

/** The ayah after `position` (into the next surah after a surah's last ayah), or null after An-Nas 6. */
export function nextAyah(position: AyahPosition): AyahPosition | null {
  if (position.ayah < SURAH_AYAH_COUNTS[position.surah - 1]) return { surah: position.surah, ayah: position.ayah + 1 };
  if (position.surah < 114) return { surah: position.surah + 1, ayah: 1 };
  return null;
}

/** The ayah before `position` (the previous surah's last ayah before an ayah 1), or null before Al-Fatiha 1. */
export function previousAyah(position: AyahPosition): AyahPosition | null {
  if (position.ayah > 1) return { surah: position.surah, ayah: position.ayah - 1 };
  if (position.surah > 1) return { surah: position.surah - 1, ayah: SURAH_AYAH_COUNTS[position.surah - 2] };
  return null;
}

/**
 * The first ayah printed on a Mushaf page (canonical page table, mushaf/generated/pageStarts.ts). Every QCF V1 page
 * begins with an ayah's first word (checked on all 604 pages of the Content Sync snapshot, tools/quran-audio/README.md),
 * so playing a page from its start never needs a timestamp inside an ayah.
 */
export function firstAyahOfPage(page: number): AyahPosition | null {
  if (!Number.isInteger(page) || page < 1 || page > MUSHAF_PAGE_COUNT) return null;
  const [surah, ayah] = PAGE_FIRST_AYAH[page - 1];
  return { surah, ayah };
}

/** The Mushaf page an ayah begins on: the page to show while it is recited. */
export const pageOfPosition = (position: AyahPosition): number => pageOfAyah(position.surah, position.ayah);
