import { REFERENCE_COLORS } from '@/mushaf/pageGeometry';

/**
 * Colours of the printed Mushaf page in the /mushaf prototype, sampled from
 * the reference print (see mushaf/pageGeometry.ts): the Light Mode
 * (phase 1C) values. Which colours a page actually uses, in Light and Dark,
 * is chosen in mushaf/appearance.ts.
 */
export const MUSHAF_PAPER = {
  /** Original Cream. The page background itself is chosen in mushaf/appearance.ts (MUSHAF_BACKGROUND_ORIGINAL holds this exact value). */
  paper: REFERENCE_COLORS.paper,
  /** The SVG's own ink colour; the Quran text is never recoloured. */
  ink: '#231F20',
  /** Ayah-number medallion ornaments (tintAyahMarkers). */
  marker: '#3E7D57',
  /** Both brown border rules. */
  rule: REFERENCE_COLORS.rule,
  header: '#2B2A26',
  /** Selected-ayah highlight, drawn over the page at low opacity. */
  highlight: '#5B8F6A',
  highlightOpacity: 0.18,
} as const;
