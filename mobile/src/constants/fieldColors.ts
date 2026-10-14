/**
 * The surface of unselected option rows and other controls (inputBackground in
 * constants/theme.ts: Report an Issue's categories, segmented choices). Since
 * 2026-10-14 every editable text field in the app uses it too, so fields and
 * the option rows beside them read as one family.
 */
export const OPTION_SURFACE = { light: '#F7F2EA', dark: '#171E27' } as const;

/**
 * Every editable text field's surface and border in the app, in Light and Dark:
 * the option-row surface above, with a quiet border of its own. One source for
 * the app palette (fieldBackground / fieldBorder in constants/theme.ts). Fields
 * sit on sheets (sheetBackground), from which this surface stands apart; the
 * border separates them from everything else. No React Native import, so
 * constants can use it.
 */
export const FIELD_COLORS = {
  light: { background: OPTION_SURFACE.light, border: '#E5DCCF' },
  dark: { background: OPTION_SURFACE.dark, border: '#494A47' },
} as const;

/**
 * The Mushaf reader's own text fields (search, ورد name in its panel): unchanged,
 * on its approved cream and olive panels (MUSHAF_PANEL_COLORS), whose palette is
 * its own rather than the app's.
 */
export const MUSHAF_FIELD_COLORS = {
  light: { background: '#F3EBDD', border: '#E5DCCF' },
  dark: { background: '#33363A', border: '#494A47' },
} as const;
