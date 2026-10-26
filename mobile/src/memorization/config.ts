/**
 * Memorization Mode (وضع الحفظ): the rollback switch, separate from the reader's own Settings → Quran → Memorization
 * Mode toggle (memorizationModePreference.ts, ON by default), which only shows or hides the Eye button.
 *
 * Available in every build — development and release, Android and iOS (owner approval, 2026-10-24): the Settings row,
 * the Eye, Show All / Hide All, the guide choice and the Memorization Mode Guide. Returning false removes all of it
 * (Settings → Mushaf Guide then opens the Mushaf guide directly, as before) and changes nothing else.
 */
export function isMemorizationModeAvailable(): boolean {
  return true;
}
