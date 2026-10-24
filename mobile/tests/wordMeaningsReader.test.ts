import { createElement, type ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@/localization/messages';

/**
 * Word Meanings (المعاني) in the real /mushaf reader: Normal Mode only, never in full screen (the long, Taller page),
 * page-aware, and without changing anything else. The harness is mushafScreen.test.ts's own (the same mocked native
 * modules, the real verified Quran database for the Tanzil check, SYNTHETIC QPC V1 layouts), plus Animated and
 * PanResponder for the sheet, and a SYNTHETIC Word Meanings dataset (never King Fahd text): wordMeaningsData.test.ts
 * checks the real one.
 */

type MockGesture = { kind: 'pinch' | 'pan' | 'tap'; handlers: Record<string, (...args: unknown[]) => void>; config: Record<string, unknown> };
const state = vi.hoisted(() => ({
  /** The clipboard (expo-clipboard): what was last copied; `clipboardFails` makes the next copy fail. */
  clipboard: null as string | null,
  clipboardFails: false,
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
  storage: new Map<string, string>(),
  /** The Favorite Reciter the screen sees (useFavoriteReciter mock): the default unless a test chooses one. */
  favoriteReciterId: 'maher',
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
  /** Keyboard listeners (Keyboard mock), by event, so a test can show or hide the keyboard. */
  keyboardListeners: new Map<string, Set<() => void>>(),
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
    InputAccessoryView: 'InputAccessoryView',
    Keyboard: {
      dismiss: vi.fn(),
      addListener: (event: string, listener: () => void) => {
        const set = state.keyboardListeners.get(event) ?? new Set();
        set.add(listener);
        state.keyboardListeners.set(event, set);
        return { remove: () => { set.delete(listener); } };
      },
    },
    BackHandler: {
      addEventListener: (_event: string, handler: () => boolean) => {
        state.backHandlers.push(handler);
        return { remove: () => { state.backHandlers = state.backHandlers.filter((h) => h !== handler); } };
      },
    },
    // Like a device: a closed modal shows nothing.
    Modal: ({ visible, children, ...rest }: { visible: boolean; children: unknown }) => (visible ? h('Modal', rest, children as never) : null),
    // Renders every row (the real list virtualises them), then its footer, as the real list does.
    FlatList: ({ data, renderItem, ListEmptyComponent, ListFooterComponent, keyExtractor, ...rest }: ListProps & { ListFooterComponent?: unknown }) =>
      h('FlatList', rest, ...(data.length ? data.map((item, index) => h('Row', { key: keyExtractor(item) }, renderItem({ item, index }) as never)) : [ListEmptyComponent as never]), ListFooterComponent as never),
    TouchableWithoutFeedback: 'TouchableWithoutFeedback',
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    // Foreground (Keep Screen Awake, mushaf/useMushafKeepAwake.ts).
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
    ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
    // The Word Meanings sheet's drag: values that hold what they are set to, springs that arrive at once, and the
    // responder's own configuration as its handlers (so a test drives the release it would get).
    Animated: {
      View: 'AnimatedView',
      Value: class { constructor(public value: number) {} setValue(next: number) { this.value = next; } },
      spring: (value: { setValue: (n: number) => void }, config: { toValue: number }) => ({ start: () => value.setValue(config.toValue) }),
    },
    PanResponder: { create: (config: Record<string, unknown>) => ({ panHandlers: { __responder: config } }) },
  };
});
// The dataset (wordMeanings/bundledDataset.ts): SYNTHETIC, as a development build would carry it; `wm` switches the
// build to a release (nothing bundled), the feature off, or the import's "unavailable" placeholder.
const wm = vi.hoisted(() => ({ enabled: true, bundled: true, data: null as unknown, loads: 0 }));
vi.mock('@/wordMeanings/config', () => ({ get WORD_MEANINGS_ENABLED() { return wm.enabled; } }));
vi.mock('@/wordMeanings/bundledDataset', () => ({
  isWordMeaningsBundled: () => wm.bundled,
  bundledWordMeanings: () => { wm.loads += 1; return wm.bundled ? wm.data : null; },
}));
// Surah Preview (surahPreview/): bundled as in a development build, its data SYNTHETIC (never the source's text).
const sp = vi.hoisted(() => ({ bundled: true, loads: 0 }));
vi.mock('@/surahPreview/bundledDataset', () => ({
  isSurahPreviewBundled: () => sp.bundled,
  bundledSurahPreview: () => {
    sp.loads += 1;
    return sp.bundled ? { format: 1, status: 'official', sources: [], surahs: Array.from({ length: 114 }, (_, i) => ({ surah: i + 1, revelation: i % 2 ? 'madani' : 'makki', ayahCount: 10 + i, purpose: { ar: `مقصد تجريبي ${i + 1}`, en: null }, themes: { ar: null, en: null } })) } : null;
  },
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', SvgXml: 'SvgXml', Defs: 'Defs', Ellipse: 'Ellipse', G: 'G', Line: 'Line', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => state.insets }));
vi.mock('lucide-react-native', () => ({
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', BookMarked: 'BookMarked', Bookmark: 'Bookmark', Check: 'Check', ChevronDown: 'ChevronDown', ChevronLeft: 'ChevronLeft', ChevronRight: 'ChevronRight', ChevronsLeft: 'ChevronsLeft', ChevronsRight: 'ChevronsRight', CircleHelp: 'CircleHelp', Copy: 'Copy', Heart: 'Heart', Maximize2: 'Maximize2', Minimize2: 'Minimize2', Plus: 'Plus', Search: 'Search', Share2: 'Share2', X: 'X',
  // Quran audio (the top bar's headphones, the player chip and panel, the popup's Listen).
  BookOpenText: 'BookOpenText', AudioLines: 'AudioLines', ChevronUp: 'ChevronUp', CircleAlert: 'CircleAlert', Headphones: 'Headphones', LocateFixed: 'LocateFixed', Pause: 'Pause', Play: 'Play', SkipBack: 'SkipBack', SkipForward: 'SkipForward',
}));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), replace: vi.fn(), push: vi.fn(), navigate: vi.fn(), canGoBack: () => state.canGoBack }, useLocalSearchParams: () => state.params, useIsFocused: () => true }));
// Keep Screen Awake: the reader holds its own tag while focused (lifecycle cases: mushafKeepAwake.test.ts).
const keepAwake = vi.hoisted(() => ({ activate: vi.fn(async (_tag?: string) => undefined), deactivate: vi.fn(async (_tag?: string) => undefined) }));
vi.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: keepAwake.activate, deactivateKeepAwake: keepAwake.deactivate }));
// The ayah screens' Share Ayah sheet, as in ayahLinkNavigation.test.ts: its props are what the reader hands it.
vi.mock('@/components/ShareAyahSheet', () => ({ ShareAyahSheet: 'ShareAyahSheet' }));
// Signed out (a guest): Save's Favorites stay on the device (the real hook and storage; no cloud sync, no native sign-in).
vi.mock('@/auth/useAuth', () => ({ getCurrentSessionToken: async () => null, useAuth: () => ({}) }));
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
vi.mock('@/audio/useFavoriteReciter', () => ({
  useFavoriteReciter: () => ({ reciterId: state.favoriteReciterId, isReady: true, setReciterId: () => undefined }),
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
vi.mock('expo-clipboard', () => ({
  setStringAsync: vi.fn(async (text: string) => {
    if (state.clipboardFails) return false;
    state.clipboard = text;
    return true;
  }),
}));
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

// Quran audio (audio/index.ts): the real engine (audio/engine.ts) over a fake native player and synthetic timing (every
// ayah 10 s after a 4 s opening), so the reader's Play, Listen, page turning and following run the engine's own rules.
const audio = vi.hoisted(() => ({
  listeners: new Set<(status: { positionMs: number; playing: boolean; buffering: boolean; loaded: boolean; finished: boolean; error: string | null; durationMs?: number }) => void>(),
  loads: [] as string[],
  /** Whole-surah tests: surahs that play only whole ("reciterId:surah"); everything else is the catalogue. */
  wholeSurah: new Set<string>(),
}));
vi.mock('@/audio/index', async () => {
  const { createPlaybackEngine } = await import('@/audio/engine');
  const { hasAyahPlayback, surahAudioUrl } = await import('@/audio/reciters');
  const { SURAH_AYAH_COUNTS } = await import('@/utils/ayahLink');
  const audioEngine = createPlaybackEngine({
    output: {
      load: async (uri: string, startMs: number) => void audio.loads.push(`${uri}@${startMs}`),
      seek: async (ms: number) => void audio.loads.push(`seek@${ms}`),
      play: () => undefined,
      pause: () => undefined,
      stop: () => undefined,
      subscribe: (listener) => {
        audio.listeners.add(listener);
        return () => audio.listeners.delete(listener);
      },
      setNowPlaying: () => undefined,
      preload: () => undefined,
    },
    timing: {
      load: async (reciter, surah) => ({
        ok: true as const,
        timing: { reciterId: reciter.id, surah, introEndMs: 4000, ayahs: Array.from({ length: SURAH_AYAH_COUNTS[surah - 1] }, (_, i) => ({ startMs: 4000 + i * 10_000, endMs: 14_000 + i * 10_000 })) },
      }),
      stored: async () => null,
    },
    // Whole-surah sources carry their verified length and pass the stream check (as the registry's would).
    resolveSource: async (reciter, surah) => (audio.wholeSurah.has(`${reciter.id}:${surah}`)
      ? { uri: surahAudioUrl(reciter, surah), local: false, bytes: 1, durationMs: 1_234_000, verify: true }
      : { uri: surahAudioUrl(reciter, surah), local: false }),
    capability: (reciter, surah) => (audio.wholeSurah.has(`${reciter.id}:${surah}`) ? 'surah' : hasAyahPlayback(reciter, surah) ? 'ayah' : 'none'),
    checkStream: async () => 'ok',
    now: () => 10 ** 12,
  });
  const idleDownloads = { getState: () => ({ phase: 'idle' }), subscribe: () => () => undefined, getStorageVersion: () => 0 };
  return { audioEngine, audioDownloads: idleDownloads, audioFiles: { reciters: async () => [] }, setAudioLocale: () => undefined, timingLoader: {} };
});
const { resetMushafAutoDownloadForTests } = await import('@/mushaf/offline/autoDownloadService');
const { default: MushafScreen } = await import('@/app/(tabs)/mushaf');
const { router } = await import('expo-router');
const { MUSHAF_PANEL_COLORS } = await import('@/constants/mushafTheme');
const { computePageLayout } = await import('@/mushaf/pageGeometry');
const { getSurahName } = await import('@/services/surahNames');
const { syntheticQpcPage61 } = await import('./helpers/syntheticQpcPage61');
const { ACTIVE_READING_STOP_STORAGE_KEY, READING_STOPS_STORAGE_KEY } = await import('@/mushaf/readingStops');
const spacingMd = (await import('@/constants/theme')).spacing.md;
const { resetWordMeaningsDatasetForTests } = await import('@/wordMeanings/dataset');
const { MushafFeatureLayer } = await import('@/mushafFeatures/MushafFeatureLayer');
const { BUTTON_SLOP, edgeInset, MIN_PILL_WIDTH, PILL_CLEARANCE } = await import('@/mushafFeatures/placement');
const { ARROW_ONLY_WIDTH } = await import('@/mushafFeatures/FeatureButton');
const { resetSurahPreviewDatasetForTests } = await import('@/surahPreview/dataset');
const { useWordMeaningsVisibility, WordMeaningsVisibilityProvider } = await import('@/mushaf/useWordMeaningsVisibility');
const { WORD_MEANINGS_VISIBLE_STORAGE_KEY } = await import('@/mushaf/wordMeaningsVisibilityPreference');
const layoutResponse = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

type Row = [number, number, number, number, string, string];
/**
 * A SYNTHETIC dataset in the generated file's shape: on each page, `count(page)` entries «كلمة p-k» / «معنى p-k»
 * (Al-Imran 84 onward; a pair of ayahs first on page 483), never the source's words.
 */
function synthetic(count: (page: number) => number = () => 3) {
  let id = 0;
  const pages = Array.from({ length: 604 }, (_, i) => Array.from({ length: count(i + 1) }, (_, k): Row => {
    id += 1;
    return i + 1 === 483 && k === 0 ? [id, 42, 1, 2, 'كلمة مزدوجة', 'معنى لآيتين'] : [id, 3, 84 + k, 84 + k, `كلمة ${i + 1}-${k + 1}`, `معنى ${i + 1}-${k + 1}`];
  }));
  return { format: 1, status: 'official', parser: 2, source: { title: 'synthetic', publisher: 'synthetic', url: '', sha256: '', retrieved: '' }, counts: { entries: id }, pages };
}

let root: ReactTestRenderer;
const flush = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };
const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean));
const styleOf = (node: ReactTestInstance) => flat(typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style);
const hosts = (testID: string) => root.root.findAllByProps({ testID }).filter((node) => typeof node.type === 'string');
/** Every node of the feature still in the tree (its control, sheet, backdrop, drag area, entries…). */
const featureNodes = () => root.root.findAll((node) => typeof node.type === 'string' && typeof node.props.testID === 'string' && node.props.testID.startsWith('word-meanings'));
const layers = () => root.root.findAllByType(MushafFeatureLayer as never);
const textOf = (node: ReactTestInstance) => node.findAllByType('Text' as never).map((t) => [t.props.children].flat().join('')).join(' | ');
const allText = () => root.root.findAllByType('Text' as never).map((t) => [t.props.children].flat().join(''));
const control = () => hosts('word-meanings-open')[0];
/** Hidden as the ورد row is while zoomed: unseen, letting every touch through, not pressable, not announced. */
const controlHidden = () => {
  const style = styleOf(control());
  const props = control().props;
  const hidden = style.opacity === 0 && style.pointerEvents === 'none' && props.disabled === true && props.accessibilityElementsHidden === true && props.importantForAccessibility === 'no-hide-descendants';
  const shown = style.opacity !== 0 && style.pointerEvents === undefined && !props.disabled && !props.accessibilityElementsHidden;
  expect(hidden || shown, 'hidden or shown, never in between').toBe(true);
  return hidden;
};
const sheetOpen = () => hosts('word-meanings-sheet').length === 1;
const entryRows = () => root.root.findAll((n) => typeof n.type === 'string' && /^word-meanings-entry-\d+$/.test(String(n.props.testID)));
const sheetModal = () => root.root.findAllByType('Modal' as never).find((m) => m.findAllByProps({ testID: 'word-meanings-sheet' }).length > 0);
const inPage = () => root.root.findByProps({ testID: 'mushaf-zoom-page' });
const currentPage = () => Number(String(inPage().parent!.props.testID).replace('mushaf-pager-', ''));
async function press(node: ReactTestInstance | undefined) {
  await act(async () => { await node!.props.onPress(); });
  await flush();
}
const openSheet = () => press(control());
const toggleFullScreen = () => press(hosts('mushaf-fullscreen-toggle')[0]);
type Live = { __live: () => { transform: Record<string, string | number>[] } };
/** A button's chevron turn (useDropdownMotion, as the ورد pill's): 0 points down, 180 up. */
const chevronTurn = (id: string) => {
  const node = root.root.findAllByProps({ testID: `${id}-chevron` })[0];
  const live = ([node.props.style].flat(3).find((style) => style && (style as Live).__live) as Live).__live();
  return Number(String(live.transform[0].rotate).replace('deg', ''));
};
/** Outside the sheet (its backdrop's own responder): a release after a drag of dy (and dx); 0, 0 is a tap (the only one that closes it). */
async function swipeOutside(id: string, dy: number, dx = 0) {
  const r = hosts(`${id}-backdrop`)[0].props.__responder as Record<string, (e: unknown, g: unknown) => void>;
  await act(async () => { r.onPanResponderRelease(null, { dx, dy, vx: 0, vy: 0 }); });
  await flush();
}
const tapOutside = (id: string) => swipeOutside(id, 0);
let lastArea = { width: 390, height: 797 };
/** The ورد pill's width as last laid out (measure, layoutPill). */
let laidOutPillWidth = 110;
const LINK_HEIGHT = 27.4;
/** The ورد row's width: the area's on phones, the page's on tablets (styles: left/right 0, or its own width). */
const rowWidth = () => styleOf(hosts('mushaf-wird-row')[0]).width ?? lastArea.width;
/** The buttons' widths as measured on the Android emulator (the ورد pill's 13-pt semibold text and chevron). */
const BUTTON_WIDTHS = { en: { meanings: 102, preview: 129 }, ar: { meanings: 78, preview: 95 } };
const widthsFor = () => BUTTON_WIDTHS[state.locale === 'en' ? 'en' : 'ar'];
/** A feature button drawn arrow-only (the ورد name needs the room): its capsule and chevron, no label. */
const arrowOnly = (testID: string) => hosts(testID)[0].findAllByType('Text' as never).length === 0;
/** A button's width as drawn: its measured labelled width, or ARROW_ONLY_WIDTH (24 pt padding, the 14-pt chevron, 2 × 0.5 border). */
const drawnWidth = (testID: string, labelledWidth: number) => (arrowOnly(testID) ? ARROW_ONLY_WIDTH : labelledWidth);
/**
 * As a device's first layout reports them: the buttons at the pill's height, then the ورد pill (centred in its row,
 * `pillWidth` wide but at most the width the reader gives it, as a real pill truncates; 26 pt tall).
 */
async function measure({ pillWidth = 110, controlWidth = widthsFor().meanings, previewWidth = widthsFor().preview }: { pillWidth?: number; controlWidth?: number; previewWidth?: number } = {}) {
  await act(async () => {
    control()?.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: controlWidth, height: 26 } } });
    hosts('surah-preview-open')[0]?.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: previewWidth, height: 26 } } });
  });
  await flush();
  const cap = styleOf(hosts('mushaf-wird')[0]).maxWidth;
  pillWidth = typeof cap === 'number' ? Math.min(pillWidth, cap) : pillWidth;
  laidOutPillWidth = pillWidth;
  const rowHeight = styleOf(hosts('mushaf-wird-row')[0]).height as number;
  await act(async () => {
    // Page 604: إتمام الختمة at its own size (27.4 pt tall on the emulator), centred in its 56-pt band.
    hosts('mushaf-complete-khatma')[0]?.props.onLayout({ nativeEvent: { layout: { x: 16, y: 28 - LINK_HEIGHT / 2, width: 72, height: LINK_HEIGHT } } });
    hosts('mushaf-wird')[0].props.onLayout({ nativeEvent: { layout: { x: (rowWidth() - pillWidth) / 2, y: (rowHeight - 26) / 2, width: pillWidth, height: 26 } } });
  });
  await flush();
}
async function render(area = { width: 390, height: 797 }, layout: Parameters<typeof measure>[0] | 'unmeasured' = {}, element: ReactElement = createElement(MushafScreen)) {
  lastArea = area;
  await act(async () => { root = create(element); });
  await flush();
  await act(async () => root.root.findByProps({ testID: 'mushaf-page-area' }).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, ...area } } }));
  await flush();
  await flush();
  if (layout !== 'unmeasured' && hosts('word-meanings-open').length) await measure(layout);
}
async function unmount() {
  await act(async () => root.unmount());
}
/** The current page's screen-reader action (as a swipe would turn it). */
async function turnPage(delta: 1 | -1) {
  const target = inPage().findAll((node) => typeof node.type === 'string' && Array.isArray(node.props.accessibilityActions))[0];
  await act(async () => target.props.onAccessibilityAction({ nativeEvent: { actionName: delta === 1 ? 'nextPage' : 'previousPage' } }));
  await flush();
}
const gestures = () => state.gesture!.gestures.map((g) => g.__g);
/** A one-finger horizontal swipe through the pager's own gesture (its activation offset as configured). */
async function swipe(dx: number) {
  await act(async () => {
    const turn = gestures().find((g) => g.kind === 'pan' && 'activeOffsetX' in g.config)!;
    const [, activeX] = turn.config.activeOffsetX as number[];
    turn.handlers.onBegin?.({ translationX: 0, translationY: 0 });
    const at = { translationX: Math.sign(dx) * (activeX + 1), translationY: 0, velocityX: 0 };
    turn.handlers.onStart?.(at);
    turn.handlers.onUpdate?.(at);
    turn.handlers.onUpdate?.({ translationX: dx, translationY: 0, velocityX: 0 });
    turn.handlers.onEnd({ translationX: dx, translationY: 0, velocityX: 0 }, true);
    turn.handlers.onFinalize?.({ translationX: dx, translationY: 0 }, true);
  });
  await flush();
  await flush();
}
async function pinch(scale: number) {
  await act(async () => {
    const g = gestures().find((x) => x.kind === 'pinch')!;
    g.handlers.onStart({ focalX: 195, focalY: 300 });
    g.handlers.onUpdate({ scale, focalX: 195, focalY: 300 });
    g.handlers.onEnd({}, true);
  });
  await flush();
}
/** The rendered tree as data (functions dropped), less the feature's own nodes when `prefix` is given. */
function treeWithout(prefix: string | null) {
  const strip = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(strip).filter((child) => child !== undefined);
    const n = node as { props?: { testID?: unknown }; children?: unknown };
    if (prefix && typeof n.props?.testID === 'string' && n.props.testID.startsWith(prefix)) return undefined;
    return { ...n, children: n.children ? strip(n.children) : n.children };
  };
  return JSON.stringify(strip(root.toJSON()));
}
const gestureSettings = () => JSON.stringify(gestures().map((g) => ({ kind: g.kind, config: g.config })));
/** Every page drawn in QPC V1 (page 61's verified synthetic lines under each number), so page turns draw the next page. */
const everyPageDrawn = () => state.offline.readPage.mockImplementation(async (n: number) => ({ ...syntheticQpcPage61(), page: n, fontFamily: `QCF_P${String(n).padStart(3, '0')}` }));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.storage.clear();
  state.storage.set('quran-heals:mushaf-guide:v1', JSON.stringify({ status: 'done', finished: false }));
  state.favoriteReciterId = 'maher';
  state.fontsLoaded = true;
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
  vi.mocked(router.push).mockClear();
  vi.mocked(router.navigate).mockClear();
  vi.mocked(router.replace).mockClear();
  state.loadFont.mockReset().mockResolvedValue(undefined);
  state.offline.readPage.mockReset().mockResolvedValue(null);
  state.offline.status.mockReset().mockResolvedValue({ installed: false, stagedChunks: 0 });
  state.offline.download.mockReset();
  state.offline.remove.mockReset().mockResolvedValue(undefined);
  state.offline.pageFont.mockReset().mockResolvedValue(null);
  // Every page in QPC V1 (its Taller frame), as on a device with the offline Mushaf.
  state.fetch.mockReset().mockResolvedValue(layoutResponse(200, { success: true, data: syntheticQpcPage61() }));
  everyPageDrawn();
  wm.enabled = true;
  wm.bundled = true;
  wm.data = synthetic();
  wm.loads = 0;
  resetWordMeaningsDatasetForTests();
  sp.bundled = true;
  sp.loads = 0;
  resetSurahPreviewDatasetForTests();
});
afterEach(async () => {
  if (root) await unmount();
  (await import('@/audio/index')).audioEngine.stop();
  audio.loads = [];
  audio.wholeSurah.clear();
  await resetMushafAutoDownloadForTests();
});

describe('Word Meanings: Normal Mode only (mode isolation)', () => {
  it('1. the control is shown in Normal Mode: one «Meanings» button with a downward chevron (closed)', async () => {
    await render();
    expect(hosts('word-meanings-open')).toHaveLength(1);
    expect(control().props.accessibilityRole).toBe('button');
    expect(control().props.accessibilityLabel).toBe('Meanings');
    expect(control().findAllByType('ChevronDown' as never)).toHaveLength(1);
    expect(chevronTurn('word-meanings-open')).toBe(0);
    expect(textOf(control())).toBe('Meanings');
    expect(controlHidden()).toBe(false);
    expect(sheetOpen()).toBe(false);
  });

  it('2–3. absent in full screen (the long page): no layer, control, sheet or any of its nodes, so nothing can open', async () => {
    await render();
    await toggleFullScreen();
    expect(layers()).toHaveLength(0);
    expect(featureNodes()).toHaveLength(0);
    expect(sheetModal()).toBeUndefined();
  });

  it('4–5. switching to full screen closes an open sheet; back in Normal Mode the control returns and the sheet stays closed', async () => {
    await render();
    await openSheet();
    expect(sheetOpen()).toBe(true);
    await toggleFullScreen();
    expect(featureNodes()).toHaveLength(0);
    await toggleFullScreen();
    expect(hosts('word-meanings-open')).toHaveLength(1);
    expect(sheetOpen()).toBe(false);
    expect(hosts('word-meanings-backdrop')).toHaveLength(0);
    // It opens again only when asked, on the page shown.
    await openSheet();
    expect(textOf(hosts('word-meanings-subtitle')[0])).toBe('Page 61');
  });

  it('6–8. full screen is exactly as without the feature: the same tree (no invisible target), the same gestures', async () => {
    wm.enabled = false;
    await render();
    await toggleFullScreen();
    const withoutTree = treeWithout(null);
    const withoutGestures = gestureSettings();
    await unmount();
    wm.enabled = true;
    await render();
    await toggleFullScreen();
    expect(treeWithout(null)).toBe(withoutTree);
    expect(gestureSettings()).toBe(withoutGestures);
    // Android Back still leaves full screen first, as before.
    expect(state.backHandlers).toHaveLength(1);
  });

  it('Normal Mode: the page and every other control are drawn exactly as without the feature; only the control is added', async () => {
    wm.enabled = false;
    await render();
    const withoutTree = treeWithout(null);
    const withoutGestures = gestureSettings();
    await unmount();
    wm.enabled = true;
    await render();
    expect(treeWithout('word-meanings')).toBe(withoutTree);
    expect(gestureSettings()).toBe(withoutGestures);
  });

  it('9. Normal Mode navigation works with the sheet closed: swipes turn the page both ways, the control stays', async () => {
    await render();
    await swipe(-150);
    expect(Math.abs(currentPage() - 61)).toBe(1);
    expect(hosts('word-meanings-open')).toHaveLength(1);
    await swipe(150);
    expect(currentPage()).toBe(61);
    expect(hosts('word-meanings-open')).toHaveLength(1);
  });

  it('10. the feature switched off, or a release build without the dataset: no control in Normal Mode, nothing loaded', async () => {
    wm.enabled = false;
    await render();
    expect(featureNodes()).toHaveLength(0);
    await unmount();
    wm.enabled = true;
    wm.bundled = false;
    await render();
    expect(featureNodes()).toHaveLength(0);
    expect(wm.loads).toBe(0);
  });

  it('hidden while zoomed as the ورد row is (unseen, every touch passing through to the page), back at 1×', async () => {
    await render();
    await pinch(2);
    expect(controlHidden()).toBe(true);
    expect(styleOf(hosts('mushaf-wird-row')[0]).opacity).toBe(0);
    await act(async () => { gestures().find((g) => g.kind === 'tap')!.handlers.onEnd({}, true); });
    await flush();
    expect(controlHidden()).toBe(false);
  });

  it('hidden while another popup is open (the page selector)', async () => {
    await render();
    await press(root.root.findAllByProps({ testID: 'mushaf-nav-page' }).find((n) => typeof n.type === 'string'));
    expect(controlHidden()).toBe(true);
  });
});

describe('Word Meanings: page-aware', () => {
  it('shows the page being read; a page turn closes it, and the next opening shows the new page (never the old one)', async () => {
    await render();
    await openSheet();
    expect(textOf(hosts('word-meanings-subtitle')[0])).toBe('Page 61');
    expect(allText()).toContain('كلمة 61-1');
    await turnPage(1);
    expect(currentPage()).toBe(62);
    expect(sheetOpen()).toBe(false);
    await openSheet();
    expect(textOf(hosts('word-meanings-subtitle')[0])).toBe('Page 62');
    expect(allText()).toContain('كلمة 62-1');
    expect(allText().some((t) => t.startsWith('كلمة 61-'))).toBe(false);
  });

  it('a link to another page (/mushaf?page=N, as Home or a list opens) closes it too', async () => {
    await render();
    await openSheet();
    state.params = { page: '125', at: '2' };
    await act(async () => root.update(createElement(MushafScreen)));
    await flush();
    expect(currentPage()).toBe(125);
    expect(sheetOpen()).toBe(false);
    await openSheet();
    expect(textOf(hosts('word-meanings-subtitle')[0])).toBe('Page 125');
    expect(allText()).toContain('كلمة 125-1');
  });

  it('the recitation never turns the page from under an open sheet; once it closes, the page follows', async () => {
    state.favoriteReciterId = 'abdulbasit';
    await render();
    await press(hosts('mushaf-play-page')[0]);
    await openSheet();
    const engine = (await import('@/audio/index')).audioEngine;
    for (let ayah = 84; ayah <= 91; ayah++) {
      const start = 4000 + (engine.getState().position!.ayah - 1) * 10_000;
      for (const positionMs of [start + 100, start + 10_000]) {
        await act(async () => { for (const listener of audio.listeners) listener({ positionMs, playing: true, buffering: false, loaded: true, finished: false, error: null }); });
        await flush();
      }
    }
    expect(engine.getState().position).toEqual({ surah: 3, ayah: 92 });
    expect(currentPage()).toBe(61);
    expect(sheetOpen()).toBe(true);
    expect(textOf(hosts('word-meanings-subtitle')[0])).toBe('Page 61');
    await press(hosts('word-meanings-close')[0]);
    expect(currentPage()).toBe(62);
  });

  it("the dataset is read only on first opening (never at the reader's start or on page turns), and once", async () => {
    await render();
    await turnPage(1);
    expect(wm.loads).toBe(0);
    await openSheet();
    expect(wm.loads).toBe(1);
    await press(hosts('word-meanings-close')[0]);
    await turnPage(1);
    await openSheet();
    expect(wm.loads).toBe(1);
  });
});

describe('Word Meanings: the sheet', () => {
  it("lists the page's entries in order: the word, its explanation, its ayah; the source under the list", async () => {
    await render();
    await openSheet();
    expect(entryRows().map((r) => textOf(r))).toEqual([0, 1, 2].map((k) => `كلمة 61-${k + 1} | معنى 61-${k + 1} | ${getSurahName(3).nameEnglish} 3:${84 + k}`));
    expect(textOf(hosts('word-meanings-source')[0])).toMatch(/Al-Muyassar fi Gharib al-Quran al-Karim .*King Fahd/);
    expect(textOf(hosts('word-meanings-arabic-only')[0])).toMatch(/English meanings are not available yet/);
  });

  it('a pair of ayahs explained together shows its range', async () => {
    state.params = { page: '483' };
    await render();
    await openSheet();
    expect(allText()).toContain(`${getSurahName(42).nameEnglish} 42:1–2`);
  });

  it('a long list scrolls (all 60 entries, in a list); a page without entries says so; an unavailable dataset says so', async () => {
    wm.data = synthetic((page) => (page === 61 ? 60 : page === 62 ? 0 : 3));
    await render();
    await openSheet();
    expect(hosts('word-meanings-list')).toHaveLength(1);
    expect(entryRows()).toHaveLength(60);
    await turnPage(1);
    await openSheet();
    expect(textOf(hosts('word-meanings-empty')[0])).toBe('No word meanings for this page.');
    await unmount();
    resetWordMeaningsDatasetForTests();
    wm.data = { format: 1, status: 'unavailable', reason: 'offline', pages: [] };
    await render();
    await openSheet();
    expect(textOf(hosts('word-meanings-unavailable')[0])).toBe('Meanings are not available in this version of the app.');
  });

  it('Arabic: «المعاني» on the control and the sheet, Arabic-Indic numbers, right to left; never «معاني الكلمات»', async () => {
    state.locale = 'ar';
    await render();
    expect(textOf(control())).toBe('المعاني');
    expect(styleOf(control()).flexDirection).toBe('row-reverse');
    await openSheet();
    expect(textOf(hosts('word-meanings-subtitle')[0])).toBe('صفحة ٦١');
    expect(allText()).toContain(`${getSurahName(3).nameArabic}، الآية ٨٤`);
    expect(hosts('word-meanings-arabic-only')).toHaveLength(0);
    expect(allText().join(' ')).not.toMatch(/معاني الكلمات/);
    const title = root.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'header' && textOf(n) === 'المعاني')[0];
    expect(styleOf(title)).toMatchObject({ textAlign: 'right', writingDirection: 'rtl' });
  });

  it('English: the header reads left to right; the Arabic words and meanings are always right to left', async () => {
    await render();
    await openSheet();
    const title = root.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'header' && textOf(n) === 'Meanings')[0];
    expect(styleOf(title)).toMatchObject({ textAlign: 'left', writingDirection: 'ltr' });
    const [word, explanation] = entryRows()[0].findAllByType('Text' as never);
    expect(styleOf(word)).toMatchObject({ textAlign: 'right', writingDirection: 'rtl' });
    expect(styleOf(explanation)).toMatchObject({ textAlign: 'right', writingDirection: 'rtl' });
  });

  it("follows the reader's light and dark appearance (the ورد pill's colours, the reader's sheet colours)", async () => {
    for (const theme of ['light', 'dark'] as const) {
      state.theme = theme;
      await render();
      const colors = theme === 'dark' ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
      expect(styleOf(control())).toMatchObject(colors.pill);
      await openSheet();
      expect(styleOf(hosts('word-meanings-sheet')[0])).toMatchObject(colors.sheet);
      await unmount();
    }
  });

  it('closes only by its X button, a tap outside it or Back: no swipe or drag ever closes it', async () => {
    await render();
    await openSheet();
    // A tap outside closes it.
    await tapOutside('word-meanings');
    expect(sheetOpen()).toBe(false);
    // The X button closes it.
    await openSheet();
    await press(hosts('word-meanings-close')[0]);
    expect(sheetOpen()).toBe(false);
    await openSheet();
    // Swipes and drags outside it, in any direction, do nothing.
    for (const [dy, dx] of [[120, 0], [400, 0], [-120, 0], [0, 120], [0, -120], [60, 60]]) await swipeOutside('word-meanings', dy, dx);
    expect(sheetOpen()).toBe(true);
    // Back closes it, and only it: the reader stays on the same page.
    await act(async () => { sheetModal()!.props.onRequestClose(); });
    await flush();
    expect(sheetOpen()).toBe(false);
    expect(router.back).not.toHaveBeenCalled();
    await openSheet();
    // No drag handler anywhere on the sheet: no responder or gesture to dismiss it by dragging.
    expect(hosts('word-meanings-drag-area')).toHaveLength(0);
    const sheetTree = hosts('word-meanings-sheet')[0];
    expect(sheetTree.findAll((n) => typeof n.type === 'string' && (n.props.onResponderRelease || n.props.onMoveShouldSetResponder))).toHaveLength(0);
    // The outside area is one responder that takes every touch (nothing reaches the page under it).
    const outside = hosts('word-meanings-backdrop')[0].props.__responder as Record<string, () => boolean>;
    expect(outside.onStartShouldSetPanResponder()).toBe(true);
    // The same page throughout.
    expect(currentPage()).toBe(61);
  });

  it("the chevron follows the sheet as the ورد pill's does: down while closed, up while open, down again however it closes", async () => {
    await render();
    const arrow = () => {
      expect(control().findAllByType('ChevronDown' as never)).toHaveLength(1);
      const turn = chevronTurn('word-meanings-open');
      expect(control().props.accessibilityState).toEqual({ expanded: turn === 180 });
      return turn === 180 ? 'up' : 'down';
    };
    const closings: [string, () => Promise<void>][] = [
      ['a tap outside', () => tapOutside('word-meanings')],
      ['the close button', () => press(hosts('word-meanings-close')[0])],
      ['Back', async () => { await act(async () => { sheetModal()!.props.onRequestClose(); }); }],
      ['a page turn', () => turnPage(1)],
    ];
    expect(arrow()).toBe('down');
    for (const [how, close] of closings) {
      await openSheet();
      expect(arrow(), `open, before closing by ${how}`).toBe('up');
      // A swipe outside leaves it open (and the chevron up).
      await swipeOutside('word-meanings', 120);
      expect(arrow()).toBe('up');
      await close();
      expect(sheetOpen(), how).toBe(false);
      expect(arrow(), `closed by ${how}`).toBe('down');
    }
    // The ورد pill's own chevron size.
    expect(control().findAllByType('ChevronDown' as never)[0].props.size).toBe(14);
  });

  it('opening and closing it saves nothing (no ورد, Khatma, last browsed page or other reading data) and navigates nowhere', async () => {
    await render();
    const before = JSON.stringify([...state.storage.entries()].sort());
    for (let i = 0; i < 3; i++) {
      await openSheet();
      await press(hosts('word-meanings-close')[0]);
    }
    expect(JSON.stringify([...state.storage.entries()].sort())).toBe(before);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(currentPage()).toBe(61);
  });
});


describe('Feature buttons: placement — Meanings LEFT, the ورد pill centred, Surah Preview RIGHT, one line, every language', () => {
  const AREAS = { phone: { width: 390, height: 797 }, narrow: { width: 320, height: 520 }, tabletPortrait: { width: 820, height: 1100 }, tabletLandscape: { width: 1180, height: 760 } };
  const geometry = () => {
    const { pageWidth, tilesDown, areaWidth, page } = layers()[0].props as { pageWidth: number; tilesDown: number; areaWidth: number; page: number };
    const row = styleOf(hosts('mushaf-wird-row')[0]);
    const rowLeft = row.width === undefined ? 0 : (areaWidth - pageWidth) / 2;
    const layout = computePageLayout(pageWidth, tilesDown);
    // Meanings' approved x before Surah Preview existed: the page frame's left edge (page 604: never further in than
    // إتمام الختمة's left, spacing.md into the row).
    const approvedLeft = (areaWidth - pageWidth) / 2 + layout.frame.x;
    return { layout, areaWidth, rowLeft, rowHeight: row.height as number, pageHeight: row.top as number, approvedLeft: page === 604 ? Math.min(approvedLeft, rowLeft + spacingMd) : approvedLeft };
  };
  const box = (node: ReactTestInstance) => ({ ...styleOf(node), slop: node.props.hitSlop as { top: number; bottom: number; left: number; right: number } });
  const pillBox = () => {
    const { rowLeft, pageHeight, rowHeight } = geometry();
    const width = laidOutPillWidth;
    return { left: rowLeft + (rowWidth() - width) / 2, top: pageHeight + (rowHeight - 26) / 2, width, height: 26 };
  };
  const hidden = (node: ReactTestInstance) => styleOf(node).opacity === 0 && node.props.disabled === true;
  /**
   * The buttons as placed, in whichever form each is drawn, checked against every rule: the approved x, the pill's line,
   * a 44-pt touch target, never within PILL_CLEARANCE of the pill — and each labelled exactly where its labelled width
   * would still clear the pill, arrow-only exactly where it would not. Returns their boxes.
   */
  const expectRow = (withPreview: boolean, alwaysArrow = false) => {
    const { approvedLeft, areaWidth } = geometry();
    const pill = pillBox();
    const centre = pill.top + pill.height / 2;
    const m = box(control());
    const w = widthsFor();
    expect(hidden(control())).toBe(false);
    // Meanings: its approved x, on the pill's line, its 4-pt side touch target clear of the pill's.
    expect(m.left).toBeCloseTo(approvedLeft, 9);
    expect(m.top + 13).toBeCloseTo(centre, 6);
    expect(m.slop.left).toBe(BUTTON_SLOP);
    expect(m.left + drawnWidth('word-meanings-open', w.meanings) + PILL_CLEARANCE).toBeLessThanOrEqual(pill.left + 1e-6);
    // Labelled exactly where the label clears the pill (page 604: never, both always arrow-only).
    expect(arrowOnly('word-meanings-open')).toBe(alwaysArrow || m.left + w.meanings + PILL_CLEARANCE > pill.left + 0.5);
    expect(26 + m.slop.top + m.slop.bottom).toBeCloseTo(44, 6);
    expect(drawnWidth('word-meanings-open', w.meanings) + 2 * m.slop.left).toBeGreaterThanOrEqual(44);
    const previews = hosts('surah-preview-open');
    if (!withPreview) {
      expect(previews).toHaveLength(0);
      return { m, pill };
    }
    const p = box(previews[0]);
    const pWidth = drawnWidth('surah-preview-open', w.preview);
    expect(hidden(previews[0])).toBe(false);
    // Surah Preview: mirrored from the right edge, the same line, clear of the pill and of Meanings.
    expect(areaWidth - (p.left + pWidth)).toBeCloseTo(approvedLeft, 9);
    expect(p.top).toBeCloseTo(m.top, 9);
    expect(p.left).toBeGreaterThanOrEqual(pill.left + pill.width + PILL_CLEARANCE - 1e-6);
    expect(arrowOnly('surah-preview-open')).toBe(alwaysArrow || areaWidth - approvedLeft - w.preview < pill.left + pill.width + PILL_CLEARANCE - 0.5);
    expect(pWidth + 2 * p.slop.left).toBeGreaterThanOrEqual(44);
    return { m, p, pill };
  };
  /** The ورد pill laid out again at `natural` width (a new or renamed name), at most the width the reader gives it. */
  async function layoutPill(natural: number) {
    const cap = styleOf(hosts('mushaf-wird')[0]).maxWidth;
    const width = typeof cap === 'number' ? Math.min(natural, cap) : natural;
    laidOutPillWidth = width;
    const rowHeight = styleOf(hosts('mushaf-wird-row')[0]).height as number;
    await act(async () => hosts('mushaf-wird')[0].props.onLayout({ nativeEvent: { layout: { x: (rowWidth() - width) / 2, y: (rowHeight - 26) / 2, width, height: 26 } } }));
    await flush();
  }
  const LONG = 'Maximum length reading name for testing!';
  const SHORT = 'Fajr';
  /** Two ورد on page 2: a short one and one at the 40-character maximum; `active` is the one shown. */
  const twoWirds = (active: 'short' | 'long') => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([
      { id: 'short', name: SHORT, page: 2, updatedAt: '2026-10-24T00:00:00.000Z' },
      { id: 'long', name: LONG, page: 2, updatedAt: '2026-10-24T00:00:00.000Z' },
    ]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, active);
    state.params = { page: '2' };
  };
  const labelsShown = () => [arrowOnly('word-meanings-open'), arrowOnly('surah-preview-open')].map((arrow) => (arrow ? 'arrow' : 'label'));

  for (const [name, area] of Object.entries(AREAS)) {
    for (const locale of ['ar', 'en'] as const) {
      it(`${name}, ${locale}: page 61 (no Surah begins): Meanings at its approved x on the pill's line; no Surah Preview`, async () => {
        state.locale = locale;
        await render(area);
        expectRow(false);
        // A short name: labelled wherever there is room; on the 320-pt screen the label would reach the pill, so arrow-only.
        expect(arrowOnly('word-meanings-open')).toBe(name === 'narrow');
        expect(edgeInset({ areaWidth: area.width, pageWidth: (layers()[0].props as { pageWidth: number }).pageWidth, tilesDown: (layers()[0].props as { tilesDown: number }).tilesDown, rowLeft: 0, page604: false })).toBeCloseTo(geometry().approvedLeft, 9);
      });

      it(`${name}, ${locale}: page 2 (Al-Baqarah begins): Meanings left, the pill centred, Surah Preview right — the same physical order in both languages`, async () => {
        state.locale = locale;
        state.params = { page: '2' };
        // A short ورد name («Fajr ⌄», 70 pt). 320 × 520 pt: neither label fits beside it; both arrow-only, the pill
        // keeping ≥ MIN_PILL_WIDTH. Phones and tablets: both labelled, where they always were.
        await render(area, { pillWidth: 70 });
        const { m, p, pill } = expectRow(true);
        expect(labelsShown()).toEqual(name === 'narrow' ? ['arrow', 'arrow'] : ['label', 'label']);
        // The room the buttons leave the pill (its cap), never under MIN_PILL_WIDTH while Surah Preview is shown.
        expect(styleOf(hosts('mushaf-wird')[0]).maxWidth as number).toBeGreaterThanOrEqual(MIN_PILL_WIDTH);
        expect(m.left).toBeLessThan(pill.left);
        expect(p!.left).toBeGreaterThan(pill.left + pill.width);
      });
    }
  }

  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: a long ورد name keeps its own width up to where even arrow-only buttons need the room; the labels give way first`, async () => {
      state.locale = locale;
      twoWirds('long');
      await render({ width: 390, height: 797 }, { pillWidth: 0.72 * 390 });
      const cap = styleOf(hosts('mushaf-wird')[0]).maxWidth as number;
      const { approvedLeft } = geometry();
      // The cap is the arrow-only buttons' (not the labelled ones'): the name is shortened only that far.
      expect(cap).toBe(Math.floor(2 * (195 - (approvedLeft + ARROW_ONLY_WIDTH + PILL_CLEARANCE))));
      expect(cap).toBeLessThan(0.72 * 390);
      expect(textOf(hosts('mushaf-wird')[0])).toContain(LONG);
      expect(styleOf(hosts('mushaf-wird-row')[0])).toMatchObject({ alignItems: 'center', justifyContent: 'center' });
      expectRow(true);
      expect(labelsShown()).toEqual(['arrow', 'arrow']);
      // Still named for screen readers, and still opening their own windows.
      expect(control().props.accessibilityLabel).toBe(locale === 'en' ? 'Meanings' : 'المعاني');
      expect(hosts('surah-preview-open')[0].props.accessibilityLabel).toBe(locale === 'en' ? 'Surah Preview' : 'عن السورة');
      await openSheet();
      expect(sheetOpen()).toBe(true);
      await press(hosts('word-meanings-close')[0]);
      await press(hosts('surah-preview-open')[0]);
      expect(hosts('surah-preview-name')).toHaveLength(1);
    });
  }

  it('only the button that needs the room collapses (a pill reaching one side only)', async () => {
    twoWirds('short');
    await render({ width: 390, height: 797 }, { pillWidth: 70 });
    expect(labelsShown()).toEqual(['label', 'label']);
    // The pill a few points wider than Surah Preview's labelled room (English: the wider button), not Meanings'.
    const { approvedLeft } = geometry();
    const previewRoom = 2 * (195 - (approvedLeft + widthsFor().preview + PILL_CLEARANCE));
    const meaningsRoom = 2 * (195 - (approvedLeft + widthsFor().meanings + PILL_CLEARANCE));
    expect(previewRoom).toBeLessThan(meaningsRoom);
    await layoutPill(previewRoom + 4);
    expectRow(true);
    expect(labelsShown()).toEqual(['label', 'arrow']);
  });

  it('choosing a shorter ورد restores both labels at once; a longer one collapses them again (no navigation, no reload)', async () => {
    twoWirds('long');
    await render({ width: 390, height: 797 }, { pillWidth: 0.72 * 390 });
    expect(labelsShown()).toEqual(['arrow', 'arrow']);
    await press(hosts('mushaf-wird')[0]);
    await press(hosts('mushaf-wird-short')[0]);
    await layoutPill(70);
    expect(textOf(hosts('mushaf-wird')[0])).toContain(SHORT);
    expectRow(true);
    expect(labelsShown()).toEqual(['label', 'label']);
    await press(hosts('mushaf-wird')[0]);
    await press(hosts('mushaf-wird-long')[0]);
    await layoutPill(0.72 * 390);
    expectRow(true);
    expect(labelsShown()).toEqual(['arrow', 'arrow']);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('renaming the shown ورد long and back short (أورادي وختماتي) updates the buttons as soon as the pill is laid out again', async () => {
    const { renameReadingStop } = await import('@/mushaf/readingStops');
    twoWirds('short');
    await render({ width: 390, height: 797 }, { pillWidth: 70 });
    expect(labelsShown()).toEqual(['label', 'label']);
    await act(async () => { await renameReadingStop('short', 'A much longer name for the dawn reading'); });
    await flush();
    expect(textOf(hosts('mushaf-wird')[0])).toContain('A much longer name for the dawn reading');
    await layoutPill(0.72 * 390);
    expectRow(true);
    expect(labelsShown()).toEqual(['arrow', 'arrow']);
    await act(async () => { await renameReadingStop('short', SHORT); });
    await flush();
    await layoutPill(70);
    expectRow(true);
    expect(labelsShown()).toEqual(['label', 'label']);
  });

  it('no flicker: the same pill laid out again changes nothing; a layout from before the cap reached the pill is read at the cap', async () => {
    twoWirds('short');
    await render({ width: 390, height: 797 }, { pillWidth: 70 });
    const before = treeWithout(null);
    await layoutPill(70);
    await layoutPill(70);
    expect(treeWithout(null)).toBe(before);
    expect(labelsShown()).toEqual(['label', 'label']);
    await unmount();
    // A long name laid out wider than its cap (before the cap reached it): the buttons are placed as they will be once
    // the pill is laid out at the cap, so the next layout changes nothing; nothing is hidden on the way.
    twoWirds('long');
    await render({ width: 390, height: 797 }, { pillWidth: 0.72 * 390 });
    const settled = treeWithout(null);
    const rowHeight = styleOf(hosts('mushaf-wird-row')[0]).height as number;
    const wide = 0.72 * 390 + 20;
    await act(async () => hosts('mushaf-wird')[0].props.onLayout({ nativeEvent: { layout: { x: (rowWidth() - wide) / 2, y: (rowHeight - 26) / 2, width: wide, height: 26 } } }));
    await flush();
    expect(hidden(control())).toBe(false);
    expect(treeWithout(null)).toBe(settled);
    await layoutPill(0.72 * 390);
    expect(treeWithout(null)).toBe(settled);
  });

  it('Meanings is never hidden because Surah Preview cannot fit (320 × 520 pt, page 2)', async () => {
    state.params = { page: '2' };
    await render(AREAS.narrow);
    expect(hidden(control())).toBe(false);
    expect(box(control()).left).toBeCloseTo(geometry().approvedLeft, 9);
  });

  describe('page 604', () => {
    beforeEach(() => {
      state.params = { page: '604' };
      state.khatmDua = { title: 'دعاء ختم القرآن', paragraphs: ['…'] };
    });
    for (const [name, area] of Object.entries(AREAS)) {
      for (const locale of ['ar', 'en'] as const) {
        it(`${name}, ${locale}: إتمام الختمة and the du'a unchanged on the page number's line; the buttons on the pill's line beneath them`, async () => {
          state.locale = locale;
          await render(area);
          const { layout } = geometry();
          const band = styleOf(hosts('mushaf-604-links')[0]);
          const numberCentre = layout.pageNumber.y + layout.pageNumber.height / 2;
          expect(band.top + band.height / 2).toBeCloseTo(numberCentre, 6);
          expect([styleOf(hosts('mushaf-complete-khatma')[0]).left, styleOf(hosts('mushaf-khatm-dua')[0]).right]).toEqual([spacingMd, spacingMd]);
          const linkBottom = numberCentre + LINK_HEIGHT / 2;
          // Both buttons beneath إتمام الختمة and the du'a, ALWAYS arrow-only on page 604 (owner, 2026-10-24), still named
          // for screen readers, at their usual places (expectRow: approved x, mirrored inset, the pill's line, 44-pt targets).
          const m = box(control());
          expect(m.top - m.slop.top).toBeGreaterThanOrEqual(linkBottom - 1e-6);
          const { p, pill } = expectRow(true, true);
          expect(pill.width).toBeGreaterThanOrEqual(name === 'narrow' ? MIN_PILL_WIDTH : 0);
          expect(hosts('word-meanings-open')[0].props.accessibilityLabel).toBe(locale === 'en' ? 'Meanings' : 'المعاني');
          expect(hosts('surah-preview-open')[0].props.accessibilityLabel).toBe(locale === 'en' ? 'Surah Preview' : 'عن السورة');
          expect(p!.top - p!.slop.top).toBeGreaterThanOrEqual(linkBottom - 1e-6);
        });
      }
    }

    it('always arrow-only, whatever the ورد name (none, short, medium, long, the longest) and in both languages; page 2 stays adaptive', async () => {
      const forms: string[] = [];
      for (const locale of ['en', 'ar'] as const) {
        state.locale = locale;
        // 40 pt: no ورد ("+ Add …" truncated); 70: «Fajr ⌄»; 110: a medium name; 0.3 × row: the longest page 604 allows.
        for (const pillWidth of [40, 70, 110, 0.3 * 390]) {
          await render(AREAS.phone, { pillWidth });
          expectRow(true, true);
          forms.push(`${locale}/${Math.round(pillWidth)}: ${arrowOnly('word-meanings-open')}/${arrowOnly('surah-preview-open')}`);
          await unmount();
        }
      }
      expect(forms.every((f) => f.endsWith('true/true'))).toBe(true);
      // Page 2, same phone, a short name: both labelled (the adaptive rule, unchanged).
      state.locale = 'en';
      state.params = { page: '2' };
      await render(AREAS.phone, { pillWidth: 70 });
      expect([arrowOnly('word-meanings-open'), arrowOnly('surah-preview-open')]).toEqual([false, false]);
    });

    it('the arrow-only buttons open their sheets and close as before (chevron up while open, down after)', async () => {
      await render(AREAS.phone);
      expect(chevronTurn('word-meanings-open')).toBe(0);
      await openSheet();
      expect(sheetOpen()).toBe(true);
      expect(chevronTurn('word-meanings-open')).toBe(180);
      expect(textOf(hosts('word-meanings-subtitle')[0])).toBe('Page 604');
      await press(hosts('word-meanings-close')[0]);
      expect(sheetOpen()).toBe(false);
      expect(chevronTurn('word-meanings-open')).toBe(0);
      await press(hosts('surah-preview-open')[0]);
      expect(hosts('surah-preview-sheet')).toHaveLength(1);
      expect(chevronTurn('surah-preview-open')).toBe(180);
      await tapOutside('surah-preview');
      expect(hosts('surah-preview-sheet')).toHaveLength(0);
      expect(chevronTurn('surah-preview-open')).toBe(0);
      expect(arrowOnly('word-meanings-open') && arrowOnly('surah-preview-open')).toBe(true);
    });

    it('both links still work; the band and the buttons are never in full screen', async () => {
      await render(AREAS.phone);
      await press(hosts('mushaf-khatm-dua')[0]);
      expect(router.push).toHaveBeenCalledWith('/khatm-dua');
      await press(hosts('mushaf-complete-khatma')[0]);
      await flush();
      expect(hosts('mushaf-khatma-noWird')).toHaveLength(1);
      await act(async () => { root.root.findAllByProps({ testID: 'mushaf-khatma-noWird' })[0].props.onCancel?.(); });
      await toggleFullScreen();
      expect(hosts('mushaf-604-links')).toHaveLength(0);
      expect(featureNodes()).toHaveLength(0);
      expect(hosts('surah-preview-open')).toHaveLength(0);
    });
  });
});

describe('Surah Preview (عن السورة)', () => {
  const previewButton = () => hosts('surah-preview-open')[0];
  const previewOpen = () => hosts('surah-preview-sheet').length === 1;

  it('appears only on Normal Pages where a Surah begins, and never in full screen', async () => {
    for (const [page, shown] of [['1', true], ['2', true], ['61', false], ['125', false], ['591', true], ['604', true]] as const) {
      state.params = { page };
      await render();
      expect(hosts('surah-preview-open').length, `page ${page}`).toBe(shown ? 1 : 0);
      await toggleFullScreen();
      expect(hosts('surah-preview-open'), `page ${page}, full screen`).toHaveLength(0);
      await unmount();
    }
  });

  it("opens the Surah's introduction (name, Makki/Madani, ayah count, main purpose; its source is on Sources, not here), its chevron up while open", async () => {
    state.params = { page: '2' };
    await render();
    expect(chevronTurn('surah-preview-open')).toBe(0);
    await press(previewButton());
    expect(previewOpen()).toBe(true);
    expect(chevronTurn('surah-preview-open')).toBe(180);
    expect(textOf(hosts('surah-preview-name')[0])).toBe(getSurahName(2).nameEnglish);
    // The approved order: name, facts (Makki/Madani | ayahs | Surah number), purpose, then «موضوعاتها».
    expect(textOf(hosts('surah-preview-facts')[0])).toBe('Madani  |  11 ayahs  |  Surah 2');
    expect(textOf(hosts('surah-preview-purpose')[0])).toBe('مقصد تجريبي 2');
    // No themes this app may use (synthetic entry: status unavailable): the section says so, never a filler.
    expect(hosts('surah-preview-themes')).toHaveLength(0);
    expect(textOf(hosts('surah-preview-themes-unavailable')[0])).toBe('Not available yet.');
    // Section headings: Main Purpose unchanged; the themes heading is «Topics» (never the former «Main Themes»).
    expect(allText()).toEqual(expect.arrayContaining(['Main Purpose', 'Topics']));
    expect(allText()).not.toContain('Main Themes');
    const order = ['surah-preview-name', 'surah-preview-facts', 'surah-preview-purpose', 'surah-preview-themes-unavailable'];
    expect(root.root.findAll((n) => typeof n.type === 'string' && order.includes(String(n.props.testID))).map((n) => n.props.testID)).toEqual(order);
    expect(hosts('surah-preview-arabic-only')).toHaveLength(1);
    expect(hosts('surah-preview-source')).toHaveLength(0);
    expect(allText().some((text) => /Tafsir Center|QuranEnc|Tanzil/.test(text))).toBe(false);
    // Only the X button or a tap outside closes it: a swipe down does not.
    await swipeOutside('surah-preview', 120);
    expect(previewOpen()).toBe(true);
    await act(async () => { root.root.findAllByType('Modal' as never).find((m) => m.findAllByProps({ testID: 'surah-preview-sheet' }).length > 0)!.props.onRequestClose(); });
    expect(previewOpen()).toBe(false);
    expect(chevronTurn('surah-preview-open')).toBe(0);
    await press(previewButton());
    await press(hosts('surah-preview-close')[0]);
    expect(previewOpen()).toBe(false);
    await press(previewButton());
    await tapOutside('surah-preview');
    expect(previewOpen()).toBe(false);
    expect(chevronTurn('surah-preview-open')).toBe(0);
  });

  it('several Surahs on the page (604): a choice of them, the first shown', async () => {
    state.params = { page: '604' };
    await render();
    await press(previewButton());
    expect(['112', '113', '114'].map((n) => hosts(`surah-preview-choose-${n}`).length)).toEqual([1, 1, 1]);
    expect(textOf(hosts('surah-preview-purpose')[0])).toBe('مقصد تجريبي 112');
    await press(hosts('surah-preview-choose-114')[0]);
    expect(textOf(hosts('surah-preview-purpose')[0])).toBe('مقصد تجريبي 114');
  });

  it('only one sheet at a time: opening Surah Preview closes Meanings and the reverse; the page never changes', async () => {
    state.params = { page: '2' };
    await render();
    await openSheet();
    expect(sheetOpen()).toBe(true);
    // A modal is open: the buttons underneath are not reachable on a device; pressing through the toggle still keeps one.
    await press(previewButton());
    expect(previewOpen()).toBe(true);
    expect(sheetOpen()).toBe(false);
    await openSheet();
    expect(sheetOpen()).toBe(true);
    expect(previewOpen()).toBe(false);
    expect(currentPage()).toBe(2);
  });

  it('switching to full screen closes it; back in Normal Mode it stays closed', async () => {
    state.params = { page: '2' };
    await render();
    await press(previewButton());
    await toggleFullScreen();
    expect(previewOpen()).toBe(false);
    await toggleFullScreen();
    expect(previewOpen()).toBe(false);
    expect(hosts('surah-preview-open')).toHaveLength(1);
  });

  it('Arabic: «عن السورة», مدنية, Arabic-Indic numbers; the data is read only when first opened', async () => {
    state.locale = 'ar';
    state.params = { page: '2' };
    await render();
    expect(sp.loads).toBe(0);
    expect(textOf(previewButton())).toBe('عن السورة');
    await press(previewButton());
    expect(sp.loads).toBe(1);
    expect(textOf(hosts('surah-preview-facts')[0])).toBe('مدنية  |  ١١ آية  |  السورة ٢');
    expect(textOf(hosts('surah-preview-themes-unavailable')[0])).toBe('غير متاحة بعد.');
    expect(allText()).toEqual(expect.arrayContaining(['مقصد السورة', 'موضوعاتها']));
    expect(allText()).not.toContain('أبرز موضوعاتها');
    expect(hosts('surah-preview-arabic-only')).toHaveLength(0);
  });

  it('not bundled (a release build): no button, nothing loaded', async () => {
    sp.bundled = false;
    state.params = { page: '2' };
    await render();
    expect(hosts('surah-preview-open')).toHaveLength(0);
    expect(sp.loads).toBe(0);
  });
});

describe('Settings → Word Meanings (the switch that shows or hides the control)', () => {
  /** The switch as Settings sees it (the app's own provider around the reader). */
  let setting: ReturnType<typeof useWordMeaningsVisibility>;
  function Probe() {
    setting = useWordMeaningsVisibility();
    return null;
  }
  const withSetting = () => createElement(WordMeaningsVisibilityProvider, null, createElement(Probe), createElement(MushafScreen));
  async function setVisible(visible: boolean) {
    await act(async () => setting.setVisible(visible));
    await flush();
  }

  it('ON for anyone who has never chosen: the control is shown and opens the sheet as before; nothing is saved', async () => {
    await render(undefined, {}, withSetting());
    expect(setting.visible).toBe(true);
    expect(hosts('word-meanings-open')).toHaveLength(1);
    expect(controlHidden()).toBe(false);
    await openSheet();
    expect(sheetOpen()).toBe(true);
    expect(state.storage.has(WORD_MEANINGS_VISIBLE_STORAGE_KEY)).toBe(false);
  });

  for (const page of ['61', '2']) {
    it(`OFF (saved): page ${page} is drawn exactly as in a build without the feature: no control, touch target or space; Surah Preview as it is`, async () => {
      state.params = { page };
      wm.enabled = false;
      await render(undefined, 'unmeasured');
      await measure();
      const withoutTree = treeWithout(null);
      const withoutGestures = gestureSettings();
      await unmount();
      wm.enabled = true;
      state.storage.set(WORD_MEANINGS_VISIBLE_STORAGE_KEY, 'false');
      await render(undefined, 'unmeasured', withSetting());
      await measure();
      expect(setting.visible).toBe(false);
      expect(featureNodes()).toHaveLength(0);
      expect(treeWithout(null)).toBe(withoutTree);
      expect(gestureSettings()).toBe(withoutGestures);
      expect(wm.loads).toBe(0);
      if (page === '2') {
        expect(hosts('surah-preview-open')).toHaveLength(1);
        await press(hosts('surah-preview-open')[0]);
        expect(hosts('surah-preview-name')).toHaveLength(1);
      }
    });
  }

  it('applies at once: OFF removes the control, ON brings it back (working); the choice is saved each time', async () => {
    await render(undefined, {}, withSetting());
    expect(hosts('word-meanings-open')).toHaveLength(1);
    await setVisible(false);
    expect(featureNodes()).toHaveLength(0);
    expect(state.storage.get(WORD_MEANINGS_VISIBLE_STORAGE_KEY)).toBe('false');
    await setVisible(true);
    await measure();
    expect(hosts('word-meanings-open')).toHaveLength(1);
    expect(controlHidden()).toBe(false);
    expect(state.storage.get(WORD_MEANINGS_VISIBLE_STORAGE_KEY)).toBe('true');
    await openSheet();
    expect(sheetOpen()).toBe(true);
    expect(textOf(hosts('word-meanings-subtitle')[0])).toBe('Page 61');
  });

  it('kept after a restart: OFF stays OFF when the app starts again (and ON stays ON)', async () => {
    await render(undefined, {}, withSetting());
    await setVisible(false);
    await unmount();
    await render(undefined, {}, withSetting());
    expect(setting.visible).toBe(false);
    expect(featureNodes()).toHaveLength(0);
    await setVisible(true);
    await unmount();
    await render(undefined, {}, withSetting());
    expect(setting.visible).toBe(true);
    expect(hosts('word-meanings-open')).toHaveLength(1);
  });

  it('a corrupt stored value means the default, ON', async () => {
    state.storage.set(WORD_MEANINGS_VISIBLE_STORAGE_KEY, 'maybe');
    await render(undefined, {}, withSetting());
    expect(setting.visible).toBe(true);
    expect(hosts('word-meanings-open')).toHaveLength(1);
  });
});
