import { Platform } from 'react-native';

export const colors = {
  parchment: '#F7F2EA',
  surface: '#FFFDF8',
  ink: '#1F2A24',
  muted: '#66736B',
  softText: '#8B948E',
  border: '#E5DED2',
  olive: '#617256',
  oliveWash: '#E9EEE4',
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

export const radii = {
  sm: 8,
  md: 8,
  lg: 8,
  full: 999,
};

export const typography = {
  caption: 13,
  small: 12,
  body: 16,
  bodyLarge: 18,
  title: 34,
  arabic: 34,
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

