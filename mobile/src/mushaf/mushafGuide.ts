import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GuideTarget } from './guideTargets';

/**
 * The first-time Mushaf guide (components/MushafGuide.tsx): six steps, each pointing at a real control. Instructional
 * only: while it is shown nothing in the reader can be tapped, and it never changes the page, a ورد, a Khatma, a
 * reflection or a favorite.
 *
 * Shown by itself the first time the Mushaf is opened (once the page and its controls are drawn), and kept until the
 * user closes or finishes it: no timer, no tap outside, no backgrounding closes it. Its progress is saved, so a reload
 * mid-way reopens it at the same step. Closing or finishing records that it was seen (a local, versioned key; never
 * synced). Finishing it (Start Reading on the last step) also hides the reader's Help icon for good; closing it early
 * keeps the icon. Settings → Quran → Mushaf Guide, and the Help icon while shown, open it again at the first step
 * without changing what was recorded.
 *
 * The order (2026-10-17, the original order reversed): the ayah's number (saving the ورد position), an ayah, the
 * Juz, the page number, the Hizb, the Surah name. Each step carries its own control and its own text, so they always
 * move together.
 */
export type GuideTextKey = 'guideMarker' | 'guideAyah' | 'guideJuz' | 'guidePage' | 'guideHizb' | 'guideSurah';
export type GuideStep = { target: GuideTarget; text: GuideTextKey };
export const GUIDE_STEPS: readonly GuideStep[] = [
  { target: 'marker', text: 'guideMarker' },
  { target: 'ayah', text: 'guideAyah' },
  { target: 'juz', text: 'guideJuz' },
  { target: 'page', text: 'guidePage' },
  { target: 'hizb', text: 'guideHizb' },
  { target: 'surah', text: 'guideSurah' },
];
/** Saved with a step in progress; a step saved without it counted in the original order (surah … marker) and restarts. */
export const GUIDE_ORDER = 2;

export const MUSHAF_GUIDE_STORAGE_KEY = 'quran-heals:mushaf-guide:v1';

/**
 * 'unseen': never shown, or shown and not yet closed (with the step reached); 'done': closed or finished, with
 * `finished` true once all six steps were gone through to Start Reading. A 'done' saved before `finished` existed
 * counts as finished: those users keep the guide completed (and the Help icon hidden) after updating.
 */
export type GuideProgress = { status: 'unseen'; step: number } | { status: 'done'; finished: boolean };

export function parseGuideProgress(raw: unknown): GuideProgress {
  if (raw && typeof raw === 'object') {
    const value = raw as { status?: unknown; step?: unknown; finished?: unknown; order?: unknown };
    if (value.status === 'done') return { status: 'done', finished: value.finished !== false };
    if (value.status === 'unseen' && typeof value.step === 'number' && Number.isInteger(value.step) && value.step >= 0 && value.step < GUIDE_STEPS.length) {
      // A step saved in the original order is not resumed in the reversed one: the guide starts again from step 1.
      return { status: 'unseen', step: value.order === GUIDE_ORDER ? value.step : 0 };
    }
  }
  return { status: 'unseen', step: 0 };
}

/** Whether the guide was finished: the reader's Help icon is then hidden for good. */
export const isGuideFinished = (progress: GuideProgress | null): boolean => progress?.status === 'done' && progress.finished;

/** Never throws: an unreadable store means the guide has not been seen (so it shows, rather than silently never). */
export async function loadGuideProgress(): Promise<GuideProgress> {
  try {
    const raw = await AsyncStorage.getItem(MUSHAF_GUIDE_STORAGE_KEY);
    return parseGuideProgress(raw === null ? null : JSON.parse(raw));
  } catch {
    return { status: 'unseen', step: 0 };
  }
}

export async function saveGuideProgress(progress: GuideProgress): Promise<void> {
  try {
    await AsyncStorage.setItem(MUSHAF_GUIDE_STORAGE_KEY, JSON.stringify(progress.status === 'unseen' ? { ...progress, order: GUIDE_ORDER } : progress));
  } catch {
    // Non-fatal: at worst the guide shows again next time.
  }
}

export type Rect = { x: number; y: number; width: number; height: number };

export const GUIDE_HIGHLIGHT_PAD = 6;
/** Between the highlight and the card: the arrow's length. */
export const GUIDE_ARROW_LENGTH = 34;
export const GUIDE_SIDE_MARGIN = 16;
export const GUIDE_CARD_MAX_WIDTH = 360;
/** The arrow's tip and tail stay this far inside the card's rounded corners. */
const ARROW_CORNER_INSET = 22;

export type GuidePlacement = {
  /** The highlighted area around the control (the control's own box, padded). */
  hole: Rect;
  card: { left: number; width: number } & ({ top: number } | { bottom: number });
  /** The card below the control (the arrow points up to it) or above it (the arrow points down). */
  side: 'below' | 'above';
  arrow: { x: number; fromY: number; toY: number };
};

/**
 * Where the guide draws, from the control's measured box and the screen: the card on the side of the control with
 * more room (below a control in the screen's upper half, above one in its lower half), never past the safe areas, as
 * wide as the screen allows up to GUIDE_CARD_MAX_WIDTH, centred; the arrow from the card's edge straight to the
 * highlighted control, at the control's centre (kept inside the card's straight edge).
 */
export function computeGuidePlacement(target: Rect, screen: { width: number; height: number }, safe: { top: number; bottom: number }): GuidePlacement {
  const hole = {
    x: target.x - GUIDE_HIGHLIGHT_PAD,
    y: target.y - GUIDE_HIGHLIGHT_PAD,
    width: target.width + GUIDE_HIGHLIGHT_PAD * 2,
    height: target.height + GUIDE_HIGHLIGHT_PAD * 2,
  };
  const width = Math.min(GUIDE_CARD_MAX_WIDTH, screen.width - GUIDE_SIDE_MARGIN * 2);
  const left = (screen.width - width) / 2;
  const centreY = hole.y + hole.height / 2;
  const roomBelow = screen.height - safe.bottom - (hole.y + hole.height);
  const roomAbove = hole.y - safe.top;
  const side: GuidePlacement['side'] = centreY < screen.height / 2 ? (roomBelow >= roomAbove * 0.6 ? 'below' : 'above') : (roomAbove >= roomBelow * 0.6 ? 'above' : 'below');
  const arrowX = Math.min(left + width - ARROW_CORNER_INSET, Math.max(left + ARROW_CORNER_INSET, target.x + target.width / 2));
  if (side === 'below') {
    const cardTop = hole.y + hole.height + GUIDE_ARROW_LENGTH;
    return { hole, side, card: { left, width, top: cardTop }, arrow: { x: arrowX, fromY: cardTop, toY: hole.y + hole.height } };
  }
  const cardBottomY = hole.y - GUIDE_ARROW_LENGTH;
  return { hole, side, card: { left, width, bottom: screen.height - cardBottomY }, arrow: { x: arrowX, fromY: cardBottomY, toY: hole.y } };
}
