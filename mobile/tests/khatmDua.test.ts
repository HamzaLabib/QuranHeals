import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_LOCALES } from '@/localization/locales';
import { MESSAGES } from '@/localization/messages';

/**
 * دعاء ختم القرآن (/khatm-dua): an optional screen after page 604, never Quran
 * and never a page 605. Its text waits for an approved, verified printed
 * version (mushaf/khatmDua.ts is null until then), so these tests use a
 * stand-in text.
 */
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
  canGoBack: true,
  setItem: vi.fn(),
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 0.5 },
  Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: state.setItem, removeItem: vi.fn() } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
vi.mock('lucide-react-native', () => ({ ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', AArrowDown: 'AArrowDown', AArrowUp: 'AArrowUp' }));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), replace: vi.fn(), canGoBack: () => state.canGoBack } }));
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette, useThemedStyles: (factory: (colors: unknown) => unknown) => factory(lightPalette) };
});
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));

const { default: KhatmDuaScreen } = await import('@/app/khatm-dua');
const { KHATM_DUA, KHATM_DUA_SIZES, DEFAULT_KHATM_DUA_SIZE } = await import('@/mushaf/khatmDua');
const { router } = await import('expo-router');

const STAND_IN = { paragraphs: ['نص تجريبي أول', 'نص تجريبي ثانٍ'], source: 'stand-in for tests' };
let root: ReactTestRenderer;
const byId = (id: string) => root.root.findByProps({ testID: id });
const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(3).filter(Boolean));
const press = async (id: string) => { await act(async () => { byId(id).props.onPress(); }); };
const render = async (dua: typeof STAND_IN | null = STAND_IN) => { await act(async () => { root = create(createElement(KhatmDuaScreen, { dua })); }); };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.canGoBack = true;
  state.setItem.mockReset();
  vi.mocked(router.back).mockClear();
  vi.mocked(router.replace).mockClear();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('دعاء ختم القرآن', () => {
  it('has no text until a verified version is approved: the screen says so, and page 604 shows no link (tests/mushafScreen)', async () => {
    expect(KHATM_DUA).toBeNull();
    await render(null);
    expect(byId('khatm-dua-unavailable').props.children).toBe(MESSAGES.en.khatmDua.unavailable);
    expect(root.root.findAllByProps({ testID: 'khatm-dua-text' })).toHaveLength(0);
  });

  for (const locale of APP_LOCALES) {
    it(`${locale}: the Arabic title, the note that it is not Quran and optional, the du'a right to left and selectable, its source`, async () => {
      state.locale = locale;
      await render();
      const copy = MESSAGES[locale].khatmDua;
      const title = root.root.findAll((node) => node.props.accessibilityRole === 'header')[0];
      expect(title.props.children).toBe('دعاء ختم القرآن');
      expect(byId('khatm-dua-note').props.children).toBe(copy.note);
      STAND_IN.paragraphs.forEach((paragraph, i) => {
        const node = byId(`khatm-dua-paragraph-${i}`);
        expect(node.props.children).toBe(paragraph);
        expect(node.props.selectable).toBe(true);
        expect(styleOf(node)).toMatchObject({ writingDirection: 'rtl', textAlign: 'center', fontSize: KHATM_DUA_SIZES[DEFAULT_KHATM_DUA_SIZE] });
        expect(styleOf(node).fontFamily).toBeUndefined(); // the system Arabic font, never the Mushaf's QPC glyphs
      });
      expect(byId('khatm-dua-source').props.children).toContain(STAND_IN.source);
      expect(byId('khatm-dua-back').props.accessibilityLabel).toBe(copy.back);
    });
  }

  it('the note never presents it as Quran, as a prescribed prophetic du`a, or as recording a khatma', () => {
    expect(MESSAGES.en.khatmDua.note).toMatch(/not part of the Quran/);
    expect(MESSAGES.en.khatmDua.note).toMatch(/not a supplication prescribed by the Prophet/);
    expect(MESSAGES.en.khatmDua.note).toMatch(/does not record a completed khatma/);
    for (const locale of ['ar', 'ar-EG'] as const) expect(MESSAGES[locale].khatmDua.note).toMatch(/القرآن الكريم/);
  });

  it('text size: smaller and larger, within the sizes, the line height following', async () => {
    await render();
    const size = () => styleOf(byId('khatm-dua-paragraph-0'));
    for (let i = DEFAULT_KHATM_DUA_SIZE; i < KHATM_DUA_SIZES.length - 1; i++) await press('khatm-dua-larger');
    expect(size().fontSize).toBe(KHATM_DUA_SIZES.at(-1));
    expect(size().lineHeight).toBe(Math.round(KHATM_DUA_SIZES.at(-1)! * 1.9));
    expect(byId('khatm-dua-larger').props.disabled).toBe(true);
    for (let i = 0; i < KHATM_DUA_SIZES.length; i++) await press('khatm-dua-smaller');
    expect(size().fontSize).toBe(KHATM_DUA_SIZES[0]);
    expect(byId('khatm-dua-smaller').props.disabled).toBe(true);
  });

  it('Back returns to the reader (page 604 is under it); opened directly, it opens page 604', async () => {
    await render();
    await press('khatm-dua-back');
    expect(router.back).toHaveBeenCalledTimes(1);
    state.canGoBack = false;
    await press('khatm-dua-back');
    expect(router.replace).toHaveBeenCalledWith('/mushaf?page=604');
  });

  it('opening, reading and resizing it saves nothing (no khatma, reading position, ورد or bookmark)', async () => {
    await render();
    await press('khatm-dua-larger');
    await press('khatm-dua-back');
    expect(state.setItem).not.toHaveBeenCalled();
    // And there is no completion button until أورادي وختماتي exists.
    expect(root.root.findAll((node) => typeof node.props.testID === 'string' && /khatma|complete/i.test(node.props.testID))).toHaveLength(0);
  });

  it('is not Quran: not in the Quran dataset, search or page count', () => {
    const source = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');
    expect(source('src/mushaf/mushafPage.ts')).toMatch(/MUSHAF_PAGE_COUNT = 604/);
    for (const path of ['src/services/quran.ts', 'src/mushaf/surahSearch.ts', 'src/components/MushafSearchSheet.tsx']) expect(source(path)).not.toMatch(/khatm|KHATM/);
  });
});
