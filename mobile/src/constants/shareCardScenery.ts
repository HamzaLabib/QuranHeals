import type { ShareCardTheme } from './shareCardThemes';

/**
 * Share Studio "Scenery" backgrounds: bundled nature photographs (Unsplash
 * License), 1080 x 1920 JPEGs in assets/share-backgrounds/scenery/, drawn
 * under a translucent cream overlay so the card text stays readable. Nothing
 * is fetched at runtime.
 *
 * The photographs, their sources and their overlay strengths are produced by
 * tools/share-backgrounds/build_scenery.py and recorded in
 * docs/share-backgrounds/scenery-manifest.json. Each overlayOpacity is the
 * weakest cream wash that keeps the Arabic and translation ink at >= 7:1 and
 * the reference / branding ink at >= 4.5:1 over that photo's text area
 * (tests/shareCardScenery.test.ts checks these values against the manifest).
 * The image files themselves are required in shareCardSceneryImages.ts.
 */
export type ShareCardSceneryId =
  | 'misty-valley-sunrise'
  | 'alpine-lake'
  | 'foggy-rolling-hills'
  | 'golden-mountain-sunset'
  | 'forest-sunbeams'
  | 'mossy-forest-path'
  | 'morning-meadow'
  | 'olive-grove'
  | 'ocean-horizon'
  | 'turquoise-shoreline'
  | 'mountain-lake-reflection'
  | 'fern-waterfall'
  | 'golden-dunes'
  | 'pastel-desert-sky'
  | 'soft-clouds'
  | 'earth-tone-horizon'
  | 'wildflower-meadow'
  | 'white-blossoms'
  | 'lavender-field'
  | 'garden-path'
  | 'pink-sakura'
  | 'sakura-sky'
  | 'pink-roses'
  | 'autumn-forest-path'
  | 'autumn-lake'
  | 'golden-autumn-valley'
  | 'sakura-pathway'
  | 'sakura-canopy'
  | 'sakura-lake'
  | 'maple-path'
  | 'golden-riverbank'
  | 'autumn-mountains'
  | 'snowy-forest-path'
  | 'snowy-mountain-valley'
  | 'winter-lake'
  | 'snowy-pines'
  | 'fresh-snowfall'
  | 'winter-dawn';

export type ShareCardScenery = {
  id: ShareCardSceneryId;
  /** Cream wash over the text area, 0–1. */
  overlayOpacity: number;
};

export const SHARE_CARD_SCENERY: readonly ShareCardScenery[] = [
  { id: 'misty-valley-sunrise', overlayOpacity: 0.69 },
  { id: 'alpine-lake', overlayOpacity: 0.69 },
  { id: 'foggy-rolling-hills', overlayOpacity: 0.7 },
  { id: 'golden-mountain-sunset', overlayOpacity: 0.68 },
  { id: 'forest-sunbeams', overlayOpacity: 0.7 },
  { id: 'mossy-forest-path', overlayOpacity: 0.72 },
  { id: 'morning-meadow', overlayOpacity: 0.72 },
  { id: 'olive-grove', overlayOpacity: 0.71 },
  { id: 'ocean-horizon', overlayOpacity: 0.61 },
  { id: 'turquoise-shoreline', overlayOpacity: 0.65 },
  { id: 'mountain-lake-reflection', overlayOpacity: 0.73 },
  { id: 'fern-waterfall', overlayOpacity: 0.73 },
  { id: 'golden-dunes', overlayOpacity: 0.6 },
  { id: 'pastel-desert-sky', overlayOpacity: 0.7 },
  { id: 'soft-clouds', overlayOpacity: 0.45 },
  { id: 'earth-tone-horizon', overlayOpacity: 0.69 },
  { id: 'wildflower-meadow', overlayOpacity: 0.72 },
  { id: 'white-blossoms', overlayOpacity: 0.64 },
  { id: 'lavender-field', overlayOpacity: 0.65 },
  { id: 'garden-path', overlayOpacity: 0.71 },
  { id: 'pink-sakura', overlayOpacity: 0.7 },
  { id: 'sakura-sky', overlayOpacity: 0.45 },
  { id: 'pink-roses', overlayOpacity: 0.71 },
  { id: 'autumn-forest-path', overlayOpacity: 0.71 },
  { id: 'autumn-lake', overlayOpacity: 0.7 },
  { id: 'golden-autumn-valley', overlayOpacity: 0.72 },
  { id: 'sakura-pathway', overlayOpacity: 0.7 },
  { id: 'sakura-canopy', overlayOpacity: 0.72 },
  { id: 'sakura-lake', overlayOpacity: 0.64 },
  { id: 'maple-path', overlayOpacity: 0.72 },
  { id: 'golden-riverbank', overlayOpacity: 0.68 },
  { id: 'autumn-mountains', overlayOpacity: 0.73 },
  { id: 'snowy-forest-path', overlayOpacity: 0.49 },
  { id: 'snowy-mountain-valley', overlayOpacity: 0.68 },
  { id: 'winter-lake', overlayOpacity: 0.71 },
  { id: 'snowy-pines', overlayOpacity: 0.68 },
  { id: 'fresh-snowfall', overlayOpacity: 0.69 },
  { id: 'winter-dawn', overlayOpacity: 0.71 },
];

const BY_ID = new Map(SHARE_CARD_SCENERY.map((scenery) => [scenery.id, scenery]));

export function sceneryById(id: ShareCardSceneryId): ShareCardScenery {
  return BY_ID.get(id)!;
}

/** The overlay's colour: the app's parchment (lightPalette.background / the Cream card). */
export const SHARE_CARD_SCENERY_OVERLAY_COLOR = '#F7F2EA';

/**
 * Outside the text area (the Story card's top and bottom margins, the frame
 * inset) the wash fades to this much weaker strength, so the photograph
 * shows most clearly at the card's edges.
 */
export function sceneryEdgeOpacity(overlayOpacity: number): number {
  return Math.max(0.3, Math.round((overlayOpacity - 0.3) * 100) / 100);
}

/**
 * Text colours on every Scenery card: the darkest inks of the Cream and Sage
 * themes, which the overlay strengths above were computed for. `background`
 * is what shows while the photograph is still loading.
 */
export const SCENERY_CARD_THEME: ShareCardTheme = {
  background: SHARE_CARD_SCENERY_OVERLAY_COLOR,
  frame: 'rgba(255, 253, 248, 0.85)',
  arabic: '#1F2A24',
  translation: '#1F2A24',
  reference: '#2D3826',
  branding: '#2D3826',
  divider: '#617256',
};

/**
 * A Scenery background chosen at random, never `current`: the first pick of a
 * session (current = null) may be any photograph; "New Background" always
 * shows a different one.
 */
export function pickScenery(current: ShareCardSceneryId | null, random: () => number = Math.random): ShareCardSceneryId {
  const choices = SHARE_CARD_SCENERY.filter((scenery) => scenery.id !== current);
  const index = Math.min(Math.floor(random() * choices.length), choices.length - 1);
  return choices[Math.max(index, 0)].id;
}
