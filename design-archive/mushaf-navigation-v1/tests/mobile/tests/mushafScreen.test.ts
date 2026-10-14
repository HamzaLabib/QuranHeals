import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  /** The دعاء ختم القرآن text (mushaf/khatmDua.ts mock): null here unless a test sets the approved text. */
  khatmDua: null as null | { title: string; paragraphs: readonly string[] },
  /** The page's gestures as last rendered (react-native-gesture-handler mock), to drive pinches, drags, swipes and taps. */
  gesture: null as null | { gestures: { __g: MockGesture }[] },
  /** The zoomed page's animated style (Reanimated mock), read after gestures. */
  animatedStyle: null as null | (() => { transform: Record<string, number>[] }),
  /** Animations held mid-way (Reanimated mock): their completions wait in `pending` until run, or are dropped when cancelled. */
  holdAnimations: false,
  pending: [] as ((finished: boolean) => void)[],
  /** UI-thread calls to React (react-native-worklets mock) held in `toRN` until run. */
  deferRN: false,
  toRN: [] as (() => void)[],
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
    ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
  };
});
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', SvgXml: 'SvgXml', Defs: 'Defs', Ellipse: 'Ellipse', G: 'G', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => state.insets }));
vi.mock('lucide-react-native', () => ({
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', BookMarked: 'BookMarked', Bookmark: 'Bookmark', Check: 'Check', ChevronDown: 'ChevronDown', Maximize: 'Maximize', Minimize: 'Minimize', Plus: 'Plus', Search: 'Search', X: 'X',
}));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), replace: vi.fn(), push: vi.fn(), navigate: vi.fn(), canGoBack: () => state.canGoBack }, useLocalSearchParams: () => state.params }));
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
    // The style as rendered, carrying (not enumerable) the function itself, to read it live after gestures.
    useAnimatedStyle: (style: () => { transform: Record<string, number>[] }) => {
      state.animatedStyle = style;
      return Object.defineProperty(style(), '__live', { value: style });
    },
    // Arrives at once; its completion callback runs after the value is set, as on a device (never within the set).
    // Held: the value is already there, but the animation counts as running until `pending` is run or cancelled.
    withTiming: (value: number, _config?: unknown, done?: (finished: boolean) => void) => {
      if (done && state.holdAnimations) state.pending.push(done);
      else if (done) queueMicrotask(() => done(true));
      return value;
    },
    cancelAnimation: () => {
      const dropped = state.pending.splice(0);
      dropped.forEach((done) => done(false));
    },
    Easing: { out: (easing: unknown) => easing, cubic: 'cubic' },
  };
});
// From the UI thread to React: at once, or (deferRN) queued in `toRN` until run, as when React is a frame behind.
vi.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => (state.deferRN ? state.toRN.push(() => fn(...args)) : fn(...args)),
}));
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
// The binary's EAS Update channel (expo-updates, a native module): none, as in a development build.
vi.mock('expo-updates', () => ({ channel: null }));
// The device's connection (expo-network, a native module): Wi-Fi.
vi.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true, isInternetReachable: true }), addNetworkStateListener: () => ({ remove: () => undefined }) }));
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

const { resetMushafAutoDownloadForTests } = await import('@/mushaf/offline/autoDownloadService');
const { default: MushafScreen, parsePageNumber, fitMushafPage, BACK_BAR_HEIGHT, TALLER_MAX_TILES_DOWN, TALLER_MAX_LINE_SPACING } = await import('@/app/(tabs)/mushaf');
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
const { MUSHAF_BORDER_STYLES } = await import('@/mushaf/appearance');
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
/** The current page's drawing (its neighbours, drawn beside it for a swipe, are left out). */
const inPage = () => root.root.findByProps({ testID: 'mushaf-zoom-page' });
/** The page the reader shows: the pager's current slot (mushaf-pager-N). */
const currentPage = () => Number(String(inPage().parent!.props.testID).replace('mushaf-pager-', ''));
const shownPageNumber = () => inPage().findAllByType('Text' as never).map((node) => [node.props.children].flat().join('')).find((text) => /^[0-9٠-٩]{1,3}$/.test(text));

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
/** The page's current zoom: { scale, x, y } from the current page's animated transform, read live. */
const zoom = () => {
  const live = [inPage().props.style].flat(3).find((style) => style && (style as { __live?: unknown }).__live) as { __live: () => { transform: Record<string, number>[] } };
  const [{ translateX: x }, { translateY: y }, { scale }] = live.__live().transform;
  return { scale, x, y };
};
/** A one-finger drag; at 1× the swipe gesture decides (its activation offsets as configured), when zoomed the drag moves the page. */
async function swipe(dx: number, dy = 0) {
  await act(async () => {
    const turn = swipeGesture();
    const [, activeX] = turn.config.activeOffsetX as number[];
    const [, failY] = turn.config.failOffsetY as number[];
    if (enabled(turn)) {
      // As the gesture runs: touch down, then (past its activation offset) the drag follows the finger, then it lifts.
      turn.handlers.onBegin?.({ translationX: 0, translationY: 0 });
      const active = Math.abs(dx) > activeX && Math.abs(dy) < failY;
      if (active) {
        const at = { translationX: Math.sign(dx) * (activeX + 1), translationY: 0, velocityX: 0 };
        turn.handlers.onStart?.(at);
        turn.handlers.onUpdate?.(at);
        turn.handlers.onUpdate?.({ translationX: dx, translationY: dy, velocityX: 0 });
        turn.handlers.onEnd({ translationX: dx, translationY: dy, velocityX: 0 }, true);
      }
      turn.handlers.onFinalize?.({ translationX: dx, translationY: dy }, active);
    }
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
  // Most tests draw page 61 (bundled: drawn before any download), so they open it explicitly; without ?page= the
  // reader opens the saved ورد's page, or page 1 (tests below).
  state.params = { page: '61' };
  state.theme = 'light';
  state.insets = { top: 47, bottom: 34, left: 0, right: 0 };
  state.canGoBack = true;
  state.khatmDua = null;
  state.backHandlers = [];
  state.holdAnimations = false;
  state.pending = [];
  state.deferRN = false;
  state.toRN = [];
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
  // The offline Mushaf's one controller (a module singleton): each test starts with a fresh one.
  await resetMushafAutoDownloadForTests();
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
    expect(texts()).toEqual(expect.arrayContaining(['سورة آل عمران', 'الجزء ٣', '٦١']));
    const frame = inPage().findByProps({ testID: 'mushaf-frame' });
    expect(frame.findAllByType('Path' as never)).toHaveLength(6);
    const wrapper = frame.parent!.parent!;
    expect(wrapper.props.pointerEvents).toBe('none');
    expect(wrapper.props.importantForAccessibility).toBe('no-hide-descendants');
    const artwork = root.root.findByType('SvgXml' as never);
    expect(artwork.props.xml.match(/fill="#3E7D57"/g)).toHaveLength(8);
    for (const text of ['سورة آل عمران', 'الجزء ٣', '٦١']) {
      expect(styleOf(root.root.findAllByType('Text' as never).find((node) => node.props.children === text)!).fontFamily).toBe('Amiri_700Bold');
    }
  });

  it('takes the largest page that fits above the floating bar, in its own proportions, never cropped', async () => {
    const { computePageLayout } = await import('@/mushaf/pageGeometry');
    const aspect = computePageLayout(1000).page.height / 1000;
    const paperSize = () => styleOf(inPage().findByProps({ testID: 'mushaf-paper' }));
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
    const area = () => styleOf(inPage().findByProps({ testID: 'mushaf-text-area' }));
    const paper = () => styleOf(inPage().findByProps({ testID: 'mushaf-paper' }));
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
  const paperSize = () => styleOf(inPage().findByProps({ testID: 'mushaf-paper' }));
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
    expect(texts()).toEqual(expect.arrayContaining(['سورة آل عمران', 'الجزء ٣', '٦١']));
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
    const slot = () => inPage().parent!;
    expect(styleOf(slot()).justifyContent).toBeUndefined(); // Normal Mode: the page sits at the top, as approved
    await press(toggle());
    expect(styleOf(viewport())).toMatchObject({ overflow: 'hidden' });
    const box = { ...styleOf(viewport()), ...styleOf(slot()) };
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
    expect(currentPage()).toBe(62);
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
    expect(currentPage()).toBe(62);
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

  it('Dark Mode: ivory icons; the page keeps its dark border inks', async () => {
    state.theme = 'dark';
    await render();
    await press(toggle());
    expect(toggle().findByType('Minimize' as never).props.color).toBe(MUSHAF_PANEL_COLORS.dark.icon);
    expect(styleOf(inPage().findByProps({ testID: 'mushaf-paper' })).backgroundColor).toBe('#222820');
    const fills = inPage().findByProps({ testID: 'mushaf-frame' }).findAllByType('Path' as never).map((node) => node.props.fill);
    expect(new Set(fills)).toEqual(new Set(Object.values(MUSHAF_BORDER_STYLES.midnight.inks)));
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
      expect(styleOf(inPage().findByProps({ testID: 'mushaf-paper' })).backgroundColor).toBe(paper);
      expect(screen().paddingTop).toBe(47); // the status-bar area is the reader's own, in its colour
      await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
      expect(screen().backgroundColor).toBe(paper);
      await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
      expect(styleOf(root.root.findByProps({ testID: 'mushaf-panel' })).backgroundColor).not.toContain(theme === 'dark' ? '34, 40, 32' : '249, 239, 210');
      // The border: the approved inks on the light page, the midnight gold and sage inks on the dark one.
      const fills = inPage().findByProps({ testID: 'mushaf-frame' }).findAllByType('Path' as never).map((node) => node.props.fill);
      expect(new Set(fills)).toEqual(new Set(Object.values(theme === 'dark' ? MUSHAF_BORDER_STYLES.midnight.inks : BORDER_INKS)));
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
      for (const key of ['previous', 'search', 'next']) {
        const iconNode = panelButton(key).children[0] as ReactTestInstance;
        expect(iconNode.props.color, key).toBe(icon);
      }
      // Page 61 is ورد الفجر's saved page: the whole bookmark, outline and fill, is bright yellow (no green left).
      expect((panelButton('save').children[0] as ReactTestInstance).props).toMatchObject({ color: '#FFC000', fill: '#FFC000' });
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
    state.params = { page: '61', ...params };
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
  const frameTiles = () => Number(String(inPage().findByProps({ testID: 'mushaf-frame' }).props.viewBox).split(' ')[3]);
  const lineRows = () => Array.from({ length: 15 }, (_, i) => styleOf(root.root.findByProps({ testID: `qpc-line-${i + 1}` })));
  const glyphs = () => inPage().findAllByProps({ testID: 'qpc-v1-text' })[0].findAll((node) => String(node.type) === 'Text' && typeof node.props.children === 'string').map((node) => ({ glyph: node.props.children, size: styleOf(node).fontSize }));

  const fullScreenOn = async () => { await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' })); };

  it('page 61: Normal Mode is Traditional, full screen is Taller automatically; the reading position is kept', async () => {
    setDev(true);
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'fajr', name: 'ورد الفجر', page: 61, updatedAt: '2026-10-01T00:00:00.000Z' }]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
    const stored = state.storage.get(READING_STOPS_STORAGE_KEY);
    // An iPhone 393 × 852 (insets 59 / 34): the area under the Back row.
    await renderQpc({}, { width: 393, height: 852 - 59 - BACK_BAR_HEIGHT });
    const paper = () => styleOf(inPage().findByProps({ testID: 'mushaf-paper' }));
    const glyphSize = () => styleOf(inPage().findByProps({ testID: 'qpc-line-1' }).findAllByType('Text' as never)[0]).fontSize;
    expect(Math.round(paper().height)).toBe(623);
    expect(frameTiles()).toBe(29);
    const size = glyphSize();
    { const row = inPage().findByProps({ testID: 'qpc-line-2' }); const locationY = await drawnLineY(row); await act(async () => row.props.onPress({ nativeEvent: { locationX: 405, locationY } })); }
    state.offline.readPage.mockClear();
    await fullScreenOn();
    expect(paper()).toMatchObject({ width: 387 });
    expect(Math.round(paper().height)).toBe(700); // +77 pt on this iPhone
    expect(frameTiles()).toBe(33);
    expect(glyphSize()).toBe(size); // the same letter size
    expect(inPage().findAllByProps({ testID: 'qpc-highlight-2' }).length).toBeGreaterThan(0); // the selection is kept
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
    const boxes = () => inPage().findAllByProps({ testID: 'qpc-v1-text' })[0]
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
    expect(styleOf(inPage().findByProps({ testID: 'mushaf-paper' })).width).toBe(406);
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
        expect(Math.round(styleOf(inPage().findByProps({ testID: 'mushaf-paper' })).height), label).toBe(700);
        await fullScreenOn();
        expect(frameTiles(), label).toBe(29);
        await act(async () => root.unmount());
      }
    }
  });

  it('Hizb label: centred in the header between the Surah and the juz`, only on a start page, the same in Normal and Full-Screen', async () => {
    const hizbLabel = () => root.root.findAllByProps({ testID: 'mushaf-hizb-label' }).filter((node) => String(node.type) === 'Text');
    for (const [n, expected] of [[5, 'ربع الحزب ١'], [11, 'الحزب ٢'], [6, null]] as const) {
      setDev(true);
      const other = { ...syntheticQpcPage61(), page: n, fontFamily: `QCF_P${String(n).padStart(3, '0')}` };
      state.offline.readPage.mockImplementation(async (page: number) => (page === n ? other : null));
      state.params = { page: String(n) };
      await render({ width: 393, height: 852 - 59 - BACK_BAR_HEIGHT });
      if (expected === null) {
        expect(hizbLabel(), `page ${n}`).toHaveLength(0); // no start on this page: no label at all
        await fullScreenOn();
        expect(hizbLabel(), `page ${n} full screen`).toHaveLength(0); // nor in Full-Screen
        await fullScreenOn();
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
        expect(texts.map((child) => child.props.testID ?? null)).toEqual(['mushaf-header-surah', 'mushaf-hizb-label', 'mushaf-header-juz']);
        expect(String(texts[0].props.children)).toMatch(/^سورة /);
        expect(String(texts[2].props.children)).toMatch(/^الجزء /);
        // Full-Screen (Taller): the same label, in the same header row, between the same two heads.
        await fullScreenOn();
        expect(frameTiles(), `page ${n} full screen is Taller`).toBeGreaterThan(29);
        const full = hizbLabel();
        expect(full, `page ${n} full screen`).toHaveLength(1);
        expect(full[0].props.children).toBe(expected);
        expect(styleOf(full[0])).toMatchObject({ flex: 1, textAlign: 'center' });
        expect(full[0].props.numberOfLines).toBe(1);
        const fullRow = full[0].parent!;
        expect(styleOf(fullRow).alignItems).toBe('baseline');
        expect((fullRow.children as ReactTestInstance[]).filter((child) => typeof child !== 'string').map((child) => child.props.testID ?? null)).toEqual(['mushaf-header-surah', 'mushaf-hizb-label', 'mushaf-header-juz']);
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
    const traditional = { tiles: frameTiles(), paper: styleOf(inPage().findByProps({ testID: 'mushaf-paper' })), pitch: lineRows()[0].height, glyphs: glyphs() };
    await fullScreenOn();
    const mobile = { tiles: frameTiles(), paper: styleOf(inPage().findByProps({ testID: 'mushaf-paper' })), pitch: lineRows()[0].height, glyphs: glyphs() };
    expect(traditional.tiles).toBe(29);
    expect(mobile.tiles).toBeGreaterThan(29);
    expect(Number.isInteger(mobile.tiles)).toBe(true); // whole tiles: repeated, never stretched
    expect(mobile.paper.width).toBe(traditional.paper.width); // the width (and so the text size) is the device's
    expect(mobile.paper.height).toBeGreaterThan(traditional.paper.height);
    expect(mobile.paper.height).toBeLessThanOrEqual(855 - 4 - 34); // still the whole page, inside the safe area
    expect(mobile.pitch).toBeGreaterThan(traditional.pitch);
    expect(mobile.glyphs).toEqual(traditional.glyphs); // every glyph, in order, at the same size
    const { QCF_V1_LINE_BOX_EM } = await import('@/mushaf/ayahMarkers');
    for (const node of inPage().findByProps({ testID: 'qpc-line-1' }).findAllByType('Text' as never)) {
      expect(styleOf(node).lineHeight).toBeCloseTo(styleOf(node).fontSize * QCF_V1_LINE_BOX_EM); // the full glyph box here too
    }
    const rows = lineRows();
    expect(rows.map((row) => row.top)).toEqual(rows.map((_, i) => i * mobile.pitch)); // 15 evenly spaced lines
    const { buildBorderPattern } = await import('@/mushaf/borderPattern');
    expect(inPage().findByProps({ testID: 'mushaf-frame' }).findAllByType('Path' as never).map((node) => node.props.d)).toEqual(['cream', 'mint', 'green', 'brown', 'ochre', 'rule'].map((ink) => buildBorderPattern(20, mobile.tiles).paths[ink as never]));
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
        if (inPage().findAllByProps({ testID: 'qpc-line-1' }).length === 0) {
          await act(async () => {
            for (const line of syntheticQpcPage61().lines) root.root.findByProps({ testID: `qpc-measure-${line.line}` }).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: line.line === 1 ? MEASURE_WIDTH : 800, height: 100 } } });
          });
        }
        const rows = lineRows();
        const pitch = rows[0].height;
        const glyph = styleOf(inPage().findByProps({ testID: 'qpc-line-1' }).findAllByType('Text' as never)[0]);
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
    { const row = inPage().findByProps({ testID: 'qpc-line-2' }); const locationY = await drawnLineY(row); await act(async () => row.props.onPress({ nativeEvent: { locationX: 405, locationY } })); }
    const band = styleOf(inPage().findByProps({ testID: 'qpc-highlight-2' }));
    const { computePageLayout } = await import('@/mushaf/pageGeometry');
    const printedPitch = computePageLayout(styleOf(inPage().findByProps({ testID: 'mushaf-paper' })).width).linePitch;
    expect(band.height).toBeCloseTo(printedPitch * 0.92);
    expect(band.top + band.height / 2).toBeCloseTo(await drawnLineY(inPage().findByProps({ testID: 'qpc-line-2' }))); // centred on its line as drawn
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
    expect(styleOf(inPage().parent!)).toMatchObject({ justifyContent: 'center' });
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
  it('is icon-only, in the fixed order arrow-left · lightbulb · bookmark (centre) · search · arrow-right, above the bottom inset', async () => {
    await render();
    const bar = root.root.findByProps({ testID: 'mushaf-panel' });
    const buttons = bar.findAllByType('Pressable' as never);
    // Right to left: the left arrow is "next page", the right arrow "previous page".
    expect(buttons.map((node) => node.props.testID)).toEqual(['mushaf-panel-next', 'mushaf-panel-reflect', 'mushaf-panel-save', 'mushaf-panel-search', 'mushaf-panel-previous']);
    expect(buttons.findIndex((node) => node.props.testID === 'mushaf-panel-save')).toBe(Math.floor(buttons.length / 2)); // the centre of five
    expect(bar.findAllByType('Text' as never)).toHaveLength(0); // no labels under the icons
    expect(buttons.map((node) => node.props.accessibilityLabel)).toEqual([copy().nextPage, MESSAGES.en.reflection.writeAction, copy().saveStopAction, copy().searchPage, copy().previousPage]);
    const icons = buttons.map((node) => node.children[0] as ReactTestInstance);
    expect(icons.map(typeName)).toEqual(['ArrowLeft', 'ReflectionBulbIcon', 'Bookmark', 'Search', 'ArrowRight']);
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
    expect(inPage().findByProps({ testID: 'mushaf-selection' })).toBeDefined();
    expect(panelButton('reflect').props.disabled).toBe(false);
    await press(panelButton('reflect'));
    expect(root.root.findByType('ReflectionSheet' as never).props).toMatchObject({ visible: true, verseKey: '3:85' });
  });

  it('the lightbulb: a grey outline without rays until an ayah is selected, then the save button`s green outline and rays filled with bright yellow; clearing the selection unlights it', async () => {
    await render();
    const bulb = () => panelButton('reflect').findByType(ReflectionBulbIcon as never);
    const rays = () => panelButton('reflect').findAllByProps({ testID: 'reflection-bulb-rays' });
    const glassFill = () => panelButton('reflect').findByProps({ testID: 'reflection-bulb-glass' }).props.fill;
    expect(bulb().props).toMatchObject({ lit: false, color: MUSHAF_PANEL_COLORS.light.bulbOff });
    expect(glassFill()).toBe('none');
    expect(rays()).toHaveLength(0);
    const unlitSize = bulb().props.size;
    await tapPage(100, 130);
    // The saved bookmark's colour: the same token fills the save button's icon.
    expect(bulb().props).toMatchObject({ lit: true, color: MUSHAF_PANEL_COLORS.light.saved, size: unlitSize });
    // The green outline and rays, the glass bright yellow.
    expect(glassFill()).toBe('#FFC000');
    expect(panelButton('reflect').findByProps({ testID: 'reflection-bulb-lit' }).props.stroke).toBe(MUSHAF_PANEL_COLORS.light.saved);
    // One warm golden yellow for both active icons, the same token in Light and Dark; the Mushaf's gold ornament ink is separate.
    expect(MUSHAF_PANEL_COLORS.light.activeFill).toBe('#FFC000');
    expect(MUSHAF_PANEL_COLORS.dark.activeFill).toBe('#FFC000');
    expect(rays()).toHaveLength(1);
    // The same bulb shape in both states: only the fill and the rays are added.
    expect(panelButton('reflect').findByProps({ testID: 'reflection-bulb-lit' }).findAllByType('Path' as never)).toHaveLength(4);
    await tapPage(100, 130); // the selected ayah again: cleared
    expect(bulb().props.lit).toBe(false);
    expect(glassFill()).toBe('none');
    expect(panelButton('reflect').props.disabled).toBe(true);
    expect(panelButton('reflect').findByProps({ testID: 'reflection-bulb-unlit' }).findAllByType('Path' as never)).toHaveLength(3);
  });

  it('a tap in the margin selects nothing', async () => {
    await render();
    await tapPage(343, 300); // right of every ayah polygon (they span x 0–338)
    expect(inPage().findAllByProps({ testID: 'mushaf-selection' })).toHaveLength(0);
    expect(panelButton('reflect').props.disabled).toBe(true);
  });
});

describe('page direction: arrows (left = next) and swipes (finger left to right = next)', () => {
  const left = () => root.root.findByProps({ testID: 'mushaf-panel' }).findAllByType('Pressable' as never)[0];
  const right = () => root.root.findByProps({ testID: 'mushaf-panel' }).findAllByType('Pressable' as never).at(-1)!;
  const shown = () => currentPage();

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
    expect(currentPage()).toBe(62);
    expect(inPage().findByProps({ testID: 'mushaf-page-missing' })).toBeDefined(); // not downloaded
    expect(panelButton('reflect').props.disabled).toBe(true);
    await press(panelButton('previous'));
    await flush();
    await flush();
    expect(shownPageNumber()).toBe('٦١');
    await swipe(120); // left to right: next
    expect(currentPage()).toBe(62);
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
    expect(inPage().findAllByProps({ testID: 'qpc-v1-text' })).toHaveLength(1);
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
    expect(currentPage()).toBe(62);
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 }); // a new page starts at 1×
    expect(enabled(swipeGesture())).toBe(true);
  });

  it('a pinch released near 1× snaps back to the fitted page, and swiping turns pages again', async () => {
    await render();
    await pinch(1.01);
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 });
    expect(enabled(swipeGesture())).toBe(true);
    await swipe(120);
    expect(currentPage()).toBe(62);
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
    expect(inPage().findByProps({ testID: 'mushaf-selection' })).toBeDefined();
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
    // Still exactly five bar buttons; search is fourth (the bookmark is in the centre).
    expect(root.root.findByProps({ testID: 'mushaf-panel' }).findAllByType('Pressable' as never).map((node) => node.props.testID)[3]).toBe('mushaf-panel-search');
  });

  it('Page Number: a numeric field; Western or Arabic-Indic digits go straight there and close the sheet', async () => {
    await render();
    await openSearch();
    expect(byId('mushaf-search-page-input').props).toMatchObject({ keyboardType: 'number-pad', accessibilityLabel: copy().pageNumberPlaceholder });
    // iOS: no extra "Go" bar above the number pad (React Native adds one for any other return key type); the green arrow is the action.
    expect(byId('mushaf-search-page-input').props.returnKeyType).toBe('none');
    for (const prop of ['enterKeyHint', 'inputAccessoryViewID', 'inputAccessoryViewButtonLabel']) expect(byId('mushaf-search-page-input').props[prop]).toBeUndefined();
    await typeInto('mushaf-search-page-input', '٣٠٠');
    await press(byId('mushaf-search-go'));
    await flush();
    expect(currentPage()).toBe(300);
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
    expect(currentPage()).toBe(50);
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
    expect(currentPage()).toBe(293);
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

  describe('its chevron shows the way the list opens and closes', () => {
    type Live = { __live: () => { transform: Record<string, string | number>[] } };
    const live = (node: ReactTestInstance) => ([node.props.style].flat(3).find((style) => style && (style as Live).__live) as Live).__live();
    /** 0 points down, 180 up. */
    const chevron = () => Number(String(live(root.root.findByProps({ testID: 'mushaf-wird-chevron' })).transform[0].rotate).replace('deg', ''));
    const card = () => styleOf(list()[0]);

    it('opens above the pill (the bar is below it): the chevron turns up; closing, the list goes back down and so does the chevron', async () => {
      seed(THREE, 'fajr');
      await render();
      expect(chevron()).toBe(0); // at rest: down, as before
      await openList();
      expect(card().bottom).toBeGreaterThan(0);
      expect(card().top).toBeUndefined();
      expect(chevron()).toBe(180);
      expect(pill().props.accessibilityState).toEqual({ expanded: true });
      state.holdAnimations = true;
      await press(root.root.findByProps({ testID: 'mushaf-wird-backdrop' }));
      // Closing (held): still drawn, moving back down toward the pill, the chevron pointing down.
      expect(list()).toHaveLength(1);
      expect(chevron()).toBe(0);
      expect(live(list()[0]).transform[0].translateY).toBe(8);
      expect(pill().props.accessibilityState).toEqual({ expanded: false });
      await act(async () => { state.pending.splice(0).forEach((done) => done(true)); });
      await flush();
      expect(list()).toHaveLength(0);
      expect(chevron()).toBe(0);
    });

    it('choosing a ورد closes it and the chevron comes back to rest; rapid taps leave it pointing the way the list is', async () => {
      seed(THREE, 'fajr');
      await render();
      await openList();
      await press(root.root.findByProps({ testID: 'mushaf-wird-tadabbur' }));
      await flush();
      expect(list()).toHaveLength(0);
      expect(chevron()).toBe(0);
      expect(pillText()).toBe('ورد التدبر');
      state.holdAnimations = true;
      await openList();
      await press(root.root.findByProps({ testID: 'mushaf-wird-backdrop' }));
      await openList();
      await act(async () => { state.pending.splice(0).forEach((done) => done(true)); }); // the closing's late completion
      await flush();
      expect(list()).toHaveLength(1);
      expect(chevron()).toBe(180);
    });

    it('where there is no room above the pill, the list opens below it and the chevron points down', async () => {
      const { MushafWirdSelector, WIRD_PILL_HEIGHT } = await import('@/components/MushafWirdSelector');
      const props = {
        labels: { choose: 'c', selectorLabel: 's', selectorHint: 'h', add: 'a', addNew: 'n', close: 'x', page: 'Page', manage: 'm' },
        dark: false, rtl: false, formatNumber: String, stops: THREE, active: THREE[0],
        onOpen: () => undefined, onClose: () => undefined, onSelect: () => undefined, onAdd: () => undefined, onManage: () => undefined,
        // The pill's top 60 pt from the top of an 844-pt screen: under the 47-pt status bar there is no room above.
        anchorBottom: 844 - 60,
      };
      await act(async () => { root = create(createElement(MushafWirdSelector, { ...props, open: false })); });
      await act(async () => { root.update(createElement(MushafWirdSelector, { ...props, open: true })); });
      expect(card().top).toBe(60 + WIRD_PILL_HEIGHT + 6);
      expect(card().bottom).toBeUndefined();
      expect(chevron()).toBe(0);
      state.holdAnimations = true;
      await act(async () => { root.update(createElement(MushafWirdSelector, { ...props, open: false })); });
      expect(chevron()).toBe(180); // closing upward, back to the pill
      expect(live(list()[0]).transform[0].translateY).toBe(-8);
    });
  });

  it('sits centred between the page and the bar: below the page, outside the toolbar, without shrinking the phone page', async () => {
    seed(THREE, 'fajr');
    await render({ width: 390, height: 761 });
    const row = root.root.findByProps({ testID: 'mushaf-wird-row' });
    const paper = styleOf(inPage().findByProps({ testID: 'mushaf-paper' }));
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
    state.params = {};
    await render();
    expect(currentPage()).toBe(125);
    expect(pillText()).toBe('ورد التدبر');
    await act(async () => root.unmount());
    state.params = { page: '200' };
    await render();
    expect(currentPage()).toBe(200);
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
    expect(currentPage()).toBe(302);
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

  it('the empty name field asks for a ورد name, as a placeholder only (never prefilled); a typed name shows and saves as typed', async () => {
    const expected = { en: 'Wird name (e.g., Personal or Mosque)', ar: 'اسم الورد (مثل: شخصي أو المسجد)', 'ar-EG': 'اسم الورد (زي: شخصي أو المسجد)' } as const;
    for (const locale of ['en', 'ar', 'ar-EG'] as const) {
      state.locale = locale;
      state.storage.clear();
      if (root) await act(async () => root.unmount());
      await render();
      await press(pill());
      const field = () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never);
      expect(copy().stopNameLabel).toBe(expected[locale]);
      expect(field().props).toMatchObject({ value: '', placeholder: expected[locale], accessibilityLabel: expected[locale] });
      await act(async () => field().props.onChangeText('Personal'));
      expect(field().props.value).toBe('Personal');
      await press(button(copy().confirmStop));
      expect(pillText()).toBe('Personal');
      expect(JSON.parse(state.storage.get(READING_STOPS_STORAGE_KEY)!)).toEqual([expect.objectContaining({ name: 'Personal', page: 61 })]);
    }
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
    expect(currentPage()).toBe(62);
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
      expect(labels).toEqual([copy().nextPage, MESSAGES[locale].reflection.writeAction, copy().saveStopAction, copy().searchPage, copy().previousPage]);
      expect(labels.every((label) => /[؀-ۿ]/.test(label))).toBe(true);
      expect(texts()).toEqual(expect.arrayContaining(['سورة آل عمران', 'الجزء ٣', '٦١']));
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
  const paperColor = () => styleOf(inPage().findByProps({ testID: 'mushaf-paper' })).backgroundColor;

  it('is used once the font is loaded and the layout passes the Tanzil check', async () => {
    await renderQpc();
    expect(String(state.fetch.mock.calls[0][0])).toMatch(/\/api\/mushaf\/qpc-v1\/pages\/61$/);
    expect(inPage().findAllByProps({ testID: 'qpc-v1-text' })).toHaveLength(1);
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
    const area = styleOf(inPage().findByProps({ testID: 'mushaf-text-area' })) as { width: number };
    const size = styleOf(inPage().findByProps({ testID: 'qpc-line-1' }).findAllByType('Text' as never)[0]).fontSize as number;
    expect(size).toBeCloseTo((100 * area.width * 0.985) / MEASURE_WIDTH);
  });

  it('every glyph Text is the font`s whole line, in a container 0.25 em taller above and below in Normal Mode, so no harakah, hamza or descender is clipped on devices', async () => {
    const { QCF_V1_INK_ROOM_V_EM, QCF_V1_LINE_BOX_EM, QCF_V1_NORMAL_BOX_MARGIN_EM, QCF_V1_NORMAL_LINE_BOX_EM } = await import('@/mushaf/ayahMarkers');
    const layout = syntheticQpcPage61();
    await renderQpc(layout);
    // The measuring pass, at its fixed size.
    const measured = inPage().findByProps({ testID: 'qpc-measure-1' }).findAllByType('Text' as never).map(styleOf);
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
    const pitch = styleOf(inPage().findByProps({ testID: 'qpc-line-1' })).height;
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
    state.params = { page: '61', background: 'original', markers: 'qpc-glyph' };
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
    expect(inPage().findAllByProps({ testID: 'qpc-highlight-1' })).toHaveLength(1);
  });

  it('a layout that disagrees with the verified Tanzil text is never drawn: the SVG page shows instead', async () => {
    await renderQpc(syntheticQpcPage61({ dropWord: '3:87' }));
    expect(inPage().findAllByProps({ testID: 'qpc-v1-text' })).toHaveLength(0);
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
    expect(inPage().findAllByProps({ testID: 'qpc-v1-text' })).toHaveLength(1);
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
  it('Warm Midnight Olive: cream ink and heads, the approved border pattern in its midnight inks, the panel in its dark style', async () => {
    state.theme = 'dark';
    state.fetch.mockResolvedValue(layoutResponse(200, { success: true, data: syntheticQpcPage61() }));
    await render();
    expect(styleOf(inPage().findByProps({ testID: 'mushaf-paper' })).backgroundColor).toBe('#222820');
    expect(styleOf(inPage().findByProps({ testID: 'qpc-measure-1' }).findAllByType('Text' as never)[0]).color).toBe('#F1E9D6');
    expect(styleOf(root.root.findAllByType('Text' as never).find((node) => node.props.children === 'سورة آل عمران')!).color).toBe('#F1E9D6');
    const frame = () => inPage().findByProps({ testID: 'mushaf-frame' }).findAllByType('Path' as never);
    expect(new Set(frame().map((node) => node.props.fill))).toEqual(new Set(Object.values(MUSHAF_BORDER_STYLES.midnight.inks)));
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-panel' })).backgroundColor).toBe(MUSHAF_PANEL_COLORS.dark.surface.backgroundColor);
    // Only the inks differ from the light page: the same paths, in the same order and fill rules.
    const shape = () => frame().map((node) => [node.props.d, node.props.fillRule]);
    const dark = shape();
    await act(async () => root.unmount());
    state.theme = 'light';
    await render();
    expect(shape()).toEqual(dark);
    expect(new Set(frame().map((node) => node.props.fill))).toEqual(new Set(Object.values(BORDER_INKS)));
  });

  it('Dark Mode: the lit lightbulb keeps the dark save-button green outline, filled with the same bright yellow; unlit it is a muted grey outline', async () => {
    state.theme = 'dark';
    await render();
    const bulb = () => panelButton('reflect').findByType(ReflectionBulbIcon as never);
    const glassFill = () => panelButton('reflect').findByProps({ testID: 'reflection-bulb-glass' }).props.fill;
    expect(bulb().props).toMatchObject({ lit: false, color: MUSHAF_PANEL_COLORS.dark.bulbOff });
    expect(glassFill()).toBe('none');
    await tapPage(100, 130);
    expect(bulb().props).toMatchObject({ lit: true, color: MUSHAF_PANEL_COLORS.dark.saved });
    expect(glassFill()).toBe('#FFC000');
    expect(panelButton('reflect').findByProps({ testID: 'reflection-bulb-lit' }).props.stroke).toBe(MUSHAF_PANEL_COLORS.dark.saved);
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
  const shown = () => currentPage();
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
        expect(currentPage()).toBe(62);
        expect(state.offline.readPage.mock.calls).toEqual([[63]]); // 62 slid in already drawn: only its new neighbour is read
        await touch(drag(300, 350, -160, -6), stack); // right to left
        expect(shownPageNumber()).toBe('٦١');
        state.offline.readPage.mockClear();
        await touch(drag(300, 350, -160, 6), stack);
        expect(currentPage()).toBe(60);
        expect(state.offline.readPage.mock.calls).toEqual([[59]]); // 60 slid in already drawn: only its new neighbour is read
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
    expect(currentPage()).toBe(62);
    expect(state.offline.readPage.mock.calls).toEqual([[63]]);
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
  it('no link without a du`a text, on page 604 or anywhere', async () => {
    state.params = { page: '604' };
    await render();
    expect(link()).toHaveLength(0);
  });

  it('with the approved text: a link on page 604 only, opening its own screen; the Mushaf still ends at 604', async () => {
    state.khatmDua = (await vi.importActual<typeof import('@/mushaf/khatmDua')>('@/mushaf/khatmDua')).KHATM_DUA;
    expect(state.khatmDua).not.toBeNull();
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

describe('Page 604: إتمام الختمة | ورد name | دعاء ختم القرآن', () => {
  const host = (id: string) => root.root.findAllByProps({ testID: id }).filter((node) => String(node.type) === 'Pressable');
  const styleOf = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style({ pressed: false })].flat(3).filter(Boolean));
  const pillStyle = () => Object.assign({}, ...[root.root.findByProps({ testID: 'mushaf-wird' }).props.style({ pressed: false })].flat(3).filter(Boolean));
  const label = (id: string) => host(id)[0].findByType('Text' as never);
  const reachedSheet = () => root.root.findAllByProps({ testID: 'khatma-reached' }).filter((node) => String(node.type) === 'View');
  const notice = (kind: string) => root.root.findAllByProps({ testID: `mushaf-khatma-${kind}` }).filter((node) => String(node.type) === 'View');
  const sheetButton = (which: 'confirm' | 'cancel') => root.root.findAllByProps({ testID: `khatma-reached-${which}` }).find((node) => String(node.type) === 'Pressable')!;
  const withDua = async () => { state.khatmDua = (await vi.importActual<typeof import('@/mushaf/khatmDua')>('@/mushaf/khatmDua')).KHATM_DUA; };
  const reading = async () => (await import('@/mushaf/khatmas')).loadReadingData();
  const tapComplete = async () => { await press(host('mushaf-complete-khatma')[0]); await flush(); await flush(); };
  /** ورد saved through the real reading data at `page` (an earlier page, so a later save at 604 completes its cycle). */
  async function wirdsAt(entries: [string, number][], active: string) {
    const { saveWirdPage } = await import('@/mushaf/khatmas');
    for (const [name, page] of entries) {
      await saveWirdPage({ name, page: Math.min(page, 300) });
      if (page > 300) await saveWirdPage({ name, page });
    }
    const wirds = (await reading()).wirds;
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, wirds.find((w) => w.stop.name === active)!.stop.id);
    return wirds;
  }

  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: إتمام الختمة on the left, the existing ورد name centred, دعاء ختم القرآن on the right — always Standard Arabic, the same places in every language`, async () => {
      await withDua();
      state.locale = locale;
      await wirdsAt([['ورد الفجر', 300]], 'ورد الفجر');
      state.params = { page: '604' };
      await render();
      const complete = styleOf(host('mushaf-complete-khatma')[0]);
      const dua = styleOf(host('mushaf-khatm-dua')[0]);
      expect(complete).toMatchObject({ position: 'absolute', left: 14, maxWidth: '29%' });
      expect(complete.right).toBeUndefined();
      expect(dua).toMatchObject({ position: 'absolute', right: 14, maxWidth: '29%' });
      expect(dua.left).toBeUndefined();
      // The ورد name stays the centred pill, unchanged apart from its narrower width on this page.
      const row = root.root.findByProps({ testID: 'mushaf-wird-row' });
      expect(Object.assign({}, ...[row.props.style].flat(3).filter(Boolean))).toMatchObject({ alignItems: 'center', justifyContent: 'center' });
      expect(root.root.findByProps({ testID: 'mushaf-wird' }).props.accessibilityLabel).toContain('ورد الفجر');
      expect(pillStyle().maxWidth).toBe('30%');
      // The same link design: identical styles except which edge each hugs.
      const { left: _l, ...completeRest } = complete;
      const { right: _r, ...duaRest } = dua;
      expect(completeRest).toEqual(duaRest);
      const textStyle = (id: string) => Object.assign({}, ...[label(id).props.style].flat(3).filter(Boolean));
      expect({ ...textStyle('mushaf-complete-khatma'), textAlign: undefined }).toEqual({ ...textStyle('mushaf-khatm-dua'), textAlign: undefined });
      expect(textStyle('mushaf-complete-khatma')).toMatchObject({ writingDirection: 'rtl', textAlign: 'left' });
      expect(textStyle('mushaf-khatm-dua')).toMatchObject({ writingDirection: 'rtl', textAlign: 'right' });
      expect(label('mushaf-complete-khatma').props.children).toBe('إتمام الختمة');
      expect(label('mushaf-khatm-dua').props.children).toBe('دعاء ختم القرآن');
      for (const id of ['mushaf-khatm-dua', 'mushaf-complete-khatma']) expect(label(id).props).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.7 });
    });
  }

  it('never overlaps on narrow phones: each link and the centred name keep apart at 320, 375 and 430 pt', () => {
    for (const width of [320, 375, 430]) {
      const linkEnd = 14 + 0.29 * width; // the left link's far edge (the right link mirrors it)
      const nameStart = width / 2 - (0.3 * width) / 2;
      expect(nameStart - linkEnd, `${width} pt`).toBeGreaterThan(4);
    }
  });

  it('pages 1–603 are unchanged: no إتمام الختمة, no du`a link, and the ورد name keeps its usual width', async () => {
    await withDua();
    for (const page of ['1', '300', '603']) {
      state.params = { page };
      await render();
      expect(host('mushaf-complete-khatma')).toHaveLength(0);
      expect(host('mushaf-khatm-dua')).toHaveLength(0);
      expect(pillStyle().maxWidth).toBe('72%');
      await act(async () => root.unmount());
    }
  });

  it('not yet saved at 604: the bookmark`s own save of page 604, then the confirmation opens; nothing counted until confirmed', async () => {
    state.locale = 'ar';
    await wirdsAt([['ورد الفجر', 300], ['ورد العشاء', 120]], 'ورد الفجر');
    state.params = { page: '604' };
    await render();
    expect(reachedSheet()).toHaveLength(0); // showing page 604 offers nothing by itself
    await tapComplete();
    const data = await reading();
    const fajr = data.wirds.find((w) => w.stop.name === 'ورد الفجر')!;
    // The same transition as a manual save at 604: the page saved, the completion pending, nothing recorded.
    expect(fajr).toMatchObject({ status: 'pending' });
    expect(fajr.stop.page).toBe(604);
    expect(data.stats.total).toBe(0);
    expect(data.wirds.find((w) => w.stop.name === 'ورد العشاء')!.stop.page).toBe(120); // only the selected ورد
    expect(reachedSheet()).toHaveLength(1);
    expect(texts()).toContain('ورد الفجر');
    vi.mocked(router.push).mockClear();
    await act(async () => { sheetButton('confirm').props.onPress(); sheetButton('confirm').props.onPress(); });
    await flush();
    await flush();
    const after = await reading();
    expect(after.records.map((r) => r.stopName)).toEqual(['ورد الفجر']); // once, even tapped twice
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/khatma-complete', params: { id: after.records[0].id } });
  });

  it('already awaiting confirmation: the confirmation opens directly, without saving again', async () => {
    await wirdsAt([['Fajr', 604], ['Isha', 604]], 'Fajr');
    const before = await reading();
    const stopsBefore = state.storage.get(READING_STOPS_STORAGE_KEY);
    state.params = { page: '604' };
    await render();
    await tapComplete();
    expect(reachedSheet()).toHaveLength(1);
    expect(texts()).toContain('Fajr');
    expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(stopsBefore); // no second save
    expect(await reading()).toEqual(before);
    await press(sheetButton('confirm'));
    await flush();
    const after = await reading();
    expect(after.records.map((r) => r.stopName)).toEqual(['Fajr']);
    expect(after.wirds.find((w) => w.stop.name === 'Isha')!.status).toBe('pending'); // the other ورد untouched
  });

  it('cancelling keeps the saved page and the pending completion, and counts nothing', async () => {
    state.locale = 'ar';
    await wirdsAt([['ورد الفجر', 300]], 'ورد الفجر');
    state.params = { page: '604' };
    await render();
    await tapComplete();
    await press(sheetButton('cancel'));
    const data = await reading();
    expect(data.stats.total).toBe(0);
    expect(data.wirds[0]).toMatchObject({ status: 'pending' });
    expect(data.wirds[0].stop.page).toBe(604);
  });

  it('a failed save: an error, no confirmation, nothing recorded', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await wirdsAt([['Fajr', 300]], 'Fajr');
    state.params = { page: '604' };
    await render();
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    await tapComplete();
    expect(reachedSheet()).toHaveLength(0);
    expect(notice('saveFailed')).toHaveLength(1);
    expect(texts()).toContain('The page could not be saved');
    expect((await reading()).stats.total).toBe(0);
  });

  it('no ورد selected: asks for one; nothing saved or recorded', async () => {
    state.locale = 'ar';
    const before = new Map(state.storage);
    state.params = { page: '604' };
    await render();
    await tapComplete();
    expect(reachedSheet()).toHaveLength(0);
    expect(notice('noWird')).toHaveLength(1);
    expect(texts()).toEqual(expect.arrayContaining(['اختر وردًا أولًا', 'اختر الورد الذي أتممته من اسم الورد أسفل الصفحة، ثم حاول مرة أخرى.']));
    expect(root.root.findAllByProps({ testID: 'mushaf-khatma-noWird-confirm' })).toHaveLength(0);
    await press(root.root.findAllByProps({ testID: 'mushaf-khatma-noWird-cancel' }).find((node) => String(node.type) === 'Pressable')!);
    expect(notice('noWird')).toHaveLength(0);
    for (const [key, value] of before) expect(state.storage.get(key), key).toBe(value);
    expect([...state.storage.keys()].filter((key) => !before.has(key))).toEqual([]);
  });

  it('a genuine restriction is kept: a ورد saved at 604 before Khatmas were tracked is not completed here (its own wording is in أورادي وختماتي)', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'old', name: 'Mum', page: 604, updatedAt: '2026-09-01T08:00:00.000Z' }]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'old');
    const stopsBefore = state.storage.get(READING_STOPS_STORAGE_KEY);
    state.params = { page: '604' };
    await render();
    await tapComplete();
    expect(reachedSheet()).toHaveLength(0);
    expect(notice('notReady')).toHaveLength(1);
    expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(stopsBefore);
    expect((await reading()).stats.total).toBe(0);
  });

  it('repeated taps while it saves start one operation; a completed Khatma is never counted again, and the restarted cycle is not offered', async () => {
    await wirdsAt([['Fajr', 300]], 'Fajr');
    state.params = { page: '604' };
    await render();
    await act(async () => {
      host('mushaf-complete-khatma')[0].props.onPress();
      host('mushaf-complete-khatma')[0].props.onPress();
      host('mushaf-complete-khatma')[0].props.onPress();
    });
    await flush();
    await flush();
    expect(reachedSheet()).toHaveLength(1);
    await press(sheetButton('confirm'));
    await flush();
    expect((await reading()).stats.total).toBe(1);
    // The ورد restarted at page 1 by that confirmation: tapping again right away is blocked — no save, no sheet.
    const recordsBefore = (await reading()).records;
    const stopsBefore = state.storage.get(READING_STOPS_STORAGE_KEY);
    await tapComplete();
    expect(reachedSheet()).toHaveLength(0);
    expect(notice('newCycle')).toHaveLength(1);
    expect((await reading()).records).toEqual(recordsBefore);
    expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(stopsBefore);
  });

  it('the du`a link still opens its own screen; the du`a screen offers no confirmation', async () => {
    await withDua();
    state.params = { page: '604' };
    await render();
    await press(host('mushaf-khatm-dua')[0]);
    expect(router.push).toHaveBeenLastCalledWith('/khatm-dua');
    const duaScreen = readFileSync(resolve(__dirname, '../src/app/khatm-dua.tsx'), 'utf8');
    expect(duaScreen).not.toMatch(/confirmKhatma|@\/mushaf\/khatmas/);
  });
});

describe('Page 604: a cycle just restarted by a confirmed Khatma is never completed again by accident', () => {
  const host = (id: string) => root.root.findAllByProps({ testID: id }).filter((node) => String(node.type) === 'Pressable');
  const reachedSheet = () => root.root.findAllByProps({ testID: 'khatma-reached' }).filter((node) => String(node.type) === 'View');
  const notice = (kind: string) => root.root.findAllByProps({ testID: `mushaf-khatma-${kind}` }).filter((node) => String(node.type) === 'View');
  const sheetButton = (which: 'confirm' | 'cancel') => root.root.findAllByProps({ testID: `khatma-reached-${which}` }).find((node) => String(node.type) === 'Pressable')!;
  const khatmas = () => import('@/mushaf/khatmas');
  const reading = async () => (await khatmas()).loadReadingData();
  const tapComplete = async () => { await press(host('mushaf-complete-khatma')[0]); await flush(); await flush(); };
  const KHATMAS_KEY = 'quran-heals:mushaf-khatmas:v1';
  /** Everything the reading data persists (stops, cycles, Khatmas, the selected ورد). */
  const persisted = () => [READING_STOPS_STORAGE_KEY, KHATMAS_KEY, ACTIVE_READING_STOP_STORAGE_KEY].map((key) => state.storage.get(key));

  /** Fajr read from page 300, completed on page 604 through إتمام الختمة and confirmed: one Khatma, a new cycle at page 1. */
  async function completeFirstKhatma(others: [string, number][] = []) {
    const { saveWirdPage } = await khatmas();
    for (const [name, page] of others) { await saveWirdPage({ name, page: Math.min(page, 300) }); if (page > 300) await saveWirdPage({ name, page }); }
    await saveWirdPage({ name: 'Fajr', page: 300 });
    state.params = { page: '604' };
    await render();
    await tapComplete();
    expect(reachedSheet()).toHaveLength(1);
    await press(sheetButton('confirm'));
    await flush();
    const data = await reading();
    expect(data.records.map((r) => r.stopName)).toEqual(['Fajr']);
    return data;
  }
  /** Blocked: the explanation only — no confirmation sheet, nothing saved or counted. */
  async function expectBlocked() {
    const before = persisted();
    await tapComplete();
    expect(reachedSheet()).toHaveLength(0);
    expect(notice('newCycle')).toHaveLength(1);
    expect(persisted()).toEqual(before);
    await press(root.root.findAllByProps({ testID: 'mushaf-khatma-newCycle-cancel' }).find((node) => String(node.type) === 'Pressable')!);
  }

  it('the first, legitimate Khatma is recorded once, with its date and Ramadan classification; the new cycle is persisted as not yet progressed', async () => {
    const data = await completeFirstKhatma();
    const fajr = data.wirds.find((w) => w.stop.name === 'Fajr')!;
    expect(fajr.stop.page).toBe(1);
    expect(fajr.status).toBe('reading');
    expect(data.records[0]).toMatchObject({ localDate: expect.any(String), ramadan: expect.any(Boolean) });
    // Persisted on the device (and synced as part of the ورد): the cycle began with that Khatma, nothing saved since.
    const doc = JSON.parse(state.storage.get(KHATMAS_KEY)!) as { cycles: Record<string, { startedByKhatmaId: string | null; savedSinceStart: boolean }> };
    expect(doc.cycles[fajr.stop.id]).toMatchObject({ startedByKhatmaId: data.records[0].id, savedSinceStart: false });
  });

  it('an immediate second tap, and Arabic, are blocked: no save, no sheet, the count unchanged', async () => {
    state.locale = 'ar';
    await completeFirstKhatma();
    const history = (await reading()).records;
    await tapComplete();
    expect(texts()).toEqual(expect.arrayContaining(['سُجِّلت هذه الختمة بالفعل']));
    await press(root.root.findAllByProps({ testID: 'mushaf-khatma-newCycle-cancel' }).find((node) => String(node.type) === 'Pressable')!);
    await expectBlocked();
    expect((await reading()).records).toEqual(history);
  });

  it('reopening page 604, or a full restart (a fresh screen over the stored data), stays blocked: the state is persisted, not a screen flag', async () => {
    await completeFirstKhatma();
    await act(async () => root.unmount());
    state.params = { page: '604' };
    await render();
    await expectBlocked();
    await act(async () => root.unmount());
    // "Restart": a fresh screen; the reading data is read back from storage (it keeps no state in memory).
    state.params = { page: '604' };
    await render();
    await expectBlocked();
    expect((await reading()).stats.total).toBe(1);
  });

  it('switching to another ورد and back: the other one completes normally, Fajr`s restarted cycle stays blocked', async () => {
    await completeFirstKhatma([['Isha', 604]]);
    const isha = (await reading()).wirds.find((w) => w.stop.name === 'Isha')!;
    const fajr = (await reading()).wirds.find((w) => w.stop.name === 'Fajr')!;
    await act(async () => root.unmount());
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, isha.stop.id);
    await render();
    await tapComplete();
    expect(reachedSheet()).toHaveLength(1);
    await press(sheetButton('confirm'));
    await flush();
    expect((await reading()).records.map((r) => r.stopName).sort()).toEqual(['Fajr', 'Isha']);
    await act(async () => root.unmount());
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, fajr.stop.id);
    await render();
    await expectBlocked();
  });

  it('the restarted cycle syncs as data, so another device receives the same block; a stale device`s older cycle can never win over it', async () => {
    const data = await completeFirstKhatma();
    const fajr = data.wirds.find((w) => w.stop.name === 'Fajr')!;
    const { wirdContent, wirdFromContent, mergeWird } = await import('@/sync/readingSyncModel');
    const synced = wirdContent(fajr.stop, fajr.cycle);
    // What another device stores on download: the same "started by that Khatma, nothing saved since".
    expect(wirdFromContent(synced).cycle).toMatchObject({ startedByKhatmaId: data.records[0].id, savedSinceStart: false, seq: 1 });
    // A device still holding the completed cycle (generation 0, pending at 604) merges to the newer generation.
    const stale = { ...synced, page: 604, cycle: { ...synced.cycle, id: 'old-cycle', seq: 0, startedByKhatmaId: null, savedSinceStart: true, lastSavedPage: 604, reachedEndAt: '2026-10-01T00:00:00.000Z', undoneCycleId: null } };
    expect(mergeWird(stale, synced, null).cycle).toMatchObject({ id: fajr.cycle.id, savedSinceStart: false });
    expect(mergeWird(synced, stale, null).cycle).toMatchObject({ id: fajr.cycle.id, savedSinceStart: false });
  });

  it('genuine progress in the new cycle (any explicit save of its reading position) lifts the block: the next Khatma is completed and counted separately', async () => {
    await completeFirstKhatma();
    const { saveWirdPage } = await khatmas();
    await saveWirdPage({ name: 'Fajr', page: 40 });
    await tapComplete();
    expect(notice('newCycle')).toHaveLength(0);
    expect(reachedSheet()).toHaveLength(1);
    await act(async () => { sheetButton('confirm').props.onPress(); sheetButton('confirm').props.onPress(); });
    await flush();
    await flush();
    const data = await reading();
    expect(data.stats.total).toBe(2);
    expect(new Set(data.records.map((r) => r.cycleId)).size).toBe(2); // two different cycles, each once
  });

  /** The bookmark's own save, as the reader does it: the save button, the name, confirm. */
  async function bookmarkSave(name: string) {
    await press(panelButton('save'));
    await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText(name));
    await press(button(copy().confirmStop));
    await flush();
    await flush();
  }
  const toast = () => root.root.findAllByProps({ testID: 'mushaf-saved-toast' }).filter((node) => String(node.type) === 'View');
  const savePopup = () => root.root.findAllByProps({ testID: 'mushaf-popup-save' }).filter((node) => String(node.type) === 'View');

  it('the bookmark, right after a confirmation: page 604 is not saved for the restarted cycle — the new-cycle notice, no "Saved", no sheet, nothing changed', async () => {
    await completeFirstKhatma();
    const before = persisted();
    await bookmarkSave('Fajr');
    expect(reachedSheet()).toHaveLength(0);
    expect(notice('newCycle')).toHaveLength(1);
    expect(savePopup()).toHaveLength(0); // the name field closed
    expect(toast()).toHaveLength(0);
    expect(persisted()).toEqual(before);
    expect((await reading()).stats.total).toBe(1);
    // And then إتمام الختمة is still blocked too: the bookmark did not count as progress.
    await press(root.root.findAllByProps({ testID: 'mushaf-khatma-newCycle-cancel' }).find((node) => String(node.type) === 'Pressable')!);
    await expectBlocked();
  });

  it('the bookmark stays blocked after reopening page 604 and after a restart (persisted cycle state)', async () => {
    await completeFirstKhatma();
    for (let i = 0; i < 2; i++) {
      await act(async () => root.unmount());
      state.params = { page: '604' };
      await render();
      const before = persisted();
      await bookmarkSave('Fajr');
      expect(notice('newCycle')).toHaveLength(1);
      expect(reachedSheet()).toHaveLength(0);
      expect(persisted()).toEqual(before);
    }
  });

  it('on page 604 the bookmark still saves other ورد normally, and a new name as before (never offered a Khatma)', async () => {
    await completeFirstKhatma([['Isha', 300]]);
    await bookmarkSave('Isha');
    expect(notice('newCycle')).toHaveLength(0);
    expect(reachedSheet()).toHaveLength(1); // Isha legitimately reached 604: the usual Save → Confirm
    await press(sheetButton('cancel'));
    await bookmarkSave('Brand new');
    expect(notice('newCycle')).toHaveLength(0);
    expect(reachedSheet()).toHaveLength(0);
    expect((await reading()).wirds.find((w) => w.stop.name === 'Brand new')!.stop.page).toBe(604);
  });

  it('pages 1–603 save as always — for the restarted ورد too — and that saved progress restores page 604`s Save → Confirm', async () => {
    await completeFirstKhatma();
    await act(async () => root.unmount());
    state.params = { page: '40' };
    await render();
    await bookmarkSave('Fajr');
    expect(notice('newCycle')).toHaveLength(0);
    expect(toast()).toHaveLength(1);
    expect((await reading()).wirds.find((w) => w.stop.name === 'Fajr')!.stop.page).toBe(40);
    await act(async () => root.unmount());
    state.params = { page: '604' };
    await render();
    await bookmarkSave('Fajr');
    expect(notice('newCycle')).toHaveLength(0);
    expect(reachedSheet()).toHaveLength(1);
    await act(async () => { sheetButton('confirm').props.onPress(); sheetButton('confirm').props.onPress(); });
    await flush();
    await flush();
    const data = await reading();
    expect(data.stats.total).toBe(2);
    expect(new Set(data.records.map((r) => r.cycleId)).size).toBe(2);
  });

  it('repeated bookmark saves on page 604 after a confirmation never count anything', async () => {
    await completeFirstKhatma();
    for (let i = 0; i < 3; i++) {
      await bookmarkSave('Fajr');
      expect(reachedSheet()).toHaveLength(0);
      await press(root.root.findAllByProps({ testID: 'mushaf-khatma-newCycle-cancel' }).find((node) => String(node.type) === 'Pressable')!);
    }
    expect((await reading()).stats.total).toBe(1);
  });

  it('cancelling a confirmation counts nothing; the earlier Khatma history stays exactly as it was', async () => {
    const first = await completeFirstKhatma();
    const { saveWirdPage } = await khatmas();
    await saveWirdPage({ name: 'Fajr', page: 40 });
    await tapComplete();
    await press(sheetButton('cancel'));
    const data = await reading();
    expect(data.records).toEqual(first.records);
    expect(data.wirds.find((w) => w.stop.name === 'Fajr')!.status).toBe('pending');
  });
});

describe('Khatma: reaching page 604 through the saved ورد (mushaf/khatmas.ts)', () => {
  const { KHATMAS_STORAGE_KEY } = { KHATMAS_STORAGE_KEY: 'quran-heals:mushaf-khatmas:v1' };
  const records = () => (JSON.parse(state.storage.get(KHATMAS_STORAGE_KEY) ?? '{"records":[]}') as { records: { id: string; stopId: string }[] }).records;
  const stops = () => JSON.parse(state.storage.get(READING_STOPS_STORAGE_KEY) ?? '[]') as { id: string; name: string; page: number }[];
  const sheet = () => root.root.findAllByProps({ testID: 'khatma-reached' }).filter((node) => String(node.type) === 'View');
  const sheetButton = (which: 'confirm' | 'cancel') => root.root.findAllByProps({ testID: `khatma-reached-${which}` }).find((node) => String(node.type) === 'Pressable')!;
  const fajrAt = (page: number) => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'fajr', name: 'ورد الفجر', page, updatedAt: '2026-10-01T00:00:00.000Z' }]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
  };
  async function saveAs(name: string) {
    await press(panelButton('save'));
    await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText(name));
    await press(button(copy().confirmStop));
    await flush();
  }

  it('showing, turning to or searching page 604 offers nothing and counts nothing', async () => {
    fajrAt(300);
    state.params = { page: '603' };
    await render();
    await press(panelButton('next'));
    await flush();
    expect(panelButton('next').props.disabled).toBe(true); // page 604, the last
    expect(sheet()).toHaveLength(0);
    expect(records()).toHaveLength(0);
    expect(stops()[0].page).toBe(300);
  });

  it('saving the active ورد from an earlier page at 604 asks «ما شاء الله، أتممت ختم القرآن»; ليس الآن records nothing and keeps it pending', async () => {
    state.locale = 'ar';
    fajrAt(300);
    state.params = { page: '604' };
    await render();
    await saveAs('ورد الفجر');
    expect(sheet()).toHaveLength(1);
    expect(texts()).toContain('ما شاء الله، أتممت ختم القرآن');
    expect(sheetButton('confirm').findByType('Text' as never).props.children).toBe('إتمام الختمة');
    expect(sheetButton('cancel').findByType('Text' as never).props.children).toBe('ليس الآن');
    await press(sheetButton('cancel'));
    expect(sheet()).toHaveLength(0);
    expect(records()).toHaveLength(0);
    expect(stops()[0].page).toBe(604);
    const { loadReadingData } = await import('@/mushaf/khatmas');
    expect((await loadReadingData()).wirds[0].status).toBe('pending');
  });

  it('إتمام الختمة records it once (a double tap too), starts the next cycle at page 1, and opens the completion screen', async () => {
    fajrAt(300);
    state.params = { page: '604' };
    await render();
    await saveAs('ورد الفجر');
    vi.mocked(router.push).mockClear();
    await act(async () => {
      sheetButton('confirm').props.onPress();
      sheetButton('confirm').props.onPress();
    });
    await flush();
    await flush();
    expect(records()).toHaveLength(1);
    expect(records()[0].stopId).toBe('fajr');
    expect(stops()[0].page).toBe(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/khatma-complete', params: { id: records()[0].id } });
    expect(sheet()).toHaveLength(0);
  });

  it('a new ورد saved directly on page 604 is not offered a Khatma', async () => {
    state.params = { page: '604' };
    await render();
    await saveAs('New');
    expect(sheet()).toHaveLength(0);
    expect(records()).toHaveLength(0);
  });

  it('the ورد list links to أورادي وختماتي', async () => {
    fajrAt(300);
    await render();
    await press(root.root.findByProps({ testID: 'mushaf-wird' }));
    await press(root.root.findAllByProps({ testID: 'mushaf-wird-manage' }).find((node) => String(node.type) === 'Pressable'));
    // A tab now: navigate (switch to it), never a second copy pushed on a stack.
    expect(router.navigate).toHaveBeenLastCalledWith('/my-reading');
  });
});

describe('the Mushaf tab', () => {
  /** The page number drawn under the page, in either digits. */
  const pageNow = () => Number((shownPageNumber() ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)));
  const tabsLayout = readFileSync(resolve(__dirname, '../src/app/(tabs)/_layout.tsx'), 'utf8');

  it('has no tab bar, in Normal Mode or full screen: the tab declares it hidden; Back returns to the tab before (Home first)', async () => {
    const { MUSHAF_TAB_OPTIONS } = await import('@/mushaf/screenOptions');
    expect(MUSHAF_TAB_OPTIONS).toEqual({ tabBarStyle: { display: 'none' } });
    expect(tabsLayout).toMatch(/<Tabs\.Screen name="mushaf" options=\{MUSHAF_TAB_OPTIONS\} \/>/);
    expect(tabsLayout).toMatch(/backBehavior="history"/);
    // The other tabs keep the bar (no options of their own).
    for (const name of ['index', 'my-reading', 'reflections']) expect(tabsLayout).toMatch(new RegExp(`<Tabs\\.Screen name="${name}" \\/>`));
  });

  it('keeps the approved page size: the same fit as before the tabs, the bar on the bottom safe area, in both modes', async () => {
    // iPhone 15 (393 × 852, insets 59 / 34) below its 36-pt Back row: the approved 387-pt page (not 354 above a tab bar).
    expect(fitMushafPage({ width: 393, height: 852 - 59 - 36 }, 34).page.width).toBe(387);
    // iPhone SE: 317 (not 280).
    expect(fitMushafPage({ width: 375, height: 667 - 20 - 36 }, 0).page.width).toBe(317);
    await render();
    expect(flat(root.root.findByProps({ testID: 'mushaf-panel' }).parent!.props.style).bottom).toBe(state.insets.bottom + 8);
    // Normal Mode keeps its Back arrow (back, or Home when opened directly).
    expect(root.root.findAllByProps({ testID: 'mushaf-back' }).length).toBeGreaterThan(0);
  });

  it('a later /mushaf?page=N&at=… (Continue Reading) moves an open reader to page N; the same request twice moves once', async () => {
    state.params = { page: '61' };
    await render();
    state.params = { page: '300', at: '1' };
    await act(async () => root.update(createElement(MushafScreen)));
    await flush();
    expect(pageNow()).toBe(300);
    await press(panelButton('next'));
    await act(async () => root.update(createElement(MushafScreen)));
    await flush();
    expect(pageNow()).toBe(301);
  });
});

describe('opening without a page (the Mushaf tab, a first launch)', () => {
  it('no saved position: page 1, not page 61', async () => {
    state.params = {};
    await render();
    expect(currentPage()).toBe(1);
    expect(state.offline.readPage).not.toHaveBeenCalledWith(61);
  });

  it('the active ورد page wins; else the most recently saved ورد page; a page in the link wins over both', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([
      { id: 'a', name: 'A', page: 210, updatedAt: '2026-10-02T00:00:00.000Z' },
      { id: 'b', name: 'B', page: 77, updatedAt: '2026-10-01T00:00:00.000Z' },
    ]));
    state.params = {};
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'b');
    await render();
    expect(currentPage()).toBe(77);
    await act(async () => root.unmount());
    state.storage.delete(ACTIVE_READING_STOP_STORAGE_KEY);
    await render();
    expect(currentPage()).toBe(210);
    await act(async () => root.unmount());
    state.params = { page: '5' };
    await render();
    expect(currentPage()).toBe(5);
    // Opening never saved or moved anything.
    expect(JSON.parse(state.storage.get(READING_STOPS_STORAGE_KEY)!).map((stop: { page: number }) => stop.page)).toEqual([210, 77]);
  });
});

describe('the bookmark shows whether this page is the selected ورد`s saved page', () => {
  const stop = (id: string, name: string, page: number, day: number) => ({ id, name, page, updatedAt: `2026-10-0${day}T00:00:00.000Z` });
  const seed = (stops: ReturnType<typeof stop>[], active?: string) => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify(stops));
    if (active) state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, active);
  };
  const icon = () => panelButton('save').children[0] as ReactTestInstance;
  const isSaved = () => icon().props.testID === 'mushaf-bookmark-saved';
  const toast = () => root.root.findAllByProps({ testID: 'mushaf-saved-toast' }).filter((node) => String(node.type) === 'View');
  const goToPage = async (page: number) => {
    await press(panelButton('search'));
    await act(async () => root.root.findByProps({ testID: 'mushaf-search-page-input' }).props.onChangeText(String(page)));
    await press(root.root.findByProps({ testID: 'mushaf-search-go' }));
    await flush();
  };
  const saveHere = async (name?: string) => {
    await press(panelButton('save'));
    if (name !== undefined) await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText(name));
    await press(button(copy().confirmStop));
    await flush();
  };
  const savedStops = () => JSON.parse(state.storage.get(READING_STOPS_STORAGE_KEY) ?? '[]') as { id: string; name: string; page: number }[];

  it('no ورد or no saved page here: the plain outline in the bar`s own colour', async () => {
    await render();
    expect(isSaved()).toBe(false);
    expect(icon().props).toMatchObject({ color: '#596F49', fill: 'none' });
    expect(panelButton('save').props.accessibilityLabel).toBe(copy().saveStopAction);
    // A ورد saved on another page, or another ورد saved on this one, is not this page's saved state.
    await act(async () => root.unmount());
    seed([stop('fajr', 'ورد الفجر', 100, 2), stop('isha', 'ورد العشاء', 61, 1)], 'fajr');
    await render();
    expect(isSaved()).toBe(false);
  });

  it('save 100 → green; 150 → outline; save 150 → green; back to 100 → outline; 150 → green — one position per ورد', async () => {
    seed([stop('fajr', 'ورد الفجر', 20, 1)], 'fajr');
    state.params = { page: '100' };
    await render();
    expect(isSaved()).toBe(false);
    await saveHere();
    expect(isSaved()).toBe(true);
    // Saved: the whole bookmark bright yellow, outline and fill.
    expect(icon().props).toMatchObject({ color: '#FFC000', fill: '#FFC000' });
    expect(panelButton('save').props.accessibilityLabel).toBe(`${copy().saveStopAction}, ${copy().stopSaved}`);
    await goToPage(150);
    expect(isSaved()).toBe(false);
    await saveHere();
    expect(isSaved()).toBe(true);
    await goToPage(100);
    expect(isSaved()).toBe(false);
    await goToPage(150);
    expect(isSaved()).toBe(true);
    expect(savedStops()).toEqual([expect.objectContaining({ id: 'fajr', page: 150 })]);
  });

  it('switching ورد shows that ورد`s own saved page, never another`s', async () => {
    seed([stop('fajr', 'ورد الفجر', 61, 2), stop('isha', 'ورد العشاء', 300, 1)], 'fajr');
    await render();
    expect(isSaved()).toBe(true);
    await press(root.root.findByProps({ testID: 'mushaf-wird' }));
    await press(root.root.findAllByProps({ testID: 'mushaf-wird-isha' }).find((node) => String(node.type) === 'Pressable')!);
    await flush();
    // ورد العشاء's page (300) opened: its bookmark is saved there…
    expect(currentPage()).toBe(300);
    expect(isSaved()).toBe(true);
    // …and on page 61 (ورد الفجر's), it is not ورد العشاء's.
    await goToPage(61);
    expect(isSaved()).toBe(false);
    // Neither ورد moved.
    expect(savedStops().map((s) => [s.id, s.page]).sort()).toEqual([['fajr', 61], ['isha', 300]]);
  });

  it('"Saved" appears briefly only after the page is saved on the device — once for repeated saves, never on failure', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    seed([stop('fajr', 'ورد الفجر', 20, 1)], 'fajr');
    await render();
    expect(toast()).toHaveLength(0);
    // A failed save: the reason in the field, no "Saved", the bookmark unchanged.
    await press(panelButton('save'));
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    await press(button(copy().confirmStop));
    expect(texts()).toContain(copy().stopSaveFailed);
    expect(toast()).toHaveLength(0);
    expect(isSaved()).toBe(false);
    // The retry saves: the field closes and "Saved" shows, without blocking the bar.
    await press(button(copy().confirmStop));
    await flush();
    expect(toast()).toHaveLength(1);
    expect(toast()[0].props.pointerEvents).toBe('none');
    expect(texts().filter((text) => text === 'Saved')).toEqual(['Saved']);
    expect(isSaved()).toBe(true);
    // Saving the same page again: the same one stop, still one message.
    await saveHere();
    expect(savedStops()).toEqual([expect.objectContaining({ id: 'fajr', page: 61 })]);
    expect(toast()).toHaveLength(1);
    // An invalid name: no "Saved".
    await act(async () => root.unmount());
    await render();
    await saveHere('   ');
    expect(toast()).toHaveLength(0);
    expect(texts()).toContain(copy().stopNameInvalid);
  });

  it('the message is gone shortly after, and nothing else changes', async () => {
    const { SAVED_TOAST_MS } = await import('@/components/MushafControlPanel');
    seed([stop('fajr', 'ورد الفجر', 20, 1)], 'fajr');
    await render();
    await saveHere();
    expect(toast()).toHaveLength(1);
    await act(async () => { await new Promise((done) => setTimeout(done, SAVED_TOAST_MS + 50)); });
    expect(toast()).toHaveLength(0);
    expect(isSaved()).toBe(true);
  });

  for (const locale of ['ar', 'ar-EG'] as const) {
    it(`${locale}: "تم الحفظ"`, async () => {
      state.locale = locale;
      seed([stop('fajr', 'ورد الفجر', 20, 1)], 'fajr');
      await render();
      await saveHere();
      expect(MESSAGES[locale].mushaf.stopSaved).toBe('تم الحفظ');
      expect(texts()).toContain('تم الحفظ');
      // The bar's order is the same in every language.
      expect(root.root.findByProps({ testID: 'mushaf-panel' }).findAllByType('Pressable' as never).map((node) => node.props.testID))
        .toEqual(['mushaf-panel-next', 'mushaf-panel-reflect', 'mushaf-panel-save', 'mushaf-panel-search', 'mushaf-panel-previous']);
    });
  }

  it('English: exactly "Saved"', () => {
    expect(MESSAGES.en.mushaf.stopSaved).toBe('Saved');
  });

  it('dark: the outline in the dark bar`s colour, the saved page filled with the dark palette`s green', async () => {
    state.theme = 'dark';
    seed([stop('fajr', 'ورد الفجر', 100, 1)], 'fajr');
    await render();
    expect(icon().props).toMatchObject({ color: '#B5C9A9', fill: 'none' });
    await act(async () => root.unmount());
    seed([stop('fajr', 'ورد الفجر', 61, 1)], 'fajr');
    await render();
    expect(icon().props).toMatchObject({ color: '#FFC000', fill: '#FFC000' });
  });

  it('the guest`s and an account`s أوراد are separate: switching owner shows that owner`s saved page', async () => {
    const { setLocalDataOwnerState } = await import('@/storage/localDataOwner');
    seed([stop('fajr', 'ورد الفجر', 61, 1)], 'fajr');
    state.storage.set(`${READING_STOPS_STORAGE_KEY}:account:user-a`, JSON.stringify([stop('acct', 'Account ورد', 300, 1)]));
    state.storage.set(`${ACTIVE_READING_STOP_STORAGE_KEY}:account:user-a`, 'acct');
    await render();
    expect(isSaved()).toBe(true); // the guest's ورد on 61
    await act(async () => setLocalDataOwnerState({ activeUserId: 'user-a', keptSeparate: [], resolved: true }));
    await flush();
    expect(isSaved()).toBe(false); // the account's ورد is on 300, not 61
    await act(async () => setLocalDataOwnerState({ activeUserId: null, keptSeparate: [], resolved: true }));
    await flush();
    expect(isSaved()).toBe(true);
  });

  it('page 604: saving still asks to confirm the Khatma (never automatic); once confirmed, the ورد starts again on page 1, so 604 is no longer its saved page', async () => {
    seed([stop('fajr', 'ورد الفجر', 600, 1)], 'fajr');
    state.params = { page: '604' };
    await render();
    expect(isSaved()).toBe(false);
    await saveHere();
    expect(isSaved()).toBe(true);
    const sheet = root.root.findAllByProps({ testID: 'khatma-reached' }).filter((node) => String(node.type) === 'View');
    expect(sheet).toHaveLength(1);
    expect(JSON.parse(state.storage.get('quran-heals:mushaf-khatmas:v1') ?? '{"records":[]}').records).toHaveLength(0);
    await press(root.root.findAllByProps({ testID: 'khatma-reached-confirm' }).find((node) => String(node.type) === 'Pressable')!);
    await flush();
    expect(JSON.parse(state.storage.get('quran-heals:mushaf-khatmas:v1')!).records).toHaveLength(1);
    expect(savedStops()).toEqual([expect.objectContaining({ id: 'fajr', page: 1 })]);
    expect(isSaved()).toBe(false);
  });
});

/**
 * Finger-following page turns (MushafZoomView): the page and its two
 * neighbours drawn side by side, the strip moved with the finger on the UI
 * thread (Reanimated, mocked: styles read live), settled on release.
 */
describe('finger-following page turns', () => {
  const W = 390; // the viewport's width in render()
  const ACTIVATE = 17; // just past the swipe's 16-pt activation offset
  type Live = { __live: () => { transform: { translateX: number }[] } };
  const slotIds = () => root.root.findAll((n) => typeof n.type === 'string' && /^mushaf-pager-\d+$/.test(String(n.props.testID))).map((n) => Number(String(n.props.testID).slice('mushaf-pager-'.length)));
  const slot = (n: number) => root.root.findAll((node) => typeof node.type === 'string' && node.props.testID === `mushaf-pager-${n}`)[0];
  /** Where page n's slot is now, from its live animated style (0: centred; -W: one page to the left). */
  const x = (n: number) => ([slot(n).props.style].flat(3).find((style) => style && (style as Live).__live) as Live).__live().transform[0].translateX;
  /** Every page drawn in QPC V1 (page 61's verified lines under each number), so the neighbours are drawn too. */
  const everyPageDrawn = () => state.offline.readPage.mockImplementation(async (n: number) => ({ ...syntheticQpcPage61(), page: n, fontFamily: `QCF_P${String(n).padStart(3, '0')}` }));
  /** Touch down, then past the activation offset: the drag has started where the finger is. */
  const down = async (direction: 1 | -1) => {
    await act(async () => {
      const g = swipeGesture();
      g.handlers.onBegin({ translationX: 0, translationY: 0 });
      g.handlers.onStart({ translationX: direction * ACTIVATE, translationY: 0 });
    });
  };
  /** The finger `travel` pt from where it touched down. */
  const move = async (travel: number) => {
    await act(async () => { swipeGesture().handlers.onUpdate({ translationX: travel, translationY: 0 }); });
  };
  /** The finger lifts after `travel` pt, moving at `velocityX` pt/s. */
  const lift = async (travel: number, velocityX = 0) => {
    await act(async () => {
      const g = swipeGesture();
      g.handlers.onEnd({ translationX: travel, translationY: 0, velocityX }, true);
      g.handlers.onFinalize({ translationX: travel, translationY: 0 }, true);
    });
    await flush();
    await flush();
  };
  const swipeTo = async (travel: number, velocityX = 0) => {
    await down(Math.sign(travel) as 1 | -1);
    await move(travel);
    await lift(travel, velocityX);
  };
  const tap = async () => {
    await act(async () => { const g = swipeGesture(); g.handlers.onBegin({}); g.handlers.onFinalize({}, false); });
    await flush();
  };

  it('draws the page and both neighbours, each under its own number, beside it; only the current page is touchable, zoomable and read aloud', async () => {
    everyPageDrawn();
    await render();
    expect(currentPage()).toBe(61);
    // The neighbours first and the current page last (on top).
    expect(slotIds()).toEqual([60, 62, 61]);
    // The next page waits to the left, the previous to the right.
    expect([x(62), x(61), x(60)]).toEqual([-W, 0, W]);
    for (const n of [60, 62]) {
      expect(slot(n).props).toMatchObject({ pointerEvents: 'none', accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' });
      expect(slot(n).findAll((node) => typeof node.type === 'string' && node.props.testID === 'qpc-v1-text')).toHaveLength(1); // drawn, not a placeholder
    }
    expect(slot(61).props).toMatchObject({ pointerEvents: 'auto', accessibilityElementsHidden: false });
    expect(root.root.findAll((node) => typeof node.type === 'string' && node.props.testID === 'mushaf-zoom-page')).toHaveLength(1);
    // Only these three pages are read, the shown one first: never all 604.
    expect(state.offline.readPage.mock.calls.map(([n]) => n)).toEqual([61, 62, 60]);
  });

  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: the page follows the finger; at 25%, 50% and 75% of a swipe that much of the neighbour shows`, async () => {
      state.locale = locale;
      everyPageDrawn();
      await render();
      // Left to right: the next page slides in from the left (the same in every language).
      await down(1);
      for (const f of [0.25, 0.5, 0.75]) {
        await move(ACTIVATE + f * W);
        expect(x(61)).toBeCloseTo(f * W);
        expect(x(62)).toBeCloseTo(-W + f * W);
        expect(W - Math.abs(x(62))).toBeCloseTo(f * W); // the share of page 62 on screen
      }
      await lift(ACTIVATE + 0.75 * W);
      expect(currentPage()).toBe(62);
      expect([x(63), x(62), x(61)]).toEqual([-W, 0, W]);
      // Right to left: the previous page from the right.
      await down(-1);
      for (const f of [0.25, 0.5, 0.75]) {
        await move(-(ACTIVATE + f * W));
        expect(x(62)).toBeCloseTo(-f * W);
        expect(x(61)).toBeCloseTo(W - f * W);
      }
      await lift(-(ACTIVATE + 0.75 * W));
      expect(currentPage()).toBe(61);
      expect(x(61)).toBe(0);
    });
  }

  it('released: on to the neighbour past 50 pt or after a flick; otherwise smoothly back; flicked back against the drag, back', async () => {
    everyPageDrawn();
    await render();
    await swipeTo(45); // short and slow
    expect(currentPage()).toBe(61);
    expect([x(62), x(61)]).toEqual([-W, 0]);
    await swipeTo(-45);
    expect(currentPage()).toBe(61);
    await swipeTo(60); // past 50 pt
    expect(currentPage()).toBe(62);
    await swipeTo(-35, -800); // a short flick
    expect(currentPage()).toBe(61);
    await swipeTo(200, -900); // far, then flicked back the other way
    expect(currentPage()).toBe(61);
    expect(x(61)).toBe(0);
    // A second finger (a pinch starting) cancels the drag: back.
    await down(1);
    await move(250);
    await act(async () => { const g = swipeGesture(); g.handlers.onEnd({ translationX: 250, translationY: 0, velocityX: 0 }, false); g.handlers.onFinalize({}, false); });
    await flush();
    expect(currentPage()).toBe(61);
    expect(x(61)).toBe(0);
    // Never more than one page at a time, however far the finger goes.
    await down(1);
    await move(ACTIVATE + 3 * W);
    expect(x(61)).toBe(W);
    await lift(ACTIVATE + 3 * W);
    expect(currentPage()).toBe(62);
  });

  it('page 1 and page 604: toward the missing page it only gives a little, and settles back', async () => {
    everyPageDrawn();
    state.params = { page: '1' };
    await render();
    expect(slotIds()).toEqual([2, 1]);
    await down(-1); // right to left: previous, before page 1
    await move(-(ACTIVATE + 200));
    expect(x(1)).toBeCloseTo(-200 * 0.2);
    await lift(-(ACTIVATE + 200), -900);
    expect(currentPage()).toBe(1);
    expect(x(1)).toBe(0);
    await act(async () => root.unmount());
    state.params = { page: '604' };
    await render();
    expect(slotIds()).toEqual([603, 604]);
    await down(1); // left to right: next, after page 604
    await move(ACTIVATE + 200);
    expect(x(604)).toBeCloseTo(200 * 0.2);
    await lift(ACTIVATE + 200, 900);
    expect(currentPage()).toBe(604);
    expect(x(604)).toBe(0);
    await swipeTo(-120); // the other way still turns
    expect(currentPage()).toBe(603);
  });

  it('interrupted: a touch catches a gliding page where it is (no jump); a tap lets it glide on; nothing turns twice', async () => {
    everyPageDrawn();
    await render();
    state.holdAnimations = true;
    await swipeTo(120);
    // Gliding on to 62 (held): not turned yet.
    expect(state.pending).toHaveLength(1);
    expect(currentPage()).toBe(61);
    // A tap on the gliding page: it holds, then glides on where it was going.
    await tap();
    expect(state.pending).toHaveLength(1);
    await act(async () => { state.pending.splice(0).forEach((done) => done(true)); });
    await flush();
    expect(currentPage()).toBe(62);
    expect(x(62)).toBe(0);
    // Gliding on to 63, caught by a new drag: the page stays exactly where it was when the drag starts...
    await swipeTo(120);
    const at = x(62);
    await down(-1);
    await move(-ACTIVATE);
    expect(x(62)).toBe(at);
    // ...and follows the finger back from there; released short of 50 pt from 62, it settles on 62.
    await move(-ACTIVATE - 360);
    expect(x(62)).toBeCloseTo(at - 360);
    await lift(-ACTIVATE - 360);
    await act(async () => { state.pending.splice(0).forEach((done) => done(true)); });
    await flush();
    expect(currentPage()).toBe(62);
    expect(x(62)).toBe(0);
  });

  it('fast consecutive swipes each land exactly one page, even before the screen has caught up', async () => {
    everyPageDrawn();
    await render();
    await act(async () => {
      for (let i = 0; i < 2; i++) {
        const g = swipeGesture();
        g.handlers.onBegin({});
        g.handlers.onStart({ translationX: ACTIVATE, translationY: 0 });
        g.handlers.onUpdate({ translationX: 140, translationY: 0 });
        g.handlers.onEnd({ translationX: 140, translationY: 0, velocityX: 900 }, true);
        g.handlers.onFinalize({}, true);
        await Promise.resolve(); // the glide's completion (UI thread), before React renders
      }
    });
    await flush();
    await flush();
    expect(currentPage()).toBe(63);
    expect([x(64), x(63), x(62)]).toEqual([-W, 0, W]);
    await swipeTo(-140);
    expect(currentPage()).toBe(62);
    expect(x(62)).toBe(0);
  });

  it('a second swipe settled before React shows the first: the strip stays on the newer page (no jump back), then React catches up', async () => {
    everyPageDrawn();
    await render();
    state.deferRN = true;
    await swipeTo(140); // settled on 62 (UI thread); React not told yet
    await swipeTo(140); // and on 63
    expect(state.toRN).toHaveLength(2);
    expect(currentPage()).toBe(61);
    // React now shows the first (62) while the strip is already on 63: 63 stays centred.
    await act(async () => { state.toRN.shift()!(); });
    await flush();
    expect(currentPage()).toBe(62);
    expect(x(63)).toBe(0);
    expect(x(62)).toBe(W);
    await act(async () => { state.toRN.shift()!(); });
    await flush();
    expect(currentPage()).toBe(63);
    expect([x(64), x(63), x(62)]).toEqual([-W, 0, W]);
  });

  it('the page that slid in is the one shown: never drawn again (no second measuring pass) nor read again', async () => {
    everyPageDrawn();
    await render();
    const measures = (node: ReactTestInstance) => node.findAll((n) => typeof n.type === 'string' && /^qpc-measure-/.test(String(n.props.testID)));
    // Every drawn page measures its lines once, as each lays out.
    await act(async () => {
      for (const n of slotIds()) for (const m of measures(slot(n))) m.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: m.props.testID === 'qpc-measure-1' ? 700 : 800, height: 100 } } });
    });
    for (const n of slotIds()) expect(measures(slot(n))).toHaveLength(0);
    state.offline.readPage.mockClear();
    await swipeTo(120);
    expect(currentPage()).toBe(62);
    expect(measures(slot(62))).toHaveLength(0); // the same drawing, already measured
    expect(measures(slot(63)).length).toBeGreaterThan(0); // only the new neighbour is new
    expect(state.offline.readPage.mock.calls).toEqual([[63]]);
  });

  it('a tap never moves the page; the arrows still go straight to a page, centred and at 1×', async () => {
    everyPageDrawn();
    await render();
    await tap();
    expect(currentPage()).toBe(61);
    expect(x(61)).toBe(0);
    await press(panelButton('next'));
    await flush();
    expect(currentPage()).toBe(62);
    expect([x(63), x(62), x(61)]).toEqual([-W, 0, W]);
    await pinch(2);
    expect(zoom().scale).toBe(2);
    await press(panelButton('previous'));
    await flush();
    expect(currentPage()).toBe(61);
    expect(x(61)).toBe(0);
    expect(zoom().scale).toBe(1);
  });

  // Release audit (rapid swipes): only one page is read ahead on each side, so a second swipe made before the new
  // neighbour has loaded slides in an empty placeholder (no paper, frame or text) until its load finishes. Pins the
  // current behaviour; it never shows the wrong page, never skips a page and draws the page as soon as it is read.
  it('a second swipe before the new neighbour has loaded shows an empty placeholder, then the page once read', async () => {
    everyPageDrawn();
    await render();
    let finish63!: () => void;
    const drawn = state.offline.readPage.getMockImplementation()!;
    state.offline.readPage.mockImplementation((n: number) => (n === 63 ? new Promise((resolve) => { finish63 = () => resolve(drawn(n)); }) : drawn(n)));
    await swipeTo(120);
    expect(currentPage()).toBe(62);
    const text = (n: number) => slot(n).findAll((node) => typeof node.type === 'string' && node.props.testID === 'qpc-v1-text');
    // Page 63 is still being read: its slot is the bare loading placeholder, not a page.
    expect(text(63)).toHaveLength(0);
    expect(slot(63).findAll((node) => typeof node.type === 'string' && node.props.testID === 'mushaf-page-missing')).toHaveLength(0);
    expect(slot(63).findAll((node) => typeof node.type === 'string' && node.props.accessibilityLabel === 'Loading the 1405 page…')).toHaveLength(1);
    // The reader swipes on at once: page 63 slides in (and is shown) as that placeholder.
    await swipeTo(120);
    expect(currentPage()).toBe(63);
    expect(text(63)).toHaveLength(0);
    // The read finishes: page 63 is drawn in place.
    await act(async () => { finish63(); });
    await flush();
    await flush();
    expect(text(63)).toHaveLength(1);
  });
});

describe('the page`s heads: digits and inset', () => {
  it('Juz`, Hizb and page numbers in Arabic-Indic digits, in Arabic and English alike', async () => {
    for (const locale of ['en', 'ar'] as const) {
      state.locale = locale;
      const page11 = { ...syntheticQpcPage61(), page: 11, fontFamily: 'QCF_P011' };
      state.offline.readPage.mockImplementation(async (n: number) => (n === 11 ? page11 : null));
      state.params = { page: '11' };
      await render();
      const head = (id: string) => inPage().findByProps({ testID: id }).props.children;
      expect(head('mushaf-header-juz')).toBe('الجزء ٣'); // the synthetic page's first ayah is 3:…
      expect(head('mushaf-hizb-label')).toBe('الحزب ٢');
      expect(shownPageNumber()).toBe('١١');
      for (const text of inPage().findAllByType('Text' as never).map((node) => [node.props.children].flat().join(''))) {
        if (/الجزء|الحزب|^[٠-٩]+$/.test(text)) expect(text, locale).not.toMatch(/[0-9]/);
      }
      await act(async () => root.unmount());
    }
  });

  it('the Surah and juz` heads sit in from the page`s edges by one border tile, over the frame`s inner rule, on their own sides; nothing else moves', async () => {
    const { MushafPageView } = await import('@/components/MushafPageView');
    const { computePageLayout } = await import('@/mushaf/pageGeometry');
    const draw = async (pageNumber: number, openingOrnament: boolean, width = 384) => {
      await act(async () => {
        root = create(createElement(MushafPageView, { pageNumber, firstAyah: { surah: 2, ayah: 6 }, width, renderText: () => null, hizbLabels: [], openingOrnament }));
      });
      const header = root.root.findByProps({ testID: 'mushaf-header' });
      const heads = (header.children as ReactTestInstance[]).map((child) => child.props.testID);
      const box = { header: styleOf(header), text: styleOf(root.root.findByProps({ testID: 'mushaf-text-area' })), paper: styleOf(root.root.findByProps({ testID: 'mushaf-paper' })) };
      await act(async () => root.unmount());
      return { heads, ...box };
    };
    const layout = computePageLayout(384);
    for (const n of [3, 4, 61, 62, 604]) {
      const page = await draw(n, false);
      // The Surah on the left, the juz' on the right, odd and even pages alike, as before.
      expect(page.heads, `page ${n}`).toEqual(['mushaf-header-surah', 'mushaf-header-juz']);
      // In by the band's width: the heads' outer edges over the inner rule's inner edge (19.2 pt on a 384-pt page).
      expect(page.header).toMatchObject({ paddingHorizontal: layout.inner.x - layout.frame.x, height: layout.header.height, flexDirection: 'row', justifyContent: 'space-between' });
      expect(page.header.paddingHorizontal).toBeCloseTo(19.2);
      // The header's height, the text area and the page's size are the layout's own.
      expect(page.text).toMatchObject({ left: layout.text.x, width: layout.text.width, height: layout.text.height });
      expect(page.paper).toMatchObject({ width: layout.page.width, height: layout.page.height });
    }
    // Every page size: always the band's width, so always past the band (never the 7 pt that left the heads over it).
    for (const width of [251, 310, 338, 384, 406, 434]) {
      const sized = computePageLayout(width);
      const inset = (await draw(61, false, width)).header.paddingHorizontal as number;
      expect(inset, `width ${width}`).toBeCloseTo(sized.inner.x - sized.frame.x);
      expect(inset, `width ${width}`).toBeGreaterThan(7);
    }
    // Pages 1–2 (the approved opening design): their heads as approved.
    for (const n of [1, 2]) expect((await draw(n, true)).header.paddingHorizontal, `page ${n}`).toBe(0);
  });
});
