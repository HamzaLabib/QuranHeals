/**
 * Which orientations the app asks for, by DEVICE (never by window): phones portrait only, tablets any orientation.
 *
 * - iOS: entirely static (app.json). `orientation: "portrait"` gives the iPhone its portrait-only list, and
 *   `ios.supportsTablet` makes Expo give the iPad all four orientations (`UISupportedInterfaceOrientations~ipad`,
 *   required for iPad multitasking). Nothing is locked at runtime.
 * - Android: the manifest keeps `screenOrientation="portrait"` (app.json `orientation`), so a phone is portrait from its
 *   very first frame (the system splash included): no landscape flash before JavaScript runs. A large-screen device then
 *   asks for the system's default (follow the sensor and the user's auto-rotate setting) at runtime, which is what makes
 *   tablets on Android 15 and older rotate. Android 16+ already ignores the portrait request on large screens
 *   (sw600dp+), and the user or the manufacturer can override any request, so a lock here is a request, never a
 *   guarantee: every screen still lays itself out from its window (layout/windowClass.ts).
 *
 * The device is judged by its physical screen's shortest side (Dimensions 'screen': on Android the default display's
 * real size, unchanged by split screen or a freeform window), so a tablet's narrow split-screen window stays
 * unlocked, and a foldable is a phone folded and a tablet unfolded.
 */

/** The shortest side, in dp/pt, from which a screen is a tablet's (Android's sw600dp, the large-screen threshold). */
export const LARGE_SCREEN_MIN_SHORTEST_SIDE = 600;

export type OrientationRequest = 'portrait' | 'any';

export function isLargeScreen(screen: { width: number; height: number }): boolean {
  const shortest = Math.min(screen.width, screen.height);
  return Number.isFinite(shortest) && shortest >= LARGE_SCREEN_MIN_SHORTEST_SIDE;
}

/**
 * The runtime request for this device, or null where the platform's static configuration already decides (iOS, web).
 * An unknown size (0 × 0 before the first measurement) keeps the manifest's portrait.
 */
export function orientationRequestFor(os: string, screen: { width: number; height: number }): OrientationRequest | null {
  if (os !== 'android') return null;
  return isLargeScreen(screen) ? 'any' : 'portrait';
}
