import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const scheme = vi.hoisted(() => ({ current: 'light' as 'light' | 'dark' | null }));
vi.mock('react-native', () => ({
  useColorScheme: () => scheme.current,
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value },
  Pressable: 'Pressable',
}));
vi.mock('lucide-react-native', () => ({ Heart: 'Heart' }));
vi.mock('@/localization/useAppLocale', () => ({
  useAppLocale: () => ({ messages: { favoriteButton: { saveLabel: 'Save', removeLabel: 'Remove' } } }),
}));
// Appearance mode is 'system' for these tests specifically so they can
// exercise "follows the live device appearance" — the app's default is now
// Light (see appearancePreference.ts), which does NOT follow the device;
// that default is covered in appearancePreference.test.ts instead.
vi.mock('@/theme/useAppearancePreference', () => ({
  useAppearancePreference: () => ({ mode: 'system', isReady: true, setMode: vi.fn() }),
}));

import {
  darkPalette,
  lightPalette,
  navigationColorsFor,
  paletteFor,
  resolveThemeName,
  statusBarStyleFor,
  type Palette,
} from '@/constants/theme';
import { FavoriteButton } from '@/components/FavoriteButton';
import { getThemedStyles, usePalette } from '@/theme/useTheme';

const root = resolve(__dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf-8');

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

afterEach(() => {
  scheme.current = 'light';
});

describe('light palette keeps the existing Quran Heals colors', () => {
  it('maps every original color to its semantic role unchanged', () => {
    expect(lightPalette).toMatchObject({
      background: '#F7F2EA', // parchment
      surface: '#FFFDF8',
      card: '#FFFDF8',
      sheetBackground: '#FFFDF8',
      inputBackground: '#F7F2EA',
      textPrimary: '#1F2A24', // ink
      textSecondary: '#66736B', // muted
      textMuted: '#5F6960', // softText
      border: '#E5DED2',
      accent: '#617256', // olive
      accentSoft: '#E9EEE4', // oliveWash
      accentFill: '#617256',
      onAccentFill: '#FFFDF8',
      primaryButton: '#1F2A24',
      onPrimaryButton: '#FFFDF8',
      danger: '#9A4F3F', // rust
      dangerBorder: '#E7C9BF', // rustSoft
      dangerFill: '#9A4F3F',
      overlay: 'rgba(31, 42, 36, 0.45)',
      appleButton: '#1F2A24',
      onAppleButton: '#FFFDF8',
      googleButton: '#FFFDF8',
      googleButtonBorder: '#E5DED2',
      onGoogleButton: '#1F2A24',
    });
  });

  it('light and dark define exactly the same semantic tokens', () => {
    expect(Object.keys(darkPalette).sort()).toEqual(Object.keys(lightPalette).sort());
    for (const value of Object.values(darkPalette)) expect(value).toMatch(/^(#[0-9A-F]{6}|rgba\(.+\))$/);
  });
});

describe('dark palette: warm, soft, readable', () => {
  it('keeps the background and reading text warm, never pure black/white', () => {
    const n = parseInt(darkPalette.background.slice(1), 16);
    expect(darkPalette.background).not.toBe('#000000');
    // Warm, not cold blue-gray: red channel >= blue channel.
    expect(n >> 16).toBeGreaterThanOrEqual(n & 255);
    expect(darkPalette.textPrimary).not.toBe('#FFFFFF');
  });

  it('uses blue-gray (not warm olive) secondary surfaces and inputs, per the dark accent direction', () => {
    for (const token of ['surface', 'card', 'sheetBackground', 'inputBackground'] as const) {
      expect(darkPalette[token]).not.toBe('#000000');
      const n = parseInt(darkPalette[token].slice(1), 16);
      // Blue-leaning, not warm: blue channel >= red channel.
      expect(n & 255).toBeGreaterThanOrEqual(n >> 16);
    }
  });

  it('keeps every meaningful text/action pair at WCAG AA (4.5:1) or better', () => {
    const pairs: [keyof Palette, keyof Palette][] = [
      ['textPrimary', 'background'], ['textPrimary', 'card'], ['textPrimary', 'sheetBackground'], ['textPrimary', 'inputBackground'],
      ['textSecondary', 'background'], ['textSecondary', 'card'],
      ['textMuted', 'background'], ['textMuted', 'card'], ['textMuted', 'inputBackground'],
      ['placeholder', 'inputBackground'],
      ['accent', 'background'], ['accent', 'card'], ['accent', 'accentSoft'],
      ['danger', 'background'], ['danger', 'card'],
      ['onPrimaryButton', 'primaryButton'], ['onAccentFill', 'accentFill'], ['onDangerFill', 'dangerFill'],
      ['onAppleButton', 'appleButton'], ['onGoogleButton', 'googleButton'],
      ['icon', 'surface'],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrast(darkPalette[fg], darkPalette[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the Quran Arabic text (textPrimary on the ayah card) at very high contrast', () => {
    expect(contrast(darkPalette.textPrimary, darkPalette.card)).toBeGreaterThanOrEqual(12);
  });

  it('uses the Apple white button style and Google dark button theme in dark mode', () => {
    expect(darkPalette.appleButton).toBe('#FFFFFF');
    expect(darkPalette.onAppleButton).toBe('#000000');
    expect(darkPalette).toMatchObject({ googleButton: '#131314', googleButtonBorder: '#8E918F', onGoogleButton: '#E3E3E3' });
  });
});

describe('system appearance → app theme', () => {
  it('maps only an explicit dark appearance to the dark theme', () => {
    expect(resolveThemeName('dark')).toBe('dark');
    for (const value of ['light', null, undefined, 'unspecified']) expect(resolveThemeName(value)).toBe('light');
    expect(paletteFor('dark')).toBe(darkPalette);
    expect(paletteFor('light')).toBe(lightPalette);
  });

  it('uses light status-bar content in dark mode and dark content in light mode', () => {
    expect(statusBarStyleFor('dark')).toBe('light');
    expect(statusBarStyleFor('light')).toBe('dark');
  });

  it('navigation background/card match the screen background in both themes (no white flash)', () => {
    expect(navigationColorsFor('dark')).toMatchObject({ background: darkPalette.background, card: darkPalette.background, text: darkPalette.textPrimary });
    expect(navigationColorsFor('light')).toMatchObject({ background: lightPalette.background, card: lightPalette.background, text: lightPalette.textPrimary });
  });
});

describe('themed styles', () => {
  it('builds each factory once per theme and returns stable identities', () => {
    const factory = vi.fn((colors: Palette) => ({ box: { backgroundColor: colors.card } }));
    const light = getThemedStyles(factory, 'light');
    expect(getThemedStyles(factory, 'light')).toBe(light);
    const dark = getThemedStyles(factory, 'dark');
    expect(dark.box.backgroundColor).toBe(darkPalette.card);
    expect(light.box.backgroundColor).toBe(lightPalette.card);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('a shared component re-resolves its colors when the system appearance changes', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(createElement(FavoriteButton, { isSaved: true, onToggle: () => undefined }));
    });
    const styleOf = () => {
      const pressable = renderer.root.findByType('Pressable' as never);
      return Object.assign({}, ...pressable.props.style({ pressed: false }).filter(Boolean));
    };
    expect(styleOf()).toMatchObject({ backgroundColor: lightPalette.accentFill });
    expect(renderer.root.findByType('Heart' as never).props.color).toBe(lightPalette.onAccentFill);

    scheme.current = 'dark';
    act(() => renderer.update(createElement(FavoriteButton, { isSaved: true, onToggle: () => undefined })));
    expect(styleOf()).toMatchObject({ backgroundColor: darkPalette.accentFill });
    expect(renderer.root.findByType('Heart' as never).props.color).toBe(darkPalette.onAccentFill);

    act(() => renderer.update(createElement(FavoriteButton, { isSaved: false, onToggle: () => undefined })));
    expect(styleOf()).toMatchObject({ backgroundColor: darkPalette.surface, borderColor: darkPalette.border });
    expect(renderer.root.findByType('Heart' as never).props.color).toBe(darkPalette.icon);
    act(() => renderer.unmount());
  });

  it('usePalette follows useColorScheme', () => {
    let seen: Palette | undefined;
    const Probe = () => {
      seen = usePalette();
      return null;
    };
    scheme.current = 'dark';
    act(() => {
      create(createElement(Probe));
    });
    expect(seen).toBe(darkPalette);
  });
});

describe('no light-only colors left in shared components and screens', () => {
  const files = [
    ...readdirSync(resolve(root, 'src/components')).map((f) => `src/components/${f}`),
    ...readdirSync(resolve(root, 'src/app')).filter((f) => f.endsWith('.tsx')).map((f) => `src/app/${f}`),
    ...readdirSync(resolve(root, 'src/app/ayah')).map((f) => `src/app/ayah/${f}`),
  ].filter((f) => f.endsWith('.tsx'));

  it.each(files)('%s has no hard-coded color literals (brand logos excepted)', (file) => {
    const source = read(file);
    if (file.endsWith('GoogleIcon.tsx')) return; // Official multicolour Google "G" — never recolored.
    const literals = (source.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(|'(white|black)'/g) ?? [])
      // AppleIcon's default only; every caller passes a themed color.
      .filter(() => !file.endsWith('AppleIcon.tsx'));
    expect(literals).toEqual([]);
  });

  it.each(files)('%s never uses the retired single-theme color names or a static colors import', (file) => {
    const source = read(file);
    expect(source).not.toMatch(/colors\.(ink|parchment|olive|oliveWash|muted|softText|rust|rustSoft|forest|teal)\b/);
    expect(source).not.toMatch(/import \{[^}]*\bcolors\b[^}]*\} from '@\/constants\/theme'/);
    if (/\bcolors\./.test(source) && /StyleSheet\.create/.test(source)) {
      expect(source).toMatch(/= \(colors: Palette\) => StyleSheet\.create\(/);
      expect(source).toMatch(/useThemedStyles\(make\w+\)/);
    }
  });

  it('every modal sheet dims with the themed overlay', () => {
    for (const file of ['DeleteAccountSheet', 'ReflectionSheet', 'ReportIssueSheet', 'SyncPassphraseSheet']) {
      expect(read(`src/components/${file}.tsx`)).toMatch(/backgroundColor: colors\.overlay/);
    }
  });
});

describe('system UI wiring', () => {
  const layout = read('src/app/_layout.tsx');

  it('root layout drives status bar, navigation theme, stack background and native root view from the theme', () => {
    expect(layout).toMatch(/<StatusBar style=\{statusBarStyleFor\(theme\)\} \/>/);
    expect(layout).toMatch(/<ThemeProvider value=\{navigationThemes\[theme\]\}>/);
    expect(layout).toMatch(/backgroundColor: background,/);
    expect(layout).toMatch(/SystemUI\.setBackgroundColorAsync\(background\)/);
    expect(layout).not.toMatch(/#F7F2EA/);
  });

  it('app.json follows the device appearance and has a dark splash on the night background', () => {
    const config = JSON.parse(read('app.json')).expo;
    expect(config.userInterfaceStyle).toBe('automatic');
    const splash = config.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];
    expect(splash.backgroundColor).toBe(lightPalette.background);
    expect(splash.dark.backgroundColor).toBe(darkPalette.background);
  });

  it('expo-system-ui is installed (required for userInterfaceStyle "automatic" on Android)', () => {
    expect(JSON.parse(read('package.json')).dependencies['expo-system-ui']).toBeDefined();
  });
});

describe('Arabic naming for dark mode', () => {
  it('never uses non-approved Arabic names for the dark appearance; any mention uses وضع الليل', () => {
    const messages = read('src/localization/messages.ts');
    for (const banned of ['الوضع الداكن', 'المظهر الداكن', 'السمة الداكنة']) expect(messages).not.toContain(banned);
  });
});
