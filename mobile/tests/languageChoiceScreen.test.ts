import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The first-launch language choice (components/LanguageChoiceScreen.tsx): logo, an excerpt of Yusuf 12:100 in Arabic, its
 * reference, then العربية and English — nothing else — shown by the root layout only while no App Language is saved.
 */
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: { ios?: unknown; default?: unknown }) => values.ios ?? values.default },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
  Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
}));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@/constants/appLogo', () => ({ APP_LOGO: 1 }));

const { LanguageChoiceScreen, LANGUAGE_CHOICE_VERSE, LANGUAGE_CHOICE_VERSE_REFERENCE } = await import('@/components/LanguageChoiceScreen');
const { lightPalette } = await import('@/constants/theme');

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
const flatStyle = (style: unknown): Record<string, unknown> =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flatStyle)) : ((style as Record<string, unknown>) ?? {});

describe('LanguageChoiceScreen', () => {
  let root: ReactTestRenderer | undefined;
  const onChoose = vi.fn();

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onChoose.mockReset();
    await act(async () => { root = create(createElement(LanguageChoiceScreen, { onChoose })); });
  });
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
  });

  it('shows the exact verse (no brackets or quotes) and its reference, in Arabic', () => {
    expect(LANGUAGE_CHOICE_VERSE).toBe('إِنَّ رَبِّي لَطِيفٌ لِّمَا يَشَاءُ');
    expect(LANGUAGE_CHOICE_VERSE_REFERENCE).toBe('يوسف: ١٠٠');
    const texts = root!.root.findAll((node) => (node.type as unknown) === 'Text').map(textOf);
    expect(texts).toEqual([LANGUAGE_CHOICE_VERSE, LANGUAGE_CHOICE_VERSE_REFERENCE, 'العربية', 'English']);
    expect(texts.join('')).not.toMatch(/[﴿﴾"«»“”]/);
  });

  it('the verse is centred soft olive and wraps (no line limit); the reference is smaller', () => {
    const [verse, reference] = root!.root.findAll((node) => (node.type as unknown) === 'Text');
    const verseStyle = flatStyle(verse.props.style);
    expect(verseStyle).toMatchObject({ color: lightPalette.accent, textAlign: 'center', writingDirection: 'rtl' });
    expect(verse.props.numberOfLines).toBeUndefined();
    expect(verse.props.adjustsFontSizeToFit).toBeUndefined();
    expect(flatStyle(reference.props.style).fontSize as number).toBeLessThan(verseStyle.fontSize as number);
  });

  it('logo first, then the verse, then العربية above English with the same style', () => {
    const scroll = root!.root.findByType('ScrollView' as never);
    const [logo] = scroll.children as ReactTestInstance[];
    expect(logo.type).toBe('Image');
    const buttons = root!.root.findAll((node) => (node.type as unknown) === 'Pressable');
    expect(buttons.map((button) => button.props.testID)).toEqual(['language-choice-ar', 'language-choice-en']);
    const [ar, en] = buttons.map((button) => flatStyle(button.props.style({ pressed: false })));
    expect(ar).toEqual(en);
  });

  it('a tap chooses that language at once (no Continue step)', async () => {
    const ar = root!.root.find((node) => node.props.testID === 'language-choice-ar');
    await act(async () => ar.props.onPress());
    expect(onChoose).toHaveBeenCalledWith('ar');
    const en = root!.root.find((node) => node.props.testID === 'language-choice-en');
    await act(async () => en.props.onPress());
    expect(onChoose).toHaveBeenLastCalledWith('en');
    expect(root!.root.findAll((node) => (node.type as unknown) === 'Pressable')).toHaveLength(2);
  });

  it('always on the cream light palette, matching the native splash', () => {
    const scroll = root!.root.findByType('ScrollView' as never);
    expect(flatStyle(scroll.props.style).backgroundColor).toBe(lightPalette.background);
    const app = JSON.parse(readFileSync(resolve(__dirname, '../app.json'), 'utf8'));
    const splash = app.expo.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen')[1];
    expect(splash.backgroundColor).toBe(lightPalette.background);
  });
});

describe('root layout', () => {
  it('shows the language choice only while no App Language is saved, and saves through setLocale', () => {
    const source = readFileSync(resolve(__dirname, '../src/app/_layout.tsx'), 'utf8');
    expect(source).toContain('const needsLanguageChoice = isLocaleReady && !hasSavedLocale;');
    expect(source).toContain('{needsLanguageChoice && <LanguageChoiceScreen onChoose={setLocale} />}');
  });
});
