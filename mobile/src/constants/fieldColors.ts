/**
 * Every editable text field's surface and border, in Light and Dark: a soft
 * warm cream (Light) and a softly lighter dark surface (Dark), each a little
 * apart from the windows around them. One source for the app palette
 * (fieldBackground / fieldBorder in constants/theme.ts) and the Mushaf's own
 * fields (MUSHAF_PANEL_COLORS); no React Native import, so both can use it.
 */
export const FIELD_COLORS = {
  light: { background: '#F3EBDD', border: '#E5DCCF' },
  dark: { background: '#33363A', border: '#494A47' },
} as const;
