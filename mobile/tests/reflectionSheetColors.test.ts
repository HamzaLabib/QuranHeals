import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGES } from '@/localization/messages';

/**
 * The reflection window's colours: the app's standard window everywhere
 * (an emotion's ayah, خواطري), and the Mushaf's own window colours only when
 * opened from the reader (ReflectionSheet's `mushaf`). Text fields use the
 * app's field colours in both.
 */
const state = vi.hoisted(() => ({
  theme: 'light' as 'light' | 'dark',
  getReflection: vi.fn(),
  saveReflection: vi.fn(),
}));
vi.mock('react-native', () => ({
  useColorScheme: () => 'light',
  Alert: { alert: vi.fn() }, Keyboard: { dismiss: vi.fn() },
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }), Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value },
  Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable',
  ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput',
  TouchableWithoutFeedback: 'TouchableWithoutFeedback', View: 'View',
}));
vi.mock('@/theme/useTheme', async () => {
  const { darkPalette, lightPalette } = await import('@/constants/theme');
  const palette = () => (state.theme === 'dark' ? darkPalette : lightPalette);
  return { usePalette: palette, useThemedStyles: (factory: (p: unknown) => unknown) => factory(palette()), useThemeName: () => state.theme };
});
vi.mock('lucide-react-native', () => ({ Trash2: 'Trash2' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: 'en', messages: MESSAGES.en }) }));
vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ status: 'guest' }) }));
vi.mock('@/storage/ayahReflections', () => ({ getReflection: state.getReflection, saveReflection: state.saveReflection, REFLECTION_MAX_LENGTH: 2000 }));
vi.mock('@/storage/reflectionConflicts', () => ({ getConflictVersionsFor: async () => [], resolveConflictVersions: async () => undefined }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/storage/localChanges', () => ({ notifyLocalChange: vi.fn() }));

const { ReflectionSheet } = await import('@/components/ReflectionSheet');
const { darkPalette, lightPalette } = await import('@/constants/theme');
const { MUSHAF_PANEL_COLORS } = await import('@/constants/mushafTheme');
const { MUSHAF_FIELD_COLORS } = await import('@/constants/fieldColors');

let root: ReactTestRenderer;
const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean)) as Record<string, unknown>;
const styleOf = (node: ReactTestInstance) => flat(typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style);
const source = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.getReflection.mockReset().mockResolvedValue(null);
  state.saveReflection.mockReset().mockResolvedValue(null);
});
afterEach(async () => { if (root) await act(async () => root.unmount()); });

async function open(mushaf?: { dark: boolean }) {
  await act(async () => { root = create(createElement(ReflectionSheet, { visible: true, verseKey: '2:286', onClose: vi.fn(), mushaf })); });
  await act(async () => { await Promise.resolve(); });
  const field = root.root.findByType('TextInput' as never);
  const button = (label: string) => root.root.findAllByType('Pressable' as never).find((node) => node.findAllByType('Text' as never).some((t) => t.props.children === label))!;
  const colours = new Set(root.root.findAll((node) => typeof node.type === 'string').flatMap((node) => {
    const style = styleOf(node);
    return [style.backgroundColor, style.color, style.borderColor, node.props.placeholderTextColor].filter((value): value is string => typeof value === 'string');
  }));
  const sheet = root.root.findAll((node) => typeof node.type === 'string' && styleOf(node).borderTopLeftRadius !== undefined)[0];
  return { field, save: button(MESSAGES.en.reflection.save), cancel: button(MESSAGES.en.reflection.cancel), colours, sheet };
}

describe('the reflection window from an emotion`s ayah (and خواطري): the app`s standard window, unchanged', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: the app palette's window, text and buttons; no Mushaf colour anywhere; the field in the app's field colours`, async () => {
      state.theme = theme;
      const palette = theme === 'dark' ? darkPalette : lightPalette;
      const { field, save, cancel, colours, sheet } = await open();
      expect(styleOf(sheet).backgroundColor).toBe(palette.sheetBackground);
      expect(styleOf(save).backgroundColor).toBe(palette.primaryButton);
      expect(styleOf(save.findByType('Text' as never)).color).toBe(palette.onPrimaryButton);
      expect(styleOf(cancel)).toMatchObject({ backgroundColor: palette.surface, borderColor: palette.border });
      expect(styleOf(field)).toMatchObject({ backgroundColor: palette.fieldBackground, borderColor: palette.fieldBorder, color: palette.textPrimary });
      expect(field.props.placeholderTextColor).toBe(palette.placeholder);
      // Every colour drawn is one of the app palette's own.
      const appColours = new Set(Object.values(palette));
      for (const colour of colours) expect(appColours.has(colour), colour).toBe(true);
      const panel = MUSHAF_PANEL_COLORS[theme];
      for (const colour of [panel.sheet.backgroundColor, panel.text, panel.go.backgroundColor, panel.backdrop]) expect(colours.has(colour), colour).toBe(false);
    });
  }

  it('only the Mushaf passes `mushaf`: the emotion screen and خواطري open it as before', () => {
    expect(source('src/app/(tabs)/mushaf.tsx')).toMatch(/<ReflectionSheet[\s\S]*?mushaf=\{\{ dark \}\}[\s\S]*?\/>/);
    for (const path of ['src/components/AyahExperience.tsx', 'src/app/(tabs)/reflections.tsx']) {
      const use = source(path).match(/<ReflectionSheet[\s\S]*?\/>/)![0];
      expect(use, path).not.toMatch(/mushaf/);
    }
  });
});

describe('the reflection window from the Mushaf: the reader`s own window colours', () => {
  for (const dark of [false, true]) {
    it(`${dark ? 'dark' : 'light'}: the Mushaf sheet, text, divider, Save and backdrop colours; the field in the reader's own field colours`, async () => {
      // The app theme agrees with the page (the reader follows it); the sheet follows the page.
      state.theme = dark ? 'dark' : 'light';
      const panel = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
      const app = dark ? darkPalette : lightPalette;
      const { field, save, cancel, colours, sheet } = await open({ dark });
      expect(styleOf(sheet).backgroundColor).toBe(panel.sheet.backgroundColor);
      expect(styleOf(save).backgroundColor).toBe(panel.go.backgroundColor);
      expect(styleOf(save.findByType('Text' as never)).color).toBe(panel.onGo);
      expect(styleOf(cancel)).toMatchObject({ backgroundColor: panel.sheet.backgroundColor, borderColor: panel.surface.borderColor });
      expect(styleOf(cancel.findByType('Text' as never)).color).toBe(panel.text);
      expect(colours.has(panel.backdrop)).toBe(true);
      // The field: the reader's own field colours (as its search and ورد fields; unchanged when the app's fields took the
      // option-row surface), the Mushaf's text and placeholder.
      expect(styleOf(field)).toMatchObject({ backgroundColor: MUSHAF_FIELD_COLORS[dark ? 'dark' : 'light'].background, borderColor: MUSHAF_FIELD_COLORS[dark ? 'dark' : 'light'].border, color: panel.text });
      expect(styleOf(field)).toMatchObject({ backgroundColor: panel.input.backgroundColor, borderColor: panel.input.borderColor });
      expect(field.props.placeholderTextColor).toBe(panel.placeholder);
      // None of the app window's own surfaces remain (no stray white or blue-slate).
      for (const colour of [app.sheetBackground, app.primaryButton, app.overlay]) expect(colours.has(colour), colour).toBe(false);
    });
  }

  it('writing and saving work as before', async () => {
    state.theme = 'dark';
    const { field } = await open({ dark: true });
    await act(async () => { field.props.onChangeText('A note'); });
    const save = root.root.findAllByType('Pressable' as never).find((node) => node.findAllByType('Text' as never).some((t) => t.props.children === MESSAGES.en.reflection.save))!;
    await act(async () => { await save.props.onPress(); });
    expect(state.saveReflection).toHaveBeenCalledExactlyOnceWith('2:286', 'A note');
  });
});
