import type { QiblaAction } from './qiblaPresentation';

/**
 * What the /qibla screen shows (owner's UI refinements, 2026-11-07). Display switches only: the bearing is still
 * calculated and drives the needle, the turn hints and the dial's screen-reader label, and the manual-city fallback
 * (cities.ts, QiblaCityPicker.tsx, manualCityStorage.ts, the controller's chooseManualPosition) stays in the code.
 * Set either one to true to bring its part back exactly as it was.
 */

/** The "Qibla bearing · N° from true north · Measured clockwise from true north" card. */
export const SHOW_QIBLA_BEARING_CARD = false;

/**
 * The city fallback's visible parts: "Using your current location" / "Using {city}", the Choose a city and Use my
 * location buttons, and the picker. While false, a city saved on an earlier visit is NOT applied (there would be no
 * way back to the device location on screen); its stored ID is kept for when this returns.
 */
export const SHOW_QIBLA_CITY_PICKER = false;

const CITY_ACTIONS: readonly QiblaAction[] = ['chooseCity', 'useMyLocation'];

/** The presentation's actions as this screen shows them: without the city ones while the city picker is hidden. */
export function visibleQiblaActions(actions: readonly QiblaAction[], showCityPicker: boolean = SHOW_QIBLA_CITY_PICKER): QiblaAction[] {
  return showCityPicker ? [...actions] : actions.filter((action) => !CITY_ACTIONS.includes(action));
}
