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

/**
 * The reader's floating action bar (MushafControlPanel): translucent,
 * frosted-looking surfaces over the page, in the Light and the Warm Midnight
 * Olive (Dark) appearance.
 */
export const MUSHAF_PANEL_COLORS = {
  light: {
    // Sage olive (4.0:1 on the bar): the bar's icons and the reader's top icons.
    icon: '#596F49',
    // Reflection lightbulb: deep green when lit (5.9:1 on the bar), grey and unlit with no ayah selected (2.9:1).
    bulbOn: '#2F5A22',
    bulbOff: '#857F6C',
    text: '#2B2A26',
    error: '#A33A2B',
    placeholder: '#8A8578',
    onGo: '#FFFFFF',
    // The approved bar (Option A): a gently darker cream than the page (#F9EFD2), a faint edge.
    surface: { backgroundColor: '#E9DBB9', borderColor: '#DBCCA8', shadowColor: '#000000' },
    input: { backgroundColor: 'rgba(255, 255, 255, 0.9)', borderColor: 'rgba(43, 42, 38, 0.18)', color: '#231F20' },
    go: { backgroundColor: '#3E6B4B' },
    selected: { backgroundColor: 'rgba(89, 111, 73, 0.16)' },
    // The ورد selector (a small pill under the page) and its list.
    accent: '#3E6B4B',
    muted: '#6E6A5E',
    // The ورد pill keeps its own sage-green tint (not the bar's colour).
    pill: { backgroundColor: 'rgba(62, 107, 75, 0.10)', borderColor: 'rgba(62, 107, 75, 0.22)' },
    // The search sheet and the ورد list: warm cream, olive selection.
    sheet: { backgroundColor: '#FBF6E8', borderColor: 'rgba(43, 42, 38, 0.12)' },
    segments: { backgroundColor: 'rgba(43, 42, 38, 0.06)' },
    segmentSelected: { backgroundColor: '#3E6B4B' },
    onSegmentSelected: '#FFFFFF',
    divider: 'rgba(43, 42, 38, 0.10)',
    backdrop: 'rgba(20, 18, 12, 0.32)',
  },
  dark: {
    // Sage (6.4:1 on the bar): the bar's icons and the reader's top icons.
    icon: '#B5C9A9',
    // Warm ivory when lit (9.2:1 on the bar), muted grey unlit (3.2:1).
    bulbOn: '#F6E7B8',
    bulbOff: '#868B7C',
    text: '#F1E9D6',
    error: '#F0A898',
    placeholder: '#A39C88',
    onGo: '#1B2018',
    // The approved bar (Option A): a slightly lighter olive than the page (#222820).
    surface: { backgroundColor: '#343D31', borderColor: '#475243', shadowColor: '#000000' },
    input: { backgroundColor: 'rgba(20, 24, 19, 0.85)', borderColor: 'rgba(241, 233, 214, 0.2)', color: '#F1E9D6' },
    go: { backgroundColor: '#8EA68A' },
    selected: { backgroundColor: 'rgba(181, 201, 169, 0.18)' },
    accent: '#B5C9A9',
    muted: '#A39C88',
    pill: { backgroundColor: 'rgba(181, 201, 169, 0.12)', borderColor: 'rgba(181, 201, 169, 0.26)' },
    sheet: { backgroundColor: '#262C24', borderColor: 'rgba(241, 233, 214, 0.14)' },
    segments: { backgroundColor: 'rgba(241, 233, 214, 0.08)' },
    segmentSelected: { backgroundColor: '#8EA68A' },
    onSegmentSelected: '#1B2018',
    divider: 'rgba(241, 233, 214, 0.10)',
    backdrop: 'rgba(0, 0, 0, 0.5)',
  },
} as const;

/**
 * Surah heading ornament (approved design "Option A", components/SurahHeaderOrnament.tsx): deep emerald grounds, a
 * lighter emerald for leaves, warm antique gold and its deep outline. The same in both appearances (the ornament's
 * central panel opens onto the page's own paper in the dark one).
 */
export const SURAH_HEADER_INKS = {
  emerald: '#2F5E3B',
  emeraldLight: '#4F7F4E',
  gold: '#C9A34A',
  goldDeep: '#93702B',
} as const;
