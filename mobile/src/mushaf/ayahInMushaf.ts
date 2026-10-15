import { isExistingAyah } from '@/utils/ayahLink';

import { pageOfAyah } from './navigation';

/**
 * An ayah opened in the app's own Mushaf (the reference under an ayah on its card: the ayah screens, Favorites): the
 * page that holds it (the verified page starts, navigation.ts pageOfAyah), with that ayah selected as if tapped. `at`
 * makes each tap a new request, so the reader moves to it even when it is already open on another page.
 */
export type MushafAyahRoute = { pathname: '/mushaf'; params: { page: string; ayah: string; at: string } };

/** The route for an existing ayah, or null for anything else (never a fallback page). */
export function mushafRouteForAyah(surah: number, ayah: number, now: number = Date.now()): MushafAyahRoute | null {
  if (!isExistingAyah(surah, ayah)) return null;
  return { pathname: '/mushaf', params: { page: String(pageOfAyah(surah, ayah)), ayah: `${surah}:${ayah}`, at: String(now) } };
}

/**
 * The ayah a `/mushaf?ayah=S:A` request asks to select: only an existing ayah, and only when it is on the requested
 * page (a link can never select an ayah on a page that isn't shown). Null otherwise.
 */
export function requestedAyahOnPage(raw: unknown, page: number | null): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || page === null) return null;
  const match = /^([1-9]\d{0,2}):([1-9]\d{0,2})$/.exec(value);
  if (!match) return null;
  const [surah, ayah] = [Number(match[1]), Number(match[2])];
  return isExistingAyah(surah, ayah) && pageOfAyah(surah, ayah) === page ? `${surah}:${ayah}` : null;
}
