/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { createElement, type ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openTestDatabase } from './helpers/sqlite';

/**
 * My Reflections shows each reflection's ayah translation by Saved Ayahs' rule: the list card (a compact, two-line
 * preview) and the opened reflection (ReflectionSheet's `ayah`, the full translation). The translation comes from the
 * same backend ayah endpoint as Saved Ayahs' — here a fake backend serving the backend's own verified Pickthall
 * asset — resolved from the stored verseKey alone, never written into reflection storage.
 */
const state = vi.hoisted(() => ({ storage: new Map<string, string>(), getAyah: vi.fn() }));

vi.mock('expo-router', () => ({ router: { navigate: () => undefined, back: () => undefined, push: () => undefined } }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: { ios?: unknown; default?: unknown }) => values.ios ?? values.default },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 0.5 },
  Alert: { alert: vi.fn() }, Keyboard: { dismiss: vi.fn() },
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Text: 'Text', TextInput: 'TextInput', TouchableWithoutFeedback: 'TouchableWithoutFeedback', View: 'View',
  Linking: { openURL: vi.fn(async () => undefined) },
  useColorScheme: () => 'light',
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { state.storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { state.storage.delete(key); }),
    multiRemove: vi.fn(async (keys: string[]) => { for (const key of keys) state.storage.delete(key); }),
  },
}));
vi.mock('lucide-react-native', () => ({ ArrowUpRight: 'ArrowUpRight', Check: 'Check', Copy: 'Copy', Trash2: 'Trash2', Play: 'Play', Pause: 'Pause', Square: 'Square', Loader: 'Loader', Volume2: 'Volume2' }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette, useThemedStyles: (factory: (colors: unknown) => unknown) => factory(lightPalette), useThemeName: () => 'light' };
});
vi.mock('@/theme/useAppearancePreference', () => ({ useAppearancePreference: () => ({ mode: 'system', isReady: true, setMode: vi.fn() }) }));
vi.mock('@/localization/useQuranFontSizePreference', () => ({ useQuranFontSizePreference: () => ({ preferredSize: 26 }) }));
vi.mock('@/components/QuranFontSizeControls', () => ({ QuranFontSizeControls: 'QuranFontSizeControls' }));
vi.mock('@/components/AyahAudioButton', () => ({ AyahAudioButton: 'AyahAudioButton' }));
vi.mock('@/services/quranAsset', () => ({ openBundledQuran: async () => openTestDatabase() }));
vi.mock('@/services/api', () => ({ getAyah: state.getAyah }));
vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ status: 'guest' }), getCurrentSessionToken: async () => null }));
vi.mock('@/storage/localChanges', () => ({ notifyLocalChange: vi.fn() }));

const { AppLocaleProvider } = await import('@/localization/useAppLocale');
const { QuranTranslationPreferenceProvider } = await import('@/localization/useQuranTranslationPreference');
const { AYAH_SCREEN_TRANSLATION_MODE, resolveAyahTranslationDisplay, resolveTranslationVisibility } = await import('@/localization/quranTranslationPreference');
const { MESSAGES } = await import('@/localization/messages');
const { AyahCard } = await import('@/components/AyahCard');
const { ReflectionListCard } = await import('@/components/ReflectionListCard');
const { ReflectionSheet } = await import('@/components/ReflectionSheet');
const { createAyahTranslationLookup } = await import('@/services/ayahTranslationLookup');
const { saveReflection } = await import('@/storage/ayahReflections');
const { loadReflectionListItems } = await import('@/hooks/useReflections');
type Ayah = import('@/types/domain').Ayah;
type TranslationDisplayMode = import('@/localization/quranTranslationPreference').TranslationDisplayMode;

// ── The fake backend: the backend's own verified translation asset and attribution (backend/src/quran/translationSource.ts).
const translations = new DatabaseSync(fileURLToPath(new URL('../../backend/assets/quran/translations.sqlite', import.meta.url)), { readOnly: true });
afterAll(() => translations.close());
const PICKTHALL = 'en.pickthall.gutenberg16955';
const SOURCE = 'Marmaduke Pickthall — The Meaning of the Glorious Koran — Project Gutenberg eBook #16955';
function pickthall(verseKey: string): string {
  const row = translations.prepare('SELECT text FROM translations WHERE verse_key = ? AND translation_id = ?').get(verseKey, PICKTHALL) as { text: string } | undefined;
  if (!row) throw new Error(`no Pickthall row for ${verseKey}`);
  return row.text;
}
function backendAyah(verseKey: string): Ayah & { verseKey: string } {
  const [surah, ayah] = verseKey.split(':').map(Number);
  return {
    id: verseKey, verseKey, referenceKey: verseKey, surahNumber: surah, ayahNumber: ayah, surahNameArabic: '', surahNameEnglish: '',
    arabicText: '', englishTranslation: pickthall(verseKey), emotions: [], quranTextSource: 'Tanzil', translationSource: SOURCE,
  };
}

const TRANSLATION_KEY = 'quran-heals:quran-translation-preference:v1';
const setMode = (mode: TranslationDisplayMode | null) => {
  if (mode) state.storage.set(TRANSLATION_KEY, JSON.stringify({ translationId: PICKTHALL, displayMode: mode }));
};
const reflectionStorage = () => [...state.storage.entries()].filter(([key]) => key.includes('reflection')).sort();

let root: ReactTestRenderer | undefined;
const flush = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
};
const wrap = (element: ReactElement) => createElement(AppLocaleProvider, null, createElement(QuranTranslationPreferenceProvider, null, element));
async function render(element: ReactElement) {
  if (root) await act(async () => root!.unmount());
  await act(async () => { root = create(wrap(element)); });
  await flush();
}
const textOf = (node: ReactTestInstance) => [node.props.children].flat().join('');
const texts = () => root!.root.findAll((node) => String(node.type) === 'Text').map(textOf);
const textNode = (value: string) => root!.root.findAll((node) => String(node.type) === 'Text' && textOf(node) === value)[0];
const LABELS = [MESSAGES.en.translation.showTranslation, MESSAGES.en.translation.hideTranslation];
const toggle = () => root!.root.findAll((node) => String(node.type) === 'Pressable' && LABELS.includes(node.props.accessibilityLabel))[0];
/** Document order of the host elements, for "Arabic first, translation under it, reflection below". */
const orderOf = (predicate: (node: ReactTestInstance) => boolean) => root!.root.findAll((node) => typeof node.type === 'string').findIndex(predicate);
const isText = (value: string) => (node: ReactTestInstance) => String(node.type) === 'Text' && textOf(node) === value;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.storage.clear();
  state.getAyah.mockReset().mockImplementation(async (verseKey: string) => backendAyah(verseKey));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
});

/** An existing reflection, saved through the unchanged storage path, then loaded the way My Reflections loads it. */
async function existingReflection(verseKey: string, text: string) {
  await saveReflection(verseKey, text, 1_700_000_000_000);
  const stored = reflectionStorage();
  const [item] = (await loadReflectionListItems()).filter((entry) => entry.reflection.verseKey === verseKey);
  return { item, stored };
}

describe('the translation lookup (by verseKey, memory only)', () => {
  it('returns the backend translation and attribution, caches it, and shares one request per verseKey', async () => {
    const fetch = vi.fn(async (key: string) => backendAyah(key));
    const lookup = createAyahTranslationLookup(fetch);
    expect(lookup.peek('94:6')).toBeNull();
    const [a, b] = await Promise.all([lookup.load('94:6'), lookup.load('94:6')]);
    expect(a).toEqual({ text: pickthall('94:6'), source: SOURCE });
    expect(b).toBe(a);
    expect(await lookup.load('94:6')).toBe(a);
    expect(lookup.peek('94:6')).toBe(a);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a failure, an empty translation or a response for another ayah is null and is retried next time', async () => {
    const fetch = vi.fn<(key: string) => Promise<Ayah>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...backendAyah('94:6'), englishTranslation: '  ' })
      .mockResolvedValueOnce(backendAyah('94:5'))
      .mockImplementation(async (key) => backendAyah(key));
    const lookup = createAyahTranslationLookup(fetch);
    expect(await lookup.load('94:6')).toBeNull();
    expect(await lookup.load('94:6')).toBeNull();
    expect(await lookup.load('94:6')).toBeNull();
    expect(lookup.peek('94:6')).toBeNull();
    expect((await lookup.load('94:6'))?.text).toBe(pickthall('94:6'));
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('runs at most the given number of requests at once', async () => {
    let running = 0;
    let peak = 0;
    const lookup = createAyahTranslationLookup(async (key) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((done) => setTimeout(done, 1));
      running -= 1;
      return backendAyah(key);
    }, 3);
    const keys = Array.from({ length: 10 }, (_, index) => `2:${index + 1}`);
    const results = await Promise.all(keys.map((key) => lookup.load(key)));
    expect(results.every(Boolean)).toBe(true);
    expect(peak).toBe(3);
  });
});

describe('the shared visibility rule is exactly AyahCard`s previous one', () => {
  it('every mode × compact × toggle × availability', () => {
    for (const displayMode of ['always', 'on-demand', 'off', null] as const) {
      for (const compact of [true, false]) {
        for (const toggledRevealed of [null, true, false]) {
          for (const unavailable of [true, false]) {
            // The formula AyahCard had inline before it was factored out.
            const isRevealed = toggledRevealed ?? (!compact && displayMode === 'always');
            const visibility = resolveTranslationVisibility(AYAH_SCREEN_TRANSLATION_MODE, isRevealed);
            const none = displayMode === 'off' || unavailable;
            expect(resolveAyahTranslationDisplay(displayMode, { compact, toggledRevealed, unavailable })).toEqual({
              isRevealed,
              showTranslation: !none && visibility.showTranslation,
              showToggleControl: !none && visibility.showToggleControl,
            });
          }
        }
      }
    }
  });
});

describe('My Reflections list card: the same translation visibility as a Saved Ayahs card', () => {
  // Each mode uses its own ayah so the session cache never hides whether a request was made.
  const cases = [['always', '94:6'], ['on-demand', '2:286'], ['off', '13:28'], [null, '65:3']] as const;
  for (const [mode, verseKey] of cases) {
    it(`Show Translation ${mode ?? '(never set: OFF)'}: matches Saved Ayahs; Arabic, then the translation, then the reflection`, async () => {
      setMode(mode);
      const { item, stored } = await existingReflection(verseKey, `My reflection on ${verseKey}`);

      // Saved Ayahs, for the same ayah (its stored translation snapshot comes from the same backend).
      await render(createElement(AyahCard, { ayah: { ...backendAyah(verseKey), arabicText: item.arabicText! }, compact: true }));
      const saved = { shown: texts().includes(pickthall(verseKey)), button: toggle() !== undefined };
      if (saved.button) await act(async () => toggle().props.onPress());
      const savedAfterTap = texts().includes(pickthall(verseKey));

      state.getAyah.mockClear();
      const onPress = vi.fn();
      await render(createElement(ReflectionListCard, { item, locale: 'en', messages: MESSAGES.en, onPress }));
      expect(texts()).toContain(item.arabicText);
      expect({ shown: texts().includes(pickthall(verseKey)), button: toggle() !== undefined }).toEqual(saved);
      expect(saved.shown).toBe(false); // compact: hidden at first in every mode
      expect(saved.button).toBe(mode === 'always' || mode === 'on-demand');
      if (mode === 'off' || mode === null) expect(state.getAyah).not.toHaveBeenCalled();

      if (saved.button) {
        // The card offers the toggle to screen readers too (the card itself is one accessible button).
        expect(root!.root.findByProps({ accessibilityRole: 'button', accessibilityLabel: `${MESSAGES.en.reflections.openReflectionLabel} ${verseKey}` }).props.accessibilityActions)
          .toEqual([{ name: 'toggleTranslation', label: MESSAGES.en.translation.showTranslation }]);
        await act(async () => toggle().props.onPress());
        expect(texts().includes(pickthall(verseKey))).toBe(savedAfterTap);
        // The correct translation and attribution, compact (two lines, smaller) under the Arabic, above the reflection.
        expect(textNode(pickthall(verseKey)).props.numberOfLines).toBe(2);
        expect(texts()).toContain(SOURCE);
        expect(orderOf(isText(item.arabicText!))).toBeLessThan(orderOf(isText(pickthall(verseKey))));
        expect(orderOf(isText(pickthall(verseKey)))).toBeLessThan(orderOf(isText(`My reflection on ${verseKey}`)));
        expect(state.getAyah).toHaveBeenCalledWith(verseKey);
      }

      // Opening carries the card's toggle (null when there is no toggle).
      const card = root!.root.findByProps({ accessibilityLabel: `${MESSAGES.en.reflections.openReflectionLabel} ${verseKey}` });
      await act(async () => card.props.onPress());
      expect(onPress).toHaveBeenCalledWith(saved.button ? true : null);

      // Nothing about the translation was written into reflection storage.
      expect(reflectionStorage()).toEqual(stored);
      expect(JSON.stringify(reflectionStorage())).not.toContain(pickthall(verseKey));
    });
  }

  it('unavailable (offline) → nothing in its place and no button, as Saved Ayahs; a pull-to-refresh retry then shows it', async () => {
    setMode('on-demand');
    const { item } = await existingReflection('39:53', 'Hope');
    await render(createElement(AyahCard, { ayah: { ...backendAyah('39:53'), englishTranslation: '', translationSource: '' }, compact: true }));
    expect(toggle()).toBeUndefined();

    state.getAyah.mockRejectedValue(new Error('offline'));
    const props = { item, locale: 'en' as const, messages: MESSAGES.en, onPress: vi.fn() };
    await render(createElement(ReflectionListCard, { ...props, translationRetryKey: 0 }));
    expect(texts()).toContain(item.arabicText);
    expect(texts()).toContain('Hope');
    expect(toggle()).toBeUndefined();

    state.getAyah.mockReset().mockImplementation(async (key: string) => backendAyah(key));
    await act(async () => root!.update(wrap(createElement(ReflectionListCard, { ...props, translationRetryKey: 1 }))));
    await flush();
    await act(async () => toggle().props.onPress());
    expect(texts()).toContain(pickthall('39:53'));
  });
});

describe('an opened reflection (from My Reflections): the full ayah translation, by the same rule', () => {
  const openSheet = (item: Awaited<ReturnType<typeof existingReflection>>['item'], translationRevealed: boolean | null) =>
    createElement(ReflectionSheet, {
      visible: true, verseKey: item.reflection.verseKey, onClose: vi.fn(),
      ayah: { surahNumber: item.surahNumber, ayahNumber: item.ayahNumber, arabicText: item.arabicText, translationRevealed },
    });

  it('ON: Arabic first, the full translation directly under it once shown, the reflection editor below', async () => {
    setMode('always');
    const { item, stored } = await existingReflection('2:255', 'Ayat al-Kursi reflection');
    await render(openSheet(item, null));
    expect(texts()).toContain(item.arabicText);
    expect(texts()).toContain('Al-Baqara · 2:255 · البقرة');
    expect(texts()).not.toContain(pickthall('2:255')); // Saved Ayahs' compact start: hidden
    await act(async () => toggle().props.onPress());
    const translation = textNode(pickthall('2:255'));
    expect(translation.props.numberOfLines).toBeUndefined(); // the full translation
    expect(texts()).toContain(SOURCE);
    const input = root!.root.findByType('TextInput' as never);
    expect(input.props.value).toBe('Ayat al-Kursi reflection');
    expect(orderOf(isText(item.arabicText!))).toBeLessThan(orderOf(isText(pickthall('2:255'))));
    expect(orderOf(isText(pickthall('2:255')))).toBeLessThan(orderOf((node) => node === input));
    expect(orderOf(isText(pickthall('2:255')))).toBeLessThan(orderOf(isText(MESSAGES.en.reflection.title)));
    await act(async () => toggle().props.onPress());
    expect(texts()).not.toContain(pickthall('2:255'));
    expect(reflectionStorage()).toEqual(stored);
  });

  it('opened with the list card`s translation shown → shown at once', async () => {
    setMode('on-demand');
    const { item } = await existingReflection('94:6', 'Ease');
    await render(openSheet(item, true));
    expect(texts()).toContain(pickthall('94:6'));
    expect(toggle().props.accessibilityLabel).toBe(MESSAGES.en.translation.hideTranslation);
  });

  it('OFF: the Arabic alone, no translation and no button (and nothing fetched)', async () => {
    setMode('off');
    const { item } = await existingReflection('3:139', 'Do not lose heart');
    state.getAyah.mockClear();
    await render(openSheet(item, null));
    expect(texts()).toContain(item.arabicText);
    expect(toggle()).toBeUndefined();
    expect(texts()).not.toContain(pickthall('3:139'));
    expect(state.getAyah).not.toHaveBeenCalled();
  });

  it('opened over an ayah already on screen (no `ayah`): still no Quran text in the window, and nothing fetched', async () => {
    setMode('always');
    const { item } = await existingReflection('20:46', 'Fear not');
    state.getAyah.mockClear();
    await render(createElement(ReflectionSheet, { visible: true, verseKey: '20:46', onClose: vi.fn() }));
    expect(texts()).not.toContain(item.arabicText);
    expect(toggle()).toBeUndefined();
    expect(state.getAyah).not.toHaveBeenCalled();
  });
});
