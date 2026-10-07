import { useColorScheme } from 'react-native';

import { paletteFor, resolveThemeName, type Palette, type ThemeName } from '@/constants/theme';
import { useAppearancePreference } from './useAppearancePreference';

/**
 * The app theme to render, from the user's saved Appearance preference
 * (default: Light — see appearancePreference.ts). 'system' follows the
 * device color scheme and re-renders live when it changes; 'light'/'dark'
 * force that theme regardless of the device appearance. This is the ONLY
 * place device appearance (useColorScheme) is read — every screen should go
 * through this hook (via usePalette/useThemedStyles) rather than calling
 * useColorScheme directly, so the saved preference is never bypassed.
 */
export function useThemeName(): ThemeName {
  const { mode } = useAppearancePreference();
  const deviceScheme = useColorScheme();
  return mode === 'system' ? resolveThemeName(deviceScheme) : mode;
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
