import { darkPalette, lightPalette } from './theme';

/**
 * Background themes for shareable ayah image cards. Independent of the
 * app's own light/dark appearance: a card looks the same whichever
 * appearance the sharer uses. Built from the app palette where a token
 * fits; WCAG contrast of every text color against its background is
 * checked in tests/shareCardLayout.test.ts.
 */
export type ShareCardThemeName = 'sage' | 'cream' | 'dark';

export const SHARE_CARD_THEMES_ORDER: readonly ShareCardThemeName[] = ['sage', 'cream', 'dark'];

export const DEFAULT_SHARE_CARD_THEME: ShareCardThemeName = 'sage';

export type ShareCardTheme = {
  background: string;
  /** Hairline inset frame. Decorative only. */
  frame: string;
  /** Quran Arabic. */
  arabic: string;
  translation: string;
  /** Surah reference and page indicator. */
  reference: string;
  /** Wordmark and attribution lines. */
  branding: string;
  /** Short rule between the Arabic and the translation. */
  divider: string;
};

export const SHARE_CARD_THEMES: Record<ShareCardThemeName, ShareCardTheme> = {
  // Warm sage / olive, dark olive text.
  sage: {
    background: '#DCE2CF',
    frame: '#B8C3A6',
    arabic: '#25301F',
    translation: '#2D3826',
    reference: '#3E4C34',
    branding: '#4A5740',
    divider: lightPalette.accent,
  },
  // The app's own parchment.
  cream: {
    background: lightPalette.background,
    frame: lightPalette.border,
    arabic: lightPalette.textPrimary,
    translation: lightPalette.textPrimary,
    reference: lightPalette.accent,
    branding: lightPalette.textMuted,
    divider: lightPalette.accent,
  },
  // Deep slate, warm off-white text.
  dark: {
    background: darkPalette.card,
    frame: darkPalette.border,
    arabic: darkPalette.textPrimary,
    translation: darkPalette.textPrimary,
    reference: darkPalette.textSecondary,
    branding: darkPalette.textMuted,
    divider: darkPalette.secondaryButtonBorder,
  },
};
