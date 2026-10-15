import type { Ayah } from '@/types/domain';

import { ApiError, getAyah, type ApiErrorKind } from './api';
import { resolveAyahArabic } from './quran';
import { parseVerseKey } from './quranReference';
import { getSurahName } from './surahNames';

/** The backend can't be reached (offline, timed out, down or failing): an ayah action may continue from the device. */
const UNREACHABLE: readonly ApiErrorKind[] = ['network', 'timeout', 'backend_unavailable', 'server'];

/**
 * An ayah built on the device alone: the verified local Tanzil Arabic (the same repository every ayah screen's Arabic
 * comes from, never a second dataset) and the verified local Surah names. The English translation lives only on the
 * backend, so it is left empty — never guessed — and filled in later (storage/favorites.ts:
 * completePendingFavoriteTranslations). No emotions: none are known for it.
 */
export async function localAyah(verseKey: string): Promise<Ayah & { verseKey: string }> {
  const { surah, ayah, verseKey: key } = parseVerseKey(verseKey);
  const name = getSurahName(surah);
  return resolveAyahArabic({
    id: key,
    verseKey: key,
    referenceKey: key,
    surahNumber: surah,
    ayahNumber: ayah,
    surahNameArabic: name.nameArabic,
    surahNameEnglish: name.nameEnglish,
    arabicText: '',
    englishTranslation: '',
    emotions: [],
    quranTextSource: '',
    translationSource: '',
  });
}

/**
 * The ayah for an action (the Mushaf's Save and Share): the backend's ayah as before (its translation, its Arabic
 * resolved locally), or — only when the backend can't be reached — the device's own (localAyah). Any other failure (an
 * ayah that doesn't exist, a refused request) is still an error.
 */
export async function getAyahForAction(verseKey: string, fetchAyah: (id: string) => Promise<Ayah> = getAyah): Promise<Ayah> {
  try {
    return await fetchAyah(verseKey);
  } catch (error) {
    if (error instanceof ApiError && UNREACHABLE.includes(error.kind)) return localAyah(verseKey);
    throw error;
  }
}
