/**
 * Memorization Mode (وضع الحفظ): the internal development switch, separate from the reader's own Settings → Quran →
 * Memorization Mode toggle (memorizationModePreference.ts), which only shows or hides the Eye button.
 *
 * Development builds only until the owner approves the feature for release: Metro replaces `__DEV__` with false in a
 * release bundle, so nothing of it is reachable there — no Settings row, no Eye button, no guide choice (Settings →
 * Mushaf Guide then opens the Mushaf guide directly, as before). Allowing release builds is a deliberate change of
 * this function.
 */
export function isMemorizationModeAvailable(): boolean {
  return __DEV__;
}
