/**
 * Navigation options for the Mushaf reader's route (app/_layout.tsx).
 *
 * The stack's swipe-back is off here: on iOS 26, react-native-screens turns
 * the system's full-screen back swipe on by default, so a left-to-right swipe
 * ANYWHERE on the page (the Mushaf's "previous page") was taken by the
 * navigation stack, which cancelled the page's own touches and began
 * returning to Home. With an RTL interface it claims right-to-left swipes
 * instead. Horizontal swipes on this screen belong to the page; the Back
 * arrow and Android's Back leave it.
 */
/**
 * The Mushaf tab's options (app/(tabs)/_layout.tsx): no tab bar, in Normal
 * Mode or full screen, so the reader keeps the whole screen and the page its
 * approved size (a tab bar under it made the page up to 11.7% narrower on
 * small iPhones). The bar returns on every other tab (components/AppTabBar.tsx).
 */
export const MUSHAF_TAB_OPTIONS = {
  tabBarStyle: { display: 'none' },
} as const;

export const MUSHAF_SCREEN_OPTIONS = {
  gestureEnabled: false,
  fullScreenGestureEnabled: false,
} as const;
