/**
 * Memorization Mode's session state (approved Option A): which ayahs of the page being read the reader has revealed.
 * Nothing here is saved, synced or sent anywhere; it lives in the reader while it is open.
 *
 * - Entering: every ayah of the page is hidden (its words and pause marks; its number stays).
 * - A tap on an ayah reveals all of it on this page; another tap hides it again. Any number may be revealed.
 * - Show All / Hide All: every ayah of this page revealed / hidden.
 * - Another page (a swipe, the page selector, a Surah, juz' or Hizb, a ورد, the recitation): still in Memorization
 *   Mode, that page starting hidden. Coming back to a page starts it hidden again.
 * - Exiting: every ayah drawn again, nothing else changed.
 */
export type MemorizationState =
  | { active: false }
  | { active: true; page: number; revealed: ReadonlySet<string> };

/** A touch held on an ayah: shown only while held, never changing what is revealed. */
export type MemorizationPeek = { page: number; verseKey: string } | null;

export const MEMORIZATION_OFF: MemorizationState = { active: false };

const NONE: ReadonlySet<string> = new Set();

export const enterMemorization = (page: number): MemorizationState => ({ active: true, page, revealed: NONE });

/** The page being read changed: a new page starts hidden (the same page keeps what was revealed). */
export function memorizationOnPage(state: MemorizationState, page: number): MemorizationState {
  return state.active && state.page !== page ? { active: true, page, revealed: NONE } : state;
}

export function toggleMemorizedAyah(state: MemorizationState, page: number, verseKey: string): MemorizationState {
  if (!state.active) return state;
  const revealed = new Set(state.page === page ? state.revealed : NONE);
  if (revealed.has(verseKey)) revealed.delete(verseKey);
  else revealed.add(verseKey);
  return { active: true, page, revealed };
}

export function showAllAyahs(state: MemorizationState, page: number, verseKeys: readonly string[]): MemorizationState {
  return state.active ? { active: true, page, revealed: new Set(verseKeys) } : state;
}

export function hideAllAyahs(state: MemorizationState, page: number): MemorizationState {
  return state.active ? { active: true, page, revealed: NONE } : state;
}

/** Whether an ayah's text on page `page` is hidden now (a held peek shows it without revealing it). */
export function isAyahHidden(state: MemorizationState, page: number, verseKey: string, peek: MemorizationPeek = null): boolean {
  if (!state.active) return false;
  if (peek && peek.page === page && peek.verseKey === verseKey) return false;
  return !(state.page === page && state.revealed.has(verseKey));
}
