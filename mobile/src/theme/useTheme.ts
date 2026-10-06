import { useColorScheme } from 'react-native';

import { paletteFor, resolveThemeName, type Palette, type ThemeName } from '@/constants/theme';

/** The app theme for the device's current appearance; re-renders when the system appearance changes. */
export function useThemeName(): ThemeName {
  return resolveThemeName(useColorScheme());
}

export function usePalette(): Palette {
  return paletteFor(useThemeName());
}

type StylesFactory<T> = (colors: Palette) => T;

const cache = new WeakMap<StylesFactory<unknown>, Partial<Record<ThemeName, unknown>>>();

/**
 * Builds (once per theme) and returns the StyleSheet produced by a
 * module-level factory. Keyed by the factory's identity, so every component
 * using the same factory shares one object per theme and style identities
 * stay stable across renders.
 */
export function getThemedStyles<T>(factory: StylesFactory<T>, theme: ThemeName): T {
  let entry = cache.get(factory as StylesFactory<unknown>);
  if (!entry) {
    entry = {};
    cache.set(factory as StylesFactory<unknown>, entry);
  }
  if (!(theme in entry)) entry[theme] = factory(paletteFor(theme));
  return entry[theme] as T;
}

export function useThemedStyles<T>(factory: StylesFactory<T>): T {
  return getThemedStyles(factory, useThemeName());
}
