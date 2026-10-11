import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@/localization/messages';

/**
 * The /mushaf prototype screen: both renderers (QPC V1 and the Quran SVG
 * fallback), ayah taps → exact verse → existing Add Reflection, named
 * reading stops (mocked native modules; the real verified Quran database
 * for the Tanzil check; a SYNTHETIC QPC V1 layout — no Quran Foundation data).
 */

const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
  storage: new Map<string, string>(),
  back: vi.fn(),
  replace: vi.fn(),
  canGoBack: true,
  fontsLoaded: true,
  fetch: vi.fn(),
  params: {} as Record<string, string>,
  theme: 'light' as 'light' | 'dark',
  offline: {
    readPage: vi.fn(),
    status: vi.fn(),
    download: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' } },
  Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', SvgXml: 'SvgXml', Defs: 'Defs', Ellipse: 'Ellipse', G: 'G', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('lucide-react-native', () => ({ ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', BookmarkPlus: 'BookmarkPlus', Pencil: 'Pencil', PenLine: 'PenLine', Trash2: 'Trash2', X: 'X' }));
vi.mock('expo-router', () => ({ router: { back: state.back, replace: state.replace, canGoBack: () => state.canGoBack }, useLocalSearchParams: () => state.params }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { state.storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { state.storage.delete(key); }),
  },
}));
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette, useThemedStyles: (factory: (colors: unknown) => unknown) => factory(lightPalette), useThemeName: () => state.theme };
});
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));
vi.mock('@/components/ReflectionSheet', () => ({ ReflectionSheet: 'ReflectionSheet' }));
vi.mock('expo-font', () => ({ useFonts: () => [state.fontsLoaded, null] }));
vi.mock('@/mushaf/qpcV1Fonts', () => ({ QPC_V1_FONTS: { QCF_P061: 1 } }));
vi.mock('@/mushaf/offline', () => {
  class OfflineMushafError extends Error {
    constructor(message: string, readonly kind: string) { super(message); }
  }
  return { offlineMushaf: state.offline, OfflineMushafError };
});
vi.mock('@/mushaf/headerFonts', () => ({ MUSHAF_HEADER_FONT_FAMILY: 'Amiri_700Bold', MUSHAF_HEADER_FONTS: { Amiri_700Bold: 2 } }));
vi.mock('@/services/fetchWithTimeout', () => ({ fetchWithTimeout: state.fetch, DEFAULT_FETCH_TIMEOUT_MS: 8000 }));
vi.mock('@/services/quranAsset', async () => {
  const { openTestDatabase } = await import('./helpers/sqlite');
  return { openBundledQuran: async () => openTestDatabase() };
});

const { default: MushafScreen } = await import('@/app/mushaf');
const { READING_STOPS_STORAGE_KEY } = await import('@/mushaf/readingStops');
const { syntheticQpcPage61 } = await import('./helpers/syntheticQpcPage61');
const { AYAH_MARKERS_061 } = await import('@/mushaf/generated/ayahMarkers061');
const layoutResponse = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let root: ReactTestRenderer;
const copy = () => MESSAGES[state.locale].mushaf;
const pressables = () => root.root.findAllByType('Pressable' as never);
const button = (label: string) => pressables().find((node) => node.props.accessibilityLabel === label);
const texts = () => root.root.findAllByType('Text' as never).map((node) => [node.props.children].flat().join(''));
const page = () => pressables().find((node) => node.props.accessibilityRole === 'image')!;
const flush = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };

/** Taps the rendered page at a point given in the page's own 345 × 550 coordinates. */
async function tapPage(x: number, y: number) {
  const { width, height } = Object.assign({}, ...[page().props.style].flat()) as { width: number; height: number };
  await act(async () => page().props.onPress({ nativeEvent: { locationX: (x / 345) * width, locationY: (y / 550) * height } }));
}
async function press(node: ReactTestInstance | undefined) {
  await act(async () => { await node!.props.onPress(); });
}
async function render() {
  await act(async () => { root = create(createElement(MushafScreen)); });
  await flush();
  // The page is sized from the space it is given (onLayout), e.g. a 390-pt phone minus margins.
  await act(async () => root.root.findByProps({ testID: 'mushaf-page-area' }).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 362, height: 0 } } }));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.storage.clear();
  state.back.mockReset();
  state.replace.mockReset();
  state.canGoBack = true;
  state.fontsLoaded = true;
  state.params = {};
  state.theme = 'light';
  state.offline.readPage.mockReset().mockResolvedValue(null);
  state.offline.status.mockReset().mockResolvedValue({ installed: false, stagedChunks: 0 });
  state.offline.download.mockReset();
  state.offline.remove.mockReset().mockResolvedValue(undefined);
  // Default: the 1405 layout is unavailable, so the Quran SVG fallback shows.
  state.fetch.mockReset().mockResolvedValue(layoutResponse(503, { success: false }));
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('the printed page', () => {
  it('shows page 61 as printed: surah and juz` headers, the page artwork with green medallions, the Arabic-Indic page number', async () => {
    await render();
    expect(texts()).toEqual(expect.arrayContaining(['سورة آل عمران', 'الجزء الثالث', '٦١', copy().artworkCredit]));
    const artwork = root.root.findByType('SvgXml' as never);
    expect(artwork.props.xml.match(/fill="#3E7D57"/g)).toHaveLength(8);
    expect(artwork.props.pointerEvents).toBe('none');
    expect(page().props.accessibilityLabel).toBe(`${copy().pageLabel} 61`);
  });

  it('draws the traced border behind the text: it takes no touches and is hidden from screen readers', async () => {
    await render();
    const frame = root.root.findByProps({ testID: 'mushaf-frame' });
    expect(frame.findAllByType('Path' as never)).toHaveLength(6);
    const wrapper = frame.parent!.parent!;
    expect(wrapper.props.pointerEvents).toBe('none');
    expect(wrapper.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(wrapper.props.accessibilityElementsHidden).toBe(true);
  });

  it('sets the surah and juz` heads and the page number in Amiri once loaded', async () => {
    await render();
    const styled = (text: string) => Object.assign({}, ...[root.root.findAllByType('Text' as never).find((node) => node.props.children === text)!.props.style].flat(3).filter(Boolean));
    for (const text of ['سورة آل عمران', 'الجزء الثالث', '٦١']) expect(styled(text).fontFamily).toBe('Amiri_700Bold');
  });

  it('keeps the page in proportion (345 × 550) at the screen width', async () => {
    await render();
    const { width, height } = Object.assign({}, ...[page().props.style].flat()) as { width: number; height: number };
    expect(height / width).toBeCloseTo(550 / 345);
  });
});

describe('selecting an ayah', () => {
  it('a tap selects the exact ayah under it, highlights it, and shows its reference', async () => {
    await render();
    expect(root.root.findAllByProps({ testID: 'mushaf-selection' })).toHaveLength(0);
    await tapPage(100, 130); // line 4, left of 3:84's end
    expect(texts()).toContain('Aal-i-Imraan · 3:85 · آل عمران');
    const highlight = root.root.findByProps({ testID: 'mushaf-selection' });
    expect(highlight.findByType('Path' as never).props.d).toMatch(/^M 0\.0 114\.25/);
    await tapPage(300, 130); // same line, right of the ayah end
    expect(texts()).toContain('Aal-i-Imraan · 3:84 · آل عمران');
  });

  it('a tap in the margin changes nothing', async () => {
    await render();
    await tapPage(170, 530);
    await tapPage(343, 300);
    expect(texts()).toContain('Aal-i-Imraan · 3:91 · آل عمران');
  });

  it('Add Reflection opens the existing reflection sheet for exactly that ayah — only when tapped', async () => {
    await render();
    expect(root.root.findByType('ReflectionSheet' as never).props).toMatchObject({ visible: false, verseKey: null });
    expect(button(MESSAGES.en.reflection.writeAction)).toBeUndefined(); // nothing selected yet
    await tapPage(150, 220); // 3:86
    expect(root.root.findByType('ReflectionSheet' as never).props.visible).toBe(false);
    await press(button(MESSAGES.en.reflection.writeAction));
    expect(root.root.findByType('ReflectionSheet' as never).props).toMatchObject({ visible: true, verseKey: '3:86' });
    await act(async () => root.root.findByType('ReflectionSheet' as never).props.onClose());
    expect(root.root.findByType('ReflectionSheet' as never).props.visible).toBe(false);
  });

  it('Clear selection removes the highlight and the action', async () => {
    await render();
    await tapPage(150, 220);
    await press(button(copy().clearSelection));
    expect(root.root.findAllByProps({ testID: 'mushaf-selection' })).toHaveLength(0);
    expect(button(MESSAGES.en.reflection.writeAction)).toBeUndefined();
  });
});

describe('reading stops', () => {
  const nameField = () => root.root.findAllByType('TextInput' as never).find((node) => node.props.accessibilityLabel === copy().stopNameLabel)!;

  it('saves the whole page under a name — never the selected ayah — and lists it', async () => {
    await render();
    expect(texts()).toContain(copy().noStops);
    await tapPage(150, 220); // an ayah is selected, but the stop is still page-only
    await act(async () => nameField().props.onChangeText('Ramadan'));
    await press(button(copy().saveStop));
    expect(texts()).toContain(copy().stopSaved);
    expect(texts()).toContain('Ramadan');
    expect(texts()).toContain('Page 61');
    const [saved] = JSON.parse(state.storage.get(READING_STOPS_STORAGE_KEY)!);
    expect(saved).toEqual({ id: expect.any(String), name: 'Ramadan', page: 61, updatedAt: expect.any(String) });
    expect(nameField().props.value).toBe('');
  });

  it('renames one stop inline without touching the others', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([
      { id: 's1', name: 'Mum', page: 61, updatedAt: '2026-10-11T09:00:00.000Z' },
      { id: 's2', name: 'Dad', page: 61, updatedAt: '2026-10-11T08:00:00.000Z' },
    ]));
    await render();
    await press(button(`${copy().renameStop}: Mum`));
    const field = () => root.root.findAllByType('TextInput' as never).find((node) => node.props.accessibilityLabel === `${copy().renameStop}: Mum`)!;
    expect(field().props.value).toBe('Mum');
    await act(async () => field().props.onChangeText('Mother'));
    await press(button(copy().saveName));
    expect(texts()).toContain(copy().stopRenamed);
    expect(JSON.parse(state.storage.get(READING_STOPS_STORAGE_KEY)!).map((stop: { id: string; name: string }) => [stop.id, stop.name])).toEqual([['s1', 'Mother'], ['s2', 'Dad']]);
  });

  it('a rename to a name another stop already uses is refused with an explanation; Cancel discards the edit', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([
      { id: 's1', name: 'Mum', page: 61, updatedAt: '2026-10-11T09:00:00.000Z' },
      { id: 's2', name: 'Dad', page: 61, updatedAt: '2026-10-11T08:00:00.000Z' },
    ]));
    await render();
    await press(button(`${copy().renameStop}: Mum`));
    const field = root.root.findAllByType('TextInput' as never).find((node) => node.props.accessibilityLabel === `${copy().renameStop}: Mum`)!;
    await act(async () => field.props.onChangeText('dad'));
    await press(button(copy().saveName));
    expect(texts()).toContain(copy().stopNameTaken);
    await press(button(copy().cancelRename));
    expect(texts()).toEqual(expect.arrayContaining(['Mum', 'Dad']));
    expect(JSON.parse(state.storage.get(READING_STOPS_STORAGE_KEY)!).map((stop: { name: string }) => stop.name)).toEqual(['Mum', 'Dad']);
  });

  it('an empty name explains what is needed and saves nothing; Remove deletes a stop', async () => {
    await render();
    await press(button(copy().saveStop));
    expect(texts()).toContain(copy().stopNameInvalid);
    expect(state.storage.has(READING_STOPS_STORAGE_KEY)).toBe(false);

    await act(async () => nameField().props.onChangeText('Dad'));
    await press(button(copy().saveStop));
    await press(button(`${copy().removeStop}: Dad`));
    expect(texts()).toContain(copy().noStops);
    expect(JSON.parse(state.storage.get(READING_STOPS_STORAGE_KEY)!)).toEqual([]);
  });
});

describe('navigation and languages', () => {
  it('Back returns to the previous screen, or Home when opened directly', async () => {
    await render();
    await press(button(MESSAGES.en.ayah.goBack));
    expect(state.back).toHaveBeenCalledTimes(1);
    state.canGoBack = false;
    await press(button(MESSAGES.en.ayah.goBack));
    expect(state.replace).toHaveBeenCalledWith('/');
  });

  it.each(['ar', 'ar-EG'] as const)('%s: localized screen; the printed page itself is unchanged', async (locale) => {
    state.locale = locale;
    await render();
    expect(texts()).toEqual(expect.arrayContaining([MESSAGES[locale].mushaf.title, MESSAGES[locale].mushaf.tapHint, 'سورة آل عمران', 'الجزء الثالث', '٦١']));
    expect(button(MESSAGES[locale].mushaf.saveStop)).toBeDefined();
  });
});

describe('sizing', () => {
  it('waits for the measured width, then fills it (capped at 520) without overflowing', async () => {
    await act(async () => { root = create(createElement(MushafScreen)); });
    await flush();
    expect(root.root.findAllByType('SvgXml' as never)).toHaveLength(0);
    const area = root.root.findByProps({ testID: 'mushaf-page-area' });
    await act(async () => area.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 362.6, height: 0 } } }));
    const paper = root.root.findAllByType('View' as never).find((node) => [node.props.style].flat().some((style: { width?: number } | undefined) => style?.width === 362));
    expect(paper).toBeDefined();
    await act(async () => area.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 900, height: 0 } } }));
    expect(root.root.findByType('SvgXml' as never).props.width).toBeLessThan(520);
  });
});

describe('QPC V1 (1405 AH) renderer', () => {
  const MEASURE_WIDTH = 900; // natural width of the widest line at the measuring size
  async function renderQpc(layout = syntheticQpcPage61()) {
    state.fetch.mockResolvedValue(layoutResponse(200, { success: true, data: layout }));
    await render();
    await flush();
    await flush();
  }
  /** Simulates layout: the measuring pass, then each word's position on its line (right to left, 20 pt words, 10 pt gaps). */
  async function layOut(layout = syntheticQpcPage61()) {
    await act(async () => {
      for (const line of layout.lines) {
        root.root.findByProps({ testID: `qpc-measure-${line.line}` }).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: line.line === 1 ? MEASURE_WIDTH : 800, height: 100 } } });
      }
    });
    await act(async () => {
      for (const line of layout.lines) {
        const row = root.root.findByProps({ testID: `qpc-line-${line.line}` });
        row.findAll((node) => node.props.onLayout && node.parent === row).forEach((wordView, index) => {
          wordView.props.onLayout({ nativeEvent: { layout: { x: 400 - index * 30, y: 0, width: 20, height: 30 } } });
        });
      }
    });
  }
  const tapLine = async (line: number, locationX: number) => {
    await act(async () => root.root.findByProps({ testID: `qpc-line-${line}` }).props.onPress({ nativeEvent: { locationX, locationY: 10 } }));
  };

  it('is the default once the font is loaded and the layout passes the Tanzil check', async () => {
    await renderQpc();
    expect(String(state.fetch.mock.calls[0][0])).toMatch(/\/api\/mushaf\/qpc-v1\/pages\/61$/);
    expect(root.root.findAllByProps({ testID: 'qpc-v1-text' })).toHaveLength(1);
    expect(root.root.findAllByType('SvgXml' as never)).toHaveLength(0);
    expect(button(copy().rendererQpc)!.props.accessibilityState).toEqual({ selected: true });
    expect(texts()).toContain(copy().qpcCredit);
  });

  it('draws the 15 lines, right to left, with every word as its own unmodified glyph in the page font', async () => {
    const layout = syntheticQpcPage61();
    await renderQpc(layout);
    await layOut(layout);
    for (const line of layout.lines) {
      const row = root.root.findByProps({ testID: `qpc-line-${line.line}` });
      expect(Object.assign({}, ...[row.props.style].flat())).toMatchObject({ flexDirection: 'row-reverse', justifyContent: 'space-between' });
      const glyphs = row.findAllByType('Text' as never);
      expect(glyphs.map((node) => node.props.children)).toEqual(line.words.map((word) => word.glyph));
      for (const glyph of glyphs) expect(Object.assign({}, ...[glyph.props.style].flat()).fontFamily).toBe('QCF_P061');
    }
    expect(root.root.findAll((node) => /^qpc-line-\d+$/.test(String(node.props.testID)) && String(node.type) === 'Pressable')).toHaveLength(15);
  });

  it('sizes the font so the widest line fills the text area', async () => {
    await renderQpc();
    await layOut();
    const area = Object.assign({}, ...[root.root.findByProps({ testID: 'mushaf-text-area' }).props.style].flat()) as { width: number };
    const glyph = root.root.findByProps({ testID: 'qpc-line-1' }).findAllByType('Text' as never)[0];
    const size = Object.assign({}, ...[glyph.props.style].flat()).fontSize as number;
    expect(size).toBeCloseTo((100 * area.width * 0.985) / MEASURE_WIDTH);
  });

  it('with the phase-1C marker style, ayah markers are the font glyphs in medallion green; words in ink', async () => {
    state.params = { markers: 'qpc-glyph' };
    const layout = syntheticQpcPage61();
    await renderQpc(layout);
    await layOut(layout);
    const row4 = root.root.findByProps({ testID: 'qpc-line-4' }).findAllByType('Text' as never);
    const colorOf = (index: number) => Object.assign({}, ...[row4[index].props.style].flat()).color;
    const markerIndex = layout.lines[3].words.findIndex((word) => word.kind === 'end');
    expect(colorOf(markerIndex)).toBe('#3E7D57');
    expect(colorOf(0)).toBe('#231F20');
  });

  describe('appearance presets', () => {
    const paperColor = () => Object.assign({}, ...[root.root.findByProps({ testID: 'mushaf-paper' }).props.style].flat()).backgroundColor;
    const ornaments = () => root.root.findAll((node) => String(node.type) === 'Svg' && node.props.testID !== 'mushaf-frame' && typeof node.props.viewBox === 'string');
    const markerGlyphs = (layout: ReturnType<typeof syntheticQpcPage61>) => layout.lines.flatMap((line) => {
      const glyphs = root.root.findByProps({ testID: `qpc-line-${line.line}` }).findAllByType('Text' as never);
      return line.words.map((word, index) => ({ word, glyph: glyphs[index] })).filter(({ word }) => word.kind === 'end');
    });
    const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(3).filter(Boolean));

    it('by default it shows the approved design: Warm Cream and a traditional medallion for each of the 8 ayahs', async () => {
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      expect(paperColor()).toBe('#F9EFD2');
      expect(ornaments()).toHaveLength(8);
      for (const { glyph } of markerGlyphs(layout)) expect(styleOf(glyph).color).toBe('transparent');
      // Traditional colours: dark caps over the ornament, mint sides, cream centre.
      const fills = ornaments()[0].findAllByType('Ellipse' as never).map((node) => node.props.fill);
      expect(fills).toEqual(['#857850', '#9EC498', '#FBF7E4']);
      expect(styleOf(root.root.findByProps({ testID: 'qpc-line-1' }).findAllByType('Text' as never)[0]).color).toBe('#231F20');
    });

    it('the phase-1C page is restored exactly by its presets: Original Cream, the font`s green marker glyphs, no drawn medallions', async () => {
      state.params = { background: 'original', markers: 'qpc-glyph' };
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      expect(paperColor()).toBe('#F9F5DA');
      expect(ornaments()).toHaveLength(0);
      for (const { glyph } of markerGlyphs(layout)) expect(styleOf(glyph).color).toBe('#3E7D57');
    });

    it('a medallion style keeps each marker glyph in place, unpainted, and draws that ayah`s own medallion over it', async () => {
      state.params = { markers: 'traditional' };
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      const markers = markerGlyphs(layout);
      expect(markers).toHaveLength(8);
      for (const { word, glyph } of markers) {
        expect(glyph.props.children).toBe(word.glyph); // the glyph itself is unchanged
        expect(styleOf(glyph)).toMatchObject({ color: 'transparent', fontFamily: 'QCF_P061' });
        const ornament = glyph.parent!.findAll((node) => String(node.type) === 'Svg');
        expect(ornament).toHaveLength(1);
        expect(ornament[0].props.pointerEvents).toBe('none');
        const numberPath = ornament[0].findAllByType('Path' as never).at(-1)!.props.d;
        expect(numberPath).toBe(AYAH_MARKERS_061.markers.find((marker) => marker.verseKey === word.verseKey)!.numberPath);
      }
      // Words keep their ink; the paper is the approved Warm Cream.
      expect(styleOf(root.root.findByProps({ testID: 'qpc-line-1' }).findAllByType('Text' as never)[0]).color).toBe('#231F20');
      expect(paperColor()).toBe('#F9EFD2');
    });

    it('on iOS and Android the medallion follows the baseline the platform reports; implausible reports are ignored', async () => {
      state.params = { markers: 'quran-svg' };
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      const first = () => markerGlyphs(layout)[0];
      const top = () => styleOf(first().glyph.parent!.findAll((node) => String(node.type) === 'Svg')[0]).top as number;
      const fontSize = styleOf(first().glyph).fontSize as number;
      const webTop = top();
      await act(async () => first().glyph.props.onTextLayout({ nativeEvent: { lines: [{ y: 0, ascender: fontSize * 0.9 }] } }));
      expect(top()).not.toBeCloseTo(webTop);
      const reportedTop = top();
      await act(async () => first().glyph.props.onTextLayout({ nativeEvent: { lines: [{ y: 0, ascender: fontSize * 5 }] } }));
      expect(top()).toBeCloseTo(reportedTop);
    });

    it('a tap on a drawn medallion still selects the ayah it ends', async () => {
      state.params = { markers: 'traditional' };
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      const index = layout.lines[3].words.findIndex((word) => word.kind === 'end');
      await tapLine(4, 400 - index * 30 + 10);
      expect(texts()).toContain(`Aal-i-Imraan · ${layout.lines[3].words[index].verseKey} · آل عمران`);
    });

    it('the background preset changes only the paper; the SVG fallback page takes the same paper', async () => {
      state.params = { background: 'original' };
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      expect(paperColor()).toBe('#F9F5DA');
      expect(ornaments()).toHaveLength(8);
      await press(button(copy().rendererSvg));
      expect(paperColor()).toBe('#F9F5DA');
      expect(root.root.findAllByType('SvgXml' as never)).toHaveLength(1);
    });
  });

  it('tapping any word selects its ayah and highlights all of its lines; margins select nothing', async () => {
    const layout = syntheticQpcPage61();
    await renderQpc(layout);
    await layOut(layout);
    await tapLine(2, 405); // line 2's first word (x 400–420)
    expect(texts()).toContain('Aal-i-Imraan · 3:84 · آل عمران');
    // 3:84 runs over lines 1–4: a highlight on each, none elsewhere.
    for (const line of [1, 2, 3, 4]) expect(root.root.findAllByProps({ testID: `qpc-highlight-${line}` })).toHaveLength(1);
    expect(root.root.findAllByProps({ testID: 'qpc-highlight-5' })).toHaveLength(0);
    await tapLine(13, 405); // line 13 starts with 3:90
    expect(texts()).toContain('Aal-i-Imraan · 3:90 · آل عمران');
    await tapLine(13, 1000); // beyond the words: margin
    expect(texts()).toContain('Aal-i-Imraan · 3:90 · آل عمران');
  });

  it('every ayah 3:84–3:91 can be selected and opens Add Reflection for exactly that ayah', async () => {
    const layout = syntheticQpcPage61();
    await renderQpc(layout);
    await layOut(layout);
    for (const verseKey of layout.verseKeys) {
      const line = layout.lines.find((candidate) => candidate.words.some((word) => word.verseKey === verseKey))!;
      const index = line.words.findIndex((word) => word.verseKey === verseKey);
      await tapLine(line.line, 400 - index * 30 + 5);
      await press(button(MESSAGES.en.reflection.writeAction));
      expect(root.root.findByType('ReflectionSheet' as never).props).toMatchObject({ visible: true, verseKey });
      await act(async () => root.root.findByType('ReflectionSheet' as never).props.onClose());
    }
  });

  it('a layout that disagrees with the verified Tanzil text is never drawn: the SVG page shows instead', async () => {
    await renderQpc(syntheticQpcPage61({ dropWord: '3:87' }));
    expect(root.root.findAllByProps({ testID: 'qpc-v1-text' })).toHaveLength(0);
    expect(root.root.findAllByType('SvgXml' as never)).toHaveLength(1);
    expect(texts()).toContain(copy().qpcUnavailable);
  });

  it('without the font, or with the backend unavailable, the SVG page shows with a note', async () => {
    state.fontsLoaded = false;
    await renderQpc();
    expect(root.root.findAllByType('SvgXml' as never)).toHaveLength(1);
    expect(texts()).toContain(copy().qpcLoading);
  });

  it('the renderer can be switched to the Quran SVG page and back; selection carries over', async () => {
    const layout = syntheticQpcPage61();
    await renderQpc(layout);
    await layOut(layout);
    await tapLine(9, 405);
    await press(button(copy().rendererSvg));
    expect(root.root.findAllByType('SvgXml' as never)).toHaveLength(1);
    expect(texts()).toContain(copy().artworkCredit);
    expect(texts()).toContain('Aal-i-Imraan · 3:87 · آل عمران');
    await press(button(copy().rendererQpc));
    expect(root.root.findAllByProps({ testID: 'qpc-v1-text' })).toHaveLength(1);
  });

  it('reading stops still save the whole page with QPC V1 shown', async () => {
    await renderQpc();
    const field = root.root.findAllByType('TextInput' as never).find((node) => node.props.accessibilityLabel === copy().stopNameLabel)!;
    await act(async () => field.props.onChangeText('Ramadan'));
    await press(button(copy().saveStop));
    expect(JSON.parse(state.storage.get(READING_STOPS_STORAGE_KEY)!)[0]).toMatchObject({ name: 'Ramadan', page: 61 });
  });
});

describe('offline Mushaf', () => {
  const panelTexts = () => root.root.findByProps({ testID: 'offline-mushaf' }).findAllByType('Text' as never).map((node) => [node.props.children].flat().join(''));

  it('when installed, page 61 comes from the device (no network) and still passes the Tanzil check', async () => {
    state.offline.status.mockResolvedValue({ installed: true, version: 'a'.repeat(24), syncedAt: '2026-10-11T00:00:00.000Z', installedAt: '2026-10-11T00:00:00.000Z', lastCheckAt: '2026-10-11T00:00:00.000Z', attribution: 'Quran Foundation', stagedChunks: 0 });
    state.offline.readPage.mockResolvedValue(syntheticQpcPage61());
    await render();
    await flush();
    expect(state.offline.readPage).toHaveBeenCalledWith(61);
    expect(state.fetch).not.toHaveBeenCalledWith(expect.stringMatching(/qpc-v1\/pages\/61/), expect.anything(), expect.anything());
    expect(root.root.findAllByProps({ testID: 'qpc-v1-text' })).toHaveLength(1);
    expect(panelTexts().join(' ')).toMatch(new RegExp(`${copy().offlineReady} · ${copy().offlineUpdatedFrom}`));
    expect(button(copy().offlineRemove)).toBeDefined();
  });

  it('a layout from the device that disagrees with the verified text is never drawn', async () => {
    state.offline.readPage.mockResolvedValue(syntheticQpcPage61({ dropWord: '3:87' }));
    await render();
    await flush();
    expect(root.root.findAllByProps({ testID: 'qpc-v1-text' })).toHaveLength(0);
    expect(root.root.findAllByType('SvgXml' as never)).toHaveLength(1);
  });

  it('Download shows progress, can be cancelled, and explains failures in the user`s language', async () => {
    let resolveDownload: (value: unknown) => void = () => undefined;
    state.offline.download.mockImplementation(({ signal, onProgress }: { signal: AbortSignal; onProgress: (p: unknown) => void }) => new Promise((resolve, reject) => {
      onProgress({ phase: 'downloading', chunksTotal: 31, chunksReady: 10, bytesTotal: 1000, bytesReady: 500 });
      signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { kind: 'cancelled' })));
      resolveDownload = resolve;
    }));
    await render();
    await flush();
    await press(button(copy().offlineDownload));
    expect(panelTexts().join(' ')).toMatch(new RegExp(`${copy().offlineDownloading} 50%`));
    await press(button(copy().offlineCancel));
    await flush();
    void resolveDownload;
    // The mock's error isn't an OfflineMushafError, so the generic message shows; a typed one is explained:
    const { OfflineMushafError } = await import('@/mushaf/offline');
    state.offline.download.mockRejectedValue(new (OfflineMushafError as unknown as new (m: string, k: string) => Error)('full', 'insufficient_storage'));
    await press(button(copy().offlineDownload));
    await flush();
    expect(panelTexts()).toContain(copy().offlineErrorStorage);
  });

  it('a finished download says so; a partial one offers to continue', async () => {
    state.offline.status.mockResolvedValue({ installed: false, stagedChunks: 7 });
    state.offline.download.mockResolvedValue({ status: 'installed', version: 'b'.repeat(24), downloadedChunks: 24, reusedChunks: 0 });
    await render();
    await flush();
    await press(button(copy().offlineResume));
    await flush();
    expect(panelTexts()).toContain(copy().offlineReady);
  });
});

describe('Dark Mode', () => {
  const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(3).filter(Boolean));

  it('with the app in Dark Mode the page is Warm Midnight Olive: cream ink, light heads, the approved border unchanged', async () => {
    state.theme = 'dark';
    state.fetch.mockResolvedValue(layoutResponse(200, { success: true, data: syntheticQpcPage61() }));
    await render();
    await flush();
    await flush();
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-paper' })).backgroundColor).toBe('#222820');
    // The measuring pass draws every glyph with the page's ink (the visible lines use the same style).
    const glyph = root.root.findByProps({ testID: 'qpc-measure-1' }).findAllByType('Text' as never)[0];
    expect(styleOf(glyph).color).toBe('#F1E9D6');
    const head = root.root.findAllByType('Text' as never).find((node) => node.props.children === 'سورة آل عمران')!;
    expect(styleOf(head).color).toBe('#F1E9D6');
    const { BORDER_INKS } = await import('@/mushaf/borderPattern');
    const fills = root.root.findByProps({ testID: 'mushaf-frame' }).findAllByType('Path' as never).map((node) => node.props.fill);
    expect(new Set(fills)).toEqual(new Set(Object.values(BORDER_INKS)));
  });

  it('the Quran SVG fallback is recoloured for the dark page', async () => {
    state.theme = 'dark';
    await render();
    const artwork = root.root.findByType('SvgXml' as never);
    expect(artwork.props.xml).not.toContain('fill="#231f20"');
    expect(artwork.props.xml).toContain('fill="#F1E9D6"');
  });

  it('Light Mode is unchanged', async () => {
    await render();
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-paper' })).backgroundColor).toBe('#F9EFD2');
    expect(root.root.findByType('SvgXml' as never).props.xml).toContain('fill="#231f20"');
  });
});
