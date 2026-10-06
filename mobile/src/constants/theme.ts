import { Platform } from 'react-native';

/**
 * Semantic color tokens. Components read these through useThemedStyles() /
 * usePalette() (see src/theme/useTheme.ts) so the device's light/dark
 * appearance is resolved in one place instead of per-component conditionals.
 */
export type Palette = {
  /** Screen background. */
  background: string;
  /** Neutral (outline) buttons and small chrome on top of the background. */
  surface: string;
  /** Content cards (ayah, emotion, reflection, state views). */
  card: string;
  /** Modal / bottom-sheet body. */
  sheetBackground: string;
  inputBackground: string;
  inputBorder: string;
  placeholder: string;
  /** Primary reading text — also the Quran Arabic ayah. */
  textPrimary: string;
  textSecondary: string;
  /** Softest readable tone (captions, notes, source lines). */
  textMuted: string;
  /** Default glyph color for neutral icons. */
  icon: string;
  /** Accent used as text/icon color. */
  accent: string;
  /** Tinted wash behind accent icons and selected rows. */
  accentSoft: string;
  /** Accent used as a filled background (e.g. a saved favorite). */
  accentFill: string;
  onAccentFill: string;
  /** Main call-to-action fill and its label/icon color. */
  primaryButton: string;
  onPrimaryButton: string;
  border: string;
  divider: string;
  /** Destructive text/icon/outline color. */
  danger: string;
  dangerBorder: string;
  /** Destructive filled button and its label color. */
  dangerFill: string;
  onDangerFill: string;
  /** Dim layer behind modal sheets. */
  overlay: string;
  /** Sign in with Apple: black style in light, white style in dark (Apple HIG). */
  appleButton: string;
  onAppleButton: string;
  /** Sign in with Google: Google's light / dark button themes; the logo keeps its brand colors. */
  googleButton: string;
  googleButtonBorder: string;
  onGoogleButton: string;
};

// Unchanged from the original single light palette (parchment/ink/olive/
// rust); each value is listed under the semantic role it already played.
export const lightPalette: Palette = {
  background: '#F7F2EA',
  surface: '#FFFDF8',
  card: '#FFFDF8',
  sheetBackground: '#FFFDF8',
  inputBackground: '#F7F2EA',
  inputBorder: '#E5DED2',
  placeholder: '#66736B',
  textPrimary: '#1F2A24',
  textSecondary: '#66736B',
  // Was #8B948E — only ~2.8-3.1:1 against surface/parchment, below the 4.5:1
  // WCAG AA minimum for the small (11-13px) captions this is always used
  // for (AyahCard source lines, the home disclaimer, the settings note).
  // This shade holds ~5.1-5.6:1 on both backgrounds while staying visibly
  // the softest/tertiary tone (see textSecondary for the secondary one).
  textMuted: '#5F6960',
  icon: '#1F2A24',
  accent: '#617256',
  accentSoft: '#E9EEE4',
  accentFill: '#617256',
  onAccentFill: '#FFFDF8',
  primaryButton: '#1F2A24',
  onPrimaryButton: '#FFFDF8',
  border: '#E5DED2',
  divider: '#E5DED2',
  danger: '#9A4F3F',
  dangerBorder: '#E7C9BF',
  dangerFill: '#9A4F3F',
  onDangerFill: '#FFFDF8',
  overlay: 'rgba(31, 42, 36, 0.45)',
  appleButton: '#1F2A24',
  onAppleButton: '#FFFDF8',
  googleButton: '#FFFDF8',
  googleButtonBorder: '#E5DED2',
  onGoogleButton: '#1F2A24',
};

// Warm night palette: deep warm charcoal instead of black, warm off-white
// instead of pure white, and the same olive family lifted for contrast.
// WCAG ratios (checked against card #26231F / background #1C1A17):
// textPrimary 12.6/14.0, textSecondary 7.6/8.5, textMuted 5.6/6.3,
// accent 7.3/8.1, danger 6.2/6.9, onPrimaryButton on primaryButton 4.8,
// onDangerFill on dangerFill 5.2.
export const darkPalette: Palette = {
  background: '#1C1A17',
  surface: '#26231F',
  card: '#26231F',
  sheetBackground: '#26231F',
  inputBackground: '#1F1D1A',
  inputBorder: '#4A443C',
  placeholder: '#A39A8C',
  textPrimary: '#EDE6DA',
  textSecondary: '#BDB4A6',
  textMuted: '#A39A8C',
  icon: '#EDE6DA',
  accent: '#A7B78F',
  accentSoft: '#2F3529',
  accentFill: '#5E6E52',
  onAccentFill: '#F5EFE4',
  primaryButton: '#5E6E52',
  onPrimaryButton: '#F5EFE4',
  border: '#3A352F',
  divider: '#3A352F',
  danger: '#E08E7B',
  dangerBorder: '#5A3A32',
  dangerFill: '#9A4F3F',
  onDangerFill: '#F5EFE4',
  overlay: 'rgba(10, 9, 7, 0.62)',
  appleButton: '#FFFFFF',
  onAppleButton: '#000000',
  googleButton: '#131314',
  googleButtonBorder: '#8E918F',
  onGoogleButton: '#E3E3E3',
};

export type ThemeName = 'light' | 'dark';

/** Maps the device appearance (useColorScheme()) to an app theme; anything other than 'dark' (light, null, unspecified) stays light. */
export function resolveThemeName(scheme: string | null | undefined): ThemeName {
  return scheme === 'dark' ? 'dark' : 'light';
}

export function paletteFor(theme: ThemeName): Palette {
  return theme === 'dark' ? darkPalette : lightPalette;
}

/** expo-status-bar style: dark glyphs on the light parchment, light glyphs on the night background. */
export function statusBarStyleFor(theme: ThemeName): 'light' | 'dark' {
  return theme === 'dark' ? 'light' : 'dark';
}

/**
 * React Navigation theme colors. Matching the screen background here (and
 * in the Stack's contentStyle / the native root view) keeps transitions
 * from flashing the library's white or black defaults.
 */
export function navigationColorsFor(theme: ThemeName) {
  const palette = paletteFor(theme);
  return {
    primary: palette.accent,
    background: palette.background,
    card: palette.background,
    text: palette.textPrimary,
    border: palette.border,
    notification: palette.danger,
  };
}


export const spacing = {
  xs: 4,
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  xxl: 40,
};

// A real small/medium/large progression (previously all 8, i.e. no visual
// hierarchy despite being used semantically as such — see EmotionCard,
// AyahCard, StateView, settings, FavoriteButton). Softer/larger corners read
// calmer and warmer, matching this app's intended tone.
export const radii = {
  sm: 10,
  md: 16,
  lg: 22,
  full: 999,
};

export const typography = {
  caption: 13,
  small: 12,
  body: 16,
  bodyLarge: 18,
  title: 34,
  // Used only by AyahCard's normal Quran Arabic display (see
  // AyahCard.tsx's `arabic` style for its paired lineHeight) — never by
  // unrelated Arabic UI text, which uses body/bodyLarge/title instead.
  arabic: 30,
};

export const shadows = {
  soft: Platform.select({
    ios: {
      shadowColor: '#1F2A24',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.08,
      shadowRadius: 18,
    },
    android: {
      elevation: 2,
    },
    default: {
      boxShadow: '0 12px 28px rgba(31, 42, 36, 0.08)',
    },
  }),
};

