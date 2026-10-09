/**
 * Comfortable space between the last line of a scrolling screen and the
 * system navigation area (Android's gesture bar or 3-button bar, the iOS home
 * indicator), on top of the bottom safe-area inset.
 */
export const BOTTOM_NAV_CLEARANCE = 24;

/**
 * Bottom padding for a ScrollView's content on a screen whose SafeAreaView
 * deliberately leaves out the `bottom` edge (so content can scroll behind a
 * translucent edge-to-edge navigation bar). The inset is added here exactly
 * once — never also by the SafeAreaView — so the last item always ends up
 * fully above the navigation controls, whatever their height:
 *   - Android edge-to-edge, 3-button nav: inset ≈ 48 → 72
 *   - Android gesture nav: inset ≈ 16–24 → 40–48
 *   - iPhone with a home indicator: inset 34 → 58
 *   - no inset (older layouts, iPad without indicator): 24
 */
export function scrollBottomPadding(bottomInset: number): number {
  const inset = Number.isFinite(bottomInset) && bottomInset > 0 ? bottomInset : 0;
  return inset + BOTTOM_NAV_CLEARANCE;
}
