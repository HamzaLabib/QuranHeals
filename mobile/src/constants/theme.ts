import { Platform } from 'react-native';

export const colors = {
  parchment: '#F7F2EA',
  surface: '#FFFDF8',
  ink: '#1F2A24',
  muted: '#66736B',
  // Was #8B948E — only ~2.8-3.1:1 against surface/parchment, below the 4.5:1
  // WCAG AA minimum for the small (11-13px) captions this is always used
  // for (AyahCard source lines, the home disclaimer, the settings note).
  // This shade holds ~5.1-5.6:1 on both backgrounds while staying visibly
  // the softest/tertiary tone (see colors.muted for the secondary one).
  softText: '#5F6960',
  border: '#E5DED2',
  olive: '#617256',
  oliveWash: '#E9EEE4',
  // Sampled directly from the open-book/Quran shape in
  // assets/images/appicon.png (the icon's dominant dark green) — distinct
  // from `olive`, which is that same icon's smaller leaf accent, not the
  // book itself. Used for "Read in Quran" specifically.
  forest: '#19372D',
  teal: '#246A73',
  rust: '#9A4F3F',
  rustSoft: '#E7C9BF',
};

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

