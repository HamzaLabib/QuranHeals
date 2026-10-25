import { createElement, type ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@/localization/messages';

/**
 * Memorization Mode (وضع الحفظ) in the real /mushaf reader: the Eye beside the page number (Settings → Quran →
 * Memorization Mode), hiding and revealing ayahs, Show All / Hide All, the peek, page turns, leaving it, the setting
 * turned OFF, and the Memorization Mode Guide — and nothing else changing. The harness is wordMeaningsReader.test.ts's
 * own (itself mushafScreen.test.ts's: the same mocked native modules, the real verified Quran database, SYNTHETIC QPC
 * V1 layouts and SYNTHETIC Word Meanings / Surah Preview data), with the feature's build switch mocked (`mm`).
 */
const mm = vi.hoisted(() => ({ available: true }));
vi.mock('@/memorization/config', () => ({ isMemorizationModeAvailable: () => mm.available }));

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
  BookOpenText: 'BookOpenText', AudioLines: 'AudioLines', Eye: 'Eye', EyeOff: 'EyeOff', ChevronUp: 'ChevronUp', CircleAlert: 'CircleAlert', Headphones: 'Headphones', LocateFixed: 'LocateFixed', Pause: 'Pause', Play: 'Play', SkipBack: 'SkipBack', SkipForward: 'SkipForward',
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
  mm.available = true;
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


const { MemorizationModeSettingProvider, useMemorizationModeSetting } = await import('@/memorization/useMemorizationModeSetting');
const { MEMORIZATION_MODE_VISIBLE_STORAGE_KEY } = await import('@/memorization/memorizationModePreference');
const { MUSHAF_WIRD_MARKER } = await import('@/mushaf/appearance');
const GUIDE_KEY = 'quran-heals:mushaf-guide:v1';
const MEASURE_WIDTH = 900;

/** The Settings switch, as the app shares it (Settings sets it; the reader reads it). */
let setSetting: (visible: boolean) => void = () => undefined;
function SettingProbe() {
  setSetting = useMemorizationModeSetting().setVisible;
  return null;
}
const withSetting = () => createElement(MemorizationModeSettingProvider, null, createElement(SettingProbe), createElement(MushafScreen));
async function renderWith(visible: boolean | null, area = { width: 390, height: 797 }) {
  if (visible !== null) state.storage.set(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY, String(visible));
  await render(area, {}, withSetting());
  await drawLines();
}
const rowOf = (line: number) => inPage().find((n) => n.props.testID === `qpc-line-${line}` && typeof n.type === 'string');
const wordViews = (row: ReactTestInstance) => (row.children as ReactTestInstance[]).filter((c) => typeof c !== 'string' && typeof c.props.onLayout === 'function');
/** The page being read as a device lays it out: the measuring pass, then each word's box (right to left, 30 pt apart). */
async function drawLines() {
  const layout = syntheticQpcPage61();
  await act(async () => {
    for (const line of layout.lines) inPage().findAll((n) => n.props.testID === `qpc-measure-${line.line}` && typeof n.type === 'string').forEach((n) => n.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: line.line === 1 ? MEASURE_WIDTH : 800, height: 100 } } }));
  });
  await act(async () => {
    for (const line of layout.lines) wordViews(rowOf(line.line)).forEach((view, index) => view.props.onLayout({ nativeEvent: { layout: { x: 400 - index * 30, y: 0, width: 20, height: 30 } } }));
  });
}
const page61 = syntheticQpcPage61();
/** Whether a word of the page being read is drawn (iOS: its own Text's colour; a number: its medallion, over its unpainted glyph). */
const painted = (line: number, index: number) => {
  const view = wordViews(rowOf(line))[index];
  return view.findAll((n) => n.props.marker !== undefined && n.props.box !== undefined).length > 0
    || flat(view.findAllByType('Text' as never)[0].props.style).color !== 'transparent';
};
/** Every word and number of the page being read: [verseKey, kind, painted]. */
const paintState = () => page61.lines.flatMap((line) => line.words.map((word, index) => [word.verseKey, word.kind, painted(line.line, index)] as const));
const hiddenAyahs = () => [...new Set(paintState().filter(([, kind, shown]) => kind === 'word' && !shown).map(([key]) => key))];
async function tapWord(line: number, index: number, long = false) {
  const row = rowOf(line);
  const event = { nativeEvent: { locationX: 400 - index * 30 + 10, locationY: (flat(row.props.style).height as number) / 2 } };
  await act(async () => {
    if (long) row.props.onLongPress(event);
    else row.props.onPress(event);
  });
}
const waitPastDoubleTap = () => act(async () => { await new Promise((done) => setTimeout(done, 420)); });
const eye = () => hosts('memorization-eye')[0];
/** The top bar's right-hand icons in screen order (the Help icon shows: the harness's guide is seen, not finished). */
const BAR = ['mushaf-play-page', 'mushaf-guide-open', 'memorization-eye', 'mushaf-fullscreen-toggle'];
const barOrder = () => hosts('mushaf-back-bar')[0]
  .findAll((n) => typeof n.type === 'string' && ['memorization-eye', 'mushaf-play-page', 'mushaf-guide-open', 'mushaf-fullscreen-toggle'].includes(String(n.props.testID)))
  .map((n) => n.props.testID as string);
const eyeStyle = () => styleOf(eye());
const wordOf = (verseKey: string, kind: 'word' | 'end') => {
  for (const line of page61.lines) {
    const index = line.words.findIndex((w) => w.verseKey === verseKey && w.kind === kind);
    if (index >= 0) return [line.line, index] as const;
  }
  throw new Error(verseKey);
};
/** The page number's touch area and the page's left edge, as drawn. */
const numberBox = () => {
  const paper = styleOf(inPage().findByProps({ testID: 'mushaf-paper' }));
  const nav = styleOf(inPage().findByProps({ testID: 'mushaf-nav-page' }));
  return { pageLeft: (lastArea.width - (paper.width as number)) / 2, nav };
};

describe('Memorization Mode: the Settings switch decides whether the Eye is offered', () => {
  it('OFF (the default, nothing saved): no Eye, no Show All / Hide All, every ayah drawn — the reader exactly as in a build without the feature', async () => {
    await renderWith(null);
    expect(hosts('memorization-eye')).toHaveLength(0);
    expect(hosts('memorization-all')).toHaveLength(0);
    expect(paintState().every(([, , shown]) => shown)).toBe(true);
    const offTree = treeWithout(null);
    await unmount();
    mm.available = false;
    await renderWith(null);
    expect(treeWithout(null)).toBe(offTree);
  });

  it('ON: the outline Eye in the top bar, right beside Expand / Collapse, in the bar\'s own 44-pt icon box; everything else unchanged until it is tapped', async () => {
    await renderWith(false);
    const before = treeWithout('memorization');
    await unmount();
    await renderWith(true);
    expect(hosts('memorization-eye')).toHaveLength(1);
    expect(eye().props).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: 'Enter Memorization Mode', accessibilityState: { selected: false } });
    expect(eye().findAllByType('Eye' as never)).toHaveLength(1);
    expect(eye().findAllByType('EyeOff' as never)).toHaveLength(0);
    // Nothing else in the reader is different (the Eye's own nodes aside).
    expect(treeWithout('memorization')).toBe(before);
    expect(barOrder()).toEqual(BAR);
    expect(inPage().findAll((n) => n.props.testID === 'memorization-eye')).toHaveLength(0);
    expect(eyeStyle()).toEqual(styleOf(hosts('mushaf-play-page')[0]));
    expect(eye().props.hitSlop).toEqual(hosts('mushaf-play-page')[0].props.hitSlop);
  });

  it('the same place on every page: 61, 62, 77 (a Surah opening), 604 (its links), 1 and 2 (the openings)', async () => {
    const places: string[] = [];
    for (const page of ['61', '62', '77', '604', '1', '2']) {
      state.params = { page };
      state.khatmDua = page === '604' ? { title: 'دعاء', paragraphs: ['نص'] } : null;
      await renderWith(true);
      expect(barOrder(), page).toEqual(BAR);
      places.push(JSON.stringify({ style: eyeStyle(), slop: eye().props.hitSlop, parent: eye().parent?.parent?.props.style }));
      await unmount();
    }
    expect(new Set(places).size).toBe(1);
  });
});

describe('Memorization Mode: hiding and revealing (Option A)', () => {
  it('the Eye hides every ayah\'s words at once; numbers stay; the Eye turns gold, crossed out; Show All / Hide All appear', async () => {
    await renderWith(true);
    await press(eye());
    expect(paintState().filter(([, kind]) => kind === 'word').every(([, , shown]) => !shown)).toBe(true);
    expect(paintState().filter(([, kind]) => kind === 'end').every(([, , shown]) => shown)).toBe(true);
    expect(eye().props).toMatchObject({ accessibilityLabel: 'Exit Memorization Mode', accessibilityState: { selected: true } });
    const off = eye().findAllByType('EyeOff' as never);
    expect(off).toHaveLength(1);
    expect(off[0].props.color).toBe(MUSHAF_WIRD_MARKER.warm.glyph);
    expect(hosts('memorization-show-all')).toHaveLength(1);
    expect(hosts('memorization-hide-all')).toHaveLength(1);
    expect(currentPage()).toBe(61);
  });

  it('a tap on a hidden ayah shows only it; again hides it; several stay shown; no popup, no highlight, no audio, no ورد change', async () => {
    await renderWith(true);
    const stops = state.storage.get(READING_STOPS_STORAGE_KEY);
    const active = state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY);
    await press(eye());
    await tapWord(...wordOf('3:86', 'word'));
    expect(hiddenAyahs()).toEqual(['3:84', '3:85', '3:87', '3:88', '3:89', '3:90', '3:91']);
    // Every word of 3:86, on every line it spans.
    expect(paintState().filter(([key, kind]) => key === '3:86' && kind === 'word').every(([, , shown]) => shown)).toBe(true);
    await tapWord(...wordOf('3:89', 'word'));
    expect(hiddenAyahs()).toEqual(['3:84', '3:85', '3:87', '3:88', '3:90', '3:91']);
    // An ayah's number toggles it too (no Apply-to-ورد popup).
    await tapWord(...wordOf('3:86', 'end'));
    expect(hiddenAyahs()).toEqual(['3:84', '3:85', '3:86', '3:87', '3:88', '3:90', '3:91']);
    await waitPastDoubleTap();
    expect(hosts('mushaf-ayah-actions')).toHaveLength(0);
    expect(hosts('mushaf-wird-apply')).toHaveLength(0);
    expect(root.root.findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('qpc-highlight-'))).toHaveLength(0);
    expect(audio.loads).toEqual([]);
    expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(stops);
    expect(state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)).toBe(active);
  });

  it('Show All shows the whole page; Hide All hides it all again', async () => {
    await renderWith(true);
    await press(eye());
    await press(hosts('memorization-show-all')[0]);
    expect(hiddenAyahs()).toEqual([]);
    await press(hosts('memorization-hide-all')[0]);
    expect(hiddenAyahs()).toEqual(page61.verseKeys);
  });

  it('a touch held on a hidden ayah shows it until released, then it is hidden again (never revealed)', async () => {
    await renderWith(true);
    await press(eye());
    const [line, index] = wordOf('3:87', 'word');
    await tapWord(line, index, true);
    expect(hiddenAyahs()).toEqual(page61.verseKeys.filter((key) => key !== '3:87'));
    await act(async () => rowOf(line).props.onPressOut());
    expect(hiddenAyahs()).toEqual(page61.verseKeys);
  });

  it('another page keeps Memorization Mode on, starting hidden; coming back starts hidden again', async () => {
    await renderWith(true);
    await press(eye());
    await press(hosts('memorization-show-all')[0]);
    await turnPage(1);
    await drawLines();
    expect(currentPage()).toBe(62);
    expect(eye().props.accessibilityLabel).toBe('Exit Memorization Mode');
    expect(hiddenAyahs()).toEqual(page61.verseKeys);
    await turnPage(-1);
    await drawLines();
    expect(currentPage()).toBe(61);
    expect(hiddenAyahs()).toEqual(page61.verseKeys);
  });

  it('the gold Eye leaves it: every ayah drawn again, the same page, the ورد untouched, and a tap opens the ayah\'s popup again', async () => {
    await renderWith(true);
    const stops = state.storage.get(READING_STOPS_STORAGE_KEY);
    await press(eye());
    await tapWord(...wordOf('3:85', 'word'));
    await press(eye());
    expect(paintState().every(([, , shown]) => shown)).toBe(true);
    expect(eye().props.accessibilityLabel).toBe('Enter Memorization Mode');
    expect(hosts('memorization-all')).toHaveLength(0);
    expect(currentPage()).toBe(61);
    await tapWord(...wordOf('3:85', 'word'));
    await waitPastDoubleTap();
    expect(hosts('mushaf-ayah-actions')).toHaveLength(1);
    expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(stops);
  });

  it('turning the setting OFF while on leaves Memorization Mode at once: every ayah drawn, no Eye, the same page; ON again starts normal', async () => {
    await renderWith(true);
    await press(eye());
    await act(async () => setSetting(false));
    await flush();
    expect(hosts('memorization-eye')).toHaveLength(0);
    expect(paintState().every(([, , shown]) => shown)).toBe(true);
    expect(currentPage()).toBe(61);
    expect(state.storage.get(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY)).toBe('false');
    await act(async () => setSetting(true));
    await flush();
    expect(eye().props.accessibilityLabel).toBe('Enter Memorization Mode');
    expect(paintState().every(([, , shown]) => shown)).toBe(true);
  });

  it('full screen: the Eye stays in the top bar, in the same box, and leaves Memorization Mode there too', async () => {
    await renderWith(true);
    const normal = eyeStyle();
    await press(eye());
    await toggleFullScreen();
    await drawLines();
    expect(hosts('memorization-eye')).toHaveLength(1);
    expect(hiddenAyahs()).toEqual(page61.verseKeys);
    // Full screen has no Help icon (as before); the Eye keeps its place first in the row, in the same box.
    expect(barOrder()).toEqual(['mushaf-play-page', 'memorization-eye', 'mushaf-fullscreen-toggle']);
    expect(eyeStyle()).toEqual(normal);
    await press(eye());
    expect(paintState().every(([, , shown]) => shown)).toBe(true);
  });

  it('zoomed in: the Eye stays in the top bar and usable (as the bar\'s other icons); Show All / Hide All beside the page number are unseen', async () => {
    await renderWith(true);
    await press(eye());
    await pinch(2);
    expect(eye().props.disabled).toBe(false);
    expect(eyeStyle().opacity).not.toBe(0);
    expect(hosts('memorization-all')[0].props.pointerEvents).toBe('none');
    await press(eye());
    expect(eye().props.accessibilityLabel).toBe('Enter Memorization Mode');
  });

  it('while a recitation plays: the Eye stays in the bar beside the chip (the headphones give way to the chip as before); held, it opens Show All / Hide All; the recitation is untouched', async () => {
    await renderWith(true);
    await press(eye());
    await press(hosts('mushaf-play-page')[0]);
    await act(async () => { for (const listener of audio.listeners) listener({ positionMs: 5000, playing: true, buffering: false, loaded: true, finished: false, error: null }); });
    await flush();
    const loads = [...audio.loads];
    expect(hosts('mushaf-play-page')).toHaveLength(0);
    expect(barOrder()).toEqual(['mushaf-guide-open', 'memorization-eye', 'mushaf-fullscreen-toggle']);
    await act(async () => { eye().props.onLongPress({ nativeEvent: { pageX: 300, pageY: 60 } }); });
    expect(hosts('memorization-menu')).toHaveLength(1);
    await press(hosts('memorization-menu-show-all')[0]);
    expect(hiddenAyahs()).toEqual([]);
    expect(eye().props.accessibilityLabel).toBe('Exit Memorization Mode');
    expect(audio.loads).toEqual(loads);
  });

  it('Arabic: «الدخول إلى وضع الحفظ» / «الخروج من وضع الحفظ», «إظهار الكل» and «إخفاء الكل»', async () => {
    state.locale = 'ar';
    await renderWith(true);
    expect(eye().props.accessibilityLabel).toBe('الدخول إلى وضع الحفظ');
    await press(eye());
    expect(eye().props.accessibilityLabel).toBe('الخروج من وضع الحفظ');
    expect(hosts('memorization-show-all')[0].props.accessibilityLabel).toBe('إظهار الكل');
    expect(hosts('memorization-hide-all')[0].props.accessibilityLabel).toBe('إخفاء الكل');
  });
});

describe('Memorization Mode: page 604 shares the page number\'s line with its links', () => {
  it('the Eye is in the top bar as on every page; Show All / Hide All wait for both links\' measured boxes, then never meet their touch targets (on the line, or in the top bar)', async () => {
    state.params = { page: '604' };
    state.khatmDua = { title: 'دعاء', paragraphs: ['نص'] };
    await renderWith(true);
    expect(barOrder()).toEqual(BAR);
    await press(eye());
    // إتمام الختمة is measured by the harness; the du'a not yet: Show All / Hide All are not placed until it is.
    expect(hosts('memorization-all')).toHaveLength(0);
    const duaLayout = { x: 390 - 14 - 110, y: 28 - LINK_HEIGHT / 2, width: 110, height: LINK_HEIGHT };
    await act(async () => hosts('mushaf-khatm-dua')[0].props.onLayout({ nativeEvent: { layout: duaLayout } }));
    await flush();
    expect(hosts('memorization-all').length).toBeGreaterThan(0);
    const all = hosts('memorization-all')[0];
    const s = styleOf(all);
    const band = styleOf(hosts('mushaf-604-links')[0]);
    if (s.position === 'absolute' && s.left !== 0) {
      const slop = all.findAll((n) => n.props.testID === 'memorization-show-all')[0].props.hitSlop.top;
      const box = { left: s.left as number, right: (s.left as number) + (s.width as number), top: (s.top as number) - slop, bottom: (s.top as number) + (s.height as number) };
      for (const [id, x, width] of [['mushaf-complete-khatma', 16, 72], ['mushaf-khatm-dua', duaLayout.x, duaLayout.width]] as const) {
        const link = hosts(id)[0];
        const linkBox = { left: x - 8, right: x + width + 8, top: (band.top as number) + 28 - LINK_HEIGHT / 2 - link.props.hitSlop.top, bottom: (band.top as number) + 28 + LINK_HEIGHT / 2 };
        const meets = box.left < linkBox.right && linkBox.left < box.right && box.top < linkBox.bottom && linkBox.top < box.bottom;
        expect(meets, id).toBe(false);
      }
    }
  });
});

describe('The Memorization Mode Guide (Settings → Quran → Mushaf Guide → Memorization Mode Guide)', () => {
  const guideText = () => textOf(hosts('memorization-guide-text')[0]);
  const settle = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 120)); }); };
  /** As render(), with every control measurable where it is drawn (as on a device), so the guides find their targets. */
  async function render(area = { width: 390, height: 797 }) {
    lastArea = area;
    await act(async () => {
      root = create(withSetting(), {
        createNodeMock: () => ({ measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(100, 600, 44, 30) }),
      });
    });
    await flush();
    await act(async () => root.root.findByProps({ testID: 'mushaf-page-area' }).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, ...area } } }));
    await flush();
    await flush();
    await drawLines();
    await settle();
  }

  it('seven steps from step 1 in the Mushaf guide\'s own overlay ("N of 7"); Next / Back / Done; nothing saved, no setting changed, Memorization Mode never entered', async () => {
    state.storage.set(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY, 'false');
    const guideBefore = state.storage.get(GUIDE_KEY);
    state.params = { page: '61', memorizationGuide: '1' };
    await render();
    expect(hosts('memorization-guide')).toHaveLength(1);
    expect(hosts('mushaf-guide')).toHaveLength(0);
    const counter = () => textOf(hosts('memorization-guide-card')[0]).split(' | ')[0];
    expect(counter()).toBe('1 of 7');
    expect(guideText()).toBe('Turn on Memorization Mode in Settings → Quran → Memorization Mode.');
    expect(hosts('memorization-guide-setting')).toHaveLength(1);
    expect(hosts('memorization-guide-back')).toHaveLength(0);
    const texts: string[] = [guideText()];
    const notes: (string | null)[] = [null];
    for (let step = 1; step < 7; step += 1) {
      await press(hosts('memorization-guide-next')[0]);
      expect(counter()).toBe(`${step + 1} of 7`);
      texts.push(guideText());
      notes.push(hosts('memorization-guide-note').length ? textOf(hosts('memorization-guide-note')[0]) : null);
      expect(hosts('memorization-guide-back')).toHaveLength(1);
      // Step 3 keeps its picture; no other step has one.
      expect(hosts('memorization-guide-eye-change')).toHaveLength(step === 2 ? 1 : 0);
    }
    expect(texts.slice(1)).toEqual([
      "An Eye button then appears in the Mushaf's top bar.",
      'Tap the Eye to hide all ayah text on the page.',
      "Tap an ayah's position to reveal it, then tap it again to hide it. You can reveal multiple ayahs at once.",
      'Press and hold an ayah to reveal it temporarily, until you lift your finger.',
      "Swipe to another page. Memorization Mode stays active, and the new page's ayahs remain hidden. Tap the gold Eye to exit Memorization Mode and reveal the full page.",
      'Show All and Hide All appear beside the page number while Memorization Mode is active. You can also long-press the gold Eye to access them.',
    ]);
    // The setting is OFF: no Eye — where it appears; Show All / Hide All only while on.
    const EYE_NOTE = 'The Eye appears in the top bar once Memorization Mode is turned on in Settings.';
    expect(notes).toEqual([null, EYE_NOTE, EYE_NOTE, null, null, EYE_NOTE, 'Shown only while Memorization Mode is on.']);
    // Done (not Next) on step 7, with where the guide is opened again.
    expect(hosts('memorization-guide-next')).toHaveLength(0);
    expect(textOf(hosts('memorization-guide-start')[0])).toBe('Done');
    expect(hosts('memorization-guide-reopen-hint')).toHaveLength(1);
    await press(hosts('memorization-guide-back')[0]);
    expect(counter()).toBe('6 of 7');
    expect(guideText()).toMatch(/^Swipe to another page/);
    await press(hosts('memorization-guide-next')[0]);
    await press(hosts('memorization-guide-start')[0]);
    expect(hosts('memorization-guide')).toHaveLength(0);
    expect(state.storage.get(GUIDE_KEY)).toBe(guideBefore);
    expect(state.storage.get(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY)).toBe('false');
    expect(hosts('memorization-eye')).toHaveLength(0);
    expect(paintState().every(([, , shown]) => shown)).toBe(true);
  });

  it('Arabic: "N من 7", the approved texts, right to left', async () => {
    state.locale = 'ar';
    state.storage.set(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY, 'true');
    state.params = { page: '61', memorizationGuide: '2' };
    await render();
    const counter = () => textOf(hosts('memorization-guide-card')[0]).split(' | ')[0];
    const texts: string[] = [];
    for (let step = 0; step < 7; step += 1) {
      expect(counter()).toBe(`${step + 1} من 7`);
      texts.push(guideText());
      expect(flat(hosts('memorization-guide-text')[0].props.style)).toMatchObject({ writingDirection: 'rtl', textAlign: 'right' });
      if (step < 6) await press(hosts('memorization-guide-next')[0]);
    }
    expect(texts.slice(2)).toEqual([
      'اضغط على العين لإخفاء نص جميع آيات الصفحة.',
      'اضغط على موضع الآية لإظهارها، واضغط عليها مرة أخرى لإخفائها. يمكنك إظهار عدة آيات معًا.',
      'اضغط مطولًا على آية لتراها فقط حتى ترفع إصبعك.',
      'اسحب إلى صفحة أخرى، وسيبقى وضع الحفظ مفعّلًا وتكون آيات الصفحة الجديدة مخفية. اضغط على العين الذهبية للخروج من وضع الحفظ وإظهار الصفحة كاملة.',
      'يظهر «إظهار الكل» و«إخفاء الكل» بجانب رقم الصفحة ما دام وضع الحفظ مفعّلًا. ويمكنك أيضًا الضغط مطولًا على العين الذهبية لإظهارهما.',
    ]);
    expect(textOf(hosts('memorization-guide-start')[0])).toBe('تم');
  });

  it('step 7 on a layout with no room beside the page number (a 320 × 480 reading area: the page under 265 pt wide): "in the top bar", pointing at the Eye — never "beside the page number"', async () => {
    state.storage.set(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY, 'true');
    state.params = { page: '61', memorizationGuide: '3' };
    await render({ width: 320, height: 480 });
    // Show All / Hide All measured off screen at their natural width (only while the guide is open, Memorization Mode off).
    const measure = hosts('memorization-all-measure');
    expect(measure).toHaveLength(1);
    await act(async () => measure[0].props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 118, height: 18 } } }));
    await flush();
    for (let step = 0; step < 6; step += 1) await press(hosts('memorization-guide-next')[0]);
    expect(guideText()).toBe('Show All and Hide All appear in the top bar while Memorization Mode is active. You can also long-press the gold Eye to access them.');
  });

  it('step 7 on a phone with room beside the page number (390 pt): "beside the page number"', async () => {
    state.storage.set(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY, 'true');
    state.params = { page: '61', memorizationGuide: '4' };
    await render({ width: 390, height: 797 });
    await act(async () => hosts('memorization-all-measure')[0].props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 118, height: 18 } } }));
    await flush();
    for (let step = 0; step < 6; step += 1) await press(hosts('memorization-guide-next')[0]);
    expect(guideText()).toBe('Show All and Hide All appear beside the page number while Memorization Mode is active. You can also long-press the gold Eye to access them.');
    await press(hosts('memorization-guide-start')[0]);
    // Closed: no measuring copy left (Memorization Mode off and no guide: the reader as before).
    expect(hosts('memorization-all-measure')).toHaveLength(0);
  });

  it('with the setting ON it points at the real Eye (no note); Close ends it at any step', async () => {
    state.params = { page: '61', memorizationGuide: '2' };
    state.storage.set(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY, 'true');
    await render();
    await press(hosts('memorization-guide-next')[0]);
    expect(hosts('memorization-guide-note')).toHaveLength(0);
    expect(eye().props.accessibilityLabel).toBe('Enter Memorization Mode');
    await press(hosts('memorization-guide-close')[0]);
    expect(hosts('memorization-guide')).toHaveLength(0);
    expect(paintState().every(([, , shown]) => shown)).toBe(true);
  });

  it('the first-time Mushaf guide is unchanged: it still opens by itself for a new reader — after the Memorization Mode Guide, never over it', async () => {
    state.storage.delete(GUIDE_KEY);
    state.params = { page: '61', memorizationGuide: '3' };
    await render();
    expect(hosts('memorization-guide')).toHaveLength(1);
    expect(hosts('mushaf-guide')).toHaveLength(0);
    await press(hosts('memorization-guide-close')[0]);
    await flush();
    expect(hosts('mushaf-guide')).toHaveLength(1);
    // Seeing the Memorization Mode Guide recorded nothing about the Mushaf guide.
    expect(state.storage.has(GUIDE_KEY)).toBe(false);
  });

  it('a build without Memorization Mode ignores the request', async () => {
    mm.available = false;
    state.params = { page: '61', memorizationGuide: '4' };
    await render();
    expect(hosts('memorization-guide')).toHaveLength(0);
  });
});

describe('Memorization Mode: the gold Eye held — Show All / Hide All', () => {
  const menu = () => hosts('memorization-menu');
  const holdEye = (at: { pageX?: number; pageY?: number } = { pageX: 300, pageY: 700 }) => act(async () => { eye().props.onLongPress({ nativeEvent: at }); });

  it('off: no long press and no screen-reader actions on the outline Eye (as before)', async () => {
    await renderWith(true);
    expect(eye().props.onLongPress).toBeUndefined();
    expect(eye().props.accessibilityActions).toBeUndefined();
    expect(eye().props.accessibilityHint).toBeUndefined();
  });

  it('held while on: a small card with Show All and Hide All; Memorization Mode stays on, the page stays', async () => {
    await renderWith(true);
    await press(eye());
    await holdEye();
    expect(menu()).toHaveLength(1);
    expect(hosts('memorization-menu-show-all')[0].props.accessibilityLabel).toBe('Show All');
    expect(hosts('memorization-menu-hide-all')[0].props.accessibilityLabel).toBe('Hide All');
    expect(eye().props.accessibilityLabel).toBe('Exit Memorization Mode');
    expect(hiddenAyahs()).toEqual(page61.verseKeys);
    expect(currentPage()).toBe(61);
  });

  it('Show All and Hide All from the card act on the page and close it; a tap outside closes it with nothing changed', async () => {
    await renderWith(true);
    await press(eye());
    await holdEye();
    await press(hosts('memorization-menu-show-all')[0]);
    expect(menu()).toHaveLength(0);
    expect(hiddenAyahs()).toEqual([]);
    await holdEye();
    await press(hosts('memorization-menu-hide-all')[0]);
    expect(hiddenAyahs()).toEqual(page61.verseKeys);
    await holdEye();
    await press(hosts('memorization-menu-backdrop')[0]);
    expect(menu()).toHaveLength(0);
    expect(hiddenAyahs()).toEqual(page61.verseKeys);
    expect(eye().props.accessibilityLabel).toBe('Exit Memorization Mode');
  });

  it('opens at the touch (near the Eye), or in the middle when the platform gives no position', async () => {
    await renderWith(true);
    await press(eye());
    await holdEye({});
    expect(menu()).toHaveLength(1);
  });

  it('screen readers: the gold Eye carries Show All and Hide All as its own actions, with a hint', async () => {
    await renderWith(true);
    await press(eye());
    expect(eye().props.accessibilityActions).toEqual([{ name: 'showAll', label: 'Show All' }, { name: 'hideAll', label: 'Hide All' }]);
    expect(eye().props.accessibilityHint).toBe('Touch and hold for Show All and Hide All');
    await act(async () => eye().props.onAccessibilityAction({ nativeEvent: { actionName: 'showAll' } }));
    expect(hiddenAyahs()).toEqual([]);
    await act(async () => eye().props.onAccessibilityAction({ nativeEvent: { actionName: 'hideAll' } }));
    expect(hiddenAyahs()).toEqual(page61.verseKeys);
  });

  it('the card never outlives Memorization Mode: the setting turned OFF closes it too', async () => {
    await renderWith(true);
    await press(eye());
    await holdEye();
    await act(async () => setSetting(false));
    await flush();
    expect(menu()).toHaveLength(0);
    await act(async () => setSetting(true));
    await flush();
    await press(eye());
    expect(menu()).toHaveLength(0);
  });

  it('Arabic: «إظهار الكل» / «إخفاء الكل», right to left', async () => {
    state.locale = 'ar';
    await renderWith(true);
    await press(eye());
    await holdEye();
    expect(hosts('memorization-menu-show-all')[0].props.accessibilityLabel).toBe('إظهار الكل');
    expect(hosts('memorization-menu-hide-all')[0].props.accessibilityLabel).toBe('إخفاء الكل');
    expect(styleOf(hosts('memorization-menu-show-all')[0])).toMatchObject({ flexDirection: 'row-reverse' });
  });
});

describe('Memorization Mode: page 61\'s Quran SVG (no QPC V1 fonts) cannot hide single ayahs', () => {
  it('no Eye on the SVG page, though the setting is ON; the SVG page is drawn as before', async () => {
    state.fontsLoaded = false;
    state.storage.set(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY, 'true');
    await render({ width: 390, height: 797 }, {}, withSetting());
    expect(inPage().findAll((n) => n.props.testID === 'qpc-v1-text')).toHaveLength(0);
    expect(hosts('mushaf-paper').length).toBeGreaterThan(0);
    expect(hosts('memorization-eye')).toHaveLength(0);
    expect(hosts('memorization-all')).toHaveLength(0);
    expect(state.storage.get(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY)).toBe('true');
  });

  it('the Memorization Mode Guide on the SVG page (setting ON): the Eye\'s steps say it is unavailable here for now, not to turn it on', async () => {
    state.fontsLoaded = false;
    state.storage.set(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY, 'true');
    state.params = { page: '61', memorizationGuide: '9' };
    await render({ width: 390, height: 797 }, {}, withSetting());
    await press(hosts('memorization-guide-next')[0]);
    expect(textOf(hosts('memorization-guide-note')[0])).toBe('The Eye is unavailable on this page until its standard Mushaf page loads.');
  });

  it('on from page 62, then onto the SVG page 61: Memorization Mode ends there (no Eye, no card, no buttons); back on a QPC V1 page the outline Eye returns', async () => {
    state.fontsLoaded = false;
    state.params = { page: '62' };
    await renderWith(true);
    await press(eye());
    expect(eye().props.accessibilityLabel).toBe('Exit Memorization Mode');
    await act(async () => eye().props.onLongPress({ nativeEvent: { pageX: 1, pageY: 1 } }));
    await turnPage(-1);
    expect(currentPage()).toBe(61);
    expect(hosts('memorization-eye')).toHaveLength(0);
    expect(hosts('memorization-all')).toHaveLength(0);
    expect(hosts('memorization-menu')).toHaveLength(0);
    await turnPage(1);
    expect(currentPage()).toBe(62);
    expect(eye().props.accessibilityLabel).toBe('Enter Memorization Mode');
    expect(state.storage.get(MEMORIZATION_MODE_VISIBLE_STORAGE_KEY)).toBe('true');
  });
});
