import { BORDER_INKS, type BorderInk } from './borderPattern';

/**
 * Reversible appearance presets for the printed Mushaf page (/mushaf).
 * Everything that can be switched lives here, and two objects pick the
 * defaults: MUSHAF_APPEARANCE_DEFAULT (Light) and MUSHAF_APPEARANCE_DARK
 * (Dark), chosen by the app's Appearance preference. Presets are never
 * edited in place; a new look is a new preset.
 *
 * The paper, the ayah-end medallions, the Quran ink, the heading colour,
 * the selection highlight and (optionally) the border's inks vary. The
 * border's pattern and geometry, the page layout and the QPC V1 glyphs are
 * the same in every preset.
 */

// ── Paper (page background) ─────────────────────────────────────────────

/**
 * The page background exactly as shipped through phase 1C: one opaque fill
 * on the page view (MushafPageView `styles.paper`), no gradient, texture or
 * overlay; the text area and the border's interior are transparent over it.
 * It is REFERENCE_COLORS.paper, sampled from the reference scan. Never change it.
 */
export const MUSHAF_BACKGROUND_ORIGINAL = { id: 'original', label: 'Original Cream', paper: '#F9F5DA' } as const;

/**
 * Proposed: a little darker and warmer, toward the aged paper of the
 * reference print, without turning yellow. In CIELAB: L 94.6, a −1.3,
 * b 15.4, between the scan's paper inside its frame (L 95.9, b 14.6) and
 * outside it (L 94.2, b 16.3); Original Cream is L 96.2, a −3.1, b 13.5
 * (lighter, slightly greener). Approved as the default in phase 2A.
 */
export const MUSHAF_BACKGROUND_WARM = { id: 'warm', label: 'Warm Cream', paper: '#F9EFD2' } as const;

/** Approved Dark Mode paper (phase 2C): Warm Midnight Olive. */
export const MUSHAF_BACKGROUND_MIDNIGHT_OLIVE = { id: 'midnight', label: 'Warm Midnight Olive', paper: '#222820' } as const;

export const MUSHAF_BACKGROUNDS = {
  original: MUSHAF_BACKGROUND_ORIGINAL,
  warm: MUSHAF_BACKGROUND_WARM,
  midnight: MUSHAF_BACKGROUND_MIDNIGHT_OLIVE,
} as const;
export type MushafBackgroundId = keyof typeof MUSHAF_BACKGROUNDS;

/**
 * What sits on the paper besides the Quran text: the surah and juz heads
 * and the page number, and the selected-ayah highlight. The light papers
 * keep the phase-1C values exactly (MUSHAF_PAPER.header, .highlight,
 * .highlightOpacity); on the dark paper the heads take the dark ink and the
 * highlight is a lighter, stronger sage, so a selection stays visible.
 */
export const MUSHAF_PAGE_FURNITURE: Readonly<Record<MushafBackgroundId, { header: string; highlight: string; highlightOpacity: number }>> = {
  original: { header: '#2B2A26', highlight: '#5B8F6A', highlightOpacity: 0.18 },
  warm: { header: '#2B2A26', highlight: '#5B8F6A', highlightOpacity: 0.18 },
  midnight: { header: '#F1E9D6', highlight: '#8EA68A', highlightOpacity: 0.3 },
};

// ── Ayah-end medallions (QPC V1 renderer) ───────────────────────────────

export type AyahMarkerColors = {
  /** Ornament outline in the top and bottom caps. */
  caps: string;
  /** Ornament outline along the sides. */
  sides: string;
  /** Fill behind the caps (between the outer oval and the inner ring), or null for none. */
  capFill: string | null;
  /** Fill of the side crescents, or null for none. */
  sideFill: string | null;
  /** Fill inside the inner ring, behind the number, or null for none. */
  innerFill: string | null;
  number: string;
};

export const MUSHAF_MARKER_STYLES = {
  /** Phase 1C: the QCF V1 font's own marker glyph, tinted green as one glyph. */
  'qpc-glyph': { id: 'qpc-glyph', label: 'QPC V1 glyph', colors: null },
  /** The Quran SVG page's medallion artwork, coloured as on that page. */
  'quran-svg': {
    id: 'quran-svg',
    label: 'Quran SVG medallion',
    colors: { caps: '#3E7D57', sides: '#3E7D57', capFill: null, sideFill: null, innerFill: null, number: '#231F20' },
  },
  /**
   * The same artwork in the reference print's colours: dark olive-brown
   * caps (the print's #635B41, its darkest quarter #41381F), mint-green
   * sides (#8DAC84), a light cream centre (#F8F3DE) and a dark number. Flat
   * bands, no gradients.
   */
  traditional: {
    id: 'traditional',
    label: 'Traditional medallion',
    colors: { caps: '#3F3723', sides: '#4E8160', capFill: '#857850', sideFill: '#9EC498', innerFill: '#FBF7E4', number: '#231F20' },
  },
} as const satisfies Record<string, { id: string; label: string; colors: AyahMarkerColors | null }>;
export type MushafMarkerStyleId = keyof typeof MUSHAF_MARKER_STYLES;

// ── Quran ink ───────────────────────────────────────────────────────────

export const MUSHAF_INKS = {
  /** Phase 1C ink (#231F20, the Quran SVG artwork's own black). */
  original: { id: 'original', label: 'Original ink', color: '#231F20' },
  /** Approved Dark Mode ink (phase 2C): warm cream on Warm Midnight Olive. Colour only; glyphs unchanged. */
  midnight: { id: 'midnight', label: 'Warm cream ink', color: '#F1E9D6' },
} as const;
export type MushafInkId = keyof typeof MUSHAF_INKS;

// ── Border inks ─────────────────────────────────────────────────────────

/**
 * The border's colours. Its pattern and geometry (borderPattern.ts) never
 * change. 'original' is the approved border exactly, in Light and Dark.
 * 'midnight' is a separately reversible alternative for Dark Mode (gold
 * rules and rhombi, sage leaves), not adopted: compare it before choosing it.
 */
export const MUSHAF_BORDER_STYLES = {
  original: { id: 'original', label: 'Original border', inks: BORDER_INKS },
  midnight: {
    id: 'midnight',
    label: 'Midnight gold and sage border',
    inks: { rule: '#A99A70', cream: '#2B3228', mint: '#3E4B3B', green: '#8EA68A', brown: '#A99A70', ochre: '#6E6548' },
  },
} as const satisfies Record<string, { id: string; label: string; inks: Readonly<Record<BorderInk, string>> }>;
export type MushafBorderStyleId = keyof typeof MUSHAF_BORDER_STYLES;

// ── Selection ───────────────────────────────────────────────────────────

export type MushafAppearance = { background: MushafBackgroundId; markers: MushafMarkerStyleId; ink: MushafInkId; border?: MushafBorderStyleId };

/** The page as approved in phase 1D (Warm Cream, traditional medallions, original ink). */
export const MUSHAF_APPEARANCE_APPROVED: MushafAppearance = { background: 'warm', markers: 'traditional', ink: 'original' };

/** The page as shipped through phase 1C (Original Cream, the font's marker glyphs): pixel-identical to it. */
export const MUSHAF_APPEARANCE_PHASE_1C: MushafAppearance = { background: 'original', markers: 'qpc-glyph', ink: 'original' };

/**
 * Approved Dark Mode (phase 2C, Warm Midnight Olive): dark paper, warm cream
 * ink, the same traditional medallions (dark number on cream) and the
 * approved border in its original colours.
 */
export const MUSHAF_APPEARANCE_DARK: MushafAppearance = { background: 'midnight', markers: 'traditional', ink: 'midnight', border: 'original' };

/**
 * The one setting: what /mushaf shows. To restore the phase-1C page, set
 * it to MUSHAF_APPEARANCE_PHASE_1C (or preview it with
 * ?background=original&markers=qpc-glyph).
 */
export const MUSHAF_APPEARANCE_DEFAULT: MushafAppearance = MUSHAF_APPEARANCE_APPROVED;

const pick = <T extends string>(value: unknown, allowed: Readonly<Record<T, unknown>>, fallback: T): T =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(allowed, value) ? (value as T) : fallback;

/**
 * The appearance for the app's theme (its Appearance preference: System,
 * Light or Dark; Light by default), with any preset named in the route's
 * search parameters for side-by-side previews (`?scheme=dark`,
 * `?background=warm&markers=traditional`, `&border=midnight`). Unknown
 * values are ignored.
 */
export function resolveMushafAppearance(params: Readonly<Record<string, unknown>> = {}, theme: 'light' | 'dark' = 'light'): MushafAppearance {
  const first = (value: unknown) => (Array.isArray(value) ? value[0] : value);
  const requested = first(params.scheme);
  const scheme = requested === 'dark' || requested === 'light' ? requested : theme;
  const base = scheme === 'dark' ? MUSHAF_APPEARANCE_DARK : MUSHAF_APPEARANCE_DEFAULT;
  return {
    background: pick(first(params.background), MUSHAF_BACKGROUNDS, base.background),
    markers: pick(first(params.markers), MUSHAF_MARKER_STYLES, base.markers),
    ink: pick(first(params.ink), MUSHAF_INKS, base.ink),
    border: pick(first(params.border), MUSHAF_BORDER_STYLES, base.border ?? 'original'),
  };
}
