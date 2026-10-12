import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@/localization/messages';

/**
 * The /mushaf reader: a plain Back arrow under the status bar, the printed
 * page (QPC V1, or the Quran SVG fallback for page 61) as large as it fits,
 * pinch-to-zoom, and the floating icon-only bar (previous, reflection
 * lightbulb, page search, bookmark, next) with swipe paging at 1×.
 * Mocked native modules; the real verified Quran database for the Tanzil
 * check; SYNTHETIC QPC V1 layouts (no Quran Foundation data).
 */

type MockGesture = { kind: 'pinch' | 'pan' | 'tap'; handlers: Record<string, (...args: unknown[]) => void>; config: Record<string, unknown> };
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
  storage: new Map<string, string>(),
  fontsLoaded: true,
  fetch: vi.fn(),
  params: {} as Record<string, string>,
  theme: 'light' as 'light' | 'dark',
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
  /** The دعاء ختم القرآن text (mushaf/khatmDua.ts mock): null, as now, until a verified version is approved. */
  khatmDua: null as null | { paragraphs: string[]; source: string },
  /** The page's gestures as last rendered (react-native-gesture-handler mock), to drive pinches, drags, swipes and taps. */
  gesture: null as null | { gestures: { __g: MockGesture }[] },
  /** The zoomed page's animated style (Reanimated mock), read after gestures. */
  animatedStyle: null as null | (() => { transform: Record<string, number>[] }),
  canGoBack: true,
  /** Android hardware Back listeners currently subscribed (BackHandler mock). */
  backHandlers: [] as (() => boolean)[],
  loadFont: vi.fn(),
  offline: {
    readPage: vi.fn(),
    status: vi.fn(),
    download: vi.fn(),
    remove: vi.fn(),
    pageFont: vi.fn(),
  },
}));
vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  type ListProps = { data: unknown[]; renderItem: (info: { item: unknown; index: number }) => unknown; ListEmptyComponent?: unknown; keyExtractor: (item: unknown) => string };
  return {
    Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
    StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    Keyboard: { dismiss: vi.fn() },
    BackHandler: {
      addEventListener: (_event: string, handler: () => boolean) => {
        state.backHandlers.push(handler);
        return { remove: () => { state.backHandlers = state.backHandlers.filter((h) => h !== handler); } };
      },
    },
    // Like a device: a closed modal shows nothing.
    Modal: ({ visible, children, ...rest }: { visible: boolean; children: unknown }) => (visible ? h('Modal', rest, children as never) : null),
    // Renders every row (the real list virtualises them).
    FlatList: ({ data, renderItem, ListEmptyComponent, keyExtractor, ...rest }: ListProps) =>
      h('FlatList', rest, ...(data.length ? data.map((item, index) => h('Row', { key: keyExtractor(item) }, renderItem({ item, index }) as never)) : [ListEmptyComponent as never])),
    TouchableWithoutFeedback: 'TouchableWithoutFeedback',
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
  };
});
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', SvgXml: 'SvgXml', Defs: 'Defs', Ellipse: 'Ellipse', G: 'G', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => state.insets }));
vi.mock('lucide-react-native', () => ({
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Bookmark: 'Bookmark', Check: 'Check', ChevronDown: 'ChevronDown', Maximize: 'Maximize', Minimize: 'Minimize', Plus: 'Plus', Search: 'Search', X: 'X',
}));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), replace: vi.fn(), push: vi.fn(), canGoBack: () => state.canGoBack }, useLocalSearchParams: () => state.params }));
vi.mock('@/mushaf/khatmDua', async (original) => ({ ...(await original<object>()), get KHATM_DUA() { return state.khatmDua; } }));
vi.mock('react-native-gesture-handler', () => {
  // Each Gesture.X() records its handlers (onStart…) and settings (enabled, maxPointers…), chainable like the real builder.
  const builder = (kind: MockGesture['kind']) => {
    const gesture: MockGesture = { kind, handlers: {}, config: {} };
    const api: unknown = new Proxy({}, {
      get: (_target, prop: string) => (prop === '__g' ? gesture : (...args: unknown[]) => {
        if (/^on[A-Z]/.test(prop)) gesture.handlers[prop] = args[0] as (...a: unknown[]) => void;
        else gesture.config[prop] = args[0];
        return api;
      }),
    });
    return api;
  };
  return {
    GestureHandlerRootView: 'GestureHandlerRootView',
    GestureDetector: ({ gesture, children }: { gesture: typeof state.gesture; children: unknown }) => { state.gesture = gesture; return children; },
    Gesture: { Pinch: () => builder('pinch'), Pan: () => builder('pan'), Tap: () => builder('tap'), Simultaneous: (...gestures: unknown[]) => ({ gestures }) },
  };
});
vi.mock('react-native-reanimated', async () => {
  const { useRef } = await import('react');
  return {
    default: { View: 'AnimatedView' },
    useSharedValue: (initial: unknown) => {
      const ref = useRef<{ get: () => unknown; set: (v: unknown) => void } | null>(null);
      if (!ref.current) { let value = initial; ref.current = { get: () => value, set: (next) => { value = next; } }; }
      return ref.current;
    },
    useAnimatedStyle: (style: () => { transform: Record<string, number>[] }) => { state.animatedStyle = style; return style(); },
    withTiming: (value: number) => value,
  };
});
vi.mock('react-native-worklets', () => ({ scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args) }));
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
vi.mock('expo-font', () => ({ useFonts: () => [state.fontsLoaded, null], loadAsync: state.loadFont, isLoaded: () => false }));
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

const { default: MushafScreen, parsePageNumber, fitMushafPage, BACK_BAR_HEIGHT, TALLER_MAX_TILES_DOWN, TALLER_MAX_LINE_SPACING } = await import('@/app/mushaf');
const { router } = await import('expo-router');
const { MUSHAF_PANEL_COLORS } = await import('@/constants/mushafTheme');
const { ReflectionBulbIcon } = await import('@/components/ReflectionBulbIcon');
const typeName = (node: ReactTestInstance) => (typeof node.type === 'string' ? node.type : (node.type as { name: string }).name);
const { ACTIVE_READING_STOP_STORAGE_KEY, READING_STOPS_STORAGE_KEY } = await import('@/mushaf/readingStops');
const { SURAH_START_PAGES } = await import('@/mushaf/generated/surahStartPages');
const { syntheticQpcPage61 } = await import('./helpers/syntheticQpcPage61');
const { drag, flick, runTouch } = await import('./helpers/gestureSimulator');
const { MUSHAF_SCREEN_OPTIONS } = await import('@/mushaf/screenOptions');
const { AYAH_MARKERS_061 } = await import('@/mushaf/generated/ayahMarkers061');
const { BORDER_INKS } = await import('@/mushaf/borderPattern');
const layoutResponse = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let root: ReactTestRenderer;
const copy = () => MESSAGES[state.locale].mushaf;
const pressables = () => root.root.findAllByType('Pressable' as never);
const button = (label: string) => pressables().find((node) => node.props.accessibilityLabel === label);
const texts = () => root.root.findAllByType('Text' as never).map((node) => [node.props.children].flat().join(''));
const page = () => pressables().find((node) => node.props.accessibilityRole === 'image')!;
const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean));
const styleOf = (node: ReactTestInstance) => flat(node.props.style);
/** Within a QPC V1 line's row: the drawn line's centre (iOS draws the glyphs lower than laid out: qcfV1DrawnLineShiftEm). */
async function drawnLineY(line: ReactTestInstance) {
  const { qcfV1DrawnLineShiftEm } = await import('@/mushaf/ayahMarkers');
  const fontSize = flat(line.findAllByType('Text' as never)[0].props.style).fontSize as number;
  return (flat(line.props.style).height as number) / 2 + qcfV1DrawnLineShiftEm(61, 'ios') * fontSize;
}
const flush = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };
const panelButton = (key: string) => root.root.findByProps({ testID: `mushaf-panel-${key}` });
const shownPageNumber = () => root.root.findAllByType('Text' as never).map((node) => [node.props.children].flat().join('')).find((text) => /^[0-9٠-٩]{1,3}$/.test(text));

/** Taps the rendered SVG page at a point given in the page's own 345 × 550 coordinates. */
async function tapPage(x: number, y: number) {
  const { width, height } = Object.assign({}, ...[page().props.style].flat()) as { width: number; height: number };
  await act(async () => page().props.onPress({ nativeEvent: { locationX: (x / 345) * width, locationY: (y / 550) * height } }));
}
async function press(node: ReactTestInstance | undefined) {
  await act(async () => { await node!.props.onPress(); });
}
/** The reader's measured space: a 390 × 844 phone below its 47-pt status bar. */
async function render(area = { width: 390, height: 797 }) {
  await act(async () => { root = create(createElement(MushafScreen)); });
  await flush();
  await act(async () => root.root.findByProps({ testID: 'mushaf-page-area' }).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, ...area } } }));
  await flush();
  await flush();
}
const gesture = (pick: (g: MockGesture) => boolean) => state.gesture!.gestures.map((g) => g.__g).find(pick)!;
const pinchGesture = () => gesture((g) => g.kind === 'pinch');
const swipeGesture = () => gesture((g) => g.kind === 'pan' && 'activeOffsetX' in g.config);
const dragGesture = () => gesture((g) => g.kind === 'pan' && !('activeOffsetX' in g.config) && !('activeOffsetY' in g.config));
const swipeDownGesture = () => gesture((g) => g.kind === 'pan' && 'activeOffsetY' in g.config);
const doubleTapGesture = () => gesture((g) => g.kind === 'tap');
const enabled = (g: MockGesture) => g.config.enabled !== false;
/** The page's current zoom: { scale, x, y } from its animated transform. */
const zoom = () => {
  const [{ translateX: x }, { translateY: y }, { scale }] = state.animatedStyle!().transform;
  return { scale, x, y };
};
/** A one-finger drag; at 1× the swipe gesture decides (its activation offsets as configured), when zoomed the drag moves the page. */
async function swipe(dx: number, dy = 0) {
  await act(async () => {
    const turn = swipeGesture();
    const [, activeX] = turn.config.activeOffsetX as number[];
    const [, failY] = turn.config.failOffsetY as number[];
    if (enabled(turn) && Math.abs(dx) > activeX && Math.abs(dy) < failY) turn.handlers.onEnd({ translationX: dx, translationY: dy }, true);
    const move = dragGesture();
    if (enabled(move)) {
      move.handlers.onStart({});
      move.handlers.onUpdate({ translationX: dx, translationY: dy });
      move.handlers.onEnd?.({}, true);
    }
  });
  await flush();
  await flush();
}
/** Two fingers: from their midpoint at `from` (viewport coordinates), spread by `scale`, ending at `to`. */
async function pinch(scale: number, from = { x: 195, y: 300 }, to = from) {
  await act(async () => {
    const g = pinchGesture();
    if (!enabled(g)) return;
    g.handlers.onStart({ focalX: from.x, focalY: from.y });
    g.handlers.onUpdate({ scale, focalX: to.x, focalY: to.y });
    g.handlers.onEnd({}, true);
  });
  await flush();
}
/** A one-finger swipe down from screen y `fromY` (full-screen reading's exit), through the gesture's own activation settings. */
async function swipeDown(dy: number, dx = 0, fromY = 300) {
  await act(async () => {
    const g = swipeDownGesture();
    const activeY = g.config.activeOffsetY as number;
    const [, failX] = g.config.failOffsetX as number[];
    if (enabled(g) && dy > activeY && Math.abs(dx) < failX) g.handlers.onEnd({ translationX: dx, translationY: dy, absoluteY: fromY + dy }, true);
    // Zoomed, the same drag moves the page instead.
    const move = dragGesture();
    if (enabled(move)) {
      move.handlers.onStart({});
      move.handlers.onUpdate({ translationX: dx, translationY: dy });
    }
  });
  await flush();
}
async function doubleTap() {
  await act(async () => { const g = doubleTapGesture(); if (enabled(g)) g.handlers.onEnd({}, true); });
  await flush();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.storage.clear();
  state.fontsLoaded = true;
  state.params = {};
  state.theme = 'light';
  state.insets = { top: 47, bottom: 34, left: 0, right: 0 };
  state.canGoBack = true;
  state.khatmDua = null;
  state.backHandlers = [];
  vi.mocked(router.back).mockClear();
  vi.mocked(router.replace).mockClear();
  state.loadFont.mockReset().mockResolvedValue(undefined);
  state.offline.readPage.mockReset().mockResolvedValue(null);
  state.offline.status.mockReset().mockResolvedValue({ installed: false, stagedChunks: 0 });
  state.offline.download.mockReset();
  state.offline.remove.mockReset().mockResolvedValue(undefined);
  state.offline.pageFont.mockReset().mockResolvedValue(null);
  // Default: the 1405 layout is unavailable, so page 61 shows the Quran SVG fallback.
  state.fetch.mockReset().mockResolvedValue(layoutResponse(503, { success: false }));
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('full-screen reading view', () => {
  it('a slim Back row under the status bar, then the page; no title, prototype note, hint or renderer switch', async () => {
    await render();
    const reader = root.root.findByType('GestureHandlerRootView' as never);
    expect(styleOf(reader)).toMatchObject({ paddingTop: 47, flex: 1 });
    const [backBar, pageArea] = reader.children as ReactTestInstance[];
    expect(backBar.props.testID).toBe('mushaf-back-bar');
    expect(styleOf(backBar).height).toBe(BACK_BAR_HEIGHT);
    expect(pageArea.props.testID).toBe('mushaf-page-area');
    const shown = texts();
    for (const hidden of [copy().title, copy().prototypeNote, copy().tapHint, copy().renderer, copy().rendererQpc, copy().rendererSvg]) expect(shown).not.toContain(hidden);
    expect(button(copy().rendererQpc)).toBeUndefined();
  });

  it('no source credit under the page (it is on Home and in Quran Sources & Credits)', async () => {
    await render();
    expect(texts().join(' ')).not.toMatch(/Quran Foundation|King Fahd|Tanzil/);
  });

  it('shows page 61 whole: surah and juz` heads, the border, the Arabic-Indic page number', async () => {
    await render();
    expect(texts()).toEqual(expect.arrayContaining(['سورة آل عمران', 'الجزء الثالث', '٦١']));
    const frame = root.root.findByProps({ testID: 'mushaf-frame' });
    expect(frame.findAllByType('Path' as never)).toHaveLength(6);
    const wrapper = frame.parent!.parent!;
    expect(wrapper.props.pointerEvents).toBe('none');
    expect(wrapper.props.importantForAccessibility).toBe('no-hide-descendants');
    const artwork = root.root.findByType('SvgXml' as never);
    expect(artwork.props.xml.match(/fill="#3E7D57"/g)).toHaveLength(8);
    for (const text of ['سورة آل عمران', 'الجزء الثالث', '٦١']) {
      expect(styleOf(root.root.findAllByType('Text' as never).find((node) => node.props.children === text)!).fontFamily).toBe('Amiri_700Bold');
    }
  });

  it('takes the largest page that fits above the floating bar, in its own proportions, never cropped', async () => {
    const { computePageLayout } = await import('@/mushaf/pageGeometry');
    const aspect = computePageLayout(1000).page.height / 1000;
    const paperSize = () => styleOf(root.root.findByProps({ testID: 'mushaf-paper' }));
    const reserved = 4 + 56 + 8 + 34; // gap to the bar, the bar, its margin, home indicator
    // Phone: the width decides, 3 pt from each edge.
    await render({ width: 390, height: 761 });
    expect(paperSize().width).toBe(384);
    expect(paperSize().height).toBeCloseTo(384 * aspect);
    expect(paperSize().height).toBeLessThanOrEqual(761 - reserved);
    await act(async () => root.unmount());
    // Tablet: the height decides.
    await render({ width: 820, height: 1130 });
    expect(paperSize().width).toBe(Math.floor((1130 - reserved - 32) / aspect)); // leaving the ورد row free
    expect(paperSize().width).toBeLessThan(820);
    // The SVG page keeps its own proportions inside.
    const { width, height } = Object.assign({}, ...[page().props.style].flat()) as { width: number; height: number };
    expect(height / width).toBeCloseTo(550 / 345);
  });

  it('fits iPhone, Android (gesture and 3-button navigation), a small phone and a tablet from their real safe areas', () => {
    const aspect = 1.6088532883642497;
    // area = screen − top inset − Back row; the bottom inset is passed separately.
    const fit = (w: number, h: number, top: number, bottom: number) => fitMushafPage({ width: w, height: h - top - BACK_BAR_HEIGHT }, bottom);
    const cases = [
      { name: 'iPhone 393 × 852 (Dynamic Island, home indicator)', size: fit(393, 852, 59, 34), width: 387 },
      { name: 'Android 412 × 915, gesture navigation', size: fit(412, 915, 24, 24), width: 406 },
      { name: 'Android 412 × 915, 3-button navigation', size: fit(412, 915, 24, 48), width: 406 },
      { name: 'small phone 320 × 568: the height decides', size: fit(320, 568, 20, 0), width: Math.floor((568 - 20 - 36 - 68 - 32) / aspect) },
      { name: 'iPad 820 × 1180', size: fit(820, 1180, 24, 20), width: Math.floor((1180 - 24 - 36 - 88 - 32) / aspect) },
    ];
    for (const { name, size, width } of cases) {
      expect(size.page.width, name).toBe(width);
      expect(size.page.height / size.page.width, name).toBeCloseTo(aspect);
      expect(size.page.height, name).toBeLessThanOrEqual(size.viewport.height - 32); // the ورد row stays free
    }
  });
});

describe('the whole Quran text area MUSHAF_TEXT_LIFT_PT above the printed one, the same on every page, in both modes', () => {
  it('Normal and Full-Screen: one lift, applied once; page, frame and text-area size unchanged; switching back restores it', async () => {
    const { computePageLayout, MUSHAF_TEXT_LIFT_PT } = await import('@/mushaf/pageGeometry');
    expect(MUSHAF_TEXT_LIFT_PT).toBe(4);
    await render({ width: 393, height: 852 - 59 - BACK_BAR_HEIGHT });
    const area = () => styleOf(root.root.findByProps({ testID: 'mushaf-text-area' }));
    const paper = () => styleOf(root.root.findByProps({ testID: 'mushaf-paper' }));
    const width = paper().width;
    const printed = computePageLayout(width);
    expect(paper().height).toBeCloseTo(printed.page.height, 9);
    expect(area().height).toBeCloseTo(printed.text.height, 9);
    expect(area().width).toBeCloseTo(printed.text.width, 9);
    expect(area().top).toBeCloseTo(printed.text.y - MUSHAF_TEXT_LIFT_PT, 9);
    expect(area().left).toBeCloseTo(printed.text.x, 9);
    await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
    const full = computePageLayout(paper().width, Math.round((paper().height - printed.page.height) / (width / 20)) + 29);
    expect(area().top).toBeCloseTo(full.text.y - MUSHAF_TEXT_LIFT_PT, 9);
    expect(area().height).toBeCloseTo(full.text.height, 9);
    await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
    expect(area().top).toBeCloseTo(printed.text.y - MUSHAF_TEXT_LIFT_PT, 9);
  });
});

/**
 * The Android screen matrix for the Mushaf audits (2026-10-12): for each phone size (dp), system bars and density, the
 * reading area the app gets and the page fitMushafPage fits there, in Normal and Full-Screen. Android 15+ draws edge
 * to edge (Expo SDK 57): the status bar (taller with a display cutout) and the navigation bar (gesture handle or three
 * buttons) are safe-area insets; the reader pads the top inset and puts the 36-dp Back row under it. With
 * ANDROID_MATRIX_OUT set, the matrix is written there for tools/mushaf-audit/audit_android_rendering.py.
 */
describe('Android screen matrix', () => {
  const SCREENS = [
    { name: 'Small Android 320x640', w: 320, h: 640, densities: [2, 1.5] },
    { name: 'Galaxy S-class 360x780', w: 360, h: 780, densities: [3, 2.8125, 2] },
    { name: 'Galaxy A-class 384x854', w: 384, h: 854, densities: [2.8125, 2.5] },
    { name: 'Pixel-class 393x852', w: 393, h: 852, densities: [2.75, 3] },
    { name: 'Pixel 412x915', w: 412, h: 915, densities: [2.625, 3.5] },
    { name: 'Large Android 432x960', w: 432, h: 960, densities: [2.5, 3.333] },
  ];
  const BARS = [
    { status: 24, nav: 24, label: 'status 24, gesture' },
    { status: 24, nav: 48, label: 'status 24, 3-button' },
    { status: 36, nav: 24, label: 'cutout 36, gesture' },
    { status: 52, nav: 48, label: 'cutout 52, 3-button' },
  ];
  it('every configuration fits a whole page: Normal the printed 29 tiles, Full-Screen as tall as fits', async () => {
    const { writeFileSync } = await import('node:fs');
    const rows = [];
    for (const screen of SCREENS) {
      for (const bars of BARS) {
        const area = { width: screen.w, height: screen.h - bars.status - BACK_BAR_HEIGHT };
        const normal = fitMushafPage(area, bars.nav, false, false);
        const full = fitMushafPage(area, bars.nav, true, true);
        expect(normal.tilesDown).toBe(29);
        expect(full.tilesDown).toBeGreaterThanOrEqual(29);
        for (const fit of [normal, full]) {
          expect(fit.page.width, `${screen.name} ${bars.label}`).toBeGreaterThan(250);
          expect(fit.page.width).toBeLessThanOrEqual(screen.w - 6);
          expect(fit.page.height).toBeLessThanOrEqual(fit.viewport.height);
        }
        for (const density of screen.densities) {
          rows.push({ screen: screen.name, bars: bars.label, density, mode: 'normal', pageWidth: normal.page.width, tilesDown: normal.tilesDown });
          rows.push({ screen: screen.name, bars: bars.label, density, mode: 'fullScreen', pageWidth: full.page.width, tilesDown: full.tilesDown });
        }
      }
    }
    expect(rows).toHaveLength(13 * 4 * 2);
    if (process.env.ANDROID_MATRIX_OUT) writeFileSync(process.env.ANDROID_MATRIX_OUT, JSON.stringify(rows, null, 1));
  });
});

describe('the Back arrow', () => {
  it('is a plain arrow-left on the left: no circle, background, border, shadow or label; a 44-pt target', async () => {
    await render();
    const back = root.root.findByProps({ testID: 'mushaf-back' });
    expect(back.props.accessibilityLabel).toBe(MESSAGES.en.ayah.goBack);
    expect(back.findAllByType('Text' as never)).toHaveLength(0);
    expect(back.findByType('ArrowLeft' as never).props.color).toBe(MUSHAF_PANEL_COLORS.light.icon);
    const look = Object.assign({}, ...[back.props.style({ pressed: false })].flat(3).filter(Boolean));
    for (const key of ['backgroundColor', 'borderWidth', 'borderRadius', 'shadowOpacity', 'elevation']) expect(look[key], key).toBeUndefined();
    expect(look.width).toBe(44);
    expect(look.height + back.props.hitSlop.top + back.props.hitSlop.bottom).toBe(44);
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-back-bar' }))).toMatchObject({ flexDirection: 'row', justifyContent: 'space-between' });
    expect((root.root.findByProps({ testID: 'mushaf-back-bar' }).children[0] as ReactTestInstance).props.testID).toBe('mushaf-back'); // first: the left
  });

  it('returns to the previous screen, or Home when there is none', async () => {
    await render();
    await press(root.root.findByProps({ testID: 'mushaf-back' }));
    expect(router.back).toHaveBeenCalledTimes(1);
    state.canGoBack = false;
    await press(root.root.findByProps({ testID: 'mushaf-back' }));
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('stays visible while zoomed (outside the zoomed page, never over it)', async () => {
    await render();
    await pinch(2.5);
    const viewport = root.root.findByProps({ testID: 'mushaf-zoom-viewport' });
    expect(styleOf(viewport).overflow).toBe('hidden');
    expect(viewport.findAllByProps({ testID: 'mushaf-back' })).toHaveLength(0);
    expect(root.root.findAllByProps({ testID: 'mushaf-back' })).toHaveLength(1);
  });

  it('in Dark Mode is drawn in the warm ivory icon colour', async () => {
    state.theme = 'dark';
    await render();
    expect(root.root.findByProps({ testID: 'mushaf-back' }).findByType('ArrowLeft' as never).props.color).toBe(MUSHAF_PANEL_COLORS.dark.icon);
  });
});

describe('full-screen reading', () => {
  const toggle = () => root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' });
  const has = (testID: string) => root.root.findAllByProps({ testID }).length > 0;
  const paperSize = () => styleOf(root.root.findByProps({ testID: 'mushaf-paper' }));
  const pressBack = async () => {
    let handled: boolean | undefined;
    await act(async () => { handled = state.backHandlers.at(-1)?.(); });
    return handled;
  };

  it('Normal Mode is the default: Back on the left, a plain Expand icon on the right, the bar and the ورد pill', async () => {
    await render();
    const bar = root.root.findByProps({ testID: 'mushaf-back-bar' });
    expect((bar.children as ReactTestInstance[]).map((child) => child.props.testID)).toEqual(['mushaf-back', 'mushaf-fullscreen-toggle']);
    expect(toggle().props.accessibilityLabel).toBe(copy().enterFullScreen);
    expect(toggle().findAllByType('Maximize' as never)).toHaveLength(1);
    expect(toggle().findByType('Maximize' as never).props.color).toBe(MUSHAF_PANEL_COLORS.light.icon);
    expect(toggle().findAllByType('Text' as never)).toHaveLength(0);
    const look = flat(toggle().props.style({ pressed: false }));
    for (const key of ['backgroundColor', 'borderWidth', 'borderRadius', 'shadowOpacity', 'elevation']) expect(look[key], key).toBeUndefined();
    expect(look.width).toBe(44);
    expect(look.height + toggle().props.hitSlop.top + toggle().props.hitSlop.bottom).toBe(44);
    for (const id of ['mushaf-back', 'mushaf-panel', 'mushaf-wird-row']) expect(has(id), id).toBe(true);
    expect(state.backHandlers).toHaveLength(0); // Android Back navigates as usual in Normal Mode
  });

  it('Expand shows only the page and a Collapse icon in the same place; Collapse restores every control', async () => {
    await render();
    await press(toggle());
    for (const id of ['mushaf-back', 'mushaf-panel', 'mushaf-wird-row', 'mushaf-wird']) expect(has(id), id).toBe(false);
    expect(has('mushaf-paper')).toBe(true);
    expect(texts()).toEqual(expect.arrayContaining(['سورة آل عمران', 'الجزء الثالث', '٦١']));
    expect(toggle().props.accessibilityLabel).toBe(copy().exitFullScreen);
    expect(toggle().findAllByType('Minimize' as never)).toHaveLength(1);
    expect((root.root.findByProps({ testID: 'mushaf-back-bar' }).children as ReactTestInstance[]).at(-1)!.props.testID).toBe('mushaf-fullscreen-toggle');
    await press(toggle());
    for (const id of ['mushaf-back', 'mushaf-panel', 'mushaf-wird-row']) expect(has(id), id).toBe(true);
    expect(styleOf(root.root.findByType('KeyboardAvoidingView' as never)).bottom).toBe(34 + 8); // the bar back in its safe place
  });

  it('the page takes the reclaimed space where the screen allows, in its own proportions; on phones the width still decides', async () => {
    const { computePageLayout } = await import('@/mushaf/pageGeometry');
    const aspect = computePageLayout(1000).page.height / 1000;
    // Tablet: the height decides, so the page grows.
    await render({ width: 820, height: 1130 });
    const normal = paperSize();
    await press(toggle());
    const full = paperSize();
    expect(full.width).toBe(Math.floor((1130 - 34 - 4) / aspect));
    expect(full.width).toBeGreaterThan(normal.width);
    expect(full.height / full.width).toBeCloseTo(normal.height / normal.width);
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-zoom-viewport' })).height).toBe(1130 - 34 - 4);
    await act(async () => root.unmount());
    // Phone: as wide as before (3 pt from the sides), so the same size.
    await render({ width: 390, height: 761 });
    await press(toggle());
    expect(paperSize().width).toBe(384);
  });

  it('fits the entire page, centred in the space below the Collapse row; never zoomed to fill or cropped', async () => {
    await render({ width: 390, height: 761 });
    const viewport = () => root.root.findByProps({ testID: 'mushaf-zoom-viewport' });
    expect(styleOf(viewport()).justifyContent).toBeUndefined(); // Normal Mode: the page sits at the top, as approved
    await press(toggle());
    const box = styleOf(viewport());
    expect(box).toMatchObject({ justifyContent: 'center', alignItems: 'center', overflow: 'hidden' });
    const page = styleOf(root.root.findByProps({ testID: 'mushaf-zoom-page' }));
    expect(page.width).toBe(384);
    expect(page.height).toBeLessThanOrEqual(box.height); // the whole page is visible at 1×
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 }); // fitted, not zoomed to fill
    // Zoomed, the centred page can be moved equally far up and down, and always covers the screen.
    await pinch(3);
    await swipe(0, -5000);
    const up = zoom().y;
    await swipe(0, 10000);
    const down = zoom().y;
    expect(down).toBeCloseTo(-up);
    expect(down).toBeCloseTo((page.height * 3 - box.height) / 2);
    await doubleTap();
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 }); // back to the fitted full page
  });

  it('fits iPhone, Android and tablets from their safe areas', () => {
    const fit = (w: number, h: number, top: number, bottom: number) => fitMushafPage({ width: w, height: h - top - BACK_BAR_HEIGHT }, bottom, true);
    const cases = [
      { name: 'iPhone 393 × 852', size: fit(393, 852, 59, 34), width: 387 },
      { name: 'Android gesture navigation', size: fit(412, 915, 24, 24), width: 406 },
      { name: 'Android 3-button navigation', size: fit(412, 915, 24, 48), width: 406 },
      { name: 'small phone 320 × 568', size: fit(320, 568, 20, 0), width: 314 },
      { name: 'iPad 820 × 1180', size: fit(820, 1180, 24, 20), width: Math.floor((1180 - 24 - 36 - 20 - 4) / 1.6088532883642497) },
    ];
    for (const { name, size, width } of cases) {
      expect(size.page.width, name).toBe(width);
      expect(size.page.height, name).toBeLessThanOrEqual(size.viewport.height);
    }
  });

  it('keeps the page, the selected ayah and the active ورد; the reflection returns with the bar for the same ayah', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'fajr', name: 'ورد الفجر', page: 61, updatedAt: '2026-10-01T00:00:00.000Z' }]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
    await render();
    const stored = [state.storage.get(READING_STOPS_STORAGE_KEY), state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)];
    await tapPage(100, 130); // 3:85
    state.offline.readPage.mockClear();
    await press(toggle());
    expect(shownPageNumber()).toBe('٦١');
    expect(has('mushaf-selection')).toBe(true);
    expect(has('mushaf-panel-reflect')).toBe(false); // hidden with the bar
    await tapPage(100, 300); // selecting still works in full screen
    await press(toggle());
    expect(state.offline.readPage).not.toHaveBeenCalled(); // the page never reloaded
    expect(root.root.findByProps({ testID: 'mushaf-wird' }).findByType('Text' as never).props.children).toBe('ورد الفجر');
    expect([state.storage.get(READING_STOPS_STORAGE_KEY), state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)]).toEqual(stored);
    await press(panelButton('reflect'));
    const sheet = root.root.findByType('ReflectionSheet' as never).props;
    expect(sheet.visible).toBe(true);
    expect(sheet.verseKey).toMatch(/^3:\d+$/);
  });

  it('pinch, pan, double-tap and swipes work in full screen; switching modes returns to 1× first', async () => {
    await render();
    await pinch(2.5);
    expect(zoom().scale).toBe(2.5);
    await press(toggle()); // refitted: back to 1×, never a stale zoom
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 });
    await pinch(3);
    expect(zoom().scale).toBe(3);
    await swipe(-5000, 0); // zoomed: a drag pans, never turns
    expect(shownPageNumber()).toBe('٦١');
    await doubleTap();
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 });
    await swipe(120); // 1×: left to right, the next page
    expect(state.offline.readPage).toHaveBeenLastCalledWith(62);
    expect(has('mushaf-panel')).toBe(false); // still full screen on the new page
    await swipe(-120);
    expect(shownPageNumber()).toBe('٦١');
  });

  it('Android Back leaves full screen first; the next Back navigates as before', async () => {
    await render();
    await press(toggle());
    expect(state.backHandlers).toHaveLength(1);
    expect(await pressBack()).toBe(true);
    expect(has('mushaf-panel')).toBe(true);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(state.backHandlers).toHaveLength(0); // the system handles the next Back
  });

  it('a clear swipe down at 1× leaves full screen; small, sideways or top-edge swipes don`t', async () => {
    await render();
    expect(enabled(swipeDownGesture())).toBe(false); // Normal Mode: nothing to leave
    await press(toggle());
    expect(enabled(swipeDownGesture())).toBe(true);
    await swipeDown(40); // a small movement
    expect(has('mushaf-panel')).toBe(false);
    await swipeDown(160, 120); // mostly sideways: not a swipe down (and no page turn either way)
    expect(has('mushaf-panel')).toBe(false);
    await swipeDown(160, 0, 47 + 10); // starting in the system's top-edge region (Notification Centre)
    expect(has('mushaf-panel')).toBe(false);
    await swipe(120); // sideways, left to right: the next page, still full screen
    expect(state.offline.readPage).toHaveBeenLastCalledWith(62);
    expect(has('mushaf-panel')).toBe(false);
    await swipe(-120);
    await swipeDown(160);
    for (const id of ['mushaf-back', 'mushaf-panel', 'mushaf-wird-row']) expect(has(id), id).toBe(true);
    expect(shownPageNumber()).toBe('٦١');
  });

  it('zoomed in, a downward drag pans; double-tap only resets the zoom; then a swipe down leaves', async () => {
    await render();
    await press(toggle());
    await pinch(2);
    expect(enabled(swipeDownGesture())).toBe(false);
    await swipeDown(400);
    expect(has('mushaf-panel')).toBe(false);
    expect(zoom().y).toBeGreaterThan(0); // the page moved down instead
    await doubleTap();
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 });
    expect(has('mushaf-panel')).toBe(false); // double-tap never changes the mode
    await swipeDown(160);
    expect(has('mushaf-panel')).toBe(true);
  });

  it('the Collapse icon stays as a backup exit and works at any zoom', async () => {
    await render();
    await press(toggle());
    await pinch(3);
    expect(toggle().findAllByType('Minimize' as never)).toHaveLength(1);
    await press(toggle());
    expect(has('mushaf-panel')).toBe(true);
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('a tap selects its ayah without leaving full screen', async () => {
    await render();
    await press(toggle());
    await tapPage(100, 130);
    expect(has('mushaf-selection')).toBe(true);
    expect(has('mushaf-panel')).toBe(false);
  });

  it('opens in Normal Mode again after leaving the reader in full screen', async () => {
    await render();
    await press(toggle());
    await act(async () => root.unmount());
    await render();
    expect(has('mushaf-panel')).toBe(true);
    expect(toggle().props.accessibilityLabel).toBe(copy().enterFullScreen);
  });

  it('Dark Mode: ivory icons; the page keeps its border inks', async () => {
    state.theme = 'dark';
    await render();
    await press(toggle());
    expect(toggle().findByType('Minimize' as never).props.color).toBe(MUSHAF_PANEL_COLORS.dark.icon);
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-paper' })).backgroundColor).toBe('#222820');
    const fills = root.root.findByProps({ testID: 'mushaf-frame' }).findAllByType('Path' as never).map((node) => node.props.fill);
    expect(new Set(fills)).toEqual(new Set(Object.values(BORDER_INKS)));
  });

  it('spoken in Arabic and Egyptian Arabic', async () => {
    for (const locale of ['ar', 'ar-EG'] as const) {
      state.locale = locale;
      await render();
      expect(toggle().props.accessibilityLabel).toMatch(/[؀-ۿ]/);
      await press(toggle());
      expect(toggle().props.accessibilityLabel).toBe(copy().exitFullScreen);
      await act(async () => root.unmount());
    }
  });
});

describe('one background: the screen is the page`s paper', () => {
  for (const [theme, paper] of [['light', '#F9EFD2'], ['dark', '#222820']] as const) {
    it(`${theme}: the screen, the safe areas and the space around the page are ${paper}, in both modes; the bar stays distinct`, async () => {
      state.theme = theme;
      await render();
      const screen = () => styleOf(root.root.findByType('GestureHandlerRootView' as never));
      expect(screen().backgroundColor).toBe(paper);
      expect(styleOf(root.root.findByProps({ testID: 'mushaf-paper' })).backgroundColor).toBe(paper);
      expect(screen().paddingTop).toBe(47); // the status-bar area is the reader's own, in its colour
      await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
      expect(screen().backgroundColor).toBe(paper);
      await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
      expect(styleOf(root.root.findByProps({ testID: 'mushaf-panel' })).backgroundColor).not.toContain(theme === 'dark' ? '34, 40, 32' : '249, 239, 210');
      // The border keeps the approved inks in both themes.
      const fills = root.root.findByProps({ testID: 'mushaf-frame' }).findAllByType('Path' as never).map((node) => node.props.fill);
      expect(new Set(fills)).toEqual(new Set(Object.values(BORDER_INKS)));
    });
  }
});

describe('the bar and the ورد pill blend with the page', () => {
  const PILL = {
    light: { backgroundColor: 'rgba(62, 107, 75, 0.10)', borderColor: 'rgba(62, 107, 75, 0.22)', text: '#2B2A26', chevron: '#3E6B4B' },
    dark: { backgroundColor: 'rgba(181, 201, 169, 0.12)', borderColor: 'rgba(181, 201, 169, 0.26)', text: '#F1E9D6', chevron: '#B5C9A9' },
  };
  // The approved bar (Option A).
  for (const [theme, paper, surface, border, icon] of [['light', '#F9EFD2', '#E9DBB9', '#DBCCA8', '#596F49'], ['dark', '#222820', '#343D31', '#475243', '#B5C9A9']] as const) {
    it(`${theme}: Option A — a gently ${theme === 'light' ? 'darker cream' : 'lighter olive'} than the page, sage icons, a faint border, a light shadow; the ورد pill keeps its own sage tint`, async () => {
      state.theme = theme;
      state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'fajr', name: 'ورد الفجر', page: 61, updatedAt: '2026-10-01T00:00:00.000Z' }]));
      state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
      await render();
      const bar = styleOf(root.root.findByProps({ testID: 'mushaf-panel' }));
      expect(bar).toMatchObject({ backgroundColor: surface, borderColor: border });
      expect(bar.backgroundColor).not.toBe(paper);
      expect(bar.shadowOpacity).toBeLessThanOrEqual(0.06);
      expect(bar.elevation).toBeLessThanOrEqual(1);
      // Same shape, size and place as before.
      expect(bar).toMatchObject({ height: 56, borderRadius: 28, maxWidth: 360 });
      const buttons = root.root.findByProps({ testID: 'mushaf-panel' }).findAllByType('Pressable' as never);
      expect(buttons).toHaveLength(5);
      for (const button of buttons) expect(flat(button.props.style({ pressed: false }))).toMatchObject({ width: 44, height: 44 });
      for (const key of ['previous', 'search', 'save', 'next']) {
        const iconNode = panelButton(key).children[0] as ReactTestInstance;
        expect(iconNode.props.color, key).toBe(icon);
      }
      // The ورد pill: its original sage-green style restored (not the bar's colour), same shape and size.
      const pill = root.root.findByProps({ testID: 'mushaf-wird' });
      const own = PILL[theme];
      expect(flat(pill.props.style({ pressed: false }))).toMatchObject({ backgroundColor: own.backgroundColor, borderColor: own.borderColor, minHeight: 26 });
      expect(styleOf(pill.findByType('Text' as never)).color).toBe(own.text);
      expect(pill.findByType('ChevronDown' as never).props.color).toBe(own.chevron);
      expect(styleOf(root.root.findByType('GestureHandlerRootView' as never)).backgroundColor).toBe(paper);
    });
  }
});

describe('Taller full screen: every page, every build; Normal Mode always Traditional', () => {
  const MEASURE_WIDTH = 900;
  const setDev = (on: boolean) => { (globalThis as { __DEV__?: boolean }).__DEV__ = on; };
  afterEach(() => setDev(false));
  async function renderQpc(params: Record<string, string>, area = { width: 412, height: 855 }) {
    state.params = params;
    state.fetch.mockResolvedValue(layoutResponse(200, { success: true, data: syntheticQpcPage61() }));
    await render(area);
    const layout = syntheticQpcPage61();
    await act(async () => {
      for (const line of layout.lines) root.root.findByProps({ testID: `qpc-measure-${line.line}` }).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: line.line === 1 ? MEASURE_WIDTH : 800, height: 100 } } });
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
  const frameTiles = () => Number(String(root.root.findByProps({ testID: 'mushaf-frame' }).props.viewBox).split(' ')[3]);
  const lineRows = () => Array.from({ length: 15 }, (_, i) => styleOf(root.root.findByProps({ testID: `qpc-line-${i + 1}` })));
  const glyphs = () => root.root.findAllByProps({ testID: 'qpc-v1-text' })[0].findAll((node) => String(node.type) === 'Text' && typeof node.props.children === 'string').map((node) => ({ glyph: node.props.children, size: styleOf(node).fontSize }));

  const fullScreenOn = async () => { await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' })); };

  it('page 61: Normal Mode is Traditional, full screen is Taller automatically; the reading position is kept', async () => {
    setDev(true);
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'fajr', name: 'ورد الفجر', page: 61, updatedAt: '2026-10-01T00:00:00.000Z' }]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
    const stored = state.storage.get(READING_STOPS_STORAGE_KEY);
    // An iPhone 393 × 852 (insets 59 / 34): the area under the Back row.
    await renderQpc({}, { width: 393, height: 852 - 59 - BACK_BAR_HEIGHT });
    const paper = () => styleOf(root.root.findByProps({ testID: 'mushaf-paper' }));
    const glyphSize = () => styleOf(root.root.findByProps({ testID: 'qpc-line-1' }).findAllByType('Text' as never)[0]).fontSize;
    expect(Math.round(paper().height)).toBe(623);
    expect(frameTiles()).toBe(29);
    const size = glyphSize();
    { const row = root.root.findByProps({ testID: 'qpc-line-2' }); const locationY = await drawnLineY(row); await act(async () => row.props.onPress({ nativeEvent: { locationX: 405, locationY } })); }
    state.offline.readPage.mockClear();
    await fullScreenOn();
    expect(paper()).toMatchObject({ width: 387 });
    expect(Math.round(paper().height)).toBe(700); // +77 pt on this iPhone
    expect(frameTiles()).toBe(33);
    expect(glyphSize()).toBe(size); // the same letter size
    expect(root.root.findAllByProps({ testID: 'qpc-highlight-2' }).length).toBeGreaterThan(0); // the selection is kept
    expect(state.offline.readPage).not.toHaveBeenCalled(); // no reload, same page
    expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(stored);
    await fullScreenOn();
    expect(Math.round(paper().height)).toBe(623);
    expect(frameTiles()).toBe(29);
    expect(shownPageNumber()).toBe('٦١');
  });

  it('the taller glyph container is Normal Mode only: Full-Screen keeps the font`s line, and the letter size never changes', async () => {
    const { QCF_V1_LINE_BOX_EM, QCF_V1_NORMAL_LINE_BOX_EM } = await import('@/mushaf/ayahMarkers');
    setDev(true);
    await renderQpc({}, { width: 393, height: 852 - 59 - BACK_BAR_HEIGHT });
    const boxes = () => root.root.findAllByProps({ testID: 'qpc-v1-text' })[0]
      .findAll((node) => String(node.type) === 'Text' && typeof node.props.children === 'string' && styleOf(node).color !== 'transparent')
      .map((node) => styleOf(node));
    // The container: line box + padding + (negative) margin, above and below.
    const ratios = () => [...new Set(boxes().map((style) => Math.round(((style.lineHeight + 2 * (style.paddingVertical + style.marginVertical)) / style.fontSize) * 1e6) / 1e6))];
    const lineBoxes = () => [...new Set(boxes().map((style) => Math.round((style.lineHeight / style.fontSize) * 1e6) / 1e6))];
    const size = boxes()[0].fontSize;
    expect(ratios()).toEqual([Math.round(QCF_V1_NORMAL_LINE_BOX_EM * 1e6) / 1e6]);
    expect(lineBoxes()).toEqual([Math.round(QCF_V1_LINE_BOX_EM * 1e6) / 1e6]); // the line box itself never changes
    await fullScreenOn();
    expect(ratios()).toEqual([Math.round(QCF_V1_LINE_BOX_EM * 1e6) / 1e6]); // Full-Screen exactly as before
    expect(lineBoxes()).toEqual([Math.round(QCF_V1_LINE_BOX_EM * 1e6) / 1e6]);
    expect(boxes()[0].fontSize).toBe(size);
    await fullScreenOn();
    expect(ratios()).toEqual([Math.round(QCF_V1_NORMAL_LINE_BOX_EM * 1e6) / 1e6]);
    expect(boxes()[0].fontSize).toBe(size);
  });

  it('there is no layout selector or measurement text in any build, mode or theme', async () => {
    for (const dev of [true, false]) {
      for (const theme of ['light', 'dark'] as const) {
        setDev(dev);
        state.theme = theme;
        await renderQpc({ layout: 'traditional' });
        for (const mode of ['normal', 'full'] as const) {
          if (mode === 'full') await fullScreenOn();
          const label = `${dev ? 'development' : 'release'} ${theme} ${mode}`;
          expect(root.root.findAll((node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('mushaf-dev')), label).toHaveLength(0);
          const shown = texts().join(' | ');
          expect(shown, label).not.toMatch(/Traditional|Taller|tiles|lines \d|space \d|\d+×\d+/);
          expect(root.root.findAll((node) => typeof node.props.accessibilityLabel === 'string' && /Traditional|Taller|development/.test(node.props.accessibilityLabel)), label).toHaveLength(0);
          // The top row holds only Back (Normal Mode) and Expand / Collapse.
          expect((root.root.findByProps({ testID: 'mushaf-back-bar' }).children as ReactTestInstance[]).map((child) => child.props.testID), label).toEqual(mode === 'normal' ? ['mushaf-back', 'mushaf-fullscreen-toggle'] : [undefined, 'mushaf-fullscreen-toggle']);
        }
        await act(async () => root.unmount());
      }
    }
    // The URL can't choose a layout either: ?layout=traditional is ignored, full screen stays Taller.
    setDev(true);
    await renderQpc({ layout: 'traditional' });
    await fullScreenOn();
    expect(frameTiles()).toBeGreaterThan(29);
  });

  it('Normal Mode is Traditional on every device, even where there is spare height (Android 412)', async () => {
    setDev(true);
    await renderQpc({}, { width: 412, height: 855 });
    expect(frameTiles()).toBe(29);
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-paper' })).width).toBe(406);
    await fullScreenOn();
    expect(frameTiles()).toBeGreaterThan(29); // Taller in full screen
  });

  it('pages other than 61, in release builds (preview, production) as in development: Normal Traditional, full screen Taller', async () => {
    for (const dev of [false, true]) {
      for (const n of [1, 2, 62, 187, 604]) {
        setDev(dev);
        const other = { ...syntheticQpcPage61(), page: n, fontFamily: `QCF_P${String(n).padStart(3, '0')}` };
        state.offline.readPage.mockImplementation(async (page: number) => (page === n ? other : null));
        state.params = { page: String(n) };
        // An iPhone 393 × 852 (insets 59 / 34).
        await render({ width: 393, height: 852 - 59 - BACK_BAR_HEIGHT });
        const label = `${dev ? 'development' : 'release'} page ${n}`;
        expect(frameTiles(), label).toBe(29);
        await fullScreenOn();
        expect(frameTiles(), label).toBe(33); // as page 61 on this iPhone
        expect(Math.round(styleOf(root.root.findByProps({ testID: 'mushaf-paper' })).height), label).toBe(700);
        await fullScreenOn();
        expect(frameTiles(), label).toBe(29);
        await act(async () => root.unmount());
      }
    }
  });

  it('Hizb label: centred in the header between the Surah and the juz`, only on a start page, only in Normal Mode', async () => {
    const hizbLabel = () => root.root.findAllByProps({ testID: 'mushaf-hizb-label' }).filter((node) => String(node.type) === 'Text');
    for (const [n, expected] of [[5, 'ربع الحزب الأول'], [11, 'الحزب الثاني'], [6, null]] as const) {
      setDev(true);
      const other = { ...syntheticQpcPage61(), page: n, fontFamily: `QCF_P${String(n).padStart(3, '0')}` };
      state.offline.readPage.mockImplementation(async (page: number) => (page === n ? other : null));
      state.params = { page: String(n) };
      await render({ width: 393, height: 852 - 59 - BACK_BAR_HEIGHT });
      if (expected === null) {
        expect(hizbLabel(), `page ${n}`).toHaveLength(0); // no start on this page: no label at all
      } else {
        const [label] = hizbLabel();
        expect(label.props.children).toBe(expected);
        const style = styleOf(label);
        expect(style).toMatchObject({ flex: 1, textAlign: 'center' }); // centred in the space between the two
        expect(label.props.numberOfLines).toBe(1);
        // In the header row, between the Surah (left) and the juz' (right), which keep their places, on their baseline.
        const row = label.parent!;
        expect(styleOf(row).alignItems).toBe('baseline');
        const texts = (row.children as ReactTestInstance[]).filter((child) => typeof child !== 'string');
        expect(texts.map((child) => child.props.testID ?? null)).toEqual([null, 'mushaf-hizb-label', null]);
        expect(String(texts[0].props.children)).toMatch(/^سورة /);
        expect(String(texts[2].props.children)).toMatch(/^الجزء /);
        await fullScreenOn();
        expect(hizbLabel(), `page ${n} full screen`).toHaveLength(0); // Full-Screen unchanged
        await fullScreenOn();
        expect(hizbLabel()).toHaveLength(1);
      }
      await act(async () => root.unmount());
    }
  });

  it('release builds: full screen is Taller too, whatever the URL', async () => {
    setDev(false);
    await renderQpc({ layout: 'traditional' });
    await fullScreenOn();
    expect(frameTiles()).toBeGreaterThan(29);
  });

  it('Taller: a taller frame of the same tiles, the same glyphs at the same size, the 15 lines further apart', async () => {
    await renderQpc({});
    // Normal Mode (Traditional) at the same width.
    const traditional = { tiles: frameTiles(), paper: styleOf(root.root.findByProps({ testID: 'mushaf-paper' })), pitch: lineRows()[0].height, glyphs: glyphs() };
    await fullScreenOn();
    const mobile = { tiles: frameTiles(), paper: styleOf(root.root.findByProps({ testID: 'mushaf-paper' })), pitch: lineRows()[0].height, glyphs: glyphs() };
    expect(traditional.tiles).toBe(29);
    expect(mobile.tiles).toBeGreaterThan(29);
    expect(Number.isInteger(mobile.tiles)).toBe(true); // whole tiles: repeated, never stretched
    expect(mobile.paper.width).toBe(traditional.paper.width); // the width (and so the text size) is the device's
    expect(mobile.paper.height).toBeGreaterThan(traditional.paper.height);
    expect(mobile.paper.height).toBeLessThanOrEqual(855 - 4 - 34); // still the whole page, inside the safe area
    expect(mobile.pitch).toBeGreaterThan(traditional.pitch);
    expect(mobile.glyphs).toEqual(traditional.glyphs); // every glyph, in order, at the same size
    const { QCF_V1_LINE_BOX_EM } = await import('@/mushaf/ayahMarkers');
    for (const node of root.root.findByProps({ testID: 'qpc-line-1' }).findAllByType('Text' as never)) {
      expect(styleOf(node).lineHeight).toBeCloseTo(styleOf(node).fontSize * QCF_V1_LINE_BOX_EM); // the full glyph box here too
    }
    const rows = lineRows();
    expect(rows.map((row) => row.top)).toEqual(rows.map((_, i) => i * mobile.pitch)); // 15 evenly spaced lines
    const { buildBorderPattern } = await import('@/mushaf/borderPattern');
    expect(root.root.findByProps({ testID: 'mushaf-frame' }).findAllByType('Path' as never).map((node) => node.props.d)).toEqual(['cream', 'mint', 'green', 'brown', 'ochre', 'rule'].map((ink) => buildBorderPattern(20, mobile.tiles).paths[ink as never]));
  });

  it('baselines stay exactly one pitch apart at every size and in both modes; the letter size is the same', async () => {
    setDev(true);
    const { cssBaseline } = await import('@/mushaf/ayahMarkers');
    const sizes: number[] = [];
    for (const area of [{ width: 412, height: 855 }, { width: 393, height: 757 }, { width: 448, height: 934 }, { width: 320, height: 512 }]) {
      for (const fullScreen of [false, true]) {
        await renderQpc({}, area);
        if (fullScreen) await fullScreenOn();
        // A wider page (the narrow phone, whose Normal page is height-limited) is measured again, as on a device.
        if (root.root.findAllByProps({ testID: 'qpc-line-1' }).length === 0) {
          await act(async () => {
            for (const line of syntheticQpcPage61().lines) root.root.findByProps({ testID: `qpc-measure-${line.line}` }).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: line.line === 1 ? MEASURE_WIDTH : 800, height: 100 } } });
          });
        }
        const rows = lineRows();
        const pitch = rows[0].height;
        const glyph = styleOf(root.root.findByProps({ testID: 'qpc-line-1' }).findAllByType('Text' as never)[0]);
        const baselines = rows.map((row) => row.top + (pitch - glyph.lineHeight) / 2 + cssBaseline(glyph.fontSize, glyph.lineHeight));
        baselines.slice(1).forEach((b, i) => expect(b - baselines[i]).toBeCloseTo(pitch, 9));
        sizes.push(glyph.fontSize);
        await act(async () => root.unmount());
      }
    }
    // Same width in both modes on the phones, so the same letter size (the width sets it).
    expect(sizes[0]).toBe(sizes[1]);
    expect(sizes[2]).toBe(sizes[3]);
    expect(sizes[4]).toBe(sizes[5]);
    // The narrow phone: height-limited in Normal Mode, so full screen (more height) gives a wider page and, with it, larger letters.
    expect(sizes[7]).toBeGreaterThan(sizes[6]);
  });

  it('Taller: the selection highlight keeps the printed band height; taps select as before', async () => {
    setDev(true);
    await renderQpc({});
    await fullScreenOn();
    const pitch = lineRows()[0].height;
    { const row = root.root.findByProps({ testID: 'qpc-line-2' }); const locationY = await drawnLineY(row); await act(async () => row.props.onPress({ nativeEvent: { locationX: 405, locationY } })); }
    const band = styleOf(root.root.findByProps({ testID: 'qpc-highlight-2' }));
    const { computePageLayout } = await import('@/mushaf/pageGeometry');
    const printedPitch = computePageLayout(styleOf(root.root.findByProps({ testID: 'mushaf-paper' })).width).linePitch;
    expect(band.height).toBeCloseTo(printedPitch * 0.92);
    expect(band.top + band.height / 2).toBeCloseTo(await drawnLineY(root.root.findByProps({ testID: 'qpc-line-2' }))); // centred on its line as drawn
    expect(pitch).toBeGreaterThan(band.height);
    await fullScreenOn();
    await press(panelButton('reflect'));
    expect(root.root.findByType('ReflectionSheet' as never).props.verseKey).toBe('3:84');
  });

  it('where the height already limits the page (small phones in landscape-like ratios, tablets), full screen falls back to Traditional automatically', async () => {
    await renderQpc({}, { width: 820, height: 1130 });
    await fullScreenOn();
    expect(frameTiles()).toBe(29);
  });

  it('very tall phones: the line spacing grows at most TALLER_MAX_LINE_SPACING; the rest of the height stays paper around the centred page', async () => {
    const { computePageLayout } = await import('@/mushaf/pageGeometry');
    expect(TALLER_MAX_LINE_SPACING).toBe(1.25);
    expect(TALLER_MAX_TILES_DOWN).toBe(35);
    expect(computePageLayout(1000, TALLER_MAX_TILES_DOWN).linePitch / computePageLayout(1000).linePitch).toBeLessThanOrEqual(1.25);
    expect(computePageLayout(1000, TALLER_MAX_TILES_DOWN + 1).linePitch / computePageLayout(1000).linePitch).toBeGreaterThan(1.25);
    // A 412 × 1000 Android (insets 28 / 24): room for 40 tiles, capped at 35.
    await renderQpc({}, { width: 412, height: 1000 - 28 - BACK_BAR_HEIGHT });
    await fullScreenOn();
    expect(frameTiles()).toBe(35);
    expect(root.root.findByProps({ testID: 'mushaf-zoom-viewport' }).props.style).toEqual(expect.arrayContaining([expect.objectContaining({ justifyContent: 'center' })]));
  });

  it('fits each device from its actual space: as many extra tiles as its spare height allows, never more than the cap', () => {
    const fit = (w: number, h: number, top: number, bottom: number, full = false) => fitMushafPage({ width: w, height: h - top - BACK_BAR_HEIGHT }, bottom, full, true);
    const cases = [
      ['iPhone 393, Normal', fit(393, 852, 59, 34)],
      ['iPhone 393, full screen', fit(393, 852, 59, 34, true)],
      ['iPhone 320', fit(320, 568, 20, 0)],
      ['Android 412 gesture', fit(412, 915, 24, 24)],
      ['Android 412 3-button', fit(412, 915, 24, 48)],
      ['Android 412 full screen', fit(412, 915, 24, 24, true)],
      ['large Android 448 × 998', fit(448, 998, 28, 24)],
      ['iPad 820', fit(820, 1180, 24, 20)],
    ] as const;
    for (const [name, size] of cases) {
      expect(size.tilesDown, name).toBeGreaterThanOrEqual(29);
      expect(size.tilesDown, name).toBeLessThanOrEqual(TALLER_MAX_TILES_DOWN);
      expect(size.page.height, name).toBeLessThanOrEqual(size.viewport.height);
    }
    const tiles = Object.fromEntries(cases.map(([name, size]) => [name, size.tilesDown]));
    expect(tiles).toEqual({
      'iPhone 393, Normal': 29, // (direct calls with taller on, for the fit alone; the reader passes it only in full screen)
      'iPhone 393, full screen': 33,
      'iPhone 320': 29,
      'Android 412 gesture': 32,
      'Android 412 3-button': 31,
      'Android 412 full screen': 35, // 37 fit: capped
      'large Android 448 × 998': 33,
      'iPad 820': 29,
    });
  });
});

describe('the floating bar', () => {
  it('is icon-only, in the fixed order arrow-left · lightbulb · search · bookmark · arrow-right, above the bottom inset', async () => {
    await render();
    const bar = root.root.findByProps({ testID: 'mushaf-panel' });
    const buttons = bar.findAllByType('Pressable' as never);
    // Right to left: the left arrow is "next page", the right arrow "previous page".
    expect(buttons.map((node) => node.props.testID)).toEqual(['mushaf-panel-next', 'mushaf-panel-reflect', 'mushaf-panel-search', 'mushaf-panel-save', 'mushaf-panel-previous']);
    expect(bar.findAllByType('Text' as never)).toHaveLength(0); // no labels under the icons
    expect(buttons.map((node) => node.props.accessibilityLabel)).toEqual([copy().nextPage, MESSAGES.en.reflection.writeAction, copy().searchPage, copy().saveStopAction, copy().previousPage]);
    const icons = buttons.map((node) => node.children[0] as ReactTestInstance);
    expect(icons.map(typeName)).toEqual(['ArrowLeft', 'ReflectionBulbIcon', 'Search', 'Bookmark', 'ArrowRight']);
    expect(new Set(icons.map((icon) => icon.props.size)).size).toBe(1); // one icon size
    // The bookmark: lucide's plain outline (no plus, check or fill).
    expect(icons[3].props).not.toHaveProperty('fill');
    const dock = root.root.findByType('KeyboardAvoidingView' as never);
    expect(styleOf(dock).bottom).toBe(34 + 8);
  });

  it('respects Android`s button navigation bar (a larger bottom inset)', async () => {
    state.insets = { top: 24, bottom: 48, left: 0, right: 0 };
    await render();
    expect(styleOf(root.root.findByType('KeyboardAvoidingView' as never)).bottom).toBe(48 + 8);
  });

  it('reflection is disabled until an ayah is selected, then opens the existing sheet for exactly that ayah', async () => {
    await render();
    expect(panelButton('reflect').props.disabled).toBe(true);
    expect(root.root.findByType('ReflectionSheet' as never).props.visible).toBe(false);
    await tapPage(100, 130); // line 4: 3:85
    expect(root.root.findByProps({ testID: 'mushaf-selection' })).toBeDefined();
    expect(panelButton('reflect').props.disabled).toBe(false);
    await press(panelButton('reflect'));
    expect(root.root.findByType('ReflectionSheet' as never).props).toMatchObject({ visible: true, verseKey: '3:85' });
  });

  it('the lightbulb: grey without rays until an ayah is selected, then lit with rays (olive); clearing the selection unlights it', async () => {
    await render();
    const bulb = () => panelButton('reflect').findByType(ReflectionBulbIcon as never);
    const rays = () => panelButton('reflect').findAllByProps({ testID: 'reflection-bulb-rays' });
    expect(bulb().props).toMatchObject({ lit: false, color: MUSHAF_PANEL_COLORS.light.bulbOff });
    expect(rays()).toHaveLength(0);
    const unlitSize = bulb().props.size;
    await tapPage(100, 130);
    expect(bulb().props).toMatchObject({ lit: true, color: MUSHAF_PANEL_COLORS.light.bulbOn, size: unlitSize });
    expect(rays()).toHaveLength(1);
    // The same bulb outline in both states: only the rays are added.
    expect(panelButton('reflect').findByProps({ testID: 'reflection-bulb-lit' }).findAllByType('Path' as never)).toHaveLength(4);
    await tapPage(100, 130); // the selected ayah again: cleared
    expect(bulb().props.lit).toBe(false);
    expect(panelButton('reflect').props.disabled).toBe(true);
    expect(panelButton('reflect').findByProps({ testID: 'reflection-bulb-unlit' }).findAllByType('Path' as never)).toHaveLength(3);
  });

  it('a tap in the margin selects nothing', async () => {
    await render();
    await tapPage(343, 300); // right of every ayah polygon (they span x 0–338)
    expect(root.root.findAllByProps({ testID: 'mushaf-selection' })).toHaveLength(0);
    expect(panelButton('reflect').props.disabled).toBe(true);
  });
});

describe('page direction: arrows (left = next) and swipes (finger left to right = next)', () => {
  const left = () => root.root.findByProps({ testID: 'mushaf-panel' }).findAllByType('Pressable' as never)[0];
  const right = () => root.root.findByProps({ testID: 'mushaf-panel' }).findAllByType('Pressable' as never).at(-1)!;
  const shown = () => (state.offline.readPage.mock.calls.at(-1)?.[0] as number | undefined);

  for (const locale of ['en', 'ar'] as const) {
    for (const mode of ['normal', 'full'] as const) {
      it(`${locale}, ${mode === 'normal' ? 'Normal Mode' : 'full screen'}: left arrow and a left-to-right swipe = next page; right arrow and a right-to-left swipe = previous page`, async () => {
        state.locale = locale;
        await render();
        if (mode === 'full') {
          await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
          // The arrows are hidden in full screen: there, the swipes turn the page.
          expect(root.root.findAllByProps({ testID: 'mushaf-panel' })).toHaveLength(0);
        } else {
          // The physical left arrow is the left one, spoken as "next page" in the app's language.
          expect(left().findAllByType('ArrowLeft' as never)).toHaveLength(1);
          expect(right().findAllByType('ArrowRight' as never)).toHaveLength(1);
          expect(left().props.accessibilityLabel).toBe(copy().nextPage);
          expect(right().props.accessibilityLabel).toBe(copy().previousPage);
          await press(left());
          await flush();
          expect(shown()).toBe(62);
          await press(right());
          await flush();
          await flush();
          expect(shownPageNumber()).toBe('٦١');
          await press(right());
          await flush();
          expect(shown()).toBe(60);
          await press(left());
          await flush();
          await flush();
          expect(shownPageNumber()).toBe('٦١');
        }
        await swipe(120); // finger left to right: next
        expect(shown()).toBe(62);
        await swipe(-120); // right to left: previous
        await flush();
        expect(shownPageNumber()).toBe('٦١');
        await swipe(-120);
        expect(shown()).toBe(60);
      });
    }
  }

  it('never before page 1 or after page 604, by arrow or swipe', async () => {
    state.params = { page: '1' };
    await render();
    expect(right().props).toMatchObject({ accessibilityLabel: copy().previousPage, disabled: true });
    expect(left().props.disabled).toBe(false);
    state.offline.readPage.mockClear();
    await swipe(-120); // previous: nothing before page 1
    expect(state.offline.readPage).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    state.params = { page: '604' };
    await render();
    expect(left().props).toMatchObject({ accessibilityLabel: copy().nextPage, disabled: true });
    expect(right().props.disabled).toBe(false);
    state.offline.readPage.mockClear();
    await swipe(120); // next: nothing after page 604
    expect(state.offline.readPage).not.toHaveBeenCalled();
  });

  it('turning keeps the active ورد and saves nothing', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'fajr', name: 'ورد الفجر', page: 61, updatedAt: '2026-10-01T00:00:00.000Z' }]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
    await render();
    const before = state.storage.get(READING_STOPS_STORAGE_KEY);
    await press(left());
    await flush();
    expect(shown()).toBe(62);
    expect(root.root.findByProps({ testID: 'mushaf-wird' }).findByType('Text' as never).props.children).toBe('ورد الفجر');
    expect(state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)).toBe('fajr');
    expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(before);
  });

  it('zoomed in, a sideways drag pans; it never turns the page', async () => {
    await render();
    await pinch(2);
    state.offline.readPage.mockClear();
    await swipe(-300);
    await swipe(300);
    expect(state.offline.readPage).not.toHaveBeenCalled();
    expect(shownPageNumber()).toBe('٦١');
  });
});

describe('turning pages', () => {
  it('the arrows and swipes move together; turning clears the selection', async () => {
    await render();
    expect(shownPageNumber()).toBe('٦١');
    await tapPage(100, 130);
    await press(panelButton('next'));
    await flush();
    expect(state.offline.readPage).toHaveBeenLastCalledWith(62);
    expect(root.root.findByProps({ testID: 'mushaf-page-missing' })).toBeDefined(); // not downloaded
    expect(panelButton('reflect').props.disabled).toBe(true);
    await press(panelButton('previous'));
    await flush();
    await flush();
    expect(shownPageNumber()).toBe('٦١');
    await swipe(120); // left to right: next
    expect(state.offline.readPage).toHaveBeenLastCalledWith(62);
    await swipe(-120); // right to left: previous
    expect(shownPageNumber()).toBe('٦١');
    expect(swipeGesture().config.maxPointers).toBe(1); // a second finger (a pinch) cancels a swipe
    // A vertical drag or a short one isn't a page turn.
    state.offline.readPage.mockClear();
    await swipe(-30, 0);
    await swipe(-90, 200);
    expect(state.offline.readPage).not.toHaveBeenCalled();
  });

  it('cannot go before page 1 or after page 604', async () => {
    state.params = { page: '1' };
    await render();
    expect(panelButton('previous').props.disabled).toBe(true);
    await act(async () => root.unmount());
    state.params = { page: '604' };
    await render();
    expect(panelButton('next').props.disabled).toBe(true);
  });

  it('a downloaded page draws from the device with its own font (stored, else Quran Foundation`s CDN)', async () => {
    const page62 = { ...syntheticQpcPage61(), page: 62, fontFamily: 'QCF_P062' };
    state.offline.readPage.mockImplementation(async (n: number) => (n === 62 ? page62 : null));
    state.offline.pageFont.mockResolvedValue({ family: 'QCF_P062', uri: 'file:///fonts/p62.ttf' });
    state.params = { page: '62' };
    await render();
    expect(state.loadFont).toHaveBeenCalledWith({ QCF_P062: 'file:///fonts/p62.ttf' });
    expect(root.root.findAllByProps({ testID: 'qpc-v1-text' })).toHaveLength(1);
    expect(texts()).toContain('٦٢');
    await act(async () => root.unmount());
    state.loadFont.mockClear();
    state.offline.pageFont.mockResolvedValue(null);
    await render();
    expect(state.loadFont).toHaveBeenCalledWith({ QCF_P062: 'https://verses.quran.foundation/fonts/quran/hafs/v1/ttf/p62.ttf' });
  });
});

describe('pinch-to-zoom', () => {
  it('zooms the whole page as one unit, toward the fingers, from 1× up to 3× and never below 1×', async () => {
    await render();
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 });
    const frame = root.root.findByProps({ testID: 'mushaf-zoom-page' });
    // Everything printed is inside the one scaled view: paper, frame, heads, lines, page number.
    for (const id of ['mushaf-paper', 'mushaf-frame', 'mushaf-text-area']) expect(frame.findAllByProps({ testID: id }).length, id).toBeGreaterThan(0);
    const fontSizes = () => root.root.findAllByType('Text' as never).map((node) => styleOf(node).fontSize);
    const before = fontSizes();
    await pinch(2, { x: 100, y: 200 });
    expect(zoom().scale).toBe(2);
    expect(fontSizes()).toEqual(before); // nothing is resized or reflowed on its own
    await pinch(5);
    expect(zoom().scale).toBe(3);
    await pinch(0.1);
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('the point under the fingers stays under them', async () => {
    await render({ width: 390, height: 761 });
    const page = { width: 384, height: 384 * 1.6088532883642497 };
    const viewportHeight = 761 - (4 + 56 + 8 + 34);
    const centre = { x: 195, y: page.height / 2 };
    const focal = { x: 300, y: 240 };
    await pinch(2, focal);
    const { scale, x, y } = zoom();
    // Screen point of the page point that was under the fingers (relative to the page centre at 1×).
    const p = { x: focal.x - centre.x, y: focal.y - centre.y };
    expect(centre.x + x + scale * p.x).toBeCloseTo(focal.x);
    expect(centre.y + y + scale * p.y).toBeCloseTo(focal.y);
    expect(viewportHeight).toBeGreaterThan(page.height);
  });

  it('while zoomed, one finger moves the page (clamped on screen) and never turns it; the arrows still do and reset the zoom', async () => {
    await render();
    await pinch(3);
    expect(enabled(swipeGesture())).toBe(false);
    expect(enabled(dragGesture())).toBe(true);
    state.offline.readPage.mockClear();
    await swipe(-5000, -5000);
    expect(state.offline.readPage).not.toHaveBeenCalled();
    expect(shownPageNumber()).toBe('٦١');
    const pulled = zoom();
    await swipe(5000, 5000);
    const pushed = zoom();
    // Clamped: the page still covers the viewport edge to edge, whichever way it is pulled.
    const width = 384 * 3;
    expect(pulled.x).toBeCloseTo(-(width - 390) / 2);
    expect(pushed.x).toBeCloseTo((width - 390) / 2);
    expect(pulled.y).toBeLessThan(0);
    expect(pushed.y).toBeGreaterThan(0);
    await press(panelButton('next'));
    await flush();
    expect(state.offline.readPage).toHaveBeenLastCalledWith(62);
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 }); // a new page starts at 1×
    expect(enabled(swipeGesture())).toBe(true);
  });

  it('a pinch released near 1× snaps back to the fitted page, and swiping turns pages again', async () => {
    await render();
    await pinch(1.01);
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 });
    expect(enabled(swipeGesture())).toBe(true);
    await swipe(120);
    expect(state.offline.readPage).toHaveBeenLastCalledWith(62);
  });

  it('double-tap returns to the fitted page and leaves the selection as it was', async () => {
    let now = 10_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    await render();
    await tapPage(100, 130); // 3:85
    now += 2000;
    await pinch(2);
    expect(enabled(doubleTapGesture())).toBe(true);
    // A double-tap's own taps land on an ayah first (both on the same one, 0.15 s apart).
    now += 2000;
    await tapPage(100, 300);
    now += 150;
    await tapPage(100, 300);
    now += 50;
    await doubleTap();
    // On the web a tap's click can land after the double-tap: ignored.
    now += 20;
    await tapPage(100, 300);
    clock.mockRestore();
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 });
    await press(panelButton('reflect'));
    expect(root.root.findByType('ReflectionSheet' as never).props.verseKey).toBe('3:85');
    expect(enabled(doubleTapGesture())).toBe(false); // nothing to reset at 1×
  });

  it('selecting an ayah while zoomed opens the reflection for exactly that ayah', async () => {
    await render();
    await pinch(2.4, { x: 120, y: 200 });
    await tapPage(100, 130);
    expect(root.root.findByProps({ testID: 'mushaf-selection' })).toBeDefined();
    expect(zoom().scale).toBe(2.4); // selecting doesn't change the zoom
    await press(panelButton('reflect'));
    expect(root.root.findByType('ReflectionSheet' as never).props).toMatchObject({ visible: true, verseKey: '3:85' });
  });

  it('a page that isn`t drawn (not downloaded) doesn`t zoom, but still swipes', async () => {
    state.params = { page: '200' };
    await render();
    expect(enabled(pinchGesture())).toBe(false);
    expect(enabled(swipeGesture())).toBe(true);
  });
});

describe('search (one button, two modes)', () => {
  const sheet = () => root.root.findAllByProps({ testID: 'mushaf-search-sheet' });
  const byId = (id: string) => root.root.findByProps({ testID: id });
  const surahRows = () => root.root.findAll((node) => typeof node.props.testID === 'string' && /^mushaf-surah-\d+$/.test(node.props.testID) && String(node.type) === 'Pressable');
  const openSearch = async () => { await press(panelButton('search')); };
  const typeInto = async (id: string, text: string) => { await act(async () => byId(id).props.onChangeText(text)); };

  it('the bar`s search button opens one keyboard-aware sheet with Page Number and Surah Name', async () => {
    await render();
    expect(sheet()).toHaveLength(0);
    await openSearch();
    expect(sheet()).toHaveLength(1);
    const tabs = ['page', 'surah'].map((mode) => byId(`mushaf-search-mode-${mode}`));
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([copy().searchByPage, copy().searchBySurah]);
    expect(tabs[0].props.accessibilityState).toEqual({ selected: true });
    // Keyboard-aware like the app's other sheets; the old inline field above the bar is gone.
    const avoider = root.root.findByType('Modal' as never).findByType('KeyboardAvoidingView' as never);
    expect(avoider.props.behavior).toBe('padding');
    expect(root.root.findAllByProps({ testID: 'mushaf-popup-search' })).toHaveLength(0);
    // Still exactly five bar buttons, the search one where it was.
    expect(root.root.findByProps({ testID: 'mushaf-panel' }).findAllByType('Pressable' as never).map((node) => node.props.testID)[2]).toBe('mushaf-panel-search');
  });

  it('Page Number: a numeric field; Western or Arabic-Indic digits go straight there and close the sheet', async () => {
    await render();
    await openSearch();
    expect(byId('mushaf-search-page-input').props).toMatchObject({ keyboardType: 'number-pad', accessibilityLabel: copy().pageNumberPlaceholder });
    await typeInto('mushaf-search-page-input', '٣٠٠');
    await press(byId('mushaf-search-go'));
    await flush();
    expect(state.offline.readPage).toHaveBeenLastCalledWith(300);
    expect(sheet()).toHaveLength(0);
    await openSearch();
    await typeInto('mushaf-search-page-input', '61');
    await act(async () => byId('mushaf-search-page-input').props.onSubmitEditing());
    await flush();
    expect(shownPageNumber()).toBe('٦١');
  });

  it('Page Number: a wide field and a compact, icon-only arrow (its label spoken), mirrored in Arabic; Surah mode untouched', async () => {
    for (const locale of ['en', 'ar'] as const) {
      state.locale = locale;
      await render();
      await openSearch();
      const go = byId('mushaf-search-go');
      // No visible text: just the arrow, with the existing spoken label.
      expect(go.findAll((node) => String(node.type) === 'Text')).toHaveLength(0);
      expect(go.props.accessibilityLabel).toBe(copy().goToPage);
      const style = Object.assign({}, ...[go.props.style({ pressed: false })].flat(3).filter(Boolean));
      expect(style).toMatchObject({ width: 46, height: 46 }); // compact, still a full touch target
      // The field takes the rest of the row.
      expect(Object.assign({}, ...[byId('mushaf-search-page-input').props.style].flat(3).filter(Boolean)).flex).toBe(1);
      // The arrow points forward in the reading direction: a left arrow right to left, drawn as is (a mirroring
      // transform on the SVG flipped it out of view on the web).
      const arrow = go.children[0] as ReactTestInstance;
      expect(String(arrow.type)).toBe(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight');
      expect(arrow.props.style?.transform).toBeUndefined();
      // Surah mode keeps its own layout (no go button).
      await press(byId('mushaf-search-mode-surah'));
      expect(root.root.findAllByProps({ testID: 'mushaf-search-go' })).toHaveLength(0);
      await act(async () => root.unmount());
    }
    state.locale = 'en';
  });

  it('Page Number: refuses a page outside 1–604 with an explanation, and stays open', async () => {
    await render();
    await openSearch();
    for (const bad of ['700', '0', 'abc']) {
      await typeInto('mushaf-search-page-input', bad);
      await press(byId('mushaf-search-go'));
      expect(texts()).toContain(copy().pageOutOfRange);
      expect(sheet()).toHaveLength(1);
    }
    expect(parsePageNumber('604')).toBe(604);
    expect(parsePageNumber('۶۱')).toBe(61);
  });

  it('Surah Name: all 114 Surahs in Quran order, each with its number, Arabic and English name and first page', async () => {
    await render();
    await openSearch();
    await press(byId('mushaf-search-mode-surah'));
    const rows = surahRows();
    expect(rows).toHaveLength(114);
    expect(rows.map((row) => row.props.testID)).toEqual(Array.from({ length: 114 }, (_, i) => `mushaf-surah-${i + 1}`));
    const rowTexts = (row: ReactTestInstance) => row.findAllByType('Text' as never).map((node) => [node.props.children].flat().join(''));
    expect(rowTexts(rows[0])).toEqual(['1', 'الفاتحة', 'Al-Faatiha', 'Page 1']);
    expect(rowTexts(rows[1])).toEqual(['2', 'البقرة', 'Al-Baqara', 'Page 2']);
    expect(rowTexts(rows[2])).toEqual(['3', 'آل عمران', 'Aal-i-Imraan', 'Page 50']);
    expect(rowTexts(rows[113])).toEqual(['114', 'الناس', 'An-Naas', 'Page 604']);
    // Scrollable and tappable with the keyboard open.
    expect(byId('mushaf-surah-list').props).toMatchObject({ keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'on-drag' });
  });

  it('Surah Name: filters as the reader types: Arabic with or without diacritics or hamza, English spellings, partial names', async () => {
    await render();
    await openSearch();
    await press(byId('mushaf-search-mode-surah'));
    const first = () => surahRows()[0]?.props.testID;
    for (const [query, surah] of [['البقرة', 2], ['بقره', 2], ['ٱلْكَهْف', 18], ['اسراء', 17], ['إبراهيم', 14], ['سورة يس', 36], ['baqarah', 2], ['FATIHA', 1], ['imran', 3], ['Yasin', 36], ['ya-sin', 36], ['kahf', 18], ['rahman', 55], ['36', 36], ['٣٦', 36]] as const) {
      await typeInto('mushaf-search-surah-input', query);
      expect(first(), query).toBe(`mushaf-surah-${surah}`);
    }
    await typeInto('mushaf-search-surah-input', 'xyzzy');
    expect(surahRows()).toHaveLength(0);
    expect(byId('mushaf-surah-empty').props.children).toBe(copy().surahNoResults);
    await typeInto('mushaf-search-surah-input', '');
    expect(surahRows()).toHaveLength(114);
  });

  it('choosing a Surah opens the page with its first ayah and closes the sheet', async () => {
    await render();
    await openSearch();
    await press(byId('mushaf-search-mode-surah'));
    await typeInto('mushaf-search-surah-input', 'Imran');
    await press(byId('mushaf-surah-3'));
    await flush();
    expect(state.offline.readPage).toHaveBeenLastCalledWith(50);
    expect(shownPageNumber()).toBe('50'); // not downloaded in this test: its download offer shows
    expect(sheet()).toHaveLength(0);
    // Surahs that begin partway down a page open that page (Al-Falaq and An-Naas share 604 with Al-Ikhlas).
    expect([SURAH_START_PAGES[111], SURAH_START_PAGES[112], SURAH_START_PAGES[113]]).toEqual([604, 604, 604]);
  });

  it('searching only navigates: no reading stop is created, moved or made active', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'a', name: 'Fajr', page: 61, updatedAt: '2026-10-01T00:00:00.000Z' }]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'a');
    await render();
    const before = [state.storage.get(READING_STOPS_STORAGE_KEY), state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)];
    await openSearch();
    await typeInto('mushaf-search-page-input', '300');
    await press(byId('mushaf-search-go'));
    await openSearch();
    await press(byId('mushaf-search-mode-surah'));
    await press(byId('mushaf-surah-18'));
    await flush();
    expect(state.offline.readPage).toHaveBeenLastCalledWith(293);
    expect([state.storage.get(READING_STOPS_STORAGE_KEY), state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)]).toEqual(before);
  });

  it('closes on its close button or the dimmed backdrop, leaving nothing over the page', async () => {
    await render();
    await openSearch();
    await press(byId('mushaf-search-close'));
    expect(sheet()).toHaveLength(0);
    await openSearch();
    await press(byId('mushaf-search-backdrop'));
    expect(sheet()).toHaveLength(0);
    expect(root.root.findAllByType('Modal' as never)).toHaveLength(0);
  });

  it('in Arabic: Arabic labels, right-to-left rows and Arabic-Indic numbers', async () => {
    state.locale = 'ar';
    await render();
    await openSearch();
    expect(byId('mushaf-search-mode-page').props.accessibilityLabel).toBe('رقم الصفحة');
    expect(byId('mushaf-search-mode-surah').props.accessibilityLabel).toBe('اسم السورة');
    await press(byId('mushaf-search-mode-surah'));
    const row = byId('mushaf-surah-3');
    expect(flat(row.props.style({ pressed: false })).flexDirection).toBe('row-reverse');
    expect(row.findAllByType('Text' as never).map((node) => [node.props.children].flat().join(''))).toEqual(['٣', 'آل عمران', 'Aal-i-Imraan', 'صفحة ٥٠']);
  });
});

describe('the active reading stop (ورد)', () => {
  const stop = (id: string, name: string, page: number, day: number) => ({ id, name, page, updatedAt: `2026-10-0${day}T00:00:00.000Z` });
  const seed = (stops: ReturnType<typeof stop>[], active?: string) => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify(stops));
    if (active) state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, active);
  };
  const pill = () => root.root.findByProps({ testID: 'mushaf-wird' });
  const pillText = () => pill().findByType('Text' as never).props.children;
  const list = () => root.root.findAllByProps({ testID: 'mushaf-wird-list' });
  const openList = async () => { await press(pill()); await flush(); };
  const THREE = [stop('fajr', 'ورد الفجر', 61, 3), stop('tadabbur', 'ورد التدبر', 125, 2), stop('daily', 'ورد يومي', 302, 1)];

  it('sits centred between the page and the bar: below the page, outside the toolbar, without shrinking the phone page', async () => {
    seed(THREE, 'fajr');
    await render({ width: 390, height: 761 });
    const row = root.root.findByProps({ testID: 'mushaf-wird-row' });
    const paper = styleOf(root.root.findByProps({ testID: 'mushaf-paper' }));
    expect(styleOf(row)).toMatchObject({ position: 'absolute', alignItems: 'center', justifyContent: 'center' });
    expect(styleOf(row).top).toBeCloseTo(paper.height, 0);
    expect(styleOf(row).height).toBeGreaterThanOrEqual(32);
    expect(paper.width).toBe(384); // as before: the width still decides on phones
    expect(root.root.findByProps({ testID: 'mushaf-panel' }).findAllByProps({ testID: 'mushaf-wird' })).toHaveLength(0);
    expect(pillText()).toBe('ورد الفجر');
    expect(pill().props.accessibilityLabel).toBe(`${copy().wirdSelectorLabel}: ورد الفجر`);
    // A 44-pt target around the small pill.
    expect(26 + pill().props.hitSlop.top + pill().props.hitSlop.bottom).toBe(44);
  });

  it('opens on its saved page after a restart (no page asked for); a page in the link wins', async () => {
    seed(THREE, 'tadabbur');
    await render();
    expect(state.offline.readPage).toHaveBeenLastCalledWith(125);
    expect(pillText()).toBe('ورد التدبر');
    await act(async () => root.unmount());
    state.params = { page: '200' };
    await render();
    expect(state.offline.readPage).toHaveBeenLastCalledWith(200);
    expect(pillText()).toBe('ورد التدبر');
  });

  it('lists every stop with its page, the active one checked; choosing another opens its page and changes no stop', async () => {
    seed(THREE, 'fajr');
    await render();
    const stored = state.storage.get(READING_STOPS_STORAGE_KEY);
    await openList();
    expect(list()).toHaveLength(1);
    const items = THREE.map((s) => root.root.findByProps({ testID: `mushaf-wird-${s.id}` }));
    expect(items.map((item) => item.props.accessibilityLabel)).toEqual(['ورد الفجر, Page 61', 'ورد التدبر, Page 125', 'ورد يومي, Page 302']);
    expect(items.map((item) => item.props.accessibilityState.selected)).toEqual([true, false, false]);
    expect(items[0].findAllByType('Check' as never)).toHaveLength(1);
    expect(items[1].findAllByType('Check' as never)).toHaveLength(0);
    await press(items[2]);
    await flush();
    expect(list()).toHaveLength(0);
    expect(state.offline.readPage).toHaveBeenLastCalledWith(302);
    expect(pillText()).toBe('ورد يومي');
    expect(state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)).toBe('daily');
    // Every stop keeps its own page: switching saves nothing (and there is no Khatma count to change).
    expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(stored);
    // Back to the first one: its page, unchanged by the visit to the other.
    await openList();
    await press(root.root.findByProps({ testID: 'mushaf-wird-fajr' }));
    await flush();
    expect(shownPageNumber()).toBe('٦١');
  });

  it('closes on a tap outside, without changing anything', async () => {
    seed(THREE, 'fajr');
    await render();
    await openList();
    await press(root.root.findByProps({ testID: 'mushaf-wird-backdrop' }));
    expect(list()).toHaveLength(0);
    expect(pillText()).toBe('ورد الفجر');
    expect(state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)).toBe('fajr');
  });

  it('with no stops: offers to add one through the bookmark`s name field; the stop saved becomes the active one', async () => {
    await render();
    expect(pillText()).toBe(copy().wirdAdd);
    await press(pill());
    const field = root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never);
    await act(async () => field.props.onChangeText('ورد الفجر'));
    await press(button(copy().confirmStop));
    expect(pillText()).toBe('ورد الفجر');
    const saved = JSON.parse(state.storage.get(READING_STOPS_STORAGE_KEY)!)[0];
    expect(saved).toMatchObject({ name: 'ورد الفجر', page: 61 });
    expect(state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)).toBe(saved.id);
  });

  it('one stop shows its name; a removed active stop falls back to "choose"; the list also offers a new stop', async () => {
    seed([stop('only', 'Ramadan', 61, 1)], 'only');
    await render();
    expect(pillText()).toBe('Ramadan');
    await act(async () => root.unmount());
    seed([stop('other', 'Family', 90, 1)], 'gone');
    await render();
    expect(pillText()).toBe(copy().wirdChoose);
    await openList();
    await press(root.root.findByProps({ testID: 'mushaf-wird-new' }));
    expect(list()).toHaveLength(0);
    expect(root.root.findAllByProps({ testID: 'mushaf-popup-save' })).toHaveLength(1);
  });

  it('the list re-reads the stops, so a stop renamed or removed elsewhere shows as it is now', async () => {
    seed(THREE, 'fajr');
    await render();
    seed([stop('fajr', 'After Fajr', 61, 3)], 'fajr');
    await openList();
    expect(root.root.findAllByProps({ testID: 'mushaf-wird-tadabbur' })).toHaveLength(0);
    expect(pillText()).toBe('After Fajr');
  });

  it('long names are cut to one line; many stops scroll inside a list that stays on screen', async () => {
    const many = Array.from({ length: 30 }, (_, i) => stop(`s${i}`, `Stop ${i + 1}`, i + 1, 1));
    many[0] = stop('s0', 'ورد طويل جدًا لقراءة سورة البقرة كاملة', 2, 9);
    seed(many, 's0');
    await render();
    expect(pill().findByType('Text' as never).props).toMatchObject({ numberOfLines: 1, ellipsizeMode: 'tail' });
    expect(flat(pill().props.style({ pressed: false })).maxWidth).toBe('72%');
    // Larger system text sizes: the pill grows with its text rather than cutting it (no fixed height, no scaling cap),
    // and at the default size it is the approved 26 pt (13-pt text ≈ 15.6-pt line + 2 × 2 pt padding < 26).
    const pillStyle = flat(pill().props.style({ pressed: false }));
    expect(pillStyle.height).toBeUndefined();
    expect(pillStyle).toMatchObject({ minHeight: 26, paddingVertical: 2, borderRadius: 999 });
    const textProps = pill().findByType('Text' as never).props;
    expect(textProps.allowFontScaling).not.toBe(false);
    expect(textProps.maxFontSizeMultiplier).toBeUndefined();
    expect(13 * 1.2 + 2 * 2).toBeLessThan(26);
    await openList();
    const card = root.root.findByProps({ testID: 'mushaf-wird-list' });
    expect(card.findByType('ScrollView' as never).findAll((node) => String(node.type) === 'Pressable')).toHaveLength(30);
    expect(styleOf(card).maxHeight).toBeLessThanOrEqual(844 / 2);
    expect(styleOf(card).width).toBeLessThanOrEqual(390 - 32);
  });

  it('the bookmark`s name field starts with the active stop`s name, so saving moves that stop to this page', async () => {
    seed(THREE, 'tadabbur');
    await render();
    await press(panelButton('save'));
    const field = root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never);
    expect(field.props).toMatchObject({ value: 'ورد التدبر', selectTextOnFocus: true });
  });

  it('is hidden while the page is zoomed (the page uses that space), and back at 1×', async () => {
    seed(THREE, 'fajr');
    await render();
    await pinch(2);
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-wird-row' }))).toMatchObject({ opacity: 0 });
    expect(root.root.findByProps({ testID: 'mushaf-wird-row' }).props.pointerEvents).toBe('none');
    await press(panelButton('next'));
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-wird-row' }))).toMatchObject({ opacity: 1 });
  });

  it('in Arabic and Egyptian Arabic: the list is right to left with Arabic-Indic pages', async () => {
    for (const locale of ['ar', 'ar-EG'] as const) {
      state.locale = locale;
      seed(THREE, 'fajr');
      await render();
      await openList();
      const item = root.root.findByProps({ testID: 'mushaf-wird-tadabbur' });
      expect(item.props.accessibilityLabel).toBe('ورد التدبر, صفحة ١٢٥');
      expect(flat(item.props.style({ pressed: false })).flexDirection).toBe('row-reverse');
      expect(root.root.findByProps({ testID: 'mushaf-wird-list' }).findAllByType('Text' as never)[0].props.children).toBe(copy().wirdChoose);
      await act(async () => root.unmount());
    }
  });
});

describe('save a reading stop', () => {
  const stored = () => JSON.parse(state.storage.get(READING_STOPS_STORAGE_KEY) ?? '[]') as { name: string; page: number }[];

  it('opens a name field and saves the current page — never the selected ayah', async () => {
    await render();
    await tapPage(100, 130);
    await press(panelButton('save'));
    await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText('Ramadan'));
    await press(button(copy().confirmStop));
    expect(stored()).toEqual([expect.objectContaining({ name: 'Ramadan', page: 61 })]);
    expect(JSON.stringify(stored())).not.toMatch(/3:85|verseKey|ayah/);
  });

  it('once saved, the keyboard and the whole save field close, back to the page with a working bar', async () => {
    const { Keyboard } = await import('react-native');
    vi.mocked(Keyboard.dismiss).mockClear();
    await render();
    await press(panelButton('save'));
    await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText('Ramadan'));
    await press(button(copy().confirmStop));
    expect(root.root.findAllByProps({ testID: 'mushaf-popup-save' })).toHaveLength(0);
    expect(Keyboard.dismiss).toHaveBeenCalled();
    expect(panelButton('save').props.accessibilityState.selected).toBe(false);
    expect(stored()).toEqual([expect.objectContaining({ name: 'Ramadan', page: 61 })]);
    // The bar works as before: next page, and the field opens again, empty of the old notice.
    await press(panelButton('next'));
    await flush();
    expect(state.offline.readPage).toHaveBeenLastCalledWith(62);
    await press(panelButton('save'));
    expect(root.root.findByProps({ testID: 'mushaf-popup-save' }).findAllByType('Text' as never)).toHaveLength(0);
  });

  it('if saving fails, the field stays open with the reason so the reader can retry', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await render();
    await press(panelButton('save'));
    await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText('Ramadan'));
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    await press(button(copy().confirmStop));
    expect(root.root.findAllByProps({ testID: 'mushaf-popup-save' })).toHaveLength(1);
    expect(texts()).toContain(copy().stopSaveFailed);
    expect(root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.value).toBe('Ramadan');
    // Retry works and closes it.
    await press(button(copy().confirmStop));
    expect(root.root.findAllByProps({ testID: 'mushaf-popup-save' })).toHaveLength(0);
    expect(stored()).toEqual([expect.objectContaining({ name: 'Ramadan', page: 61 })]);
  });

  it('saves the page being read after turning', async () => {
    state.params = { page: '300' };
    await render();
    await press(panelButton('save'));
    await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText('Family'));
    await press(button(copy().confirmStop));
    expect(stored()).toEqual([expect.objectContaining({ name: 'Family', page: 300 })]);
  });

  it('an empty name explains what is needed and saves nothing', async () => {
    await render();
    await press(panelButton('save'));
    await press(button(copy().confirmStop));
    expect(texts()).toContain(copy().stopNameInvalid);
    expect(root.root.findAllByProps({ testID: 'mushaf-popup-save' })).toHaveLength(1); // stays open to retry
    expect(stored()).toEqual([]);
  });
});

describe('languages', () => {
  for (const locale of ['ar', 'ar-EG'] as const) {
    it(`${locale}: the bar is spoken in the language; the printed page is unchanged`, async () => {
      state.locale = locale;
      await render();
      const labels = root.root.findByProps({ testID: 'mushaf-panel' }).findAllByType('Pressable' as never).map((node) => node.props.accessibilityLabel);
      expect(labels).toEqual([copy().nextPage, MESSAGES[locale].reflection.writeAction, copy().searchPage, copy().saveStopAction, copy().previousPage]);
      expect(labels.every((label) => /[؀-ۿ]/.test(label))).toBe(true);
      expect(texts()).toEqual(expect.arrayContaining(['سورة آل عمران', 'الجزء الثالث', '٦١']));
    });
  }
});

describe('QPC V1 (1405 AH) renderer', () => {
  const MEASURE_WIDTH = 900;
  async function renderQpc(layout = syntheticQpcPage61()) {
    state.fetch.mockResolvedValue(layoutResponse(200, { success: true, data: layout }));
    await render();
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
    const row = root.root.findByProps({ testID: `qpc-line-${line}` });
    const locationY = await drawnLineY(row); // where its words are drawn
    await act(async () => row.props.onPress({ nativeEvent: { locationX, locationY } }));
  };
  const markerGlyphs = (layout: ReturnType<typeof syntheticQpcPage61>) => layout.lines.flatMap((line) => {
    const glyphs = root.root.findByProps({ testID: `qpc-line-${line.line}` }).findAllByType('Text' as never);
    return line.words.map((word, index) => ({ word, glyph: glyphs[index] })).filter(({ word }) => word.kind === 'end');
  });
  const ornaments = () => root.root.findAll((node) => String(node.type) === 'Svg' && node.props.testID !== 'mushaf-frame' && !String(node.props.testID).startsWith('reflection-bulb') && typeof node.props.viewBox === 'string');
  const paperColor = () => styleOf(root.root.findByProps({ testID: 'mushaf-paper' })).backgroundColor;

  it('is used once the font is loaded and the layout passes the Tanzil check', async () => {
    await renderQpc();
    expect(String(state.fetch.mock.calls[0][0])).toMatch(/\/api\/mushaf\/qpc-v1\/pages\/61$/);
    expect(root.root.findAllByProps({ testID: 'qpc-v1-text' })).toHaveLength(1);
    expect(root.root.findAllByType('SvgXml' as never)).toHaveLength(0);
  });

  it('draws the 15 lines, right to left, every word its own unmodified glyph in the page font, sized to fill the text area', async () => {
    const layout = syntheticQpcPage61();
    await renderQpc(layout);
    await layOut(layout);
    for (const line of layout.lines) {
      const row = root.root.findByProps({ testID: `qpc-line-${line.line}` });
      expect(styleOf(row)).toMatchObject({ flexDirection: 'row-reverse', justifyContent: 'space-between' });
      const glyphs = row.findAllByType('Text' as never);
      expect(glyphs.map((node) => node.props.children)).toEqual(line.words.map((word) => word.glyph));
      for (const glyph of glyphs) expect(styleOf(glyph).fontFamily).toBe('QCF_P061');
    }
    const area = styleOf(root.root.findByProps({ testID: 'mushaf-text-area' })) as { width: number };
    const size = styleOf(root.root.findByProps({ testID: 'qpc-line-1' }).findAllByType('Text' as never)[0]).fontSize as number;
    expect(size).toBeCloseTo((100 * area.width * 0.985) / MEASURE_WIDTH);
  });

  it('every glyph Text is the font`s whole line, in a container 0.25 em taller above and below in Normal Mode, so no harakah, hamza or descender is clipped on devices', async () => {
    const { QCF_V1_INK_ROOM_V_EM, QCF_V1_LINE_BOX_EM, QCF_V1_NORMAL_BOX_MARGIN_EM, QCF_V1_NORMAL_LINE_BOX_EM } = await import('@/mushaf/ayahMarkers');
    const layout = syntheticQpcPage61();
    await renderQpc(layout);
    // The measuring pass, at its fixed size.
    const measured = root.root.findByProps({ testID: 'qpc-measure-1' }).findAllByType('Text' as never).map(styleOf);
    for (const style of measured) expect(style.lineHeight).toBeCloseTo(style.fontSize * QCF_V1_LINE_BOX_EM);
    await layOut(layout);
    const drawn = layout.lines.flatMap((line) => root.root.findByProps({ testID: `qpc-line-${line.line}` }).findAllByType('Text' as never).map(styleOf));
    expect(drawn).toHaveLength(layout.lines.reduce((n, line) => n + line.words.length, 0));
    for (const style of drawn) {
      // The line box is the font's own line (1.914 em; never the former 1.3 em), so each glyph sits where it always did …
      expect(style.lineHeight).toBeCloseTo(style.fontSize * QCF_V1_LINE_BOX_EM);
      expect(style.overflow).toBeUndefined();
      if (style.color === 'transparent') continue; // a hidden marker glyph (its medallion is drawn over it)
      // … and its container, in Normal Mode, is 0.25 em taller above and below (ink reaches within 1 font unit of the
      // line's edges on pages 322, 323, 466): the outer box (line + padding + margin) is QCF_V1_NORMAL_LINE_BOX_EM …
      expect(style.paddingVertical).toBeCloseTo(style.fontSize * (QCF_V1_INK_ROOM_V_EM + QCF_V1_NORMAL_BOX_MARGIN_EM));
      expect(style.marginVertical).toBeCloseTo(-style.fontSize * QCF_V1_INK_ROOM_V_EM);
      expect((style.lineHeight + 2 * (style.paddingVertical + style.marginVertical)) / style.fontSize).toBeCloseTo(QCF_V1_NORMAL_LINE_BOX_EM);
      // … and the frame the platform paints in reaches 0.75 em past the line above and below.
      expect(style.paddingVertical / style.fontSize).toBeCloseTo(0.75);
    }
    // Nothing on the way clips: the lines, the text area and the page take no overflow: hidden.
    for (const id of ['qpc-v1-text', 'mushaf-text-area', 'mushaf-paper', ...layout.lines.map((line) => `qpc-line-${line.line}`)]) {
      expect(styleOf(root.root.findByProps({ testID: id })).overflow, id).toBeUndefined();
    }
  });

  it('consecutive baselines are exactly one pitch apart on every line (measured by baseline, not by letter tops), heading slots kept', async () => {
    const { cssBaseline, QCF_V1_LINE_BOX_EM } = await import('@/mushaf/ayahMarkers');
    // Each line sits in the slot of its own line number (row top = (line − 1) × pitch), so a page's empty
    // heading or Basmala lines keep their space and the text is never pushed across them.
    // The geometry itself, on the real layout: row tops, glyph boxes and baselines.
    const full = syntheticQpcPage61();
    await renderQpc(full);
    await layOut(full);
    const pitch = styleOf(root.root.findByProps({ testID: 'qpc-line-1' })).height;
    const baselines = full.lines.map((line) => {
      const row = styleOf(root.root.findByProps({ testID: `qpc-line-${line.line}` }));
      expect(row.top).toBeCloseTo((line.line - 1) * pitch); // the row is the line's own slot
      expect(row.height).toBeCloseTo(pitch);
      expect(row.alignItems).toBe('center');
      const glyphStyles = root.root.findByProps({ testID: `qpc-line-${line.line}` }).findAllByType('Text' as never).map(styleOf);
      const box = glyphStyles[0].lineHeight;
      for (const style of glyphStyles) {
        expect(style.lineHeight).toBe(box); // every word's box the same height, so every word sits on one baseline
        expect(style.fontSize).toBe(glyphStyles[0].fontSize);
      }
      expect(box / glyphStyles[0].fontSize).toBeCloseTo(QCF_V1_LINE_BOX_EM);
      // Baseline = row top + (pitch − box) / 2 + the box's own baseline. Normal Mode's taller container is symmetric
      // padding around this box, centred in the row, so it moves no glyph.
      return row.top + (pitch - box) / 2 + cssBaseline(glyphStyles[0].fontSize, box);
    });
    const gaps = baselines.slice(1).map((b, i) => b - baselines[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(pitch, 9);
  });

  it('by default: Warm Cream and a traditional medallion over each of the 8 marker glyphs (kept in place, unpainted)', async () => {
    const layout = syntheticQpcPage61();
    await renderQpc(layout);
    await layOut(layout);
    expect(paperColor()).toBe('#F9EFD2');
    expect(ornaments()).toHaveLength(8);
    for (const { word, glyph } of markerGlyphs(layout)) {
      expect(glyph.props.children).toBe(word.glyph);
      expect(styleOf(glyph)).toMatchObject({ color: 'transparent', fontFamily: 'QCF_P061' });
      const numberPath = glyph.parent!.findAll((node) => String(node.type) === 'Svg')[0].findAllByType('Path' as never).at(-1)!.props.d;
      expect(numberPath).toBe(AYAH_MARKERS_061.markers.find((marker) => marker.verseKey === word.verseKey)!.numberPath);
    }
  });

  it('the phase-1C presets restore Original Cream and the font`s green marker glyphs exactly', async () => {
    state.params = { background: 'original', markers: 'qpc-glyph' };
    const layout = syntheticQpcPage61();
    await renderQpc(layout);
    await layOut(layout);
    expect(paperColor()).toBe('#F9F5DA');
    expect(ornaments()).toHaveLength(0);
    for (const { glyph } of markerGlyphs(layout)) expect(styleOf(glyph).color).toBe('#3E7D57');
  });

  it('every ayah 3:84–3:91 can be selected (words or medallions), enabling reflection for exactly that ayah', async () => {
    const layout = syntheticQpcPage61();
    await renderQpc(layout);
    await layOut(layout);
    for (const verseKey of layout.verseKeys) {
      const line = layout.lines.find((candidate) => candidate.words.some((word) => word.verseKey === verseKey))!;
      const index = line.words.findIndex((word) => word.verseKey === verseKey);
      await tapLine(line.line, 400 - index * 30 + 5);
      await press(panelButton('reflect'));
      expect(root.root.findByType('ReflectionSheet' as never).props).toMatchObject({ visible: true, verseKey });
      await act(async () => root.root.findByType('ReflectionSheet' as never).props.onClose());
      await tapLine(line.line, 400 - index * 30 + 5); // the same ayah again clears it
      expect(panelButton('reflect').props.disabled).toBe(true);
    }
    // Under zoom the line's own touch target scales with the page: the same local point picks the same ayah.
    await pinch(3, { x: 300, y: 400 });
    await tapLine(4, 405);
    await press(panelButton('reflect'));
    expect(root.root.findByType('ReflectionSheet' as never).props.verseKey).toBe(layout.lines[3].words[0].verseKey);
    await act(async () => root.root.findByType('ReflectionSheet' as never).props.onClose());
    await tapLine(4, 405);
    // 3:84 runs over lines 1–4: a highlight on each.
    await tapLine(2, 405);
    for (const n of [1, 2, 3, 4]) expect(root.root.findAllByProps({ testID: `qpc-highlight-${n}` })).toHaveLength(1);
    await tapLine(13, 1000); // beyond the words: margin, nothing changes
    expect(root.root.findAllByProps({ testID: 'qpc-highlight-1' })).toHaveLength(1);
  });

  it('a layout that disagrees with the verified Tanzil text is never drawn: the SVG page shows instead', async () => {
    await renderQpc(syntheticQpcPage61({ dropWord: '3:87' }));
    expect(root.root.findAllByProps({ testID: 'qpc-v1-text' })).toHaveLength(0);
    expect(root.root.findAllByType('SvgXml' as never)).toHaveLength(1);
  });

  it('without the font, the SVG page shows', async () => {
    state.fontsLoaded = false;
    await renderQpc();
    expect(root.root.findAllByType('SvgXml' as never)).toHaveLength(1);
  });

  it('when installed offline, page 61 comes from the device (no network)', async () => {
    state.offline.readPage.mockImplementation(async (n: number) => (n === 61 ? syntheticQpcPage61() : null));
    await render();
    expect(state.fetch).not.toHaveBeenCalledWith(expect.stringMatching(/qpc-v1\/pages\/61/), expect.anything(), expect.anything());
    expect(root.root.findAllByProps({ testID: 'qpc-v1-text' })).toHaveLength(1);
  });
});

describe('offline Mushaf download (on pages not yet downloaded)', () => {
  const panelTexts = () => root.root.findByProps({ testID: 'offline-mushaf' }).findAllByType('Text' as never).map((node) => [node.props.children].flat().join(''));

  it('a page that isn`t downloaded offers the download, with progress and an explained failure', async () => {
    state.params = { page: '200' };
    state.offline.download.mockImplementation(({ onProgress }: { onProgress: (p: unknown) => void }) => {
      onProgress({ phase: 'downloading', chunksTotal: 31, chunksReady: 10, bytesTotal: 1000, bytesReady: 500 });
      return new Promise(() => undefined);
    });
    await render();
    expect(texts()).toContain(copy().pageNotDownloaded);
    await press(button(copy().offlineDownload));
    expect(panelTexts().join(' ')).toMatch(new RegExp(`${copy().offlineDownloading} 50%`));
  });

  it('after a download the page reloads from the device', async () => {
    state.params = { page: '200' };
    state.offline.download.mockResolvedValue({ status: 'installed', version: 'b'.repeat(24), downloadedChunks: 31, reusedChunks: 0 });
    await render();
    state.offline.readPage.mockClear();
    await press(button(copy().offlineDownload));
    await flush();
    expect(state.offline.readPage).toHaveBeenCalledWith(200);
  });
});

describe('Dark Mode', () => {
  it('Warm Midnight Olive: cream ink and heads, the approved border unchanged, the panel in its dark style', async () => {
    state.theme = 'dark';
    state.fetch.mockResolvedValue(layoutResponse(200, { success: true, data: syntheticQpcPage61() }));
    await render();
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-paper' })).backgroundColor).toBe('#222820');
    expect(styleOf(root.root.findByProps({ testID: 'qpc-measure-1' }).findAllByType('Text' as never)[0]).color).toBe('#F1E9D6');
    expect(styleOf(root.root.findAllByType('Text' as never).find((node) => node.props.children === 'سورة آل عمران')!).color).toBe('#F1E9D6');
    const fills = root.root.findByProps({ testID: 'mushaf-frame' }).findAllByType('Path' as never).map((node) => node.props.fill);
    expect(new Set(fills)).toEqual(new Set(Object.values(BORDER_INKS)));
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-panel' })).backgroundColor).toBe(MUSHAF_PANEL_COLORS.dark.surface.backgroundColor);
  });

  it('the lit lightbulb is warm ivory in Dark Mode; unlit it is a muted grey', async () => {
    state.theme = 'dark';
    await render();
    const bulb = () => panelButton('reflect').findByType(ReflectionBulbIcon as never);
    expect(bulb().props).toMatchObject({ lit: false, color: MUSHAF_PANEL_COLORS.dark.bulbOff });
    await tapPage(100, 130);
    expect(bulb().props).toMatchObject({ lit: true, color: MUSHAF_PANEL_COLORS.dark.bulbOn });
  });

  it('the Quran SVG fallback is recoloured; Light Mode keeps its ink', async () => {
    state.theme = 'dark';
    await render();
    expect(root.root.findByType('SvgXml' as never).props.xml).not.toContain('fill="#231f20"');
    await act(async () => root.unmount());
    state.theme = 'light';
    await render();
    expect(root.root.findByType('SvgXml' as never).props.xml).toContain('fill="#231f20"');
  });
});

/**
 * Finger samples (down, moves every 16 ms, up or cancel) through the gesture
 * state machine react-native-gesture-handler runs natively
 * (tests/helpers/gestureSimulator.ts): activation and fail offsets, finger
 * counts, cancellation and callback order all decide, as on a phone. With
 * `stack`, the iOS navigation stack's back swipe sees the same touches.
 * A model, not a device: the iPhone check is in docs/mushaf-device-testing.md.
 */
describe('real touch sequences', () => {
  const shown = () => (state.offline.readPage.mock.calls.at(-1)?.[0] as number | undefined);
  const ios26 = (options: { gestureEnabled?: boolean; fullScreenGestureEnabled?: boolean }, rtl = false) => ({ options, iosVersion: 26, rtl, screenWidth: 390 });
  type Opts = Parameters<typeof runTouch>[2];
  async function touch(samples: Parameters<typeof runTouch>[1], opts?: Opts) {
    let result!: ReturnType<typeof runTouch>;
    await act(async () => { result = runTouch(state.gesture!.gestures.map((g) => g.__g), samples, opts); });
    await flush();
    await flush();
    return result;
  }
  // Two fingers spreading to 2× around the page centre: a pinch.
  const pinchSamples = [{ x: 195, y: 350, t: 0, pointers: 2 }, { x: 195, y: 350, t: 16, pointers: 2, scale: 1.5 }, { x: 195, y: 350, t: 32, pointers: 2, scale: 2 }];

  for (const locale of ['en', 'ar'] as const) {
    for (const mode of ['normal', 'full'] as const) {
      it(`${locale}, ${mode === 'normal' ? 'Normal Mode' : 'full screen'}: finger left to right = next (61 → 62), right to left = previous (61 → 60), one page per swipe`, async () => {
        state.locale = locale;
        await render();
        if (mode === 'full') await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
        state.offline.readPage.mockClear();
        // The stack around the reader, with the reader's options: it never takes the swipe.
        const stack = { stack: ios26(MUSHAF_SCREEN_OPTIONS) };
        expect((await touch(drag(80, 350, 160, 10), stack)).states).toContain('pan:ended'); // left to right
        expect(state.offline.readPage.mock.calls).toEqual([[62]]);
        await touch(drag(300, 350, -160, -6), stack); // right to left
        expect(shownPageNumber()).toBe('٦١');
        state.offline.readPage.mockClear();
        await touch(drag(300, 350, -160, 6), stack);
        expect(state.offline.readPage.mock.calls).toEqual([[60]]);
        // A quick thumb flick, shorter than a full swipe, also turns exactly one page.
        await touch(flick(150, 350, 40));
        expect(shownPageNumber()).toBe('٦١');
        await touch(flick(150, 350, 40));
        expect(shown()).toBe(62);
        if (mode === 'full') expect(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }).props.accessibilityState).toEqual({ expanded: true });
      });
    }
  }

  it('the root cause on iOS 26: the stack`s default full-screen back swipe takes a left-to-right swipe (the next page; under RTL, right to left); the reader`s options keep both for the page', async () => {
    await render();
    state.offline.readPage.mockClear();
    // Default options (before the fix): the stack begins going back and cancels the page's swipe.
    const taken = await touch(drag(80, 350, 160, 6), { stack: ios26({}) });
    expect(taken.stackTookTouch).toBe(true);
    // It wins before the page's swipe activates (16 pt): the swipe fails and never ends as a turn.
    expect(taken.states).not.toContain('pan:ended');
    expect(state.offline.readPage).not.toHaveBeenCalled();
    expect((await touch(drag(300, 350, -160, 6), { stack: ios26({}, true) })).stackTookTouch).toBe(true);
    expect(state.offline.readPage).not.toHaveBeenCalled();
    // Before iOS 26 only an edge swipe went back: that is why the middle of the page used to work.
    expect((await touch(drag(200, 350, 120, 0), { stack: { ...ios26({}), iosVersion: 18 } })).stackTookTouch).toBe(false);
    expect(shown()).toBe(62);
    await act(async () => root.unmount());
    await render();
    state.offline.readPage.mockClear();
    // The reader's options: swipe-back is off, from the edge too, in either direction.
    for (const [x, dx, rtl, page] of [[80, 160, false, 62], [5, 160, false, 62], [300, -160, true, 60], [385, -160, true, 60]] as const) {
      const result = await touch(drag(x, 350, dx, 4), { stack: ios26(MUSHAF_SCREEN_OPTIONS, rtl) });
      expect(result.stackTookTouch).toBe(false);
      expect(shown()).toBe(page);
      await touch(drag(200, 350, -dx, 4)); // back to 61
      expect(shownPageNumber()).toBe('٦١');
    }
    expect(MUSHAF_SCREEN_OPTIONS).toEqual({ gestureEnabled: false, fullScreenGestureEnabled: false });
  });

  it('no turn from a tap, a small or slow movement, a mostly vertical drag, a cancelled touch, or a second finger', async () => {
    await render();
    state.offline.readPage.mockClear();
    await touch([{ x: 200, y: 350, t: 0 }, { x: 200, y: 350, t: 90 }]); // a tap
    await touch(drag(200, 350, -12, 0)); // under the activation distance
    await touch(drag(200, 350, -40, 0, 600)); // short and slow
    await touch(drag(200, 350, -70, -90)); // mostly vertical
    await touch(drag(200, 350, -30, 40)); // vertical first: fails before it activates
    expect(state.offline.readPage).not.toHaveBeenCalled();
    // The system cancels mid-swipe (a call, Control Centre): released as cancelled, not as a turn.
    expect((await touch(drag(300, 350, -160, 0), { systemCancelAt: 8 })).states).toContain('pan:cancelled');
    // A second finger lands mid-swipe: the swipe is cancelled (a pinch starts instead).
    const two = [...drag(300, 350, -100, 0, 120), { x: 190, y: 350, t: 140, pointers: 2, scale: 1.01 }, { x: 180, y: 350, t: 160, pointers: 2, scale: 1.01 }];
    expect((await touch(two)).states).toContain('pan:cancelled');
    expect(state.offline.readPage).not.toHaveBeenCalled();
    expect(shownPageNumber()).toBe('٦١');
  });

  it('zoomed in: a sideways drag pans, never turns; double-tap returns to 1×, where swipes turn again', async () => {
    await render();
    await touch(pinchSamples);
    expect(zoom().scale).toBe(2);
    state.offline.readPage.mockClear();
    const before = zoom().x;
    expect((await touch(drag(300, 350, -160, 0))).states).toContain('pan:ended');
    await touch(drag(80, 350, 160, 0));
    await touch(flick(250, 350, -40));
    expect(state.offline.readPage).not.toHaveBeenCalled();
    expect(zoom().x).not.toBe(before);
    expect(zoom().scale).toBe(2);
    await touch([{ x: 200, y: 350, t: 1000 }, { x: 200, y: 350, t: 1060 }]);
    await touch([{ x: 200, y: 350, t: 1200 }, { x: 200, y: 350, t: 1260 }]);
    expect(zoom().scale).toBe(1);
    await touch(drag(80, 350, 160, 0));
    expect(state.offline.readPage.mock.calls).toEqual([[62]]);
  });

  it('full screen: a swipe down still leaves it; a sideways swipe never does', async () => {
    await render();
    await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
    await touch(drag(200, 300, -160, 10));
    expect(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }).props.accessibilityState).toEqual({ expanded: true });
    await touch(drag(200, 300, 0, 160));
    expect(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }).props.accessibilityState).toEqual({ expanded: false });
  });

  it('stops at pages 1 and 604, and keeps the active ورد', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'fajr', name: 'ورد الفجر', page: 61, updatedAt: '2026-10-01T00:00:00.000Z' }]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
    state.params = { page: '1' };
    await render();
    state.offline.readPage.mockClear();
    await touch(drag(300, 350, -160, 0)); // right to left, previous: nothing before page 1
    expect(state.offline.readPage).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    state.params = { page: '604' };
    await render();
    state.offline.readPage.mockClear();
    await touch(drag(80, 350, 160, 0)); // left to right, next: nothing after page 604
    expect(state.offline.readPage).not.toHaveBeenCalled();
    await touch(drag(300, 350, -160, 0));
    expect(shown()).toBe(603);
    expect(root.root.findByProps({ testID: 'mushaf-wird' }).findByType('Text' as never).props.children).toBe('ورد الفجر');
    expect(state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)).toBe('fajr');
  });
});

describe('دعاء ختم القرآن after page 604', () => {
  const link = () => root.root.findAllByProps({ testID: 'mushaf-khatm-dua' }).filter((node) => String(node.type) === 'Pressable');
  it('no link while there is no verified text (now), on page 604 or anywhere', async () => {
    state.params = { page: '604' };
    await render();
    expect(link()).toHaveLength(0);
  });

  it('with an approved text: a link on page 604 only, opening its own screen; the Mushaf still ends at 604', async () => {
    state.khatmDua = { paragraphs: ['نص'], source: 'test' };
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'fajr', name: 'ورد الفجر', page: 604, updatedAt: '2026-10-01T00:00:00.000Z' }]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
    const stored = state.storage.get(READING_STOPS_STORAGE_KEY);
    state.params = { page: '603' };
    await render();
    expect(link()).toHaveLength(0);
    await act(async () => root.unmount());
    for (const locale of ['en', 'ar'] as const) {
      state.locale = locale;
      state.params = { page: '604' };
      await render();
      expect(link()).toHaveLength(1);
      expect(link()[0].props.accessibilityLabel).toBe('دعاء ختم القرآن');
      await press(link()[0]);
      expect(router.push).toHaveBeenLastCalledWith('/khatm-dua');
      // Not a page 605: the next-page arrow stays disabled, and nothing was saved.
      expect(panelButton('next').props.disabled).toBe(true);
      expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(stored);
      expect(state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)).toBe('fajr');
      await act(async () => root.unmount());
    }
  });
});
