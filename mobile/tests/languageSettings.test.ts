import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement, type ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three language settings (docs/localization/quran-language.md):
 * App Language (interface, en/ar), Emotions Language (emotion names and
 * the "How this ayah connects" body: follow/en/ar/ar-EG), and Quran
 * Language (one mode today). Real providers over an in-memory AsyncStorage.
 */
const state = vi.hoisted(() => ({ storage: new Map<string, string>() }));

vi.mock('expo-router', () => ({ router: { navigate: () => undefined, back: () => undefined, push: () => undefined } }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: { ios?: unknown; default?: unknown }) => values.ios ?? values.default },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 0.5 },
  Pressable: 'Pressable', Text: 'Text', View: 'View',
  Linking: { openURL: vi.fn(async () => undefined) },
  useColorScheme: () => 'light',
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { state.storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { state.storage.delete(key); }),
  },
}));
// Every icon the rendered components import, as a plain string element.
vi.mock('lucide-react-native', async () => {
  const { readFileSync: read } = await import('node:fs');
  const { resolve: path } = await import('node:path');
  const names = new Set<string>();
  for (const file of ['utils/emotionIcons.ts', 'components/EmotionCard.tsx', 'components/AyahCard.tsx', 'components/AyahConnectionAccordion.tsx']) {
    const source = read(path(__dirname, '../src', file), 'utf-8');
    for (const [, list] of source.matchAll(/import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*'lucide-react-native'/g)) {
      for (const name of list.split(',')) if (name.trim()) names.add(name.trim().split(/\s+as\s+/)[0]);
    }
  }
  return Object.fromEntries([...names].map((name) => [name, name]));
});
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette, useThemedStyles: (factory: (colors: unknown) => unknown) => factory(lightPalette), useThemeName: () => 'light' };
});
vi.mock('@/theme/useAppearancePreference', () => ({ useAppearancePreference: () => ({ mode: 'system', isReady: true, setMode: vi.fn() }) }));
vi.mock('@/localization/useQuranFontSizePreference', () => ({ useQuranFontSizePreference: () => ({ preferredSize: 26 }) }));
vi.mock('@/components/QuranFontSizeControls', () => ({ QuranFontSizeControls: 'QuranFontSizeControls' }));

const { AppLocaleProvider } = await import('@/localization/useAppLocale');
const { EmotionsLanguageProvider } = await import('@/localization/useEmotionsLanguage');
const { EmotionCard } = await import('@/components/EmotionCard');
const { AyahConnectionAccordion } = await import('@/components/AyahConnectionAccordion');
const { AyahCard } = await import('@/components/AyahCard');
const { MESSAGES } = await import('@/localization/messages');
const { resolveEmotionLocale, migrateLegacyAppLanguage } = await import('@/localization/emotionsLanguage');
const { resolveConnectionText } = await import('@/utils/ayahConnection');
const { AYAH_SCREEN_TRANSLATION_MODE, parseQuranTranslationPreference } = await import('@/localization/quranTranslationPreference');
const { QuranTranslationPreferenceProvider } = await import('@/localization/useQuranTranslationPreference');
type Emotion = import('@/types/domain').Emotion;
type LocalizedText = import('@/types/domain').LocalizedText;

const APP_KEY = 'quran-heals:app-locale:v1';
const EMOTIONS_KEY = 'quran-heals:emotions-language:v1';
const TRANSLATION_KEY = 'quran-heals:quran-translation-preference:v1';

/** The 30 catalog emotions, read from the backend's source of truth (as emotionCatalogCoverage.test.ts does). */
function catalog(): Emotion[] {
  const source = readFileSync(resolve(__dirname, '../../backend/src/emotions/emotionCatalog.ts'), 'utf-8');
  const pattern = /key: '([a-z_]+)',\s*\n\s*names: \{ en: '([^']+)', ar: '([^']+)', 'ar-EG': '([^']+)' \}/g;
  return [...source.matchAll(pattern)].map(([, key, en, ar, arEG], index) => ({
    id: key, key, names: { en, ar, 'ar-EG': arEG } as LocalizedText, descriptions: { en: '', ar: '', 'ar-EG': '' } as LocalizedText,
    name: en, arabicName: ar, description: '', icon: 'heart', order: index, active: true,
  }));
}

let root: ReactTestRenderer | undefined;
async function render(element: ReactElement) {
  await act(async () => {
    root = create(createElement(AppLocaleProvider, null, createElement(EmotionsLanguageProvider, null, element)));
  });
  await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
}
const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(5).filter(Boolean));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.storage.clear();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
});

describe('Emotions Language resolution', () => {
  it('follow → the App Language (English → English, Arabic → MSA); an explicit choice is independent of it', () => {
    expect(resolveEmotionLocale('follow', 'en')).toBe('en');
    expect(resolveEmotionLocale('follow', 'ar')).toBe('ar');
    for (const app of ['en', 'ar'] as const) {
      for (const choice of ['en', 'ar', 'ar-EG'] as const) expect(resolveEmotionLocale(choice, app)).toBe(choice);
    }
  });

  it('"How this ayah connects": English and Arabic texts; Egyptian Arabic shows the approved Arabic (MSA) text — never invented, never English', () => {
    const connection = { emotionKey: 'sad', en: 'English explanation', ar: 'شرح بالعربية' };
    expect(resolveConnectionText(connection, 'sad', 'en')).toBe('English explanation');
    expect(resolveConnectionText(connection, 'sad', 'ar')).toBe('شرح بالعربية');
    expect(resolveConnectionText(connection, 'sad', 'ar-EG')).toBe('شرح بالعربية');
    expect(resolveConnectionText({ emotionKey: 'sad', en: 'only English' }, 'sad', 'ar-EG')).toBeNull();
  });
});

describe('mixed-language rendering: all 30 emotions', () => {
  const emotions = catalog();
  const combos = [
    { app: 'en', emotions: 'en', expected: 'en' },
    { app: 'en', emotions: 'ar', expected: 'ar' },
    { app: 'en', emotions: 'ar-EG', expected: 'ar-EG' },
    { app: 'ar', emotions: 'en', expected: 'en' },
    { app: 'ar', emotions: 'ar-EG', expected: 'ar-EG' },
    { app: 'en', emotions: null, expected: 'en' },
    { app: 'ar', emotions: null, expected: 'ar' },
  ] as const;

  it('the catalog has the 30 approved emotions', () => {
    expect(emotions).toHaveLength(30);
  });

  for (const combo of combos) {
    it(`App ${combo.app} + Emotions ${combo.emotions ?? 'follow'}: every name in ${combo.expected}, in its own direction`, async () => {
      state.storage.set(APP_KEY, combo.app);
      if (combo.emotions) state.storage.set(EMOTIONS_KEY, combo.emotions);
      await render(createElement('View', null, ...emotions.map((emotion) => createElement(EmotionCard, { key: emotion.key, emotion, onPress: () => {} }))));
      const names = root!.root.findAll((node) => String(node.type) === 'Text');
      expect(names.map((node) => node.props.children)).toEqual(emotions.map((emotion) => emotion.names[combo.expected]));
      const rtl = combo.expected !== 'en';
      for (const node of names) expect(styleOf(node)).toMatchObject({ writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' });
    });
  }

  it('"How this ayah connects": the heading follows the App Language, the body the Emotions Language — each in its own direction', async () => {
    state.storage.set(APP_KEY, 'en');
    state.storage.set(EMOTIONS_KEY, 'ar-EG');
    const connection = { emotionKey: 'sad', en: 'English explanation', ar: 'شرح بالعربية' };
    await render(createElement(AyahConnectionAccordion, { text: resolveConnectionText(connection, 'sad', 'ar-EG')!, resetKey: 1 }));
    const header = root!.root.findAll((node) => String(node.type) === 'Pressable')[0];
    expect(header.props.accessibilityLabel).toBe(MESSAGES.en.ayah.connectionHeading);
    await act(async () => header.props.onPress());
    const texts = root!.root.findAll((node) => String(node.type) === 'Text');
    const heading = texts.find((node) => node.props.children === MESSAGES.en.ayah.connectionHeading)!;
    const body = texts.find((node) => node.props.children === 'شرح بالعربية')!;
    expect(styleOf(heading).writingDirection).toBe('ltr');
    expect(styleOf(body)).toMatchObject({ writingDirection: 'rtl', textAlign: 'right' });
  });

  it('an Arabic interface with English emotions: the English body reads left to right', async () => {
    state.storage.set(APP_KEY, 'ar');
    state.storage.set(EMOTIONS_KEY, 'en');
    await render(createElement(AyahConnectionAccordion, { text: 'English explanation', resetKey: 1 }));
    const header = root!.root.findAll((node) => String(node.type) === 'Pressable')[0];
    expect(header.props.accessibilityLabel).toBe(MESSAGES.ar.ayah.connectionHeading);
    await act(async () => header.props.onPress());
    const body = root!.root.findAll((node) => String(node.type) === 'Text').find((node) => node.props.children === 'English explanation')!;
    expect(styleOf(body)).toMatchObject({ writingDirection: 'ltr', textAlign: 'left' });
  });
});

describe('migration of an Egyptian Arabic App Language', () => {
  it('becomes Arabic, with Egyptian Arabic emotions; idempotent; every other stored value untouched', async () => {
    state.storage.set(APP_KEY, 'ar-EG');
    state.storage.set(TRANSLATION_KEY, JSON.stringify({ translationId: 'en.pickthall.gutenberg16955', displayMode: 'always' }));
    state.storage.set('quran-heals:mushaf-reading-stops:v1', '[]');
    const before = new Map(state.storage);
    expect(await migrateLegacyAppLanguage()).toBe('ar');
    expect(state.storage.get(APP_KEY)).toBe('ar');
    expect(state.storage.get(EMOTIONS_KEY)).toBe('ar-EG');
    expect(await migrateLegacyAppLanguage()).toBe('ar');
    expect(state.storage.get(EMOTIONS_KEY)).toBe('ar-EG');
    for (const [key, value] of before) if (key !== APP_KEY) expect(state.storage.get(key)).toBe(value);
  });

  it('an explicit Emotions Language survives; English and Arabic users keep "follow" (nothing written)', async () => {
    state.storage.set(APP_KEY, 'ar-EG');
    state.storage.set(EMOTIONS_KEY, 'follow');
    expect(await migrateLegacyAppLanguage()).toBe('ar');
    expect(state.storage.get(EMOTIONS_KEY)).toBe('follow');
    for (const app of ['en', 'ar'] as const) {
      state.storage.clear();
      state.storage.set(APP_KEY, app);
      expect(await migrateLegacyAppLanguage()).toBe(app);
      expect(state.storage.has(EMOTIONS_KEY)).toBe(false);
    }
  });

  it('rendered: an Egyptian Arabic user sees an Arabic interface and Egyptian Arabic emotion names', async () => {
    state.storage.set(APP_KEY, 'ar-EG');
    const [emotion] = catalog();
    await render(createElement(EmotionCard, { emotion, onPress: () => {} }));
    expect(root!.root.findAll((node) => String(node.type) === 'Text')[0].props.children).toBe(emotion.names['ar-EG']);
  });
});

describe('Show translation on the ayah screen (Settings → Show Translation decides where it starts)', () => {
  const ayah = {
    id: '2:286', referenceKey: '2:286', surahNumber: 2, ayahNumber: 286, surahNameEnglish: 'Al-Baqarah', surahNameArabic: 'البقرة',
    arabicText: 'لَا يُكَلِّفُ ٱللَّهُ نَفْسًا إِلَّا وُسْعَهَا', englishTranslation: 'Allah tasketh not a soul beyond its scope.',
    emotions: [], quranTextSource: 'Tanzil', translationSource: 'Pickthall',
  };
  const textValues = () => root!.root.findAll((node) => String(node.type) === 'Text').map((node) => [node.props.children].flat().join(''));
  const toggle = () => root!.root.findAll((node) => String(node.type) === 'Pressable' && [MESSAGES.en.translation.showTranslation, MESSAGES.en.translation.hideTranslation].includes(node.props.accessibilityLabel))[0];

  const withTranslationProvider = (element: ReturnType<typeof createElement>) => createElement(QuranTranslationPreferenceProvider, null, element);

  // ON + Always ('always'): shown at once, hideable for this ayah. ON + On Demand ('on-demand'): hidden, with the button.
  for (const [stored, startsShown] of [['always', true], ['on-demand', false]] as const) {
    it(`stored mode ${stored}: Arabic always shown; the translation starts ${startsShown ? 'shown' : 'hidden'}; the toggle works both ways; the stored preference is kept`, async () => {
      if (stored) state.storage.set(TRANSLATION_KEY, JSON.stringify({ translationId: 'en.pickthall.gutenberg16955', displayMode: stored }));
      await render(withTranslationProvider(createElement(AyahCard, { ayah })));
      expect(textValues()).toContain(ayah.arabicText);
      const shown = () => textValues().includes(ayah.englishTranslation);
      expect(shown()).toBe(startsShown);
      expect(toggle().props.accessibilityLabel).toBe(startsShown ? MESSAGES.en.translation.hideTranslation : MESSAGES.en.translation.showTranslation);
      await act(async () => toggle().props.onPress());
      expect(shown()).toBe(!startsShown);
      await act(async () => toggle().props.onPress());
      expect(shown()).toBe(startsShown);
      if (startsShown) expect(textValues().join(' ')).toMatch(/Pickthall/); // attribution kept
      expect(textValues()).toContain(ayah.arabicText);
      if (stored) expect(parseQuranTranslationPreference(JSON.parse(state.storage.get(TRANSLATION_KEY)!)).displayMode).toBe(stored);
      else expect(state.storage.has(TRANSLATION_KEY)).toBe(false);
    });
  }

  // OFF ('off', and a new user with nothing saved): no translation and no Show translation button at all.
  for (const stored of ['off', null] as const) {
    it(`stored mode ${stored ?? '(none: a new user)'}: Show Translation OFF — the Arabic alone, with no translation and no button`, async () => {
      if (stored) state.storage.set(TRANSLATION_KEY, JSON.stringify({ translationId: 'en.pickthall.gutenberg16955', displayMode: stored }));
      await render(withTranslationProvider(createElement(AyahCard, { ayah })));
      expect(textValues()).toContain(ayah.arabicText);
      expect(textValues()).not.toContain(ayah.englishTranslation);
      expect(toggle()).toBeUndefined();
      if (!stored) expect(state.storage.has(TRANSLATION_KEY)).toBe(false);
    });
  }

  it('OFF hides the button on the compact card (Favorites) too', async () => {
    state.storage.set(TRANSLATION_KEY, JSON.stringify({ translationId: 'en.pickthall.gutenberg16955', displayMode: 'off' }));
    await render(withTranslationProvider(createElement(AyahCard, { ayah, compact: true })));
    expect(toggle()).toBeUndefined();
    expect(textValues()).not.toContain(ayah.englishTranslation);
  });

  it('the compact card (Favorites) starts hidden even when Show Translation is ON', async () => {
    state.storage.set(TRANSLATION_KEY, JSON.stringify({ translationId: 'en.pickthall.gutenberg16955', displayMode: 'always' }));
    await render(withTranslationProvider(createElement(AyahCard, { ayah, compact: true })));
    expect(textValues()).not.toContain(ayah.englishTranslation);
    expect(toggle().props.accessibilityLabel).toBe(MESSAGES.en.translation.showTranslation);
  });

  it('a reader\'s toggle applies to that ayah only: the next ayah starts again from the setting', async () => {
    state.storage.set(TRANSLATION_KEY, JSON.stringify({ translationId: 'en.pickthall.gutenberg16955', displayMode: 'always' }));
    await render(withTranslationProvider(createElement(AyahCard, { ayah })));
    await act(async () => toggle().props.onPress());
    expect(textValues()).not.toContain(ayah.englishTranslation);
    const next = { ...ayah, id: '94:5', referenceKey: '94:5', surahNumber: 94, ayahNumber: 5, englishTranslation: 'But lo! with hardship goeth ease,' };
    await act(async () => root!.update(createElement(AppLocaleProvider, null, createElement(EmotionsLanguageProvider, null, withTranslationProvider(createElement(AyahCard, { ayah: next }))))));
    expect(textValues()).toContain(next.englishTranslation);
  });

  it('outside the preference provider (a card rendered alone) it starts hidden', async () => {
    await render(createElement(AyahCard, { ayah }));
    expect(textValues()).not.toContain(ayah.englishTranslation);
  });

  it('the ayah screen`s mode is Show/Hide (on demand)', () => {
    expect(AYAH_SCREEN_TRANSLATION_MODE).toBe('on-demand');
  });
});
