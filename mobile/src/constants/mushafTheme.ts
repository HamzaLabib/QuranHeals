import { FIELD_COLORS } from '@/constants/fieldColors';
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
    // Reflection lightbulb unlit (no ayah selected): grey outline (2.9:1). Lit, it is filled in `saved` (4.5:1), the save button's green.
    bulbOff: '#857F6C',
    text: '#2B2A26',
    error: '#A33A2B',
    // On the cream text fields at WCAG AA (4.5:1).
    placeholder: '#6E6A60',
    onGo: '#FFFFFF',
    // The approved bar (Option A): a gently darker cream than the page (#F9EFD2), a faint edge.
    surface: { backgroundColor: '#E9DBB9', borderColor: '#DBCCA8', shadowColor: '#000000' },
    // Text fields: the app's own (fieldBackground / fieldBorder), as everywhere else.
    input: { backgroundColor: FIELD_COLORS.light.background, borderColor: FIELD_COLORS.light.border, color: '#231F20' },
    go: { backgroundColor: '#3E6B4B' },
    // The lit lightbulb's outline and rays: the palette's sage green.
    saved: '#3E6B4B',
    // The active bookmark (outline and fill, this page being the selected ورد's saved page) and the lit lightbulb's glass: bright yellow, the same in Dark Mode.
    activeFill: '#FFC000',
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
    // Lightbulb unlit: muted grey outline (3.2:1). Lit, it is filled in `saved` (4.3:1), the save button's green.
    bulbOff: '#868B7C',
    text: '#F1E9D6',
    error: '#F0A898',
    // On the dark text fields at WCAG AA (4.5:1).
    placeholder: '#A59E8A',
    onGo: '#1B2018',
    // The approved bar (Option A): a slightly lighter olive than the page (#222820).
    surface: { backgroundColor: '#343D31', borderColor: '#475243', shadowColor: '#000000' },
    input: { backgroundColor: FIELD_COLORS.dark.background, borderColor: FIELD_COLORS.dark.border, color: '#F1E9D6' },
    go: { backgroundColor: '#8EA68A' },
    // The lit lightbulb's outline and rays: the dark palette's green.
    saved: '#8EA68A',
    // The active bookmark (outline and fill) and the lit lightbulb's glass: the same bright yellow as in Light Mode.
    activeFill: '#FFC000',
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

/**
 * The traditional Surah heading's panel inks (components/SurahHeadingTraditional.tsx, the default heading;
 * mushaf/decorations.ts), with SURAH_HEADER_INKS' gold: a dark olive ground and a muted green for its florets, after
 * the reference print. SURAH_HEADER_INKS above stays as it is: the original heading and pages 1–2 use it.
 */
export const SURAH_HEADING_TRADITIONAL_INKS = {
  olive: '#46552F',
  mutedGreen: '#7C9461',
} as const;
