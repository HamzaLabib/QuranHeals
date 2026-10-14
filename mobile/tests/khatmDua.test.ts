import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_LOCALES } from '@/localization/locales';
import { MESSAGES } from '@/localization/messages';

/**
 * دعاء ختم القرآن (/khatm-dua): an optional screen after page 604, never Quran
 * and never a page 605. Its text is the owner-approved du'a (mushaf/khatmDua.ts),
 * checked here character by character against the approved reference
 * (fixtures/khatmDuaApproved.txt: the title, then one paragraph per block).
 */
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
  dark: false,
  canGoBack: true,
  setItem: vi.fn(),
  /** The route's params: none, or ?wird= (opened for a ورد from أورادي وختماتي). */
  params: {} as Record<string, string>,
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 0.5 },
  Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: state.setItem, removeItem: vi.fn() } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Circle: 'Circle' }));
vi.mock('lucide-react-native', () => ({ ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', AArrowDown: 'AArrowDown', AArrowUp: 'AArrowUp' }));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), replace: vi.fn(), canGoBack: () => state.canGoBack }, useLocalSearchParams: () => state.params }));
vi.mock('@/theme/useTheme', async () => {
  const { darkPalette, lightPalette } = await import('@/constants/theme');
  const palette = () => (state.dark ? darkPalette : lightPalette);
  return { usePalette: palette, useThemeName: () => (state.dark ? 'dark' : 'light'), useThemedStyles: (factory: (colors: unknown) => unknown) => factory(palette()) };
});
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));

const { default: KhatmDuaScreen } = await import('@/app/khatm-dua');
const { KHATM_DUA, KHATM_DUA_SIZES, DEFAULT_KHATM_DUA_SIZE } = await import('@/mushaf/khatmDua');
const { darkPalette, lightPalette } = await import('@/constants/theme');
const { scrollBottomPadding } = await import('@/utils/safeAreaSpacing');
const { router } = await import('expo-router');

/** The approved reference, as the owner supplied it (line endings are not content). */
const APPROVED = readFileSync(resolve(__dirname, 'fixtures/khatmDuaApproved.txt'), 'utf8').replace(/\r\n/g, '\n');
/** SHA-256 of the approved reference: the reference itself cannot change unnoticed either. */
const APPROVED_SHA256 = 'aa4860ef3526158b4d5bd8384a16533b3de232b3b6b744babd29e0ceca8ad572';
const [APPROVED_TITLE, ...APPROVED_PARAGRAPHS] = APPROVED.trimEnd().split('\n\n');

/** Where two texts first differ, by code point, for a readable failure. */
function firstDifference(actual: string, expected: string) {
  const a = [...actual];
  const e = [...expected];
  const i = a.findIndex((char, index) => char !== e[index]);
  const at = i === -1 ? Math.min(a.length, e.length) : i;
  const hex = (char?: string) => (char === undefined ? 'end' : `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
  return a.length === e.length && i === -1 ? null : `code point ${at}: ${hex(a[at])} instead of ${hex(e[at])} («${e.slice(Math.max(0, at - 12), at + 12).join('')}»)`;
}

let root: ReactTestRenderer;
const byId = (id: string) => root.root.findByProps({ testID: id });
const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(3).filter(Boolean));
const press = async (id: string) => { await act(async () => { byId(id).props.onPress(); }); };
const render = async (props: { dua?: typeof KHATM_DUA } = {}) => { await act(async () => { root = create(createElement(KhatmDuaScreen, props)); }); };
const paragraphs = () => root.root.findAll((node) => typeof node.props.testID === 'string' && /^khatm-dua-paragraph-\d+$/.test(node.props.testID) && String(node.type) === 'Text');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.dark = false;
  state.canGoBack = true;
  state.params = {};
  state.setItem.mockReset();
  vi.mocked(router.back).mockClear();
  vi.mocked(router.replace).mockClear();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('the approved text (exact)', () => {
  it('the reference is the approved one (SHA-256)', () => {
    expect(createHash('sha256').update(APPROVED, 'utf8').digest('hex')).toBe(APPROVED_SHA256);
  });

  it('the app text equals the approved reference, character by character, diacritics included', () => {
    expect(KHATM_DUA).not.toBeNull();
    const app = `${[KHATM_DUA!.title, ...KHATM_DUA!.paragraphs].join('\n\n')}\n`;
    expect(firstDifference(app, APPROVED)).toBeNull();
    expect(app).toBe(APPROVED);
  });

  it('title and 12 paragraphs, in the approved order, none missing or duplicated', () => {
    expect(KHATM_DUA!.title).toBe(APPROVED_TITLE);
    expect(KHATM_DUA!.title).toBe('دُعَاءُ خَتْمِ الْقُرْآنِ');
    expect(KHATM_DUA!.paragraphs).toEqual(APPROVED_PARAGRAPHS);
    expect(KHATM_DUA!.paragraphs).toHaveLength(12);
    expect(new Set(KHATM_DUA!.paragraphs).size).toBe(12);
    expect(KHATM_DUA!.paragraphs.every((paragraph) => paragraph.length > 0 && !paragraph.includes('\n'))).toBe(true);
    // The order, by each paragraph's opening words.
    expect(KHATM_DUA!.paragraphs.map((paragraph) => paragraph.split(' ').slice(0, 2).join(' '))).toEqual([
      'اللَّهُمَّ ارْحَمْنِي',
      'اللَّهُمَّ ذَكِّرْنِي',
      'اللَّهُمَّ أَصْلِحْ',
      'اللَّهُمَّ اجْعَلْ',
      'اللَّهُمَّ إِنِّي',
      'اللَّهُمَّ إِنِّي',
      'اللَّهُمَّ إِنِّي',
      'اللَّهُمَّ أَحْسِنْ',
      'اللَّهُمَّ اقْسِمْ',
      'اللَّهُمَّ لَا',
      'رَبَّنَا آتِنَا',
      'وَصَلَّى اللَّهُ',
    ]);
  });

  it('keeps the traditional Mushaf wording where it differs from the narrations (owner-confirmed, intentional)', () => {
    const [, , third, , , , , , ninth] = KHATM_DUA!.paragraphs;
    expect(ninth).toContain('مَا تَحُولُ بِهِ بَيْنَنَا وَبَيْنَ مَعْصِيَتِكَ');
    expect(ninth).toContain('مَا تُبَلِّغُنَا بِهَا جَنَّتَكَ');
    expect(ninth).toContain('مَصَائِبَ الدُّنْيَا');
    expect(third).toContain('أَصْلِحْ لِي دِينِي الَّذِي');
    // Never the narrations' wording (Tirmidhī 3502, Muslim 2720).
    expect(ninth).not.toMatch(/مَعَاصِيكَ|تُبَلِّغُنَا بِهِ |مُصِيبَاتِ/);
    expect(third).not.toContain('دِينِيَ');
  });

  it('nothing normalized or added: only Arabic letters, vowel marks, spaces, «،» and «.»; no tatweel or invisible marks', () => {
    for (const text of [KHATM_DUA!.title, ...KHATM_DUA!.paragraphs]) {
      expect(text).toMatch(/^[ء-غف-يً-ْ ،.]+$/);
      expect(text).toBe(text.normalize('NFC'));
      expect(text).toBe(text.trim());
    }
  });
});

describe('دعاء ختم القرآن', () => {
  it('without a text the screen says it is not available', async () => {
    await render({ dua: null });
    expect(byId('khatm-dua-unavailable').props.children).toBe(MESSAGES.en.khatmDua.unavailable);
    expect(root.root.findAllByProps({ testID: 'khatm-dua-text' })).toHaveLength(0);
  });

  for (const locale of APP_LOCALES) {
    it(`${locale}: the approved title centred, no note, the whole du'a in order, right to left, right-aligned and selectable`, async () => {
      state.locale = locale;
      await render();
      const copy = MESSAGES[locale].khatmDua;
      const title = root.root.findAll((node) => node.props.accessibilityRole === 'header')[0];
      expect(title.props.children).toBe('دُعَاءُ خَتْمِ الْقُرْآنِ');
      expect(styleOf(title)).toMatchObject({ textAlign: 'center', writingDirection: 'rtl' });
      expect(root.root.findAllByProps({ testID: 'khatm-dua-note' })).toHaveLength(0);
      // English shows the title's translation under it; Arabic shows the title alone.
      // The title alone: no subtitle or translation under it, in any language.
      expect(title.parent!.findAll((node) => String(node.type) === 'Text')).toEqual([title]);
      const shown = paragraphs();
      expect(shown.map((node) => node.props.children)).toEqual(KHATM_DUA!.paragraphs);
      shown.forEach((node, i) => {
        expect(node.props.testID).toBe(`khatm-dua-paragraph-${i}`);
        expect(node.props.selectable).toBe(true);
        expect(node.props.accessibilityLanguage).toBe('ar');
        expect(styleOf(node)).toMatchObject({ writingDirection: 'rtl', textAlign: 'right', fontSize: KHATM_DUA_SIZES[DEFAULT_KHATM_DUA_SIZE] });
        expect(styleOf(node).fontFamily).toBeUndefined(); // the system Arabic font, never the Mushaf's QPC glyphs
      });
      expect(root.root.findAllByProps({ testID: 'khatm-dua-source' })).toHaveLength(0);
      expect(byId('khatm-dua-back').props.accessibilityLabel).toBe(copy.back);
    });
  }

  it('the title is centred on the screen: a spacer as wide as the Back button balances it', async () => {
    await render();
    const title = root.root.findAll((node) => node.props.accessibilityRole === 'header')[0];
    expect(styleOf(title).textAlign).toBe('center');
    expect(styleOf(title.parent!).flex).toBe(1);
    const header = byId('khatm-dua-back').parent!;
    const back = Object.assign({}, ...[byId('khatm-dua-back').props.style({ pressed: false })].flat(3).filter(Boolean));
    const spacer = header.children.at(-1) as ReactTestInstance;
    expect(back.width).toBe(48);
    expect(styleOf(spacer).width).toBe(back.width);
  });

  it('right-aligned means the physical right edge: the app never flips layout globally (I18nManager)', () => {
    const src = resolve(__dirname, '..', 'src');
    const files = (readdirSync(src, { recursive: true }) as string[]).filter((path) => /\.tsx?$/.test(path));
    expect(files.length).toBeGreaterThan(50);
    for (const path of files) expect(readFileSync(resolve(src, path), 'utf8'), path).not.toMatch(/I18nManager\.(forceRTL|allowRTL)\(/);
    expect(readFileSync(resolve(__dirname, '..', 'app.json'), 'utf8')).not.toMatch(/supportsRTL|forcesRTL/);
  });

  it('room for the vowel marks: generous line heights at every size, wider spacing between paragraphs', async () => {
    await render();
    const title = root.root.findAll((node) => node.props.accessibilityRole === 'header')[0];
    expect(styleOf(title).lineHeight).toBeGreaterThanOrEqual(styleOf(title).fontSize * 1.6);
    for (let i = DEFAULT_KHATM_DUA_SIZE; i < KHATM_DUA_SIZES.length; i++) {
      const style = styleOf(paragraphs()[0]);
      expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize * 1.8);
      if (i < KHATM_DUA_SIZES.length - 1) await press('khatm-dua-larger');
    }
    // A clear pause between paragraphs: wider than half a line at the default size.
    await render();
    expect(styleOf(byId('khatm-dua-text')).gap).toBeGreaterThan(styleOf(paragraphs()[0]).lineHeight / 2);
  });

  it('safe areas: the top inset by the SafeAreaView, the bottom by the scroll padding, so the last line clears the system controls', async () => {
    await render();
    const safeArea = root.root.findAll((node) => String(node.type) === 'SafeAreaView')[0];
    expect(safeArea.props.edges).toEqual(['top', 'left', 'right']);
    const scroll = byId('khatm-dua-scroll');
    const content = Object.assign({}, ...[scroll.props.contentContainerStyle].flat(3).filter(Boolean));
    expect(content.paddingBottom).toBe(scrollBottomPadding(34));
  });

  for (const [name, palette, dark] of [['Light', lightPalette, false], ['Dark', darkPalette, true]] as const) {
    it(`${name} appearance: the screen, card and text take the theme's colours`, async () => {
      state.dark = dark;
      await render();
      const safeArea = root.root.findAll((node) => String(node.type) === 'SafeAreaView')[0];
      expect(styleOf(safeArea).backgroundColor).toBe(palette.background);
      expect(styleOf(byId('khatm-dua-text'))).toMatchObject({ backgroundColor: palette.card, borderColor: palette.border });
      for (const node of paragraphs()) expect(styleOf(node).color).toBe(palette.textPrimary);
    });
  }
  it('Light and Dark differ, so the du`a follows the app appearance', () => {
    expect(darkPalette.textPrimary).not.toBe(lightPalette.textPrimary);
    expect(darkPalette.card).not.toBe(lightPalette.card);
  });

  it('no disclaimer, explanation, subtitle or "optional" statement on the screen, in any language; their keys are gone from the dictionary', async () => {
    for (const locale of APP_LOCALES) {
      state.locale = locale;
      await render();
      const shown = root.root.findAll((node) => String(node.type) === 'Text').map((node) => String(node.props.children));
      expect(shown.join(' ')).not.toMatch(/Supplication on completing|not part of the Quran|optional|prescribed|ليس من القرآن|اختياري|اختيارية|يُقرأ بعد ختم|بيتقري/);
      expect(MESSAGES[locale].khatmDua).not.toHaveProperty('note');
      expect(MESSAGES[locale].khatmDua).not.toHaveProperty('subtitle');
    }
    for (const locale of APP_LOCALES) expect(MESSAGES[locale].khatmDua).not.toHaveProperty('titleTranslation');
    // No Khatma action on this screen: its confirmation keys are gone too (أورادي وختماتي keeps its own).
    for (const locale of APP_LOCALES) {
      expect(MESSAGES[locale].khatmDua).not.toHaveProperty('confirmFor');
      expect(MESSAGES[locale].khatmDua).not.toHaveProperty('confirm');
    }
    expect(MESSAGES.ar.myReading.confirm.length).toBeGreaterThan(0);
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
    // Every paragraph follows the chosen size.
    expect(new Set(paragraphs().map((node) => styleOf(node).fontSize))).toEqual(new Set([KHATM_DUA_SIZES[0]]));
  });

  it('Back returns to the reader (page 604 is under it); opened directly, it opens page 604', async () => {
    await render();
    await press('khatm-dua-back');
    expect(router.back).toHaveBeenCalledTimes(1);
    state.canGoBack = false;
    await press('khatm-dua-back');
    expect(router.replace).toHaveBeenCalledWith('/mushaf?page=604');
  });

  it('opening, scrolling, resizing and closing it saves nothing (no khatma, reading position, ورد or bookmark)', async () => {
    await render();
    // Scrolling is plain native scrolling: no scroll handler that could save anything.
    expect(Object.keys(byId('khatm-dua-scroll').props).filter((key) => /^on/.test(key))).toEqual([]);
    await press('khatm-dua-larger');
    await press('khatm-dua-back');
    expect(state.setItem).not.toHaveBeenCalled();
    // Without ?wird= (a pending ورد) there is no completion button (tests/homeTabsKhatma covers it with one).
    expect(root.root.findAll((node) => typeof node.props.testID === 'string' && /khatma|complete/i.test(node.props.testID))).toHaveLength(0);
  });

  it('is not Quran: not in the Quran dataset, search or page count', () => {
    const source = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');
    expect(source('src/mushaf/mushafPage.ts')).toMatch(/MUSHAF_PAGE_COUNT = 604/);
    for (const path of ['src/services/quran.ts', 'src/mushaf/surahSearch.ts', 'src/components/MushafSearchSheet.tsx']) expect(source(path)).not.toMatch(/khatm|KHATM/);
  });
});

const { SURAH_HEADER_INKS } = await import('@/constants/mushafTheme');
const texts = () => root.root.findAll((node) => String(node.type) === 'Text').map((node) => node.props.children);

describe('the Islamic panel around the du`a (decoration only)', () => {
  const hostSvg = (id: string) => root.root.findAll((node) => String(node.type) === 'Svg' && node.props.testID === id);

  it('an arch over the du`a and a divider under it, inside the card; the 12 paragraphs stay in order between them', async () => {
    await render();
    const card = byId('khatm-dua-text');
    const children = card.children.filter((child): child is ReactTestInstance => typeof child !== 'string');
    const ids = children.map((child) => child.props.testID ?? String(child.type));
    expect(hostSvg('khatm-dua-arch')).toHaveLength(1);
    expect(hostSvg('khatm-dua-divider')).toHaveLength(1);
    const first = ids.indexOf('khatm-dua-paragraph-0');
    const last = ids.indexOf(`khatm-dua-paragraph-${KHATM_DUA!.paragraphs.length - 1}`);
    expect(first).toBeGreaterThan(-1);
    expect(last - first).toBe(KHATM_DUA!.paragraphs.length - 1);
    expect(paragraphs().map((node) => node.props.children)).toEqual(APPROVED_PARAGRAPHS);
  });

  it('adds no words: shapes only, no text, calligraphy or verse inside any ornament, and hidden from screen readers', async () => {
    await render();
    for (const id of ['khatm-dua-arch', 'khatm-dua-divider']) {
      const svg = hostSvg(id)[0];
      expect(svg.props).toMatchObject({ accessible: false, importantForAccessibility: 'no-hide-descendants' });
      expect(svg.findAll((node) => ['Text', 'TSpan', 'TextPath'].includes(String(node.type)))).toHaveLength(0);
      expect(new Set(svg.findAll((node) => typeof node.type === 'string' && node !== svg).map((node) => String(node.type)))).toEqual(new Set(['Path', 'Circle']));
    }
    expect(texts()).toEqual(expect.not.arrayContaining([expect.stringMatching(/﷽|۞/)]));
  });

  for (const dark of [false, true]) {
    it(`${dark ? 'Dark' : 'Light'}: the Mushaf's own emerald and gold, deep gold lines on the light card and gold on the dark one; a softened inner gold rule`, async () => {
      state.dark = dark;
      await render();
      const line = dark ? SURAH_HEADER_INKS.gold : SURAH_HEADER_INKS.goldDeep;
      const strokes = hostSvg('khatm-dua-arch')[0].findAll((node) => String(node.type) === 'Path').map((node) => node.props.stroke);
      expect(strokes[0]).toBe(line);
      expect(strokes).toContain(SURAH_HEADER_INKS.emeraldLight);
      const frame = byId('khatm-dua-frame');
      expect(styleOf(frame)).toMatchObject({ borderColor: line, position: 'absolute', opacity: 0.45 });
      expect(frame.props.pointerEvents).toBe('none');
    });
  }

  it('readable on every screen: full width on phones, a centred reading measure on iPad, clear of the inner rule', async () => {
    await render();
    expect(styleOf(byId('khatm-dua-text'))).toMatchObject({ width: '100%', maxWidth: 720, alignSelf: 'center' });
    expect(styleOf(byId('khatm-dua-text')).paddingHorizontal).toBeGreaterThan(styleOf(byId('khatm-dua-frame')).left);
  });

  it('the screen keeps its title, size controls and Back', async () => {
    await render();
    for (const id of ['khatm-dua-smaller', 'khatm-dua-larger', 'khatm-dua-back']) expect(byId(id)).toBeDefined();
    expect(texts()).toContain(KHATM_DUA!.title);
  });
});
