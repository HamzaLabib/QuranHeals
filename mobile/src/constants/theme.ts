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
  /**
   * Secondary button (e.g. "Show/Hide Translation"): a surface distinct
   * from both the card behind it and the primary button, plus its border —
   * a weaker, secondary-weight control, never as strong as primaryButton.
   */
  secondaryButtonSurface: string;
  secondaryButtonBorder: string;
  /** Soft tinted surface for calm explanatory sections ("How this ayah connects"), and its subtle outline. */
  sageSurface: string;
  sageBorder: string;
  /** Filled heart on the sage surface: muted, a step darker than the surface. */
  sageHeart: string;
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
  // Identical to accentSoft on purpose: light mode's reveal button keeps its
  // existing plain-fill look (no visible border) — this task is dark-mode-only.
  secondaryButtonSurface: '#E9EEE4',
  secondaryButtonBorder: '#E9EEE4',
  // Final selected very-light olive/sage reference for the "How this ayah
  // connects" accordion — calm, soft, clearly distinct from the page
  // background, never beige/yellow/blue-green. Independent of darkPalette's
  // own sage values below (each theme keeps its own tuned set).
  sageSurface: '#EEF1E8',
  sageBorder: '#DCE1D6',
  sageHeart: '#6A7B57',
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
// instead of pure white — background and text stay warm, but every accent,
// secondary-surface and border token is a blue/cyan family instead of the
// light theme's olive/sage (dark mode is the only theme using blue).
// WCAG ratios (checked against card #1E2530 / background #1C1A17):
// textPrimary 12.4/14.0, textSecondary 9.8/11.1, textMuted 7.1/8.0,
// accent 8.1/9.1, danger 6.1/6.9, onPrimaryButton on primaryButton 5.1,
// onDangerFill on dangerFill 5.2.
export const darkPalette: Palette = {
  background: '#1C1A17',
  surface: '#1E2530',
  card: '#1E2530',
  sheetBackground: '#1E2530',
  inputBackground: '#171E27',
  inputBorder: '#4A5A6B',
  placeholder: '#A39A8C',
  textPrimary: '#EDE6DA',
  // Cooler/brighter than the first blue/cyan pass (was #BDB4A6/#A39A8C,
  // warm beige-gray): still clearly a muted/tertiary tone, never competing
  // with textPrimary, but reads less dull against the warm near-black
  // background — see "Quran text: Tanzil..." and "Report an issue" copy.
  textSecondary: '#C9CFD9',
  textMuted: '#A9B1BC',
  icon: '#EDE6DA',
  accent: '#7FC6E0',
  accentSoft: '#16262E',
  // A visibly distinct, bordered secondary-button surface — weaker than
  // primaryButton, but clearly lighter than the card behind it (unlike
  // accentSoft, which this button used to share with icon washes/selected
  // rows and which reads as nearly the same tone as the card).
  secondaryButtonSurface: '#2A4258',
  secondaryButtonBorder: '#4A7E98',
  // Blue-gray lift over the card surface — not the light sage reused.
  // Slightly lighter/more separated from the card than the first pass.
  sageSurface: '#2A303A',
  sageBorder: '#44617A',
  // Muted on purpose: the dark accent (#7FC6E0) reads too bright as a filled shape.
  sageHeart: '#6E8694',
  accentFill: '#146C94',
  onAccentFill: '#F5EFE4',
  primaryButton: '#146C94',
  onPrimaryButton: '#F5EFE4',
  border: '#3B4854',
  divider: '#3B4854',
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

/** Maps a device color-scheme value (the OS appearance) to an app theme; anything other than 'dark' (light, null, unspecified) stays light. */
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

