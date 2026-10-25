import type { GuideTarget } from '@/mushaf/guideTargets';

import type { MemorizationLabels } from './labels';

type GuideText = keyof MemorizationLabels['guide'];

/**
 * The Memorization Mode Guide (Settings → Quran → Mushaf Guide → Memorization Mode Guide): seven steps in the Mushaf
 * guide's own overlay (components/MushafGuide.tsx), each pointing at the real control where it is drawn now.
 *
 * `targets`: the controls it may point at, the first one drawn winning (the Eye in the top bar — not drawn while the
 * setting is OFF or on page 61's Quran SVG, when the card is centred instead; Show All / Hide All only while
 * Memorization Mode is on, else the page number they sit beside). `missing`: the note shown when the step's own
 * control (the first target) is not drawn. Instructional only: opening it never
 * changes a setting, enters Memorization Mode, or records anything (the Mushaf guide's saved progress is untouched).
 */
export type MemorizationGuideStep = {
  text: GuideText;
  targets: readonly GuideTarget[];
  missing: GuideText | null;
  /** A small picture under the text: the Settings switch, or the Eye turning into the gold crossed-out Eye. */
  illustration?: 'setting' | 'eyeChange';
  /**
   * Where this layout puts Show All / Hide All in the top bar (no room beside the page number), the step's text and
   * targets there instead: never "beside the page number" where they are not.
   */
  inBar?: { text: GuideText; targets: readonly GuideTarget[] };
};

export const MEMORIZATION_GUIDE_STEPS: readonly MemorizationGuideStep[] = [
  { text: 'enable', targets: [], missing: null, illustration: 'setting' },
  { text: 'findEye', targets: ['memorize'], missing: 'eyeNotShown' },
  { text: 'hide', targets: ['memorize'], missing: 'eyeNotShown', illustration: 'eyeChange' },
  { text: 'reveal', targets: ['ayah'], missing: null },
  { text: 'peek', targets: ['ayah'], missing: null },
  { text: 'continueExit', targets: ['memorize'], missing: 'eyeNotShown' },
  { text: 'showHideAll', targets: ['memorizeAll', 'page'], missing: 'allNotShown', inBar: { text: 'showHideAllInBar', targets: ['memorizeAll', 'memorize'] } },
];

/** The step as this layout shows it: its top-bar form where Show All / Hide All are in the top bar. */
export function memorizationGuideStepFor(step: MemorizationGuideStep, allInBar: boolean): MemorizationGuideStep {
  return allInBar && step.inBar ? { ...step, text: step.inBar.text, targets: step.inBar.targets } : step;
}

/** The control a step points at: its first target that is drawn now, or none (the card is then centred). */
export function memorizationGuideTarget(step: MemorizationGuideStep, isDrawn: (target: GuideTarget) => boolean): GuideTarget | null {
  return step.targets.find(isDrawn) ?? null;
}

/**
 * The step's note: shown when its own control is not drawn now. For the Eye on a page that cannot hide single ayahs
 * (`eyeUnavailableHere`: page 61's Quran SVG, with the setting ON) it says so, rather than pointing to Settings.
 */
export function memorizationGuideNote(step: MemorizationGuideStep, isDrawn: (target: GuideTarget) => boolean, eyeUnavailableHere = false): GuideText | null {
  if (!step.missing || step.targets.length === 0 || isDrawn(step.targets[0])) return null;
  return step.missing === 'eyeNotShown' && eyeUnavailableHere ? 'eyeUnavailable' : step.missing;
}
