import { getAyah } from './api';
import { getRandomVerseKey } from './quran';

/**
 * "Need an ayah from the Quran?" — the general Quran flow (completely
 * separate from the 29-emotion mapping system). Selection is entirely
 * local and unrestricted: `getRandomVerseKey` picks uniformly among all
 * 6,236 verified ayahs in the bundled quran.sqlite, with no dependency on
 * emotions, the 1,845 approved mappings, favorites, or the user's
 * language. Only fetching that verse's content (surah names, translation)
 * reaches the network — the same `getAyah` lookup-by-verseKey the app
 * already uses elsewhere (e.g. resolving a favorite) — and even then the
 * returned Arabic text is immediately re-verified against the local
 * quran.sqlite by `getAyah` itself, never trusted from the network.
 */
export async function getRandomGeneralAyah(excludedVerseKeys: string[] = []) {
  const verseKey = await getRandomVerseKey(excludedVerseKeys);
  return getAyah(verseKey);
}
