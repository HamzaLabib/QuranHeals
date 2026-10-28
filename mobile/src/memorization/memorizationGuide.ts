import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GuideTarget } from '@/mushaf/guideTargets';
import { recordLocalPreferenceChange } from '@/sync/preferencesSyncState';
import type { GuideProgress } from '@/mushaf/mushafGuide';

import type { MemorizationLabels } from './labels';

type GuideText = keyof MemorizationLabels['guide'];

/**
 * The Memorization Mode Guide (Settings → Quran → Mushaf Guide → Memorization Mode Guide): seven steps in the Mushaf
 * guide's own overlay (components/MushafGuide.tsx), each pointing at the real control where it is drawn now.
 *
 * `targets`: the controls it may point at, the first one drawn winning (the Eye in the top bar — not drawn while the
 * setting is OFF or on page 61's Quran SVG, when the card is centred instead; Show All / Hide All only while
 * Memorization Mode is on, else the page number they sit beside). `missing`: the note shown when the step's own
 * control (the first target) is not drawn. Instructional only: opening it never changes a setting or enters
 * Memorization Mode, and the Mushaf guide's saved progress is untouched. The one thing it records is its own first-time
 * showing (MemorizationGuideProgress below).
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

/**
 * The step's text as this reader's setting has it: steps 1 and 2 say the Eye is offered by default (and where to turn
 * it off), or, for a reader who saved the setting OFF, where to turn it on and that the Eye then appears. Every other
 * step is the same for everyone.
 */
export function memorizationGuideText(step: MemorizationGuideStep, settingOn: boolean): GuideText {
  if (settingOn) return step.text;
  return step.text === 'enable' ? 'enableOff' : step.text === 'findEye' ? 'findEyeOff' : step.text;
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

/**
 * The first-time showing (owner request, 2026-10-25): on a fresh install the Mushaf opens with its own guide and then,
 * once that one is closed or finished, this one, by itself, once. A local, versioned key; 'done' follows the signed-in
 * account (`memorizationGuide`: applySyncedMemorizationGuideDone), a pending step stays on this device.
 *
 * - 'none': never queued. Nothing saved, or anything unreadable: an install that had already seen the Mushaf guide
 *   before this existed. It never opens by itself there (Settings → Quran → Mushaf Guide still opens it).
 * - 'pending': queued (with the step reached, so an interrupted showing reopens there), because the Mushaf guide had
 *   not been seen yet when the reader opened (queueMemorizationGuide).
 * - 'done': closed or finished, by itself or from Settings: never shown by itself again.
 */
export type MemorizationGuideProgress = { status: 'none' } | { status: 'pending'; step: number } | { status: 'done' };

export const MEMORIZATION_GUIDE_STORAGE_KEY = 'quran-heals:memorization-guide:v1';

/** Between the Mushaf guide closing and this one opening: never two guides (two Modals) on screen at once. */
export const MEMORIZATION_GUIDE_HANDOFF_MS = 500;

const NOT_QUEUED: MemorizationGuideProgress = { status: 'none' };

export function parseMemorizationGuideProgress(raw: unknown): MemorizationGuideProgress {
  if (raw && typeof raw === 'object') {
    const value = raw as { status?: unknown; step?: unknown };
    if (value.status === 'done') return { status: 'done' };
    if (value.status === 'pending') {
      const step = typeof value.step === 'number' && Number.isInteger(value.step) && value.step >= 0 && value.step < MEMORIZATION_GUIDE_STEPS.length ? value.step : 0;
      return { status: 'pending', step };
    }
  }
  return NOT_QUEUED;
}

/** Never throws: an unreadable store means not queued (so it never opens by itself over an existing reader's Mushaf). */
export async function loadMemorizationGuideProgress(): Promise<MemorizationGuideProgress> {
  try {
    const raw = await AsyncStorage.getItem(MEMORIZATION_GUIDE_STORAGE_KEY);
    return parseMemorizationGuideProgress(raw === null ? null : JSON.parse(raw));
  } catch {
    return NOT_QUEUED;
  }
}

/** `fromSync`: applied from the account (never recorded as this device's change). */
export async function saveMemorizationGuideProgress(progress: MemorizationGuideProgress, options?: { fromSync?: boolean }): Promise<void> {
  // Its first-time showing being over is the user's own change, recorded for the signed-in account.
  if (progress.status === 'done' && !options?.fromSync) recordLocalPreferenceChange('memorizationGuide', 'done');
  try {
    await AsyncStorage.setItem(MEMORIZATION_GUIDE_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Non-fatal: at worst it is not shown by itself, or shown once more.
  }
}

/**
 * As the reader opens: queued after the Mushaf guide where that one has not been seen yet (a fresh install), else as
 * it was. An existing reader's seen Mushaf guide never queues it; 'pending' and 'done' are never changed here.
 */
export function queueMemorizationGuide(mushafGuide: GuideProgress, progress: MemorizationGuideProgress): MemorizationGuideProgress {
  return progress.status === 'none' && mushafGuide.status === 'unseen' ? { status: 'pending', step: 0 } : progress;
}

/**
 * Whether the queued first-time showing may open now: queued; the Mushaf guide seen and not on screen; no Memorization
 * Mode Guide already open; the reader focused, its page drawn, the setting read and, where the Eye is offered, the Eye
 * itself drawn (so the steps point at it rather than at nothing).
 */
export function isMemorizationGuideDue(input: {
  progress: MemorizationGuideProgress | null;
  mushafGuide: GuideProgress | null;
  mushafGuideVisible: boolean;
  memorizationGuideOpen: boolean;
  focused: boolean;
  pageReady: boolean;
  settingReady: boolean;
  eyeReady: boolean;
}): boolean {
  return input.progress?.status === 'pending'
    && input.mushafGuide?.status === 'done'
    && !input.mushafGuideVisible
    && !input.memorizationGuideOpen
    && input.focused
    && input.pageReady
    && input.settingReady
    && input.eyeReady;
}

/** The account's 'done' (useAuth.tsx): this device's first-time showing is over too — never shown by itself again. Never throws. */
export async function applySyncedMemorizationGuideDone(): Promise<void> {
  if ((await loadMemorizationGuideProgress()).status === 'done') return;
  await saveMemorizationGuideProgress({ status: 'done' }, { fromSync: true });
}
