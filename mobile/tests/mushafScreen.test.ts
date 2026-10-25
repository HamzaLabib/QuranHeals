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
    // Renders every row (the real list virtualises them).
    FlatList: ({ data, renderItem, ListEmptyComponent, keyExtractor, ...rest }: ListProps) =>
      h('FlatList', rest, ...(data.length ? data.map((item, index) => h('Row', { key: keyExtractor(item) }, renderItem({ item, index }) as never)) : [ListEmptyComponent as never])),
    TouchableWithoutFeedback: 'TouchableWithoutFeedback',
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    // Foreground (Keep Screen Awake, mushaf/useMushafKeepAwake.ts).
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
    ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
  };
});
vi.mock('react-native-svg', () => ({ default: 'Svg', ClipPath: 'ClipPath', Rect: 'Rect', Path: 'Path', Circle: 'Circle', SvgXml: 'SvgXml', Defs: 'Defs', Ellipse: 'Ellipse', G: 'G', Line: 'Line', LinearGradient: 'LinearGradient', Stop: 'Stop' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => state.insets }));
vi.mock('lucide-react-native', () => ({
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', BookMarked: 'BookMarked', Bookmark: 'Bookmark', Check: 'Check', ChevronDown: 'ChevronDown', ChevronLeft: 'ChevronLeft', ChevronRight: 'ChevronRight', ChevronsLeft: 'ChevronsLeft', ChevronsRight: 'ChevronsRight', CircleHelp: 'CircleHelp', Copy: 'Copy', Heart: 'Heart', Maximize2: 'Maximize2', Minimize2: 'Minimize2', Plus: 'Plus', Search: 'Search', Share2: 'Share2', X: 'X',
  // Quran audio (the top bar's headphones, the player chip and panel, the popup's Listen).
  AudioLines: 'AudioLines', ChevronUp: 'ChevronUp', CircleAlert: 'CircleAlert', Headphones: 'Headphones', LocateFixed: 'LocateFixed', Pause: 'Pause', Play: 'Play', SkipBack: 'SkipBack', SkipForward: 'SkipForward',
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
// The reader without Meanings and Surah Preview (as every build was here before 2026-10-24, when their datasets were
// bundled in development builds only): the ورد row's own layout. With both features — in every build since — their
// buttons narrow the pill; that layout is tested in wordMeaningsReader.test.ts.
vi.mock('@/wordMeanings/bundledDataset', () => ({ isWordMeaningsBundled: () => false, bundledWordMeanings: () => null }));
vi.mock('@/surahPreview/bundledDataset', () => ({ isSurahPreviewBundled: () => false, bundledSurahPreview: () => null }));
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
  /** Fixture: surahs treated as having no verified timing ("reciterId:surah"): Al-Minshawi has all 114 in this build. */
  without: new Set<string>(),
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
    capability: (reciter, surah) => (audio.wholeSurah.has(`${reciter.id}:${surah}`) ? 'surah' : !audio.without.has(`${reciter.id}:${surah}`) && hasAyahPlayback(reciter, surah) ? 'ayah' : 'none'),
    checkStream: async () => 'ok',
    now: () => 10 ** 12,
  });
  const idleDownloads = { getState: () => ({ phase: 'idle' }), subscribe: () => () => undefined, getStorageVersion: () => 0 };
  return { audioEngine, audioDownloads: idleDownloads, audioFiles: { reciters: async () => [] }, setAudioLocale: () => undefined, timingLoader: {} };
});
const { resetMushafAutoDownloadForTests } = await import('@/mushaf/offline/autoDownloadService');
const { default: MushafScreen, fitMushafPage, BACK_BAR_HEIGHT, TALLER_MAX_TILES_DOWN, TALLER_MAX_LINE_SPACING } = await import('@/app/(tabs)/mushaf');
const { router } = await import('expo-router');
const { MUSHAF_PANEL_COLORS } = await import('@/constants/mushafTheme');
const { ReflectionBulbIcon } = await import('@/components/ReflectionBulbIcon');
const { ACTIVE_READING_STOP_STORAGE_KEY, READING_STOPS_STORAGE_KEY } = await import('@/mushaf/readingStops');
const { SURAH_START_PAGES } = await import('@/mushaf/generated/surahStartPages');
const { syntheticQpcPage61 } = await import('./helpers/syntheticQpcPage61');
const { drag, flick, runTouch } = await import('./helpers/gestureSimulator');
const { MUSHAF_SCREEN_OPTIONS } = await import('@/mushaf/screenOptions');
const { AYAH_MARKERS_061 } = await import('@/mushaf/generated/ayahMarkers061');
const { BORDER_INKS } = await import('@/mushaf/borderPattern');
const { MUSHAF_BORDER_STYLES, MUSHAF_WIRD_MARKER } = await import('@/mushaf/appearance');
const layoutResponse = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let root: ReactTestRenderer;
const copy = () => MESSAGES[state.locale].mushaf;
const pressables = () => root.root.findAllByType('Pressable' as never);
const button = (label: string) => pressables().find((node) => node.props.accessibilityLabel === label);
const texts = () => root.root.findAllByType('Text' as never).map((node) => [node.props.children].flat().join(''));
const page = () => pressables().find((node) => node.props.accessibilityRole === 'image')!;
const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean));
const styleOf = (node: ReactTestInstance) => flat(node.props.style);
/** The top bar's controls in order: Back (or its empty slot), then the right-hand group (Help, Expand / Collapse). */
const barItems = () => (root.root.findByProps({ testID: 'mushaf-back-bar' }).children as ReactTestInstance[])
  .flatMap((child) => (child.props.testID !== undefined || !child.children.length ? [child.props.testID] : (child.children as ReactTestInstance[]).map((c) => c.props.testID)));
/** Within a QPC V1 line's row: the drawn line's centre (iOS draws the glyphs lower than laid out: qcfV1DrawnLineShiftEm). */
async function drawnLineY(line: ReactTestInstance) {
  const { qcfV1DrawnLineShiftEm } = await import('@/mushaf/ayahMarkers');
  const fontSize = flat(line.findAllByType('Text' as never)[0].props.style).fontSize as number;
  return (flat(line.props.style).height as number) / 2 + qcfV1DrawnLineShiftEm(61, 'ios') * fontSize;
}
const flush = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };
/**
 * The reader after the 2026-10-14 redesign (the floating bar is archived in design-archive/mushaf-navigation-v1/):
 *  - the ورد name field opens from the ورد list's Add (its pill, then Add);
 *  - pages turn by swipe, or by the page's own screen-reader actions (nextPage / previousPage);
 *  - an ayah's popup opens DOUBLE_TAP_MS (350 ms) after the tap.
 */
async function openNameField() {
  await press(root.root.findAllByProps({ testID: 'mushaf-wird' }).find((node) => typeof node.type === 'string'));
  await flush();
  // No ورد yet: the pill is itself "Add" and opened the field; otherwise its list's Add does.
  if (root.root.findAllByProps({ testID: 'mushaf-popup-save' }).length > 0) return;
  await press(root.root.findAllByProps({ testID: 'mushaf-wird-new' }).find((node) => typeof node.type === 'string'));
  await flush();
}
/** The current page's screen-reader action: next (+1) or previous (-1) page. */
async function turnPage(delta: 1 | -1) {
  const target = inPage().findAll((node) => typeof node.type === 'string' && Array.isArray(node.props.accessibilityActions))[0];
  await act(async () => target.props.onAccessibilityAction({ nativeEvent: { actionName: delta === 1 ? 'nextPage' : 'previousPage' } }));
  await flush();
}
/** After an ayah tap: its popup opens once the double-tap window has passed. */
async function afterTapWindow() {
  await act(async () => { await new Promise((done) => setTimeout(done, 360)); });
  await flush();
}
const hosts = (testID: string) => root.root.findAllByProps({ testID }).filter((node) => typeof node.type === 'string');
const textOfNode = (node: ReactTestInstance) => node.findAllByType('Text' as never).map((t) => [t.props.children].flat().join('')).join(' ');
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
  state.clipboard = null;
  state.clipboardFails = false;
  state.locale = 'en';
  state.storage.clear();
  state.favoriteReciterId = 'maher';
  // The reader's own tests: its first-time guide already seen (the guide's tests start fresh: 'the first-time guide').
  // (closed, not finished: its Help icon still shows, as these tests of the top bar expect).
  state.storage.set('quran-heals:mushaf-guide:v1', JSON.stringify({ status: 'done', finished: false }));
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
  // The one audio engine (a module singleton): nothing plays into the next test.
  (await import('@/audio/index')).audioEngine.stop();
  audio.loads = [];
  audio.wholeSurah.clear();
  audio.without.clear();
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

  it('takes the largest page that fits above the ورد row (the retired bar`s space reclaimed), in its own proportions, never cropped', async () => {
    const { computePageLayout, MIN_TILES_DOWN } = await import('@/mushaf/pageGeometry');
    const aspect = computePageLayout(1000).page.height / 1000;
    // The width is the one whose shortest frame for the larger text (MIN_TILES_DOWN) fits.
    const shortest = computePageLayout(1000, MIN_TILES_DOWN).page.height / 1000;
    const paperSize = () => styleOf(inPage().findByProps({ testID: 'mushaf-paper' }));
    const reserved = 4 + 34; // the gap under the ورد row, home indicator (no bar any more)
    // Phone: the width decides, 3 pt from each edge.
    await render({ width: 390, height: 761 });
    expect(paperSize().width).toBe(384);
    expect(paperSize().height).toBeCloseTo(384 * aspect); // page 61 drawn from the Quran SVG here: the printed frame
    expect(paperSize().height).toBeLessThanOrEqual(761 - reserved - 32);
    await act(async () => root.unmount());
    // Tablet: the height decides.
    await render({ width: 820, height: 1130 });
    expect(paperSize().width).toBe(Math.floor((1130 - reserved - 32) / shortest)); // leaving the ورد row free
    expect(paperSize().width).toBeLessThan(820);
    // The SVG page keeps its own proportions inside.
    const { width, height } = Object.assign({}, ...[page().props.style].flat()) as { width: number; height: number };
    expect(height / width).toBeCloseTo(550 / 345);
  });

  it('fits iPhone, Android (gesture and 3-button navigation), a small phone and a tablet from their real safe areas', () => {
    const aspect = 1.6088532883642497;
    // The shortest frame the larger text allows (31 tiles): 1.6088… + 2/20.
    const shortest = aspect + 2 / 20;
    // area = screen − top inset − Back row; the bottom inset is passed separately.
    const fit = (w: number, h: number, top: number, bottom: number) => fitMushafPage({ width: w, height: h - top - BACK_BAR_HEIGHT }, bottom);
    const cases = [
      { name: 'iPhone 393 × 852 (Dynamic Island, home indicator)', size: fit(393, 852, 59, 34), width: 387 },
      { name: 'Android 412 × 915, gesture navigation', size: fit(412, 915, 24, 24), width: 406 },
      { name: 'Android 412 × 915, 3-button navigation', size: fit(412, 915, 24, 48), width: 406 },
      // The height decides: (568 − 20 − 36 − 4 − 32) ÷ 1.7089 = 278 pt would bring the last line under the page selector's
      // card; the widest page whose text ends 4 pt above it is 261 pt.
      { name: 'small phone 320 × 568: the height decides', size: fit(320, 568, 20, 0), width: 261 },
      { name: 'iPad 820 × 1180', size: fit(820, 1180, 24, 20), width: Math.floor((1180 - 24 - 36 - 4 - 20 - 32) / shortest) },
    ];
    for (const { name, size, width } of cases) {
      expect(size.page.width, name).toBe(width);
      expect(size.page.height / size.page.width, name).toBeCloseTo(aspect);
      expect(size.page.height, name).toBeLessThanOrEqual(size.viewport.height - 32); // the ورد row stays free
    }
  });
});

describe('the whole Quran text area mushafTextLift above the printed one, the same on every page, in both modes', () => {
  it('Normal and Full-Screen: one lift, applied once; page, frame and text-area size unchanged; switching back restores it', async () => {
    const { computePageLayout, mushafTextLift, MUSHAF_TEXT_LIFT_PT, NATIVE_TEXT_LIFT_EM, NOMINAL_LETTER_SIZE_PER_TEXT_WIDTH } = await import('@/mushaf/pageGeometry');
    // iOS and Android: 0.26 × the nominal letter size (approved 2026-10-15); the web keeps the fixed 4 pt.
    expect(NATIVE_TEXT_LIFT_EM).toBe(0.26);
    expect(MUSHAF_TEXT_LIFT_PT).toBe(4);
    expect(mushafTextLift(300, 'web')).toBe(4);
    expect(mushafTextLift(300, 'android')).toBeCloseTo(0.26 * NOMINAL_LETTER_SIZE_PER_TEXT_WIDTH * 300, 12);
    const lift = (textWidth: number) => mushafTextLift(textWidth, 'ios'); // this file renders as iOS
    await render({ width: 393, height: 852 - 59 - BACK_BAR_HEIGHT });
    const area = () => styleOf(inPage().findByProps({ testID: 'mushaf-text-area' }));
    const paper = () => styleOf(inPage().findByProps({ testID: 'mushaf-paper' }));
    const width = paper().width;
    const printed = computePageLayout(width);
    expect(paper().height).toBeCloseTo(printed.page.height, 9);
    expect(area().height).toBeCloseTo(printed.text.height, 9);
    expect(area().width).toBeCloseTo(printed.text.width, 9);
    expect(area().top).toBeCloseTo(printed.text.y - lift(printed.text.width), 9);
    expect(lift(printed.text.width)).toBeGreaterThan(MUSHAF_TEXT_LIFT_PT);
    expect(area().left).toBeCloseTo(printed.text.x, 9);
    await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
    const full = computePageLayout(paper().width, Math.round((paper().height - printed.page.height) / (width / 20)) + 29);
    expect(area().top).toBeCloseTo(full.text.y - lift(full.text.width), 9);
    expect(area().height).toBeCloseTo(full.text.height, 9);
    await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
    expect(area().top).toBeCloseTo(printed.text.y - lift(printed.text.width), 9);
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

  it('Normal Mode is the default: Back on the left, a plain Expand icon on the right, and the ورد pill', async () => {
    await render();
    // The empty audio slot (the player's chip while something plays) and Listen from this page (headphones) sit between them.
    // Then the audio slot (the player's chip while playing), the headphones and Help (no page arrows: they are in the audio window).
    expect(barItems()).toEqual(['mushaf-back', 'mushaf-audio-slot', 'mushaf-play-page', 'mushaf-guide-open', 'mushaf-fullscreen-toggle']);
    expect(toggle().props.accessibilityLabel).toBe(copy().enterFullScreen);
    expect(toggle().findAllByType('Maximize2' as never)).toHaveLength(1);
    expect(toggle().findByType('Maximize2' as never).props.color).toBe(MUSHAF_PANEL_COLORS.light.icon);
    expect(toggle().findAllByType('Text' as never)).toHaveLength(0);
    const look = flat(toggle().props.style({ pressed: false }));
    for (const key of ['backgroundColor', 'borderWidth', 'borderRadius', 'shadowOpacity', 'elevation']) expect(look[key], key).toBeUndefined();
    expect(look.width).toBe(44);
    expect(look.height + toggle().props.hitSlop.top + toggle().props.hitSlop.bottom).toBe(44);
    for (const id of ['mushaf-back', 'mushaf-wird-row']) expect(has(id), id).toBe(true);
    expect(state.backHandlers).toHaveLength(0); // Android Back navigates as usual in Normal Mode
  });

  it('Expand shows only the page and a Collapse icon in the same place; Collapse restores every control', async () => {
    await render();
    await press(toggle());
    for (const id of ['mushaf-back', 'mushaf-wird-row', 'mushaf-wird']) expect(has(id), id).toBe(false);
    expect(has('mushaf-paper')).toBe(true);
    expect(texts()).toEqual(expect.arrayContaining(['سورة آل عمران', 'الجزء ٣', '٦١']));
    expect(toggle().props.accessibilityLabel).toBe(copy().exitFullScreen);
    expect(toggle().findAllByType('Minimize2' as never)).toHaveLength(1);
    expect(barItems().at(-1)).toBe('mushaf-fullscreen-toggle');
    expect(has('mushaf-guide-open')).toBe(false); // Help hides in full screen
    // Full screen keeps the headphones (2026-10-17) and Collapse.
    expect(barItems()).toEqual([undefined, 'mushaf-audio-slot', 'mushaf-play-page', 'mushaf-fullscreen-toggle']);
    await press(toggle());
    for (const id of ['mushaf-back', 'mushaf-wird-row', 'mushaf-guide-open']) expect(has(id), id).toBe(true);
    expect(barItems()).toEqual(['mushaf-back', 'mushaf-audio-slot', 'mushaf-play-page', 'mushaf-guide-open', 'mushaf-fullscreen-toggle']); // restored in place
  });

  it('full screen keeps Normal Mode`s page width, so the Quran text is the same size; its extra height is the viewport`s', async () => {
    // Tablet: the height decides Normal Mode's width; full screen does not widen it (the text would grow).
    await render({ width: 820, height: 1130 });
    const normal = paperSize();
    await press(toggle());
    const full = paperSize();
    expect(full.width).toBe(normal.width);
    expect(full.height / full.width).toBeCloseTo(normal.height / normal.width); // page 61 from the Quran SVG: one frame
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
      // Height-limited: Normal Mode's width (the same text size), not the wider page full screen alone would allow.
      { name: 'small phone 320 × 568', size: fit(320, 568, 20, 0), width: 261 }, // Normal Mode's (the page selector's room kept)
      { name: 'iPad 820 × 1180', size: fit(820, 1180, 24, 20), width: Math.floor((1180 - 24 - 36 - 4 - 20 - 32) / (1.6088532883642497 + 2 / 20)) },
    ];
    for (const { name, size, width } of cases) {
      expect(size.page.width, name).toBe(width);
      expect(size.page.height, name).toBeLessThanOrEqual(size.viewport.height);
    }
  });

  it('keeps the page, the selected ayah and the active ورد; Reflection opens from the ayah for the same ayah', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'fajr', name: 'ورد الفجر', page: 61, updatedAt: '2026-10-01T00:00:00.000Z' }]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
    await render();
    const stored = [state.storage.get(READING_STOPS_STORAGE_KEY), state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)];
    await tapPage(100, 130); // 3:85
    state.offline.readPage.mockClear();
    await press(toggle());
    expect(shownPageNumber()).toBe('٦١');
    expect(has('mushaf-selection')).toBe(true);
    expect(has('mushaf-panel')).toBe(false); // no bar in either mode (retired)
    await tapPage(100, 300); // selecting still works in full screen
    await press(toggle());
    expect(state.offline.readPage).not.toHaveBeenCalled(); // the page never reloaded
    expect(root.root.findByProps({ testID: 'mushaf-wird' }).findByType('Text' as never).props.children).toBe('ورد الفجر');
    expect([state.storage.get(READING_STOPS_STORAGE_KEY), state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)]).toEqual(stored);
    await tapPage(100, 130);
    await afterTapWindow();
    await press(hosts('mushaf-ayah-reflection')[0]);
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
    expect(has('mushaf-wird-row')).toBe(true); // Normal Mode's controls are back (the bar is retired)
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
    for (const id of ['mushaf-back', 'mushaf-wird-row']) expect(has(id), id).toBe(true);
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
    expect(has('mushaf-wird-row')).toBe(true); // Normal Mode's controls are back (the bar is retired)
  });

  it('the Collapse icon stays as a backup exit and works at any zoom', async () => {
    await render();
    await press(toggle());
    await pinch(3);
    expect(toggle().findAllByType('Minimize2' as never)).toHaveLength(1);
    await press(toggle());
    expect(has('mushaf-wird-row')).toBe(true); // Normal Mode's controls are back (the bar is retired)
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
    expect(has('mushaf-wird-row')).toBe(true); // Normal Mode's controls are back (the bar is retired)
    expect(toggle().props.accessibilityLabel).toBe(copy().enterFullScreen);
  });

  it('Dark Mode: ivory icons; the page keeps its dark border inks', async () => {
    state.theme = 'dark';
    await render();
    await press(toggle());
    expect(toggle().findByType('Minimize2' as never).props.color).toBe(MUSHAF_PANEL_COLORS.dark.icon);
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
    it(`${theme}: the screen, the safe areas and the space around the page are ${paper}, in both modes; no bar`, async () => {
      state.theme = theme;
      await render();
      const screen = () => styleOf(root.root.findByType('GestureHandlerRootView' as never));
      expect(screen().backgroundColor).toBe(paper);
      expect(styleOf(inPage().findByProps({ testID: 'mushaf-paper' })).backgroundColor).toBe(paper);
      expect(screen().paddingTop).toBe(47); // the status-bar area is the reader's own, in its colour
      await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
      expect(screen().backgroundColor).toBe(paper);
      await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
      expect(hosts('mushaf-panel')).toHaveLength(0); // the retired bar
      // The border: the approved inks on the light page, the midnight gold and sage inks on the dark one.
      const fills = inPage().findByProps({ testID: 'mushaf-frame' }).findAllByType('Path' as never).map((node) => node.props.fill);
      expect(new Set(fills)).toEqual(new Set(Object.values(theme === 'dark' ? MUSHAF_BORDER_STYLES.midnight.inks : BORDER_INKS)));
    });
  }
});

describe('the ورد pill blends with the page (unchanged); the retired bar is gone', () => {
  const PILL = {
    light: { backgroundColor: 'rgba(62, 107, 75, 0.10)', borderColor: 'rgba(62, 107, 75, 0.22)', text: '#2B2A26', chevron: '#3E6B4B' },
    dark: { backgroundColor: 'rgba(181, 201, 169, 0.12)', borderColor: 'rgba(181, 201, 169, 0.26)', text: '#F1E9D6', chevron: '#B5C9A9' },
  };
  // The approved bar (Option A).
  for (const [theme, paper] of [['light', '#F9EFD2'], ['dark', '#222820']] as const) {
    it(`${theme}: the ورد pill keeps its own sage tint, shape and size on the page; no bar`, async () => {
      state.theme = theme;
      state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'fajr', name: 'ورد الفجر', page: 61, updatedAt: '2026-10-01T00:00:00.000Z' }]));
      state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
      await render();
      expect(hosts('mushaf-panel')).toHaveLength(0);
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

describe('Taller in both modes (larger text, candidate C): every page, every build; full screen only adds tiles', () => {
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

  it('page 61: Normal Mode fills its height with whole tiles, full screen adds more at the same width; the reading position is kept', async () => {
    setDev(true);
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'fajr', name: 'ورد الفجر', page: 61, updatedAt: '2026-10-01T00:00:00.000Z' }]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
    const stored = state.storage.get(READING_STOPS_STORAGE_KEY);
    // An iPhone 393 × 852 (insets 59 / 34): the area under the Back row.
    await renderQpc({}, { width: 393, height: 852 - 59 - BACK_BAR_HEIGHT });
    const paper = () => styleOf(inPage().findByProps({ testID: 'mushaf-paper' }));
    const glyphSize = () => styleOf(inPage().findByProps({ testID: 'qpc-line-1' }).findAllByType('Text' as never)[0]).fontSize;
    // Normal Mode: 393 − 6 = 387 pt wide; 757 − 4 − 34 − 32 = 687 pt for the page would hold 32 tiles (680.7 pt), but
    // their last line would end at 621.5 pt, under where the page selector's card opens (its top at 625 pt, the text
    // 4 pt clear of it: 617); 31 tiles end it at 602.2 pt (661.3 pt page).
    expect(paper()).toMatchObject({ width: 387 });
    expect(Math.round(paper().height)).toBe(661);
    expect(frameTiles()).toBe(31);
    const size = glyphSize();
    { const row = inPage().findByProps({ testID: 'qpc-line-2' }); const locationY = await drawnLineY(row); await act(async () => row.props.onPress({ nativeEvent: { locationX: 405, locationY } })); }
    state.offline.readPage.mockClear();
    await fullScreenOn();
    expect(paper()).toMatchObject({ width: 387 }); // the same width
    expect(Math.round(paper().height)).toBe(700); // 757 − 4 − 34 = 719 pt: 33 tiles (+19 pt on this iPhone)
    expect(frameTiles()).toBe(33);
    expect(glyphSize()).toBe(size); // the same letter size
    expect(inPage().findAllByProps({ testID: 'qpc-highlight-2' }).length).toBeGreaterThan(0); // the selection is kept
    expect(state.offline.readPage).not.toHaveBeenCalled(); // no reload, same page
    expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(stored);
    await fullScreenOn();
    expect(Math.round(paper().height)).toBe(661);
    expect(frameTiles()).toBe(31);
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
          // The top row holds only Back, Listen and Help (Normal Mode), the (empty) audio slot, and Expand / Collapse.
          expect(barItems(), label).toEqual(mode === 'normal' ? ['mushaf-back', 'mushaf-audio-slot', 'mushaf-play-page', 'mushaf-guide-open', 'mushaf-fullscreen-toggle'] : [undefined, 'mushaf-audio-slot', 'mushaf-play-page', 'mushaf-fullscreen-toggle']);
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

  it('Normal Mode is Taller too, never shorter than the larger text allows (31 tiles); full screen never narrower or shorter (Android 412)', async () => {
    const { MIN_TILES_DOWN } = await import('@/mushaf/pageGeometry');
    setDev(true);
    await renderQpc({}, { width: 412, height: 855 });
    const normal = frameTiles();
    expect(normal).toBeGreaterThanOrEqual(MIN_TILES_DOWN);
    expect(styleOf(inPage().findByProps({ testID: 'mushaf-paper' })).width).toBe(406);
    await fullScreenOn();
    expect(frameTiles()).toBeGreaterThanOrEqual(normal);
    expect(styleOf(inPage().findByProps({ testID: 'mushaf-paper' })).width).toBe(406);
  });

  it('pages other than 61 (1–2 included), in release builds (preview, production) as in development: Normal 31 tiles, full screen 33 on this iPhone', async () => {
    for (const dev of [false, true]) {
      for (const n of [1, 2, 62, 187, 604]) {
        setDev(dev);
        const other = { ...syntheticQpcPage61(), page: n, fontFamily: `QCF_P${String(n).padStart(3, '0')}` };
        state.offline.readPage.mockImplementation(async (page: number) => (page === n ? other : null));
        state.params = { page: String(n) };
        // An iPhone 393 × 852 (insets 59 / 34).
        await render({ width: 393, height: 852 - 59 - BACK_BAR_HEIGHT });
        const label = `${dev ? 'development' : 'release'} page ${n}`;
        expect(frameTiles(), label).toBe(31);
        await fullScreenOn();
        expect(frameTiles(), label).toBe(33); // as page 61 on this iPhone
        expect(Math.round(styleOf(inPage().findByProps({ testID: 'mushaf-paper' })).height), label).toBe(700);
        await fullScreenOn();
        expect(frameTiles(), label).toBe(31);
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

  it('full screen: a taller frame of the same tiles than Normal Mode`s, the same glyphs at the same size, the 15 lines further apart', async () => {
    // An iPhone 393 × 852 (insets 59 / 34): Normal Mode 31 tiles, full screen 33 (a tall Android reaches the cap in both).
    await renderQpc({}, { width: 393, height: 852 - 59 - BACK_BAR_HEIGHT });
    // Normal Mode at the same width.
    const traditional = { tiles: frameTiles(), paper: styleOf(inPage().findByProps({ testID: 'mushaf-paper' })), pitch: lineRows()[0].height, glyphs: glyphs() };
    await fullScreenOn();
    const mobile = { tiles: frameTiles(), paper: styleOf(inPage().findByProps({ testID: 'mushaf-paper' })), pitch: lineRows()[0].height, glyphs: glyphs() };
    expect(traditional.tiles).toBe(31);
    expect(mobile.tiles).toBe(33);
    expect(Number.isInteger(mobile.tiles)).toBe(true); // whole tiles: repeated, never stretched
    expect(mobile.paper.width).toBe(traditional.paper.width); // the width (and so the text size) is the device's
    expect(mobile.paper.height).toBeGreaterThan(traditional.paper.height);
    expect(mobile.paper.height).toBeLessThanOrEqual(852 - 59 - BACK_BAR_HEIGHT - 4 - 34); // still the whole page, inside the safe area
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
    // The narrow phone too: height-limited in Normal Mode, full screen keeps that width, so the letters are the same size
    // (its extra height goes to the frame and the line spacing).
    expect(sizes[7]).toBe(sizes[6]);
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
    await afterTapWindow();
    await press(hosts('mushaf-ayah-reflection')[0]);
    expect(root.root.findByType('ReflectionSheet' as never).props.verseKey).toBe('3:84');
  });

  it('where the height limits the page (tablets), Normal Mode has the shortest frame the larger text allows; full screen adds what its height fits, at the same width', async () => {
    // 820 × 1130 (bottom inset 34): (1130 − 4 − 34 − 32) ÷ (31 tiles' 1.7089) → 620 pt wide, 31 tiles (1059.5 pt of 1060);
    // full screen: 1092 pt, 32 tiles (1090.5 pt).
    await renderQpc({}, { width: 820, height: 1130 });
    expect(frameTiles()).toBe(31);
    expect(styleOf(inPage().findByProps({ testID: 'mushaf-paper' })).width).toBe(620);
    await fullScreenOn();
    expect(frameTiles()).toBe(32);
    expect(styleOf(inPage().findByProps({ testID: 'mushaf-paper' })).width).toBe(620);
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

  it('Normal Mode: the Quran text always ends at least 4 pt above where the page selector`s card opens; full screen keeps Normal Mode`s width', async () => {
    const { computePageLayout, MUSHAF_TEXT_LIFT_PT } = await import('@/mushaf/pageGeometry');
    const { PAGE_SELECTOR_BOTTOM_MARGIN, PAGE_SELECTOR_CARD_HEIGHT } = await import('@/components/MushafPageSelector');
    const devices = [[375, 667, 20, 0], [375, 812, 50, 34], [390, 844, 47, 34], [393, 852, 59, 34], [402, 874, 62, 34], [430, 932, 59, 34], [440, 956, 62, 34],
      [320, 568, 20, 0], [320, 640, 24, 48], [360, 640, 24, 48], [360, 800, 24, 24], [412, 915, 24, 24], [412, 915, 24, 48], [448, 998, 28, 24], [820, 1180, 24, 20]] as const;
    for (const [w, h, top, bottom] of devices) {
      const area = { width: w, height: h - top - BACK_BAR_HEIGHT };
      const normal = fitMushafPage(area, bottom, false, true);
      const { text } = computePageLayout(normal.page.width, normal.tilesDown);
      const textBottom = text.y + text.height - MUSHAF_TEXT_LIFT_PT; // the page sits at the top of the reading area
      const cardTop = area.height - bottom - PAGE_SELECTOR_BOTTOM_MARGIN - PAGE_SELECTOR_CARD_HEIGHT;
      expect(cardTop - textBottom, `${w} × ${h}`).toBeGreaterThanOrEqual(4);
      expect(normal.tilesDown, `${w} × ${h}`).toBeGreaterThanOrEqual(31);
      const full = fitMushafPage(area, bottom, true, true);
      expect(full.page.width, `${w} × ${h} full screen`).toBe(normal.page.width); // the same Quran text size
      expect(full.tilesDown, `${w} × ${h} full screen`).toBeGreaterThanOrEqual(normal.tilesDown);
    }
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
      expect(size.tilesDown, name).toBeGreaterThanOrEqual(31); // MIN_TILES_DOWN: QPC pages are never shorter
      expect(size.tilesDown, name).toBeLessThanOrEqual(TALLER_MAX_TILES_DOWN);
      expect(size.page.height, name).toBeLessThanOrEqual(size.viewport.height);
    }
    const tiles = Object.fromEntries(cases.map(([name, size]) => [name, size.tilesDown]));
    expect(tiles).toEqual({
      // Each from its own room, at Normal Mode's width (page height = width × (0.15886 + tiles ÷ 20)):
      'iPhone 393, Normal': 31, // 387 pt wide, 687 pt: 32 would fit (680.7), but its text would reach under the page selector
      'iPhone 393, full screen': 33, // 719 pt: 33 (700.1)
      'iPhone 320': 31, // 261 pt wide (the page selector's room kept), 31
      'Android 412 gesture': 35, // 406 pt, 795 pt: 35 (775.0)
      'Android 412 3-button': 34, // 771 pt: 34 (754.7)
      'Android 412 full screen': 35, // capped
      'large Android 448 × 998': 35, // 442 pt, 874 pt: 35 (843.7)
      'iPad 820': 31, // 622 pt wide (1064 ÷ 1.7089), 31 (1062.9)
    });
  });
});

describe('page direction: swipes (finger left to right = next) and the page`s screen-reader actions', () => {
  const shown = () => currentPage();
  const actions = () => inPage().findAll((node) => typeof node.type === 'string' && Array.isArray(node.props.accessibilityActions))[0].props.accessibilityActions;

  for (const locale of ['en', 'ar'] as const) {
    for (const mode of ['normal', 'full'] as const) {
      it(`${locale}, ${mode === 'normal' ? 'Normal Mode' : 'full screen'}: a left-to-right swipe and the page’s own "next page" action = next; right to left and "previous page" = previous`, async () => {
        state.locale = locale;
        await render();
        if (mode === 'full') await press(root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }));
        expect(root.root.findAllByProps({ testID: 'mushaf-panel' })).toHaveLength(0); // no arrow bar (retired)
        // Spoken in the app's language, in both modes.
        expect(actions()).toEqual([{ name: 'nextPage', label: copy().nextPage }, { name: 'previousPage', label: copy().previousPage }]);
        await turnPage(1);
        expect(shown()).toBe(62);
        await turnPage(-1);
        await flush();
        expect(shownPageNumber()).toBe('٦١');
        await turnPage(-1);
        expect(shown()).toBe(60);
        await turnPage(1);
        await flush();
        expect(shownPageNumber()).toBe('٦١');
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

  it('never before page 1 or after page 604, by swipe or page action', async () => {
    state.params = { page: '1' };
    await render();
    state.offline.readPage.mockClear();
    await swipe(-120); // previous: nothing before page 1
    await turnPage(-1);
    expect(state.offline.readPage).not.toHaveBeenCalled();
    expect(currentPage()).toBe(1);
    await act(async () => root.unmount());
    state.params = { page: '604' };
    await render();
    state.offline.readPage.mockClear();
    await swipe(120); // next: nothing after page 604
    await turnPage(1);
    expect(state.offline.readPage).not.toHaveBeenCalled();
    expect(currentPage()).toBe(604);
  });

  it('turning keeps the active ورد and saves nothing', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'fajr', name: 'ورد الفجر', page: 61, updatedAt: '2026-10-01T00:00:00.000Z' }]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
    await render();
    const before = state.storage.get(READING_STOPS_STORAGE_KEY);
    await turnPage(1);
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
  it('the page actions and swipes move together; turning clears the selection and any waiting popup', async () => {
    await render();
    expect(shownPageNumber()).toBe('٦١');
    await tapPage(100, 130);
    await turnPage(1);
    await flush();
    expect(currentPage()).toBe(62);
    expect(inPage().findByProps({ testID: 'mushaf-page-missing' })).toBeDefined(); // not downloaded
    await afterTapWindow();
    expect(hosts('mushaf-ayah-actions')).toHaveLength(0); // the tap's popup never opened over another page
    await turnPage(-1);
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
    await turnPage(-1);
    expect(currentPage()).toBe(1);
    await act(async () => root.unmount());
    state.params = { page: '604' };
    await render();
    await turnPage(1);
    expect(currentPage()).toBe(604);
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
    await turnPage(1);
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
    // The selection is 3:85 again (the Reflection sheet always holds the selected ayah).
    expect(root.root.findByType('ReflectionSheet' as never).props.verseKey).toBe('3:85');
    expect(enabled(doubleTapGesture())).toBe(false); // nothing to reset at 1×
  });

  it('selecting an ayah while zoomed opens the reflection for exactly that ayah', async () => {
    await render();
    await pinch(2.4, { x: 120, y: 200 });
    await tapPage(100, 130);
    expect(inPage().findByProps({ testID: 'mushaf-selection' })).toBeDefined();
    expect(zoom().scale).toBe(2.4); // selecting doesn't change the zoom
    await afterTapWindow();
    await press(hosts('mushaf-ayah-reflection')[0]);
    expect(zoom().scale).toBe(2.4); // nor does its popup
    expect(root.root.findByType('ReflectionSheet' as never).props).toMatchObject({ visible: true, verseKey: '3:85' });
  });

  it('a page that isn`t drawn (not downloaded) doesn`t zoom, but still swipes', async () => {
    state.params = { page: '200' };
    await render();
    expect(enabled(pinchGesture())).toBe(false);
    expect(enabled(swipeGesture())).toBe(true);
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
    expect(hosts('mushaf-panel')).toHaveLength(0); // the pill stands on its own (the bar is retired)
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

  it('browsing survives a restart on this device, never moves a ورد, and a ورد saved later (here or synced) still wins', async () => {
    seed(THREE, 'tadabbur');
    const stopsBefore = state.storage.get(READING_STOPS_STORAGE_KEY);
    state.params = {};
    await render();
    expect(currentPage()).toBe(125); // opened by itself on the ورد: not a browse
    expect(state.storage.has('quran-heals:mushaf-last-page:v1')).toBe(false);

    await turnPage(1);
    await turnPage(1);
    expect(currentPage()).toBe(127);
    await act(async () => root.unmount());

    // Restart: the last browsed page opens (browsed after the ورد's last save), with the same active ورد.
    await render();
    expect(currentPage()).toBe(127);
    expect(pillText()).toBe('ورد التدبر');
    // Browsing changed no ورد: same pages, same save times.
    expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(stopsBefore);
    await act(async () => root.unmount());

    // The ورد is then saved at a later page (e.g. on another device, synced): its page wins over the older browse.
    const later = new Date(Date.now() + 60_000).toISOString();
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([...THREE.filter((s) => s.id !== 'tadabbur'), { ...THREE[1], page: 300, updatedAt: later }]));
    await render();
    expect(currentPage()).toBe(300);
    await act(async () => root.unmount());

    // A page in the link always wins.
    state.params = { page: '50' };
    await render();
    expect(currentPage()).toBe(50);
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
    const expected = { en: 'Reciting name (e.g., Personal or Mosque)', ar: 'اسم الوِرد (مثل: شخصي أو المسجد)', 'ar-EG': 'اسم الوِرد (زي: شخصي أو المسجد)' } as const;
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
    await openNameField();
    const field = root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never);
    expect(field.props).toMatchObject({ value: 'ورد التدبر', selectTextOnFocus: true });
  });

  it('is hidden while the page is zoomed (the page uses that space), and back at 1×', async () => {
    seed(THREE, 'fajr');
    await render();
    await pinch(2);
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-wird-row' }))).toMatchObject({ opacity: 0 });
    expect(root.root.findByProps({ testID: 'mushaf-wird-row' }).props.pointerEvents).toBe('none');
    await turnPage(1);
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
    await openNameField();
    await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText('Ramadan'));
    await press(button(copy().confirmStop));
    expect(stored()).toEqual([expect.objectContaining({ name: 'Ramadan', page: 61 })]);
    expect(JSON.stringify(stored())).not.toMatch(/3:85|verseKey|ayah/);
  });

  it('once saved, the keyboard and the whole save field close, back to the page', async () => {
    const { Keyboard } = await import('react-native');
    vi.mocked(Keyboard.dismiss).mockClear();
    await render();
    await openNameField();
    await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText('Ramadan'));
    await press(button(copy().confirmStop));
    expect(root.root.findAllByProps({ testID: 'mushaf-popup-save' })).toHaveLength(0);
    expect(Keyboard.dismiss).toHaveBeenCalled();
    expect(stored()).toEqual([expect.objectContaining({ name: 'Ramadan', page: 61 })]);
    // The reader works as before: next page, and the field opens again, empty of the old notice.
    await turnPage(1);
    await flush();
    expect(currentPage()).toBe(62);
    await openNameField();
    expect(root.root.findByProps({ testID: 'mushaf-popup-save' }).findAllByType('Text' as never)).toHaveLength(0);
  });

  it('if saving fails, the field stays open with the reason so the reader can retry', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await render();
    await openNameField();
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
    await openNameField();
    await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText('Family'));
    await press(button(copy().confirmStop));
    expect(stored()).toEqual([expect.objectContaining({ name: 'Family', page: 300 })]);
  });

  it('an empty name explains what is needed and saves nothing', async () => {
    await render();
    await openNameField();
    await press(button(copy().confirmStop));
    expect(texts()).toContain(copy().stopNameInvalid);
    expect(root.root.findAllByProps({ testID: 'mushaf-popup-save' })).toHaveLength(1); // stays open to retry
    expect(stored()).toEqual([]);
  });
});

describe('languages', () => {
  for (const locale of ['ar', 'ar-EG'] as const) {
    it(`${locale}: the page's controls are spoken in the language; the printed page is unchanged`, async () => {
      state.locale = locale;
      await render();
      const labels = ['mushaf-nav-surah', 'mushaf-nav-juz', 'mushaf-nav-page'].map((id) => hosts(id)[0].props.accessibilityLabel);
      expect(labels).toEqual([copy().openSurahs, copy().openJuz, copy().openPageSelector]);
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

  it('every ayah 3:84–3:91 can be selected by its words; Reflection opens for exactly that ayah', { timeout: 30_000 }, async () => {
    const layout = syntheticQpcPage61();
    await renderQpc(layout);
    await layOut(layout);
    for (const verseKey of layout.verseKeys) {
      const line = layout.lines.find((candidate) => candidate.words.some((word) => word.verseKey === verseKey))!;
      const index = line.words.findIndex((word) => word.verseKey === verseKey);
      await tapLine(line.line, 400 - index * 30 + 5);
      await afterTapWindow();
    await press(hosts('mushaf-ayah-reflection')[0]);
      expect(root.root.findByType('ReflectionSheet' as never).props).toMatchObject({ visible: true, verseKey });
      await act(async () => root.root.findByType('ReflectionSheet' as never).props.onClose());
    }
    // Under zoom the line's own touch target scales with the page: the same local point picks the same ayah.
    await pinch(3, { x: 300, y: 400 });
    await tapLine(4, 405);
    await afterTapWindow();
    await press(hosts('mushaf-ayah-reflection')[0]);
    expect(root.root.findByType('ReflectionSheet' as never).props.verseKey).toBe(layout.lines[3].words[0].verseKey);
    await act(async () => root.root.findByType('ReflectionSheet' as never).props.onClose());
    await tapLine(4, 405);
    await afterTapWindow();
    await press(hosts('mushaf-ayah-actions-backdrop')[0]); // dismissed: the ayah is no longer selected
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
    // Only the inks differ from the light page: the same paths, in the same order and fill rules.
    const shape = () => frame().map((node) => [node.props.d, node.props.fillRule]);
    const dark = shape();
    await act(async () => root.unmount());
    state.theme = 'light';
    await render();
    expect(shape()).toEqual(dark);
    expect(new Set(frame().map((node) => node.props.fill))).toEqual(new Set(Object.values(BORDER_INKS)));
  });

  it('Dark Mode: the ayah popup`s lamp is the lit lamp in the dark green outline, filled with the same bright yellow', async () => {
    state.theme = 'dark';
    await render();
    await tapPage(100, 130);
    await afterTapWindow();
    const popup = hosts('mushaf-ayah-actions')[0];
    expect(popup.findByType(ReflectionBulbIcon as never).props).toMatchObject({ lit: true, color: MUSHAF_PANEL_COLORS.dark.saved, fill: MUSHAF_PANEL_COLORS.dark.activeFill });
    expect(popup.findByProps({ testID: 'reflection-bulb-glass' }).props.fill).toBe('#FFC000');
    expect(popup.findByProps({ testID: 'reflection-bulb-lit' }).props.stroke).toBe(MUSHAF_PANEL_COLORS.dark.saved);
    expect(styleOf(popup)).toMatchObject({ backgroundColor: MUSHAF_PANEL_COLORS.dark.sheet.backgroundColor });
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
      // Not a page 605: there is no next page, and nothing was saved.
      await turnPage(1);
      expect(currentPage()).toBe(604);
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
    expect(texts()).toEqual(expect.arrayContaining(['اختر وِردًا أولًا', 'اختر الوِرد الذي أتممته من اسم الوِرد أسفل الصفحة، ثم حاول مرة أخرى.']));
    expect(root.root.findAllByProps({ testID: 'mushaf-khatma-noWird-confirm' })).toHaveLength(0);
    await press(root.root.findAllByProps({ testID: 'mushaf-khatma-noWird-cancel' }).find((node) => String(node.type) === 'Pressable')!);
    expect(notice('noWird')).toHaveLength(0);
    for (const [key, value] of before) expect(state.storage.get(key), key).toBe(value);
    // Only the device's last browsed page (mushaf/lastBrowsedPage.ts) — never a ورد, cycle or Khatma.
    expect([...state.storage.keys()].filter((key) => !before.has(key))).toEqual(['quran-heals:mushaf-last-page:v1']);
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
    await openNameField();
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
    await openNameField();
    await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText(name));
    await press(button(copy().confirmStop));
    await flush();
  }

  it('showing, turning to or searching page 604 offers nothing and counts nothing', async () => {
    fajrAt(300);
    state.params = { page: '603' };
    await render();
    await turnPage(1);
    await flush();
    await turnPage(1);
    expect(currentPage()).toBe(604); // the last page
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

  it('keeps the approved page width where the width decides, and takes the retired bar`s space where the height decides', async () => {
    // iPhone 15 (393 × 852, insets 59 / 34) below its 36-pt Back row: the approved 387-pt page (not 354 above a tab bar).
    expect(fitMushafPage({ width: 393, height: 852 - 59 - 36 }, 34).page.width).toBe(387);
    // iPhone SE: 324 (317 with the bar's space reserved; 280 above a tab bar). (611 − 4 − 32) ÷ 1.7089 = 336 would bring
    // its last line under the page selector's card; 324 is the widest whose text ends 4 pt above it.
    expect(fitMushafPage({ width: 375, height: 667 - 20 - 36 }, 0).page.width).toBe(324);
    await render();
    expect(hosts('mushaf-panel')).toHaveLength(0);
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
    await turnPage(1);
    await act(async () => root.update(createElement(MushafScreen)));
    await flush();
    expect(pageNow()).toBe(301);
  });
});

describe('an ayah`s reference on its card (/mushaf?page=N&ayah=S:A&at=…): its page, that ayah selected', () => {
  const selection = () => inPage().findAllByProps({ testID: 'mushaf-selection' });
  const reflectionVerse = () => root.root.findByType('ReflectionSheet' as never).props.verseKey;

  it('opens the page holding the ayah with that ayah selected, as a tap would — no popup opens by itself', async () => {
    state.params = { page: '61', ayah: '3:85', at: '1' };
    await render();
    await flush();
    expect(currentPage()).toBe(61);
    expect(selection().length).toBeGreaterThan(0);
    expect(reflectionVerse()).toBe('3:85');
    await afterTapWindow();
    expect(hosts('mushaf-ayah-actions')).toHaveLength(0);
    // It is an ordinary selection: a tap elsewhere on the page moves it, turning the page clears it.
    await turnPage(1);
    await flush();
    expect(reflectionVerse()).toBeNull();
  });

  it('an ayah that is not on the requested page (or not an ayah) selects nothing; the page still opens', async () => {
    for (const ayah of ['2:255', '1:8', 'garbage', '']) {
      state.params = { page: '61', ayah, at: '1' };
      await render();
      await flush();
      expect(currentPage(), ayah).toBe(61);
      expect(selection(), ayah).toHaveLength(0);
      expect(reflectionVerse(), ayah).toBeNull();
      await act(async () => root.unmount());
    }
  });

  it('a later reference while the reader is open moves it to that page and selects that ayah; each tap is a new request', async () => {
    state.params = { page: '61' };
    await render();
    expect(reflectionVerse()).toBeNull();
    state.params = { page: '61', ayah: '3:86', at: '1' };
    await act(async () => root.update(createElement(MushafScreen)));
    await flush();
    expect(currentPage()).toBe(61);
    expect(reflectionVerse()).toBe('3:86');
    // Another ayah elsewhere: its page, not yet downloaded — the existing Offline Mushaf state, never a website.
    state.params = { page: '465', ayah: '39:62', at: '2' };
    await act(async () => root.update(createElement(MushafScreen)));
    await flush();
    expect(currentPage()).toBe(465);
    expect(inPage().findByProps({ testID: 'mushaf-page-missing' })).toBeDefined();
    expect(hosts('offline-mushaf').length).toBeGreaterThan(0);
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

describe('the ورد name field (the ورد list`s Add): "Saved" after a save; ورد data per owner; page 604', () => {
  const stop = (id: string, name: string, page: number, day: number) => ({ id, name, page, updatedAt: `2026-10-0${day}T00:00:00.000Z` });
  const seed = (stops: ReturnType<typeof stop>[], active?: string) => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify(stops));
    if (active) state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, active);
  };
  const toast = () => root.root.findAllByProps({ testID: 'mushaf-saved-toast' }).filter((node) => String(node.type) === 'View');
  const saveHere = async (name?: string) => {
    await openNameField();
    if (name !== undefined) await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText(name));
    await press(button(copy().confirmStop));
    await flush();
  };
  const savedStops = () => JSON.parse(state.storage.get(READING_STOPS_STORAGE_KEY) ?? '[]') as { id: string; name: string; page: number }[];
  const pillName = () => root.root.findByProps({ testID: 'mushaf-wird' }).findByType('Text' as never).props.children;

  it('"Saved" appears briefly only after the page is saved on the device — once for repeated saves, never on failure', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    seed([stop('fajr', 'ورد الفجر', 20, 1)], 'fajr');
    await render();
    expect(toast()).toHaveLength(0);
    // A failed save: the reason in the field, no "Saved", the bookmark unchanged.
    await openNameField();
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    await press(button(copy().confirmStop));
    expect(texts()).toContain(copy().stopSaveFailed);
    expect(toast()).toHaveLength(0);
    expect(savedStops()).toEqual([expect.objectContaining({ id: 'fajr', page: 20 })]);
    // The retry saves: the field closes and "Saved" shows, without blocking the page.
    await press(button(copy().confirmStop));
    await flush();
    expect(toast()).toHaveLength(1);
    expect(toast()[0].props.pointerEvents).toBe('none');
    expect(texts().filter((text) => text === 'Saved')).toEqual(['Saved']);
    expect(savedStops()).toEqual([expect.objectContaining({ id: 'fajr', page: 61 })]);
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
    const { SAVED_TOAST_MS } = await import('@/components/MushafStopNameField');
    seed([stop('fajr', 'ورد الفجر', 20, 1)], 'fajr');
    await render();
    await saveHere();
    expect(toast()).toHaveLength(1);
    await act(async () => { await new Promise((done) => setTimeout(done, SAVED_TOAST_MS + 50)); });
    expect(toast()).toHaveLength(0);
    expect(savedStops()).toEqual([expect.objectContaining({ id: 'fajr', page: 61 })]);
  });

  for (const locale of ['ar', 'ar-EG'] as const) {
    it(`${locale}: "تم الحفظ"`, async () => {
      state.locale = locale;
      seed([stop('fajr', 'ورد الفجر', 20, 1)], 'fajr');
      await render();
      await saveHere();
      expect(MESSAGES[locale].mushaf.stopSaved).toBe('تم الحفظ');
      expect(texts()).toContain('تم الحفظ');
    });
  }

  it('English: exactly "Saved"', () => {
    expect(MESSAGES.en.mushaf.stopSaved).toBe('Saved');
  });

  it('the guest`s and an account`s أوراد are separate: switching owner shows that owner`s own ورد', async () => {
    const { setLocalDataOwnerState } = await import('@/storage/localDataOwner');
    seed([stop('fajr', 'ورد الفجر', 61, 1)], 'fajr');
    state.storage.set(`${READING_STOPS_STORAGE_KEY}:account:user-a`, JSON.stringify([stop('acct', 'Account ورد', 300, 1)]));
    state.storage.set(`${ACTIVE_READING_STOP_STORAGE_KEY}:account:user-a`, 'acct');
    await render();
    expect(pillName()).toBe('ورد الفجر'); // the guest's ورد
    await act(async () => setLocalDataOwnerState({ activeUserId: 'user-a', keptSeparate: [], resolved: true }));
    await flush();
    expect(pillName()).toBe('Account ورد'); // the account's own
    await act(async () => setLocalDataOwnerState({ activeUserId: null, keptSeparate: [], resolved: true }));
    await flush();
    expect(pillName()).toBe('ورد الفجر');
  });

  it('page 604: saving still asks to confirm the Khatma (never automatic); once confirmed, the ورد starts again on page 1, so 604 is no longer its saved page', async () => {
    seed([stop('fajr', 'ورد الفجر', 600, 1)], 'fajr');
    state.params = { page: '604' };
    await render();
    await saveHere();
    expect(savedStops()).toEqual([expect.objectContaining({ id: 'fajr', page: 604 })]);
    const sheet = root.root.findAllByProps({ testID: 'khatma-reached' }).filter((node) => String(node.type) === 'View');
    expect(sheet).toHaveLength(1);
    expect(JSON.parse(state.storage.get('quran-heals:mushaf-khatmas:v1') ?? '{"records":[]}').records).toHaveLength(0);
    await press(root.root.findAllByProps({ testID: 'khatma-reached-confirm' }).find((node) => String(node.type) === 'Pressable')!);
    await flush();
    expect(JSON.parse(state.storage.get('quran-heals:mushaf-khatmas:v1')!).records).toHaveLength(1);
    expect(savedStops()).toEqual([expect.objectContaining({ id: 'fajr', page: 1 })]);
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
    await turnPage(1);
    await flush();
    expect(currentPage()).toBe(62);
    expect([x(63), x(62), x(61)]).toEqual([-W, 0, W]);
    await pinch(2);
    expect(zoom().scale).toBe(2);
    await turnPage(-1);
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
    // Pages 1–2 (the opening design) line up with every other page: the same inset at every size, the heads on the
    // same sides, the header's height and the page below unchanged.
    for (const n of [1, 2]) {
      for (const width of [251, 338, 384, 434]) {
        const sized = computePageLayout(width);
        const page = await draw(n, true, width);
        expect(page.header.paddingHorizontal, `page ${n}, width ${width}`).toBeCloseTo(sized.inner.x - sized.frame.x);
        expect(page.header.height, `page ${n}, width ${width}`).toBe(sized.header.height);
        expect(page.heads, `page ${n}`).toEqual(['mushaf-header-surah', 'mushaf-header-juz']);
      }
    }
  });
});

/**
 * The 2026-10-14 navigation and interaction redesign (the earlier bar: design-archive/mushaf-navigation-v1/):
 * the running heads and page number as navigation, the compact page selector, the ayah's two actions, the
 * separator's Apply-to-ورد, the diagonal full-screen toggle. Through the real reader, as above.
 */
describe('the redesigned navigation and ayah actions', () => {
  const MEASURE_WIDTH = 900;
  const seedWird = (name = 'Fajr', page = 20) => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'fajr', name, page, updatedAt: '2026-10-01T00:00:00.000Z' }]));
    state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
  };
  const stops = () => JSON.parse(state.storage.get(READING_STOPS_STORAGE_KEY) ?? '[]') as { id: string; name: string; page: number }[];
  const khatmaRecords = () => (JSON.parse(state.storage.get('quran-heals:mushaf-khatmas:v1') ?? '{"records":[]}') as { records: unknown[] }).records;
  /** Every page drawn from the device (page 61's verified lines under each page's own number), so any page has its heads. */
  const everyPageDrawn = () => state.offline.readPage.mockImplementation(async (n: number) => ({ ...syntheticQpcPage61(), page: n, fontFamily: `QCF_P${String(n).padStart(3, '0')}` }));
  async function renderQpc(layout = syntheticQpcPage61()) {
    state.fetch.mockResolvedValue(layoutResponse(200, { success: true, data: layout }));
    await render();
  }
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
  /** A tap on line `line` at `locationX`, as on a phone (pageX / pageY: where the popup is placed). */
  const tapLine = async (line: number, locationX: number) => {
    const row = root.root.findByProps({ testID: `qpc-line-${line}` });
    const locationY = await drawnLineY(row);
    await act(async () => row.props.onPress({ nativeEvent: { locationX, locationY, pageX: 200, pageY: 420 } }));
  };
  /** The x of a word on its line after layOut (words 20 pt wide, right to left from 400). */
  const xOfWord = (index: number, inset = 10) => 400 - index * 30 + inset;
  /** Where on the synthetic page 61 a verse's separator medallion (its 'end' word) is. */
  const markerOf = (layout: ReturnType<typeof syntheticQpcPage61>, verseKey: string) => {
    for (const line of layout.lines) {
      const index = line.words.findIndex((word) => word.kind === 'end' && word.verseKey === verseKey);
      if (index >= 0) return { line: line.line, x: xOfWord(index) };
    }
    throw new Error(`no marker for ${verseKey}`);
  };
  const wordOf = (layout: ReturnType<typeof syntheticQpcPage61>, verseKey: string) => {
    for (const line of layout.lines) {
      const index = line.words.findIndex((word) => word.kind === 'word' && word.verseKey === verseKey);
      if (index >= 0) return { line: line.line, x: xOfWord(index) };
    }
    throw new Error(`no word for ${verseKey}`);
  };
  const onlyHost = (testID: string) => {
    const nodes = hosts(testID);
    expect(nodes, testID).toHaveLength(1);
    return nodes[0];
  };
  const textOf = (node: ReactTestInstance) => node.findAllByType('Text' as never).map((t) => [t.props.children].flat().join('')).join('|');

  describe('Surah, juz` and Hizb lists from the running heads', () => {
    it('the Surah name opens all 114 Surahs; a Surah that begins partway down a page opens that page; first and last Surahs', async () => {
      everyPageDrawn();
      state.params = { page: '61' };
      await render();
      await press(onlyHost('mushaf-nav-surah'));
      const sheet = onlyHost('mushaf-index-sheet');
      expect(textOf(sheet)).toContain(copy().navSurahTitle);
      const list = () => root.root.findByProps({ testID: 'mushaf-index-list' });
      expect(list().props.data).toHaveLength(114);
      // Opened at the current Surah (page 61 is in Āl ʿImrān).
      expect(list().props.data[list().props.initialScrollIndex].number).toBe(3);
      // Al-Māʾidah begins partway down page 106: that page opens; the page itself is unchanged.
      await act(async () => root.root.findByProps({ testID: 'mushaf-index-search' }).props.onChangeText('المائدة'));
      expect(list().props.data.map((r: { number: number }) => r.number)).toEqual([5]);
      await press(onlyHost('mushaf-index-surah-5'));
      await flush();
      expect(currentPage()).toBe(SURAH_START_PAGES[4]);
      expect(currentPage()).toBe(106);
      expect(hosts('mushaf-index-sheet')).toHaveLength(0);
      for (const [query, surah, page] of [['Fatiha', 1, 1], ['nas', 114, 604]] as const) {
        await press(onlyHost('mushaf-nav-surah'));
        await act(async () => root.root.findByProps({ testID: 'mushaf-index-search' }).props.onChangeText(query));
        await press(onlyHost(`mushaf-index-surah-${surah}`));
        await flush();
        expect(currentPage(), query).toBe(page);
      }
    });

    it('the juz` label opens the 30 juz`, searchable by number in either digits; each opens its first page', async () => {
      everyPageDrawn();
      await render();
      await press(onlyHost('mushaf-nav-juz'));
      const list = () => root.root.findByProps({ testID: 'mushaf-index-list' });
      expect(list().props.data).toHaveLength(30);
      expect(list().props.data[list().props.initialScrollIndex].number).toBe(3); // page 61: juz' 3
      expect(textOf(onlyHost('mushaf-index-juz-1'))).toContain("Juz' 1");
      await act(async () => root.root.findByProps({ testID: 'mushaf-index-search' }).props.onChangeText('٣٠'));
      expect(list().props.data.map((r: { number: number }) => r.number)).toEqual([30]);
      await press(onlyHost('mushaf-index-juz-30'));
      await flush();
      expect(currentPage()).toBe(582);
    });

    it('the Hizb label (where one is printed) opens the 60 whole Hizbs, never quarter markers', async () => {
      const { HIZB_QUARTER_STARTS } = await import('@/mushaf/generated/hizbQuarters');
      everyPageDrawn();
      // A page whose label is a quarter marker (ربع الحزب …), not a Hizb start.
      const quarterPage = HIZB_QUARTER_STARTS.find(([quarter]) => (quarter - 1) % 4 === 1)![2];
      state.params = { page: String(quarterPage) };
      await render();
      expect(inPage().findByProps({ testID: 'mushaf-hizb-label' }).props.children).toMatch(/^ربع الحزب/);
      await press(onlyHost('mushaf-nav-hizb'));
      const list = root.root.findByProps({ testID: 'mushaf-index-list' });
      expect(list.props.data).toHaveLength(60);
      expect(list.props.data.every((r: { primary: string }) => /^Hizb \d+$/.test(r.primary))).toBe(true);
      await press(onlyHost('mushaf-index-hizb-2'));
      await flush();
      expect(currentPage()).toBe(HIZB_QUARTER_STARTS[4][2]); // Hizb 2 = quarter 5
      // No Hizb printed on the page: no Hizb touch area.
      await act(async () => root.unmount());
      state.params = { page: '61' };
      await render();
      expect(hosts('mushaf-nav-hizb')).toHaveLength(0);
    });

    it('Arabic: the lists in Arabic, the digits Arabic-Indic; the field in the reader`s own field colours, light and dark', async () => {
      for (const theme of ['light', 'dark'] as const) {
        state.locale = 'ar';
        state.theme = theme;
        everyPageDrawn();
        await render();
        await press(onlyHost('mushaf-nav-juz'));
        expect(textOf(onlyHost('mushaf-index-juz-12'))).toContain('الجزء ١٢');
        const field = root.root.findByProps({ testID: 'mushaf-index-search' });
        expect(field.props.placeholder).toBe(MESSAGES.ar.mushaf.juzSearchPlaceholder);
        expect(styleOf(field)).toMatchObject({ backgroundColor: MUSHAF_PANEL_COLORS[theme].input.backgroundColor, borderColor: MUSHAF_PANEL_COLORS[theme].input.borderColor });
        await act(async () => root.unmount());
      }
    });

    it('the heads`s touch areas lie over the printed heads and the frame`s band, never over the Quran text, and draw nothing', async () => {
      everyPageDrawn();
      await render();
      const textArea = styleOf(inPage().findByProps({ testID: 'mushaf-text-area' }));
      const numberTop = (node: ReactTestInstance) => styleOf(node).top as number;
      for (const id of ['mushaf-nav-surah', 'mushaf-nav-juz']) {
        const area = onlyHost(id);
        const bottom = (styleOf(area).top as number) + (styleOf(area).height as number) + area.props.hitSlop.bottom;
        expect(bottom, id).toBeLessThan(textArea.top as number);
        expect(styleOf(area).height + area.props.hitSlop.bottom, id).toBeCloseTo(44, 0);
        expect(area.children, id).toHaveLength(0);
      }
      const pageArea = onlyHost('mushaf-nav-page');
      expect(numberTop(pageArea) - pageArea.props.hitSlop.top).toBeGreaterThan((textArea.top as number) + (textArea.height as number));
      expect(pageArea.children).toHaveLength(0);
      // The page number stays where it was printed: below the frame (outside it).
      const frame = inPage().findByProps({ testID: 'mushaf-frame' });
      expect(numberTop(pageArea)).toBeGreaterThan(frame.props.height);
    });

    it('only the page being read is touchable: its neighbours, drawn beside it for a swipe, have no touch areas', async () => {
      everyPageDrawn();
      await render();
      expect(hosts('mushaf-nav-page')).toHaveLength(1);
      expect(hosts('mushaf-nav-surah')).toHaveLength(1);
    });
  });

  describe('the compact page selector (the page number)', () => {
    const slider = () => onlyHost('mushaf-page-slider');
    const W = 300;
    const at = async (x: number, phase: 'onResponderGrant' | 'onResponderMove' = 'onResponderMove') => {
      await act(async () => slider().props[phase]({ nativeEvent: { locationX: x } }));
    };
    async function open() {
      await press(onlyHost('mushaf-nav-page'));
      await act(async () => slider().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: W, height: 36 } } }));
    }
    const shownSelected = () => onlyHost('mushaf-page-selector-number').findByType('Text' as never).props.children;
    const centre = () => onlyHost('mushaf-page-selector').findAll((n) => typeof n.type === 'string' && /^mushaf-page-(go-left|go-right|selector-number|selector-input)$/.test(String(n.props.testID))).map((n) => n.props.testID);

    it('opens at the page being read, compact: Surah on the left, the number in the centre, the juz` on the right; no arrow', async () => {
      everyPageDrawn();
      await render();
      await open();
      const card = onlyHost('mushaf-page-selector');
      // 14 pt from each side and just above the bottom safe area, as before; in the layout at the bottom of the
      // KeyboardAvoidingView (not absolute), so the keyboard can lift it (see the keyboard tests below).
      expect(styleOf(card)).toMatchObject({ marginHorizontal: 14, marginBottom: state.insets.bottom + 8, borderRadius: 18 });
      expect(styleOf(card).position).toBeUndefined();
      expect(styleOf(card.parent!)).toMatchObject({ flex: 1, justifyContent: 'flex-end' });
      expect(shownSelected()).toBe('61');
      expect(onlyHost('mushaf-page-selector-surah').props.children).toBe('Aal-i-Imraan');
      expect(onlyHost('mushaf-page-selector-juz').props.children).toBe("Juz' 3");
      expect(centre()).toEqual(['mushaf-page-selector-number']);
      // Physically fixed: the top row never mirrors.
      const row = onlyHost('mushaf-page-selector-surah').parent!;
      expect(styleOf(row).flexDirection).toBe('row');
      expect(row.children.map((c) => (c as ReactTestInstance).props.testID ?? 'centre')).toEqual(['mushaf-page-selector-surah', 'centre', 'mushaf-page-selector-juz']);
    });

    it('the RTL slider with a circular olive thumb: right end page 1, left end 604; dragging left raises the page; the preview updates live; the Mushaf stays', async () => {
      everyPageDrawn();
      await render();
      await open();
      const thumb = () => styleOf(onlyHost('mushaf-page-slider-thumb'));
      expect(thumb()).toMatchObject({ width: 22, height: 22, borderRadius: 11, backgroundColor: MUSHAF_PANEL_COLORS.light.accent });
      expect(slider().props.accessibilityRole).toBe('adjustable');
      state.offline.readPage.mockClear();
      await at(W, 'onResponderGrant');
      expect(shownSelected()).toBe('1');
      expect(onlyHost('mushaf-page-selector-surah').props.children).toBe('Al-Faatiha');
      expect(thumb().left).toBeCloseTo(W - 11);
      await at(0);
      expect(shownSelected()).toBe('604');
      expect(onlyHost('mushaf-page-selector-juz').props.children).toBe("Juz' 30");
      expect(onlyHost('mushaf-page-selector-surah').props.children).toBe('Al-Ikhlaas'); // page 604 begins with Al-Ikhlāṣ
      expect(thumb().left).toBeCloseTo(-11);
      // Moving left raises the page, step by step; whole pages only.
      const seen: number[] = [];
      for (let x = W; x >= 0; x -= 7) {
        await at(x);
        seen.push(Number(shownSelected()));
      }
      expect(seen.every((n, i) => Number.isInteger(n) && (i === 0 || n >= seen[i - 1]))).toBe(true);
      // Only a preview: the Mushaf never moved, and no page was read while sliding.
      expect(currentPage()).toBe(61);
      expect(state.offline.readPage).not.toHaveBeenCalled();
      // Screen readers: increment raises the page by one.
      await at(W / 2);
      const before = Number(shownSelected());
      await act(async () => slider().props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
      expect(Number(shownSelected())).toBe(before + 1);
    });

    it('a later page: a left arrow on the number`s left ("← 200"); an earlier: a right arrow on its right ("60 →"); the same page: none — in English and Arabic alike', async () => {
      for (const locale of ['en', 'ar'] as const) {
        state.locale = locale;
        everyPageDrawn();
        state.params = { page: '125' };
        await render();
        await open();
        const pageAt = (page: number) => W - ((page - 1) / 603) * W;
        await at(pageAt(200));
        expect(centre(), locale).toEqual(['mushaf-page-go-left', 'mushaf-page-selector-number']);
        expect(onlyHost('mushaf-page-go-left').findAllByType('ArrowLeft' as never)).toHaveLength(1);
        await at(pageAt(60));
        expect(centre(), locale).toEqual(['mushaf-page-selector-number', 'mushaf-page-go-right']);
        expect(onlyHost('mushaf-page-go-right').findAllByType('ArrowRight' as never)).toHaveLength(1);
        await at(pageAt(125));
        expect(centre(), locale).toEqual(['mushaf-page-selector-number']);
        await act(async () => root.unmount());
      }
    });

    it('the arrow goes to exactly that page and closes; dismissing goes nowhere', async () => {
      everyPageDrawn();
      await render();
      await open();
      await at(W - (199 / 603) * W);
      expect(shownSelected()).toBe('200');
      await press(onlyHost('mushaf-page-go-left'));
      await flush();
      expect(currentPage()).toBe(200);
      expect(hosts('mushaf-page-selector')).toHaveLength(0);
      // Dismissed after choosing another page: nothing changes.
      await open();
      await at(W);
      await press(onlyHost('mushaf-page-selector-backdrop'));
      await flush();
      expect(currentPage()).toBe(200);
      expect(hosts('mushaf-page-selector')).toHaveLength(0);
    });

    it('typing a page: Western or Arabic-Indic digits; the preview and arrow follow; anything not 1–604 shows the reason and cannot go', async () => {
      everyPageDrawn();
      await render();
      await open();
      await press(onlyHost('mushaf-page-selector-number'));
      const field = () => onlyHost('mushaf-page-selector-input');
      // The reader's own field colours (the same in the reader everywhere), a number pad.
      expect(styleOf(field())).toMatchObject({ backgroundColor: MUSHAF_PANEL_COLORS.light.input.backgroundColor, borderColor: MUSHAF_PANEL_COLORS.light.input.borderColor });
      expect(field().props.keyboardType).toBe('number-pad');
      await act(async () => field().props.onChangeText('٢٠٠'));
      expect(onlyHost('mushaf-page-selector-juz').props.children).toBe("Juz' 10");
      expect(centre()).toEqual(['mushaf-page-go-left', 'mushaf-page-selector-input']);
      for (const bad of ['700', '0']) {
        await act(async () => field().props.onChangeText(bad));
        expect(centre(), bad).toEqual(['mushaf-page-selector-input']); // no arrow: nothing to go to
        expect(texts(), bad).toContain(copy().pageOutOfRange);
        await act(async () => field().props.onSubmitEditing());
        expect(currentPage(), bad).toBe(61);
      }
      await act(async () => field().props.onChangeText('45'));
      expect(centre()).toEqual(['mushaf-page-selector-input', 'mushaf-page-go-right']);
      await press(onlyHost('mushaf-page-go-right')); // the arrow works with the keyboard open
      await flush();
      expect(currentPage()).toBe(45);
    });

    it('dark: the card and its field in the reader`s dark colours', async () => {
      state.theme = 'dark';
      everyPageDrawn();
      await render();
      await open();
      expect(styleOf(onlyHost('mushaf-page-selector'))).toMatchObject({ backgroundColor: MUSHAF_PANEL_COLORS.dark.sheet.backgroundColor });
      await press(onlyHost('mushaf-page-selector-number'));
      expect(styleOf(onlyHost('mushaf-page-selector-input'))).toMatchObject({ backgroundColor: MUSHAF_PANEL_COLORS.dark.input.backgroundColor });
    });

    describe('typing a page with the keyboard open', () => {
      const keyboard = async (event: 'keyboardWillShow' | 'keyboardWillHide') => {
        await act(async () => { state.keyboardListeners.get(event)?.forEach((listener) => listener()); });
      };
      const centreWithGo = () => onlyHost('mushaf-page-selector').findAll((n) => typeof n.type === 'string' && /^mushaf-page-(go-button|go-left|go-right|selector-number|selector-input)$/.test(String(n.props.testID))).map((n) => n.props.testID);
      const field = () => onlyHost('mushaf-page-selector-input');
      const dismissCalls = async () => (await import('react-native')).Keyboard.dismiss as unknown as { mock: { calls: unknown[] } };
      async function typing() {
        everyPageDrawn();
        await render();
        await open();
        await press(onlyHost('mushaf-page-selector-number'));
        await keyboard('keyboardWillShow');
      }

      it('the card rides above the keyboard: it sits at the bottom of the avoiding view, its bottom margin drops the safe area while the keyboard is up, and returns when it hides', async () => {
        await typing();
        const card = () => onlyHost('mushaf-page-selector');
        expect(card().parent!.type).toBe('KeyboardAvoidingView');
        expect(card().parent!.props.behavior).toBe('padding');
        expect(styleOf(card())).toMatchObject({ marginBottom: 8 });
        expect(field().props.value).toBe('');
        await act(async () => field().props.onChangeText('12'));
        expect(field().props.value).toBe('12'); // the digits being typed stay in the visible field
        await keyboard('keyboardWillHide');
        expect(styleOf(card())).toMatchObject({ marginBottom: state.insets.bottom + 8 });
        expect(field().props.value).toBe('12');
      });

      it('Go appears only while a whole, valid, different page is typed, on the arrow`s outer side: "Go ← 200" for a later page, "45 → Go" for an earlier one', async () => {
        await typing();
        expect(centreWithGo()).toEqual(['mushaf-page-selector-input']); // nothing typed yet
        await act(async () => field().props.onChangeText('200'));
        expect(centreWithGo()).toEqual(['mushaf-page-go-button', 'mushaf-page-go-left', 'mushaf-page-selector-input']);
        expect(texts()).toContain(copy().goToPageShort);
        await act(async () => field().props.onChangeText('45'));
        expect(centreWithGo()).toEqual(['mushaf-page-selector-input', 'mushaf-page-go-right', 'mushaf-page-go-button']);
        for (const notAPage of ['0', '605', '700', '61']) {
          await act(async () => field().props.onChangeText(notAPage));
          expect(centreWithGo(), notAPage).toEqual(['mushaf-page-selector-input']);
        }
        // The slider too: the same Go beside the arrow.
        await act(async () => onlyHost('mushaf-page-slider').props.onResponderGrant({ nativeEvent: { locationX: 0 } }));
        expect(centreWithGo()).toEqual(['mushaf-page-go-button', 'mushaf-page-go-left', 'mushaf-page-selector-number']);
      });

      it('the centre is a fixed width while typing (room for Go on either side), so the Surah and juz` never move as Go switches sides', async () => {
        await typing();
        const centre = () => onlyHost('mushaf-page-go-button').parent!;
        await act(async () => field().props.onChangeText('200'));
        const later = styleOf(centre()).width;
        await act(async () => field().props.onChangeText('45'));
        expect(styleOf(centre()).width).toBe(later);
        expect(later).toBe(184);
      });

      it('Go goes to exactly the typed page (the first and the last page too), then closes the keyboard and the selector', async () => {
        for (const target of [604, 1]) {
          await typing();
          const dismiss = await dismissCalls();
          const before = dismiss.mock.calls.length;
          await act(async () => field().props.onChangeText(String(target)));
          await press(onlyHost('mushaf-page-go-button'));
          await flush();
          expect(currentPage(), String(target)).toBe(target);
          expect(hosts('mushaf-page-selector')).toHaveLength(0);
          expect(dismiss.mock.calls.length).toBeGreaterThan(before);
          await act(async () => root.unmount());
        }
      });

      it('an invalid number never goes: neither Go (absent), nor the keyboard`s submit', async () => {
        await typing();
        for (const bad of ['0', '605', '999']) {
          await act(async () => field().props.onChangeText(bad));
          expect(hosts('mushaf-page-go-button'), bad).toHaveLength(0);
          await act(async () => field().props.onSubmitEditing());
          expect(currentPage(), bad).toBe(61);
          expect(hosts('mushaf-page-selector'), bad).toHaveLength(1);
        }
      });

      it('iOS: the number pad gets a Done bar (it has no return key); Done closes only the keyboard and keeps the number', async () => {
        await typing();
        await act(async () => field().props.onChangeText('300'));
        const bar = root.root.findAllByType('InputAccessoryView' as never)[0];
        expect(bar.props.nativeID).toBe(field().props.inputAccessoryViewID);
        const done = onlyHost('mushaf-page-selector-done');
        expect(done.props).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: copy().keyboardDone });
        const dismiss = await dismissCalls();
        const before = dismiss.mock.calls.length;
        await press(done);
        await keyboard('keyboardWillHide');
        expect(dismiss.mock.calls.length).toBe(before + 1);
        expect(hosts('mushaf-page-selector')).toHaveLength(1);
        expect(field().props.value).toBe('300');
        expect(currentPage()).toBe(61);
        // Go still goes once the keyboard is down.
        await press(onlyHost('mushaf-page-go-button'));
        await flush();
        expect(currentPage()).toBe(300);
      });

      it('a tap outside the field while the keyboard is up closes only the keyboard (on the dimmed screen or the card); with the keyboard down, outside closes the selector as before', async () => {
        await typing();
        await act(async () => field().props.onChangeText('120'));
        const dismiss = await dismissCalls();
        const before = dismiss.mock.calls.length;
        await press(onlyHost('mushaf-page-selector-backdrop'));
        expect(dismiss.mock.calls.length).toBe(before + 1);
        expect(hosts('mushaf-page-selector')).toHaveLength(1);
        expect(field().props.value).toBe('120');
        // The card itself, outside its controls.
        const card = onlyHost('mushaf-page-selector');
        expect(card.props.onStartShouldSetResponder()).toBe(true);
        await act(async () => card.props.onResponderRelease());
        expect(dismiss.mock.calls.length).toBe(before + 2);
        await keyboard('keyboardWillHide');
        expect(onlyHost('mushaf-page-selector').props.onStartShouldSetResponder()).toBe(false); // keyboard down: the card no longer catches taps
        await press(onlyHost('mushaf-page-selector-backdrop'));
        await flush();
        expect(hosts('mushaf-page-selector')).toHaveLength(0);
        expect(currentPage()).toBe(61);
      });

      it('Arabic: the same physical placement (never mirrored), with the Arabic Go and Done', async () => {
        state.locale = 'ar';
        await typing();
        await act(async () => field().props.onChangeText('٢٠٠'));
        expect(centreWithGo()).toEqual(['mushaf-page-go-button', 'mushaf-page-go-left', 'mushaf-page-selector-input']);
        expect(texts()).toContain('اذهب');
        expect(onlyHost('mushaf-page-selector-done').props.accessibilityLabel).toBe('تم');
        await act(async () => field().props.onChangeText('٤٥'));
        expect(centreWithGo()).toEqual(['mushaf-page-selector-input', 'mushaf-page-go-right', 'mushaf-page-go-button']);
      });

      it('the slider shows the same Go: dragging to a later or an earlier page shows it on the arrow`s outer side; back to the current page hides it; dragging alone never goes', async () => {
        everyPageDrawn();
        await render();
        await press(onlyHost('mushaf-nav-page'));
        const W = 300;
        const slider = () => onlyHost('mushaf-page-slider');
        await act(async () => slider().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: W, height: 36 } } }));
        const pageAt = (page: number) => W - ((page - 1) / 603) * W;
        const drag = async (page: number) => { await act(async () => slider().props.onResponderMove({ nativeEvent: { locationX: pageAt(page) } })); };
        const shown = () => onlyHost('mushaf-page-selector-number').findByType('Text' as never).props.children;
        expect(centreWithGo()).toEqual(['mushaf-page-selector-number']);
        await drag(200);
        expect(shown()).toBe('200');
        expect(centreWithGo()).toEqual(['mushaf-page-go-button', 'mushaf-page-go-left', 'mushaf-page-selector-number']);
        await drag(45);
        expect(shown()).toBe('45');
        expect(centreWithGo()).toEqual(['mushaf-page-selector-number', 'mushaf-page-go-right', 'mushaf-page-go-button']);
        await drag(61);
        expect(centreWithGo()).toEqual(['mushaf-page-selector-number']);
        expect(currentPage()).toBe(61); // dragging never navigates
        // The same centre width with or without Go, so the Surah and juz` never move.
        const centre = () => styleOf(onlyHost('mushaf-page-selector-number').parent!).width;
        const without = centre();
        await drag(604);
        expect(centre()).toBe(without);
        expect(shown()).toBe('604');
        await press(onlyHost('mushaf-page-go-button'));
        await flush();
        expect(currentPage()).toBe(604);
        expect(hosts('mushaf-page-selector')).toHaveLength(0);
      });

      it('the slider`s first page: Go to page 1; and typing after sliding continues from the slid page (they stay in step)', async () => {
        everyPageDrawn();
        await render();
        await press(onlyHost('mushaf-nav-page'));
        const W = 300;
        await act(async () => onlyHost('mushaf-page-slider').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: W, height: 36 } } }));
        await act(async () => onlyHost('mushaf-page-slider').props.onResponderMove({ nativeEvent: { locationX: W } }));
        expect(onlyHost('mushaf-page-selector-number').findByType('Text' as never).props.children).toBe('1');
        // Typing starts from the slid page (the field's hint), and a typed page moves the slider's thumb.
        await press(onlyHost('mushaf-page-selector-number'));
        expect(field().props.placeholder).toBe('1');
        await act(async () => field().props.onChangeText('300'));
        expect(styleOf(onlyHost('mushaf-page-slider-thumb')).left).toBeCloseTo(W - (299 / 603) * W - 11);
        await act(async () => field().props.onChangeText('1'));
        await press(onlyHost('mushaf-page-go-button'));
        await flush();
        expect(currentPage()).toBe(1);
      });

      it('going to a typed page only shows it: no ورد page, active ورد, cycle or Khatma is written', async () => {
        seedWird();
        await flush();
        const snapshot = () => [...state.storage.entries()].filter(([key]) => /reading-stop|khatma|active-reading/.test(key)).sort();
        await typing();
        const before = snapshot();
        await act(async () => field().props.onChangeText('500'));
        await press(onlyHost('mushaf-page-go-button'));
        await flush();
        expect(currentPage()).toBe(500);
        expect(snapshot()).toEqual(before);
      });
    });
  });

  describe('an ayah`s words: exactly Reflection, Save, Copy, Share and Listen', () => {
    const ayah = (verseKey: string) => ({
      id: verseKey, verseKey, referenceKey: verseKey, surahNumber: 3, surahNameArabic: 'آل عمران', surahNameEnglish: 'Aal-i-Imraan',
      ayahNumber: Number(verseKey.split(':')[1]), arabicText: '', englishTranslation: 'Say…', emotions: [], quranTextSource: 'tanzil', translationSource: 'pickthall',
    });

    it('opens after the double-tap window, near the ayah, with exactly five actions in order: Listen, the lit lamp, the heart, Copy, Share', async () => {
      await render();
      await tapPage(100, 130); // 3:85
      expect(hosts('mushaf-ayah-actions')).toHaveLength(0); // not yet: it may still be a double-tap
      await afterTapWindow();
      const popup = onlyHost('mushaf-ayah-actions');
      const actions = popup.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'button');
      expect(actions.map((n) => n.props.testID)).toEqual(['mushaf-ayah-listen', 'mushaf-ayah-reflection', 'mushaf-ayah-save', 'mushaf-ayah-copy', 'mushaf-ayah-share']);
      expect(textOf(popup)).toBe(`${MESSAGES.en.audio.listen}|${copy().actionReflection}|${copy().actionSave}|${copy().actionCopy}|${MESSAGES.en.ayah.share}`);
      // Share: the ayah screen's own icon (lucide share-2) and spoken label.
      expect(onlyHost('mushaf-ayah-share').findAllByType('Share2' as never)).toHaveLength(1);
      expect(onlyHost('mushaf-ayah-share').props.accessibilityLabel).toBe(MESSAGES.en.ayah.shareAyah);
      // No placeholder actions; Listen (2026-10-17) is a working action: recitation from this ayah (audio/engine.ts).
      expect(textOf(popup)).not.toMatch(/Audio|Tafs|Soon/i);
      expect(onlyHost('mushaf-ayah-listen').findAllByType('Headphones' as never)).toHaveLength(1);
      expect(onlyHost('mushaf-ayah-listen').props.accessibilityHint).toBe(MESSAGES.en.audio.listenHint);
      // The retired bar's enabled lamp, exactly: lit, its size, the saved green outline, the bright yellow glass.
      const lamp = popup.findByType(ReflectionBulbIcon as never).props;
      expect(lamp).toEqual({ lit: true, size: 23, color: MUSHAF_PANEL_COLORS.light.saved, fill: MUSHAF_PANEL_COLORS.light.activeFill });
      expect(popup.findByProps({ testID: 'reflection-bulb-glass' }).props.fill).toBe('#FFC000');
      expect(popup.findAllByProps({ testID: 'reflection-bulb-rays' }).length).toBeGreaterThan(0);
      // The Favorites heart (not a bookmark), outline while unsaved.
      expect(popup.findAllByType('Heart' as never)).toHaveLength(1);
      expect(popup.findAllByType('Bookmark' as never)).toHaveLength(0);
      // Small, rounded, light-theme sheet colours.
      expect(styleOf(popup)).toMatchObject({ borderRadius: 14, maxWidth: 300, backgroundColor: MUSHAF_PANEL_COLORS.light.sheet.backgroundColor });
    });

    it('Reflection opens the existing editor for exactly that ayah; nothing is saved to a ورد', async () => {
      seedWird();
      await render();
      const before = state.storage.get(READING_STOPS_STORAGE_KEY);
      await tapPage(100, 130);
      await afterTapWindow();
      await press(onlyHost('mushaf-ayah-reflection'));
      expect(root.root.findByType('ReflectionSheet' as never).props).toMatchObject({ visible: true, verseKey: '3:85' });
      expect(hosts('mushaf-ayah-actions')).toHaveLength(0);
      expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(before);
    });

    it('Save adds the ayah to Favorites and the popup stays open with the heart filled at once; Save again removes it and empties it; the state is kept when reopened; never a ورد or a Khatma', async () => {
      seedWird();
      state.fetch.mockImplementation(async (url: string) => (String(url).includes('/api/ayahs/') ? layoutResponse(200, { success: true, data: ayah(decodeURIComponent(String(url).split('/').pop()!)) }) : layoutResponse(503, { success: false })));
      await render();
      const before = state.storage.get(READING_STOPS_STORAGE_KEY);
      await tapPage(100, 130);
      await afterTapWindow();
      const heart = () => onlyHost('mushaf-ayah-save').findByType('Heart' as never).props;
      // Not yet saved: a red outline.
      expect(heart()).toMatchObject({ color: '#E44855', fill: 'transparent' });
      await press(onlyHost('mushaf-ayah-save'));
      await flush();
      // Saved: still open, the heart filled red at once (fill and stroke), Saved and the remove hint.
      expect(hosts('mushaf-ayah-actions')).toHaveLength(1);
      const favoritesStored = [...state.storage.entries()].find(([key]) => /favorites/.test(key));
      expect(favoritesStored?.[1]).toMatch(/3:85/);
      expect(onlyHost('mushaf-ayah-save').props.accessibilityState.selected).toBe(true);
      expect(hosts('mushaf-ayah-heart-saved')).not.toHaveLength(0);
      expect(heart()).toMatchObject({ color: '#E44855', fill: '#E44855' });
      expect(texts()).toContain(copy().actionSaved);
      expect(onlyHost('mushaf-ayah-save').props.accessibilityLabel).toBe(MESSAGES.en.favoriteButton.removeLabel);
      // Removed: still open, back to the red outline, Save and the add hint.
      await press(onlyHost('mushaf-ayah-save'));
      await flush();
      expect(hosts('mushaf-ayah-actions')).toHaveLength(1);
      expect(onlyHost('mushaf-ayah-save').props.accessibilityState.selected).toBe(false);
      expect(heart()).toMatchObject({ color: '#E44855', fill: 'transparent' });
      expect(texts()).toContain(copy().actionSave);
      expect(onlyHost('mushaf-ayah-save').props.accessibilityLabel).toBe(MESSAGES.en.favoriteButton.saveLabel);
      // Saved again, then closed and reopened: the popup shows the stored state.
      await press(onlyHost('mushaf-ayah-save'));
      await flush();
      await press(onlyHost('mushaf-ayah-actions-backdrop'));
      expect(hosts('mushaf-ayah-actions')).toHaveLength(0);
      await tapPage(100, 130);
      await afterTapWindow();
      expect(heart()).toMatchObject({ color: '#E44855', fill: '#E44855' });
      await press(onlyHost('mushaf-ayah-save'));
      await flush();
      expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(before);
      expect(khatmaRecords()).toHaveLength(0);
    });

    it.each([['light', 'en'], ['dark', 'en'], ['light', 'ar'], ['dark', 'ar']] as const)('%s, %s: a red outline, then the same filled red heart and the Saved label as soon as it is saved; Reflection and Share keep their place', async (theme, locale) => {
      state.theme = theme;
      state.locale = locale;
      state.fetch.mockImplementation(async (url: string) => (String(url).includes('/api/ayahs/') ? layoutResponse(200, { success: true, data: ayah(decodeURIComponent(String(url).split('/').pop()!)) }) : layoutResponse(503, { success: false })));
      await render();
      await tapPage(100, 130);
      await afterTapWindow();
      const outline = onlyHost('mushaf-ayah-save').findByType('Heart' as never).props;
      expect(outline).toMatchObject({ color: '#E44855', fill: 'transparent' }); // the same red outline in Dark
      await press(onlyHost('mushaf-ayah-save'));
      await flush();
      const popup = onlyHost('mushaf-ayah-actions');
      expect(popup.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'button').map((n) => n.props.testID)).toEqual(['mushaf-ayah-listen', 'mushaf-ayah-reflection', 'mushaf-ayah-save', 'mushaf-ayah-copy', 'mushaf-ayah-share']);
      expect(onlyHost('mushaf-ayah-save').findByType('Heart' as never).props).toMatchObject({ color: '#E44855', fill: '#E44855' });
      expect(textOf(onlyHost('mushaf-ayah-save'))).toBe(MESSAGES[locale].mushaf.actionSaved);
      expect(onlyHost('mushaf-ayah-save').props.accessibilityLabel).toBe(MESSAGES[locale].favoriteButton.removeLabel);
      // No background, circle or badge around the heart: only the icon in its slot.
      const slot = onlyHost('mushaf-ayah-save').findByType('Heart' as never).parent!;
      expect(styleOf(slot).backgroundColor).toBeUndefined();
    });

    /** No connection for ayahs (the request itself fails, as offline); everything else as before. */
    const offline = () => state.fetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/ayahs/')) throw new TypeError('Network request failed');
      return layoutResponse(503, { success: false });
    });
    const ayahRequests = () => state.fetch.mock.calls.filter(([url]) => String(url).includes('/api/ayahs/')).length;
    const storedFavorites = () => JSON.parse([...state.storage.entries()].find(([key]) => /favorites/.test(key))?.[1] ?? '[]') as Record<string, unknown>[];

    it('a refused save (the ayah isn`t found) never shows the saved heart: the reason in the popup, nothing saved', async () => {
      state.fetch.mockImplementation(async (url: string) => (String(url).includes('/api/ayahs/') ? layoutResponse(404, { success: false }) : layoutResponse(503, { success: false })));
      await render();
      await tapPage(100, 130);
      await afterTapWindow();
      await press(onlyHost('mushaf-ayah-save'));
      await flush();
      expect(hosts('mushaf-ayah-actions')).toHaveLength(1);
      expect(hosts('mushaf-ayah-heart-saved')).toHaveLength(0);
      expect(onlyHost('mushaf-ayah-save').findByType('Heart' as never).props.fill).toBe('transparent');
      expect(textOf(onlyHost('mushaf-ayah-actions'))).toMatch(new RegExp(`${copy().actionReflection}\\|${copy().actionSave}\\|.+`));
      expect(storedFavorites().filter((f) => !f.deleted)).toHaveLength(0);
    });

    it('Save without a connection: saved on the device with the verified local Arabic and no invented translation; Unsave needs no connection; kept across a restart; the translation arrives when the connection returns', async () => {
      const { getVerseByKey } = await import('@/services/quran');
      offline();
      await render();
      await tapPage(100, 130); // 3:85
      await afterTapWindow();
      await press(onlyHost('mushaf-ayah-save'));
      await flush();
      // Saved: the heart fills at once, no error.
      expect(hosts('mushaf-ayah-actions')).toHaveLength(1);
      expect(onlyHost('mushaf-ayah-save').findByType('Heart' as never).props).toMatchObject({ color: '#E44855', fill: '#E44855' });
      expect(textOf(onlyHost('mushaf-ayah-actions'))).toBe(`${MESSAGES.en.audio.listen}|${copy().actionReflection}|${copy().actionSaved}|${copy().actionCopy}|${MESSAGES.en.ayah.share}`);
      const [saved] = storedFavorites();
      expect(saved).toMatchObject({ verseKey: '3:85', surahNumber: 3, ayahNumber: 85, surahNameEnglish: 'Aal-i-Imraan', surahNameArabic: 'آل عمران', englishTranslation: '', translationSource: '', emotions: [] });
      expect(saved.arabicText).toBe((await getVerseByKey('3:85')).arabicText);
      // Unsave: from the saved favorite itself, without asking the backend.
      const requests = ayahRequests();
      await press(onlyHost('mushaf-ayah-save'));
      await flush();
      expect(ayahRequests()).toBe(requests);
      expect(onlyHost('mushaf-ayah-save').findByType('Heart' as never).props.fill).toBe('transparent');
      expect(storedFavorites()).toEqual([expect.objectContaining({ verseKey: '3:85', deleted: true })]);
      // Saved again, then the app restarts (still offline): it is still saved.
      await press(onlyHost('mushaf-ayah-save'));
      await flush();
      const savedAt = storedFavorites()[0].savedAt;
      await act(async () => root.unmount());
      await render();
      await tapPage(100, 130);
      await afterTapWindow();
      expect(onlyHost('mushaf-ayah-save').findByType('Heart' as never).props.fill).toBe('#E44855');
      expect(storedFavorites()[0]).toMatchObject({ verseKey: '3:85', englishTranslation: '' });
      // The connection returns: on the next load its translation is fetched and kept; the Arabic and savedAt are unchanged.
      await act(async () => root.unmount());
      state.fetch.mockImplementation(async (url: string) => (String(url).includes('/api/ayahs/') ? layoutResponse(200, { success: true, data: ayah(decodeURIComponent(String(url).split('/').pop()!)) }) : layoutResponse(503, { success: false })));
      await render();
      await flush();
      expect(storedFavorites()).toEqual([expect.objectContaining({ verseKey: '3:85', englishTranslation: 'Say…', translationSource: 'pickthall', savedAt })]);
      expect(storedFavorites()[0].arabicText).toBe((await getVerseByKey('3:85')).arabicText);
    });

    it('a tap outside dismisses it and the ayah is no longer selected; a double-tap never opens it', async () => {
      await render();
      await tapPage(100, 130);
      await afterTapWindow();
      await press(onlyHost('mushaf-ayah-actions-backdrop'));
      expect(hosts('mushaf-ayah-actions')).toHaveLength(0);
      expect(inPage().findAllByProps({ testID: 'mushaf-selection' })).toHaveLength(0);
      // A double-tap (the zoom reset): its taps open nothing.
      await pinch(2);
      await tapPage(100, 130);
      await act(async () => gesture((g) => g.kind === 'tap' && g.config.numberOfTaps === 2).handlers.onEnd?.({}, true));
      await afterTapWindow();
      expect(hosts('mushaf-ayah-actions')).toHaveLength(0);
    });

    it('Arabic: the actions in Arabic, read right to left', async () => {
      state.locale = 'ar';
      await render();
      await tapPage(100, 130);
      await afterTapWindow();
      expect(textOf(onlyHost('mushaf-ayah-actions'))).toBe('استمع|خاطرة|حفظ|نسخ|مشاركة');
      expect(flat(onlyHost('mushaf-ayah-reflection').props.style({ pressed: false })).flexDirection).toBe('row-reverse');
    });

    /** The fake API's ayah for a key, as the ayah screens receive it (the Arabic is then resolved from the verified local text). */
    const serveAyahs = () => state.fetch.mockImplementation(async (url: string) => (String(url).includes('/api/ayahs/')
      ? layoutResponse(200, { success: true, data: ayah(decodeURIComponent(String(url).split('/').pop()!)) })
      : layoutResponse(503, { success: false })));
    const shareSheet = () => root.root.findByType('ShareAyahSheet' as never);

    it('Share opens the ayah screens` Share Ayah sheet for exactly the selected ayah: its verified text and reference, no emotion; nothing else changes', async () => {
      const { getVerseByKey } = await import('@/services/quran');
      const { formatAyahReference } = await import('@/utils/ayahReference');
      seedWird();
      serveAyahs();
      await render();
      const before = [state.storage.get(READING_STOPS_STORAGE_KEY), state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)];
      expect(shareSheet().props).toMatchObject({ visible: false, ayah: null });
      await tapPage(100, 130); // 3:85
      await afterTapWindow();
      await press(onlyHost('mushaf-ayah-share'));
      await flush();
      expect(hosts('mushaf-ayah-actions')).toHaveLength(0);
      const shared = shareSheet().props.ayah;
      expect(shareSheet().props.visible).toBe(true);
      // Exactly 3:85 (the tapped ayah), with the verified Tanzil Arabic, resolved locally as the ayah screens do.
      expect(shared).toMatchObject({ verseKey: '3:85', surahNumber: 3, ayahNumber: 85 });
      expect(shared.arabicText).toBe((await getVerseByKey('3:85')).arabicText);
      expect(shared.arabicText.length).toBeGreaterThan(0);
      // The card's reference, from the same helper the sheet uses.
      expect(formatAyahReference(shared.surahNumber, shared.ayahNumber)).toBe('Aal-i-Imraan · 3:85 · آل عمران');
      // The sheet takes only the ayah: no emotion or connection text reaches it.
      expect(Object.keys(shareSheet().props).sort()).toEqual(['ayah', 'onClose', 'visible']);
      expect(shared.emotions).toEqual([]);
      // It stays selected while sharing; closing the sheet changes nothing else.
      expect(root.root.findByType('ReflectionSheet' as never).props.verseKey).toBe('3:85');
      await act(async () => shareSheet().props.onClose());
      expect(shareSheet().props).toMatchObject({ visible: false, ayah: null });
      expect([state.storage.get(READING_STOPS_STORAGE_KEY), state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)]).toEqual(before);
      expect(khatmaRecords()).toHaveLength(0);
      expect(root.root.findByType('ReflectionSheet' as never).props.visible).toBe(false);
    });

    it('Share on a QPC page shares the ayah whose words were tapped (3:90), in Arabic and Dark Mode alike', async () => {
      state.locale = 'ar';
      state.theme = 'dark';
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      serveAyahs(); // after the page's own layout response
      const word = wordOf(layout, '3:90');
      await tapLine(word.line, word.x);
      await afterTapWindow();
      const popup = onlyHost('mushaf-ayah-actions');
      expect(styleOf(popup)).toMatchObject({ backgroundColor: MUSHAF_PANEL_COLORS.dark.sheet.backgroundColor });
      expect(onlyHost('mushaf-ayah-share').findByType('Share2' as never).props.color).toBe(MUSHAF_PANEL_COLORS.dark.icon);
      expect(onlyHost('mushaf-ayah-share').props.accessibilityLabel).toBe(MESSAGES.ar.ayah.shareAyah);
      await press(onlyHost('mushaf-ayah-share'));
      await flush();
      expect(shareSheet().props).toMatchObject({ visible: true, ayah: expect.objectContaining({ verseKey: '3:90', surahNumber: 3, ayahNumber: 90 }) });
    });

    it('Share without a connection: the same Share Ayah sheet, for exactly this ayah, with the verified local Arabic and no translation', async () => {
      const { getVerseByKey } = await import('@/services/quran');
      state.fetch.mockImplementation(async (url: string) => {
        if (String(url).includes('/api/ayahs/')) throw new TypeError('Network request failed');
        return layoutResponse(503, { success: false });
      });
      await render();
      await tapPage(100, 130);
      await afterTapWindow();
      await press(onlyHost('mushaf-ayah-share'));
      await flush();
      expect(hosts('mushaf-ayah-actions')).toHaveLength(0);
      expect(shareSheet().props.visible).toBe(true);
      const shared = shareSheet().props.ayah;
      expect(shared).toMatchObject({ verseKey: '3:85', surahNumber: 3, ayahNumber: 85, englishTranslation: '', emotions: [] });
      expect(shared.arabicText).toBe((await getVerseByKey('3:85')).arabicText);
    });

    it.each([['en', 'Copy', 'Copied'], ['ar', 'نسخ', 'تم النسخ'], ['ar-EG', 'نسخ', 'تم النسخ']] as const)('%s: Copy puts the ayah`s verified Arabic, a blank line and its reference on the clipboard (as AyahCard does), says "%s" then "%s", and changes nothing else', async (locale, label, done) => {
      state.locale = locale;
      seedWird();
      await render();
      const stopsBefore = state.storage.get(READING_STOPS_STORAGE_KEY);
      await tapPage(100, 130); // 3:85
      await afterTapWindow();
      expect(textOf(onlyHost('mushaf-ayah-copy'))).toBe(label);
      expect(onlyHost('mushaf-ayah-copy').findAllByType('Copy' as never)).toHaveLength(1);
      await press(onlyHost('mushaf-ayah-copy'));
      await flush();
      const { getVerseByKey } = await import('@/services/quran');
      const arabic = (await getVerseByKey('3:85')).arabicText;
      // The device's verified Tanzil text, whole, with its marks, then the shared reference: the same in every app
      // language (English name, Western digits, Arabic name), never reversed or localized.
      expect(state.clipboard).toBe(`${arabic}\n\nAal-i-Imraan · 3:85 · آل عمران`);
      const [copiedArabic, reference, ...rest] = state.clipboard!.split('\n\n');
      expect(rest).toEqual([]);
      expect(copiedArabic).toBe(arabic);
      expect(copiedArabic).toMatch(/[ً-ْ]/);
      // No QCF glyph codes anywhere; no Latin letters or digits in the Arabic part; Western digits in the reference.
      expect(state.clipboard).not.toMatch(/[-ﭐ-﷿ﹰ-﻿]/);
      expect(copiedArabic).not.toMatch(/[A-Za-z0-9]/);
      expect(reference).not.toMatch(/[٠-٩۰-۹]/);
      // Confirmed in place; the popup stays open, the ayah selected; no network was needed.
      expect(textOf(onlyHost('mushaf-ayah-copy'))).toBe(done);
      expect(onlyHost('mushaf-ayah-copy').findAllByType('Check' as never)).toHaveLength(1);
      expect(hosts('mushaf-ayah-actions')).toHaveLength(1);
      expect(root.root.findByType('ReflectionSheet' as never).props.verseKey).toBe('3:85');
      expect(shareSheet().props.visible).toBe(false);
      expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(stopsBefore);
      expect(onlyHost('mushaf-ayah-save').findByType('Heart' as never).props.fill).toBe('transparent');
      // The confirmation passes; Copy is ready again.
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1400)); });
      expect(textOf(onlyHost('mushaf-ayah-copy'))).toBe(label);
    });

    it('Copy that fails: the reason in the popup, never "Copied"', async () => {
      state.clipboardFails = true;
      await render();
      await tapPage(100, 130);
      await afterTapWindow();
      await press(onlyHost('mushaf-ayah-copy'));
      await flush();
      expect(textOf(onlyHost('mushaf-ayah-copy'))).toBe(copy().actionCopy);
      expect(texts()).toContain(copy().actionCopyFailed);
      expect(hosts('mushaf-ayah-actions')).toHaveLength(1);
      expect(state.clipboard).toBeNull();
    });

    it('Copy works offline: the Arabic and the reference come from the device, with no request made', async () => {
      await render();
      await tapPage(100, 130); // 3:85
      await afterTapWindow();
      // From here on the network is gone: any request fails.
      state.fetch.mockReset();
      state.fetch.mockRejectedValue(new Error('offline'));
      await press(onlyHost('mushaf-ayah-copy'));
      await flush();
      const { getVerseByKey } = await import('@/services/quran');
      expect(state.clipboard).toBe(`${(await getVerseByKey('3:85')).arabicText}\n\nAal-i-Imraan · 3:85 · آل عمران`);
      expect(state.fetch).not.toHaveBeenCalled();
      expect(textOf(onlyHost('mushaf-ayah-copy'))).toBe(copy().actionCopied);
      expect(texts()).not.toContain(copy().actionCopyFailed);
    });

    it('Copy never takes the translation: even with one served for the ayah, only its Arabic and reference are copied', async () => {
      const translation = 'Whoever seeks a religion other than Islam';
      state.fetch.mockImplementation(async (url: string) => (String(url).includes('/api/ayahs/')
        ? layoutResponse(200, { success: true, data: { verseKey: '3:85', surahNumber: 3, ayahNumber: 85, englishTranslation: translation } })
        : layoutResponse(503, { success: false })));
      await render();
      await tapPage(100, 130);
      await afterTapWindow();
      await press(onlyHost('mushaf-ayah-copy'));
      await flush();
      expect(state.clipboard).not.toContain(translation);
      expect(state.clipboard!.split('\n\n')).toHaveLength(2);
      expect(state.clipboard!.split('\n\n')[1]).toBe('Aal-i-Imraan · 3:85 · آل عمران');
    });

    it('Share refused (the ayah isn`t found): the reason in the popup, no sheet', async () => {
      state.fetch.mockImplementation(async (url: string) => (String(url).includes('/api/ayahs/') ? layoutResponse(404, { success: false }) : layoutResponse(503, { success: false })));
      await render();
      await tapPage(100, 130);
      await afterTapWindow();
      await press(onlyHost('mushaf-ayah-share'));
      await flush();
      expect(hosts('mushaf-ayah-actions')).toHaveLength(1);
      expect(textOf(onlyHost('mushaf-ayah-actions')).split('|').length).toBe(6); // the five actions and the reason
      expect(shareSheet().props.visible).toBe(false);
    });
  });

  describe('an ayah`s number (the separator): Apply to the active ورد', () => {
    it('a tap on the medallion opens only Apply and X — never the ayah`s actions; a tap on its words opens those instead', async () => {
      seedWird('Morning');
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      const marker = markerOf(layout, '3:85');
      await tapLine(marker.line, marker.x);
      await afterTapWindow();
      const popup = onlyHost('mushaf-wird-apply');
      expect(hosts('mushaf-ayah-actions')).toHaveLength(0);
      const buttons = popup.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'button');
      expect(buttons.map((n) => n.props.testID)).toEqual(['mushaf-wird-apply-button', 'mushaf-wird-apply-close']);
      expect(popup.findAllByType('Share2' as never)).toHaveLength(0);
      expect(textOf(popup).replace(/[⁨⁩]/g, '')).toBe('Apply to Morning');
      expect(flat(onlyHost('mushaf-wird-apply-button').props.style({ pressed: false })).backgroundColor).toBe(MUSHAF_PANEL_COLORS.light.go.backgroundColor);
      // The selected ayah is the medallion's.
      expect(root.root.findByType('ReflectionSheet' as never).props.verseKey).toBe('3:85');
      await press(onlyHost('mushaf-wird-apply-close'));
      // Its words: the two actions.
      const word = wordOf(layout, '3:85');
      await tapLine(word.line, word.x);
      await afterTapWindow();
      expect(hosts('mushaf-ayah-actions')).toHaveLength(1);
      expect(hosts('mushaf-wird-apply')).toHaveLength(0);
    });

    it('Apply saves this page to the active ورد (and only it), closes, and shows nothing more; X changes nothing', async () => {
      seedWird('Morning', 20);
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      const marker = markerOf(layout, '3:86');
      await tapLine(marker.line, marker.x);
      await afterTapWindow();
      await press(onlyHost('mushaf-wird-apply-close'));
      expect(stops()).toEqual([expect.objectContaining({ id: 'fajr', page: 20 })]);
      expect(hosts('mushaf-wird-apply')).toHaveLength(0);
      await tapLine(marker.line, marker.x);
      await afterTapWindow();
      await press(onlyHost('mushaf-wird-apply-button'));
      await flush();
      expect(stops()).toEqual([expect.objectContaining({ id: 'fajr', name: 'Morning', page: 61 })]);
      expect(hosts('mushaf-wird-apply')).toHaveLength(0);
      expect(hosts('mushaf-saved-toast')).toHaveLength(0); // no success message
      expect(khatmaRecords()).toHaveLength(0);
      // The ورد pill (unchanged) still shows the same ورد.
      expect(root.root.findByProps({ testID: 'mushaf-wird' }).findByType('Text' as never).props.children).toBe('Morning');
    });

    it('a failed save keeps the popup open with the reason (nothing pretends it worked)', async () => {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      seedWird('Morning', 20);
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      const marker = markerOf(layout, '3:86');
      await tapLine(marker.line, marker.x);
      await afterTapWindow();
      vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
      await press(onlyHost('mushaf-wird-apply-button'));
      await flush();
      expect(hosts('mushaf-wird-apply')).toHaveLength(1);
      expect(texts()).toContain(copy().stopSaveFailed);
      expect(stops()).toEqual([expect.objectContaining({ page: 20 })]);
    });

    it('follows the ورد chosen in the (unchanged) ورد list: never a stale one', async () => {
      state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([
        { id: 'fajr', name: 'Fajr', page: 20, updatedAt: '2026-10-02T00:00:00.000Z' },
        { id: 'isha', name: 'ورد العشاء', page: 61, updatedAt: '2026-10-01T00:00:00.000Z' },
      ]));
      state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, 'fajr');
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      // Switch the active ورد in its list (it opens that ورد's saved page, 61).
      await press(root.root.findByProps({ testID: 'mushaf-wird' }));
      await press(root.root.findAllByProps({ testID: 'mushaf-wird-isha' }).find((node) => String(node.type) === 'Pressable')!);
      await flush();
      expect(root.root.findByProps({ testID: 'mushaf-wird' }).findByType('Text' as never).props.children).toBe('ورد العشاء');
      const marker = markerOf(layout, '3:90');
      await tapLine(marker.line, marker.x);
      await afterTapWindow();
      // The name already says ورد: not doubled; isolated in its own direction.
      expect(textOf(onlyHost('mushaf-wird-apply'))).toBe('Apply to ⁨ورد العشاء⁩');
      await press(onlyHost('mushaf-wird-apply-button'));
      await flush();
      expect(stops().find((s) => s.id === 'isha')?.page).toBe(61);
      expect(stops().find((s) => s.id === 'fajr')?.page).toBe(20); // untouched
    });

    it('Arabic: the wording in Arabic around the user`s own name', async () => {
      state.locale = 'ar';
      seedWird('الفجر');
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      const marker = markerOf(layout, '3:85');
      await tapLine(marker.line, marker.x);
      await afterTapWindow();
      expect(textOf(onlyHost('mushaf-wird-apply')).replace(/[⁨⁩]/g, '')).toBe('حفظ في الفجر');
    });

    it('no active ورد: Apply offers the existing new-ورد name field instead (nothing guessed)', async () => {
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      const marker = markerOf(layout, '3:85');
      await tapLine(marker.line, marker.x);
      await afterTapWindow();
      expect(textOf(onlyHost('mushaf-wird-apply'))).toBe(copy().wirdNew);
      await press(onlyHost('mushaf-wird-apply-button'));
      await flush();
      expect(hosts('mushaf-popup-save')).toHaveLength(1);
      expect(stops()).toEqual([]);
    });
  });

  describe('the selected ورد`s saved ayah: a gold medallion', () => {
    const GOLD = MUSHAF_WIRD_MARKER.warm.colors;
    /** The ayah whose medallion is gold on the page being read, or null. Exactly one at most. */
    const goldAyah = () => {
      const marked = inPage().findAll((node) => node.props.testID === 'qpc-wird-marker' && node.props.marker);
      expect(marked.length).toBeLessThanOrEqual(1);
      return marked.length ? (marked[0].props.marker.verseKey as string) : null;
    };
    const goldFills = () => inPage().findAll((node) => node.props.testID === 'qpc-wird-marker' && typeof node.type === 'string')[0]
      .findAll((node) => typeof node.type === 'string' && node.props.fill !== undefined).map((node) => node.props.fill);
    const seedStops = (list: object[], active: string) => {
      state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify(list));
      state.storage.set(ACTIVE_READING_STOP_STORAGE_KEY, active);
    };
    const apply = async (layout: ReturnType<typeof syntheticQpcPage61>, verseKey: string) => {
      const marker = markerOf(layout, verseKey);
      await tapLine(marker.line, marker.x);
      await afterTapWindow();
      await press(onlyHost('mushaf-wird-apply-button'));
      await flush();
    };

    it('Apply: that ayah`s medallion turns gold at once, stays after the popup closes, and the position is saved with it', async () => {
      seedWird('Morning', 20);
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      expect(goldAyah()).toBeNull();
      await apply(layout, '3:86');
      expect(hosts('mushaf-wird-apply')).toHaveLength(0);
      expect(stops()).toEqual([expect.objectContaining({ id: 'fajr', page: 61, ayahKey: '3:86' })]);
      expect(goldAyah()).toBe('3:86');
      expect(goldFills()).toEqual([GOLD.capFill, GOLD.sideFill, GOLD.innerFill, GOLD.caps, GOLD.number]);
      // Not a selection: no selection highlight is left behind; tapping elsewhere keeps the gold.
      expect(inPage().findAll((node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('qpc-highlight-'))).toHaveLength(0);
      const word = wordOf(layout, '3:88');
      await tapLine(word.line, word.x);
      await afterTapWindow();
      expect(hosts('mushaf-ayah-actions')).toHaveLength(1);
      expect(goldAyah()).toBe('3:86');
    });

    it('Apply on another ayah moves it: the previous medallion returns to normal', async () => {
      seedWird('Morning', 20);
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      await apply(layout, '3:86');
      await apply(layout, '3:90');
      expect(goldAyah()).toBe('3:90');
      expect(stops()).toEqual([expect.objectContaining({ page: 61, ayahKey: '3:90' })]);
    });

    it('switching ورد shows that ورد`s own ayah — or none when it has only a page — never another ورد`s', async () => {
      seedStops([
        { id: 'fajr', name: 'Fajr', page: 61, ayahKey: '3:86', updatedAt: '2026-10-02T00:00:00.000Z' },
        { id: 'isha', name: 'Isha', page: 61, ayahKey: '3:90', updatedAt: '2026-10-01T00:00:00.000Z' },
        { id: 'asr', name: 'Asr', page: 61, updatedAt: '2026-09-30T00:00:00.000Z' },
      ], 'fajr');
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      expect(goldAyah()).toBe('3:86');
      const choose = async (id: string) => {
        await press(root.root.findByProps({ testID: 'mushaf-wird' }));
        await press(root.root.findAllByProps({ testID: `mushaf-wird-${id}` }).find((node) => String(node.type) === 'Pressable')!);
        await flush();
      };
      await choose('isha');
      expect(goldAyah()).toBe('3:90');
      await choose('asr');
      expect(goldAyah()).toBeNull();
      await choose('fajr');
      expect(goldAyah()).toBe('3:86');
    });

    it('restored after a restart: read back from storage', async () => {
      seedStops([{ id: 'fajr', name: 'Fajr', page: 61, ayahKey: '3:88', updatedAt: '2026-10-02T00:00:00.000Z' }], 'fajr');
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      expect(goldAyah()).toBe('3:88');
      act(() => root.unmount());
      await renderQpc(layout);
      await layOut(layout);
      expect(goldAyah()).toBe('3:88');
    });

    it('follows changes made elsewhere (account sync, guest merge, أورادي وختماتي): moved, then cleared by a page-only save', async () => {
      seedStops([{ id: 'fajr', name: 'Fajr', page: 61, ayahKey: '3:84', updatedAt: '2026-10-02T00:00:00.000Z' }], 'fajr');
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      expect(goldAyah()).toBe('3:84');
      const { notifyReadingDataChanged } = await import('@/mushaf/readingStops');
      seedStops([{ id: 'fajr', name: 'Fajr', page: 61, ayahKey: '3:91', updatedAt: '2026-10-03T00:00:00.000Z' }], 'fajr');
      await act(async () => notifyReadingDataChanged());
      await flush();
      expect(goldAyah()).toBe('3:91');
      seedStops([{ id: 'fajr', name: 'Fajr', page: 61, updatedAt: '2026-10-04T00:00:00.000Z' }], 'fajr');
      await act(async () => notifyReadingDataChanged());
      await flush();
      expect(goldAyah()).toBeNull();
    });

    it('only on its saved page: a ورد saved on page 61 shows nothing on page 62; deleting the ورد clears it', async () => {
      everyPageDrawn();
      seedStops([{ id: 'fajr', name: 'Fajr', page: 61, ayahKey: '3:86', updatedAt: '2026-10-02T00:00:00.000Z' }], 'fajr');
      await render();
      // What the reader asks each page to draw in gold (the page being read and its neighbours beside it).
      const asked = () => Object.fromEntries(root.root.findAll((node) => node.props.layout && 'wirdAyahKey' in node.props && typeof node.type !== 'string')
        .map((node) => [node.props.layout.page, node.props.wirdAyahKey]));
      expect(asked()).toEqual({ 60: null, 61: '3:86', 62: null });
      await turnPage(1);
      expect(currentPage()).toBe(62);
      expect(asked()).toEqual({ 61: '3:86', 62: null, 63: null });
      await turnPage(-1);
      expect(asked()).toEqual({ 60: null, 61: '3:86', 62: null });
      const { deleteWird } = await import('@/mushaf/khatmas');
      await act(async () => deleteWird('fajr'));
      await flush();
      expect(asked()).toEqual({ 60: null, 61: null, 62: null });
    });

    /** No ورد selected: a tap on `verseKey`'s number, its New ورد button, then the name field saves `name`. */
    const newWirdFromNumber = async (layout: ReturnType<typeof syntheticQpcPage61>, verseKey: string, name: string) => {
      const marker = markerOf(layout, verseKey);
      await tapLine(marker.line, marker.x);
      await afterTapWindow();
      expect(textOf(onlyHost('mushaf-wird-apply'))).toBe(copy().wirdNew);
      await press(onlyHost('mushaf-wird-apply-button'));
      await flush();
      await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText(name));
      await press(button(copy().confirmStop));
      await flush();
      await flush();
    };

    it('no ورد selected: a new ورد named from an ayah`s number saves that page AND that ayah, and its medallion turns gold at once', async () => {
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      await newWirdFromNumber(layout, '3:86', 'Dawn');
      expect(stops()).toEqual([expect.objectContaining({ name: 'Dawn', page: 61, ayahKey: '3:86' })]);
      expect(state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)).toBe(stops()[0].id);
      expect(hosts('mushaf-popup-save')).toHaveLength(0);
      expect(goldAyah()).toBe('3:86');
    });

    it('no ورد selected, the name of an existing ورد typed: that ورد takes this page and ayah (its old position replaced) and becomes the selected one', async () => {
      seedStops([
        { id: 'isha', name: 'Isha', page: 20, updatedAt: '2026-10-01T00:00:00.000Z' },
        { id: 'fajr', name: 'Fajr', page: 61, ayahKey: '3:84', updatedAt: '2026-10-02T00:00:00.000Z' },
      ], '');
      state.storage.delete(ACTIVE_READING_STOP_STORAGE_KEY);
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      expect(goldAyah()).toBeNull(); // nothing selected: no gold, not even Fajr's
      await newWirdFromNumber(layout, '3:90', 'isha'); // any case, as every save by name
      const isha = stops().find((s) => s.id === 'isha') as unknown as { page: number; ayahKey?: string; updatedAt: string };
      expect(isha).toMatchObject({ page: 61, ayahKey: '3:90' });
      expect(Date.parse(isha.updatedAt)).toBeGreaterThan(Date.parse('2026-10-02T00:00:00.000Z')); // a new save: later-save-wins
      expect(stops()).toHaveLength(2);
      expect(stops().find((s) => s.id === 'fajr')).toMatchObject({ page: 61, ayahKey: '3:84' }); // untouched
      expect(state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)).toBe('isha');
      expect(goldAyah()).toBe('3:90');
    });

    it('the ورد list`s Add stays page-only (the intended page save): no ayah, no gold', async () => {
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      // An ayah selected first (its words), so nothing could be borrowed from a selection either.
      const word = wordOf(layout, '3:86');
      await tapLine(word.line, word.x);
      await afterTapWindow();
      await press(onlyHost('mushaf-ayah-actions-backdrop'));
      await openNameField();
      await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText('Asr'));
      await press(button(copy().confirmStop));
      await flush();
      await flush();
      expect(stops()).toEqual([expect.objectContaining({ name: 'Asr', page: 61 })]);
      expect(stops()[0]).not.toHaveProperty('ayahKey');
      expect(goldAyah()).toBeNull();
    });

    it('the name field from an ayah`s number, closed without saving: the next Add from the list is page-only', async () => {
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      const marker = markerOf(layout, '3:86');
      await tapLine(marker.line, marker.x);
      await afterTapWindow();
      await press(onlyHost('mushaf-wird-apply-button'));
      await flush();
      // Closed without saving (the field's own close).
      const field = root.root.findAll((node) => typeof node.type !== 'string' && node.props.labels?.confirmStop && typeof node.props.onClose === 'function')[0];
      await act(async () => field.props.onClose());
      await flush();
      expect(stops()).toEqual([]);
      await openNameField();
      await act(async () => root.root.findByProps({ testID: 'mushaf-popup-save' }).findByType('TextInput' as never).props.onChangeText('Asr'));
      await press(button(copy().confirmStop));
      await flush();
      await flush();
      expect(stops()[0]).toMatchObject({ name: 'Asr', page: 61 });
      expect(stops()[0]).not.toHaveProperty('ayahKey');
    });

    it('Dark Mode: the same gold medallion on the dark page', async () => {
      state.theme = 'dark';
      seedStops([{ id: 'fajr', name: 'Fajr', page: 61, ayahKey: '3:86', updatedAt: '2026-10-02T00:00:00.000Z' }], 'fajr');
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      expect(goldAyah()).toBe('3:86');
      expect(goldFills()).toEqual([GOLD.capFill, GOLD.sideFill, GOLD.innerFill, GOLD.caps, GOLD.number]);
    });

    it('the gold medallion takes no touch: a tap on it still opens Apply / X, and Apply there keeps it', async () => {
      seedStops([{ id: 'fajr', name: 'Fajr', page: 61, ayahKey: '3:86', updatedAt: '2026-10-02T00:00:00.000Z' }], 'fajr');
      const layout = syntheticQpcPage61();
      await renderQpc(layout);
      await layOut(layout);
      expect(inPage().findAll((node) => node.props.testID === 'qpc-wird-marker' && typeof node.type === 'string')[0].props.pointerEvents).toBe('none');
      await apply(layout, '3:86');
      expect(goldAyah()).toBe('3:86');
    });
  });

  it('the full-screen toggle: outward diagonal arrows to expand, inward to collapse, in the same place', async () => {
    await render();
    const toggle = () => root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' });
    expect(toggle().findAllByType('Maximize2' as never)).toHaveLength(1);
    expect(toggle().props.accessibilityLabel).toBe(copy().enterFullScreen);
    const place = flat(toggle().props.style({ pressed: false }));
    await press(toggle());
    expect(toggle().findAllByType('Minimize2' as never)).toHaveLength(1);
    expect(toggle().props.accessibilityLabel).toBe(copy().exitFullScreen);
    expect(flat(toggle().props.style({ pressed: false }))).toEqual(place);
  });
});

describe('Keep Screen Awake in the reader', () => {
  it('the reader, focused and in the foreground with the default (ON), holds its own keep-awake tag once (entering and leaving full screen never re-acquire it), and unmounting releases that same tag', async () => {
    const { MUSHAF_KEEP_AWAKE_TAG } = await import('@/mushaf/useMushafKeepAwake');
    keepAwake.activate.mockClear();
    keepAwake.deactivate.mockClear();
    await render();
    expect(keepAwake.activate.mock.calls).toEqual([[MUSHAF_KEEP_AWAKE_TAG]]);
    await act(async () => root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }).props.onPress());
    await flush();
    await act(async () => root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' }).props.onPress());
    await flush();
    expect(keepAwake.activate).toHaveBeenCalledTimes(1);
    expect(keepAwake.deactivate).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(keepAwake.deactivate.mock.calls).toEqual([[MUSHAF_KEEP_AWAKE_TAG]]);
    root = undefined as never;
  });
});

describe('the first-time guide', () => {
  const GUIDE_KEY = 'quran-heals:mushaf-guide:v1';
  const onlyHost = (testID: string) => {
    const nodes = hosts(testID);
    expect(nodes, testID).toHaveLength(1);
    return nodes[0];
  };
  const toggle = () => root.root.findByProps({ testID: 'mushaf-fullscreen-toggle' });
  const MEASURE_WIDTH = 900;
  /** Where each real control is drawn on this simulated 390 × 844 screen (measureInWindow, window coordinates). */
  const BOXES: Record<string, { x: number; y: number; width: number; height: number }> = {
    'mushaf-nav-surah': { x: 10, y: 70, width: 150, height: 22 },
    'mushaf-nav-hizb': { x: 160, y: 70, width: 70, height: 22 },
    'mushaf-nav-juz': { x: 230, y: 70, width: 150, height: 22 },
    'mushaf-nav-page': { x: 150, y: 735, width: 90, height: 22 },
    'qpc-guide-ayah': { x: 240, y: 300, width: 44, height: 30 },
    'qpc-guide-marker': { x: 200, y: 300, width: 26, height: 30 },
  };
  /** The guide's order (2026-10-17, the original reversed): each step's text and the control it points at. */
  const ORDER = [
    ['guideMarker', 'qpc-guide-marker'],
    ['guideAyah', 'qpc-guide-ayah'],
    ['guideJuz', 'mushaf-nav-juz'],
    ['guidePage', 'mushaf-nav-page'],
    ['guideHizb', 'mushaf-nav-hizb'],
    ['guideSurah', 'mushaf-nav-surah'],
  ] as const;
  async function renderFresh(area = { width: 390, height: 797 }) {
    await act(async () => {
      root = create(createElement(MushafScreen), {
        createNodeMock: (element) => ({
          measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => {
            const box = BOXES[String((element.props as { testID?: string }).testID)];
            if (box) callback(box.x, box.y, box.width, box.height);
          },
        }),
      });
    });
    await flush();
    await act(async () => root.root.findByProps({ testID: 'mushaf-page-area' }).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, ...area } } }));
    await flush();
    await flush();
    // The guide measures after the layout settles (a short timer).
    await settle();
  }
  const settle = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 120)); }); };
  const guide = () => hosts('mushaf-guide');
  const guideText = () => onlyHost('mushaf-guide-text').props.children;
  const hole = () => styleOf(onlyHost('mushaf-guide-highlight'));
  const padded = (id: string) => ({ left: BOXES[id].x - 6, top: BOXES[id].y - 6, width: BOXES[id].width + 12, height: BOXES[id].height + 12 });
  const next = async () => { await press(onlyHost('mushaf-guide-next')); await settle(); };
  const toLastStep = async () => { for (let step = 0; step < 5; step += 1) await next(); };
  const stored = () => JSON.parse(state.storage.get(GUIDE_KEY) ?? 'null');
  const helpShown = () => hosts('mushaf-guide-open').length === 1;
  /** Settings → Quran → Mushaf Guide: /mushaf?guide=<time> (a new value each time). */
  async function requestFromSettings(token: string) {
    state.params = { guide: token };
    await act(async () => root.update(createElement(MushafScreen)));
    await settle();
  }

  beforeEach(() => {
    state.storage.delete(GUIDE_KEY); // a new user
  });

  it('a new user: shown by itself once the page and its controls are drawn, at step 1 (the ayah number, for the ورد position)', async () => {
    await renderFresh();
    expect(guide()).toHaveLength(1);
    expect(guideText()).toBe(copy().guideMarker);
    expect(texts()).toContain('1 of 6');
    expect(helpShown()).toBe(true);
    // Nothing changed: the same page, no ورد, no Khatma.
    expect(currentPage()).toBe(61);
    expect([...state.storage.keys()].filter((key) => /reading-stop|khatma|favorite|reflection/.test(key))).toEqual([]);
  });

  it('all six steps in the reversed order, numbered 1–6, each pointing at its own real control: ayah number, ayah, Juz, page, Hizb, Surah', async () => {
    await renderFresh();
    const shown: string[] = [];
    for (let step = 0; step < 6; step += 1) {
      shown.push(guideText());
      expect(texts()).toContain(`${step + 1} of 6`);
      const target = ORDER[step][1];
      if (hosts(target).length > 0) {
        expect(hole(), target).toMatchObject(padded(target));
        expect(hosts('mushaf-guide-not-on-page'), target).toHaveLength(0);
      } else {
        // Not on this page: no arrow anywhere wrong, the card centred, saying so.
        expect(hosts('mushaf-guide-highlight'), target).toHaveLength(0);
        expect(hosts('mushaf-guide-not-on-page'), target).toHaveLength(1);
      }
      // Start Reading (Finish) only on step 6; Next on every other.
      expect(hosts('mushaf-guide-start'), `step ${step + 1}`).toHaveLength(step === 5 ? 1 : 0);
      expect(hosts('mushaf-guide-next'), `step ${step + 1}`).toHaveLength(step === 5 ? 0 : 1);
      if (step < 5) await next();
    }
    expect(shown).toEqual(ORDER.map(([key]) => copy()[key]));
  });

  it('step 6 (the Surah name): its highlight on the real control, the card below it and the arrow pointing up to it', async () => {
    await renderFresh();
    await toLastStep();
    expect(guideText()).toBe(copy().guideSurah);
    expect(hole()).toMatchObject(padded('mushaf-nav-surah'));
    const card = styleOf(onlyHost('mushaf-guide-card'));
    const arrow = styleOf(onlyHost('mushaf-guide-arrow'));
    expect(card.top).toBeGreaterThan(BOXES['mushaf-nav-surah'].y + BOXES['mushaf-nav-surah'].height);
    expect(arrow.top).toBe(BOXES['mushaf-nav-surah'].y + BOXES['mushaf-nav-surah'].height + 6);
    expect(arrow.top + arrow.height).toBe(card.top);
    expect(arrow.left + arrow.width / 2).toBeGreaterThanOrEqual(card.left + 22);
  });

  it('with the page`s QPC words drawn: steps 1 and 2 point at a real ayah`s number and at a word of that same ayah, on the page being read', async () => {
    state.fetch.mockResolvedValue(layoutResponse(200, { success: true, data: syntheticQpcPage61() }));
    await renderFresh();
    await act(async () => {
      for (const line of syntheticQpcPage61().lines) root.root.findByProps({ testID: `qpc-measure-${line.line}` }).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: line.line === 1 ? MEASURE_WIDTH : 800, height: 100 } } });
    });
    await settle();
    const ayah = onlyHost('qpc-guide-ayah');
    const marker = onlyHost('qpc-guide-marker');
    // The same line; the word belongs to the ayah whose number is the marker (a word before it on that line).
    expect(ayah.parent).toBe(marker.parent);
    const words = (ayah.parent!.children as ReactTestInstance[]).filter((child) => typeof child !== 'string' && child.props.onLayout);
    expect(words.indexOf(ayah)).toBeLessThan(words.indexOf(marker));
    expect(guideText()).toBe(copy().guideMarker);
    expect(hole()).toMatchObject(padded('qpc-guide-marker'));
    await next();
    expect(guideText()).toBe(copy().guideAyah);
    expect(hole()).toMatchObject(padded('qpc-guide-ayah'));
    // Only pointed at: nothing selected, no popup, no ورد saved.
    expect(hosts('mushaf-ayah-actions')).toHaveLength(0);
    expect(hosts('mushaf-wird-apply')).toHaveLength(0);
    expect([...state.storage.keys()].filter((key) => /reading-stop|khatma/.test(key))).toEqual([]);
  });

  it('on a page with a Hizb mark (page 5), step 5 points at the real Hizb label', async () => {
    state.params = { page: '5' };
    state.offline.readPage.mockImplementation(async (n: number) => ({ ...syntheticQpcPage61(), page: n, fontFamily: `QCF_P${String(n).padStart(3, '0')}` }));
    await renderFresh();
    expect(currentPage()).toBe(5);
    expect(hosts('mushaf-nav-hizb')).toHaveLength(1);
    for (let step = 0; step < 4; step += 1) await next();
    expect(guideText()).toBe(copy().guideHizb);
    expect(hole()).toMatchObject(padded('mushaf-nav-hizb'));
    expect(hosts('mushaf-guide-not-on-page')).toHaveLength(0);
  });

  it('the page number`s step (step 4): the card above, the arrow down to it', async () => {
    await renderFresh();
    for (let step = 0; step < 3; step += 1) await next();
    expect(guideText()).toBe(copy().guidePage);
    const card = styleOf(onlyHost('mushaf-guide-card'));
    const arrow = styleOf(onlyHost('mushaf-guide-arrow'));
    expect(card.bottom).toBe(844 - (BOXES['mushaf-nav-page'].y - 6 - 34));
    expect(arrow.top + arrow.height).toBe(BOXES['mushaf-nav-page'].y - 6);
  });

  it('Back, Next, Close and Start Reading; never moves by itself; a tap outside or Android Back on the first step never closes it', async () => {
    await renderFresh();
    expect(hosts('mushaf-guide-back')).toHaveLength(0); // no Back on the first step
    // Taps anywhere else land on the guide's layer, which does nothing.
    expect(onlyHost('mushaf-guide').props.onStartShouldSetResponder()).toBe(true);
    expect(onlyHost('mushaf-guide').props.onPress).toBeUndefined();
    const modal = root.root.findAll((node) => node.type === ('Modal' as never) && node.findAll((n) => n.props.testID === 'mushaf-guide').length > 0)[0];
    await act(async () => modal.props.onRequestClose());
    expect(guide()).toHaveLength(1);
    expect(guideText()).toBe(copy().guideMarker);
    await act(async () => { await new Promise((done) => setTimeout(done, 3000)); });
    expect(guideText()).toBe(copy().guideMarker); // no timer
    await next();
    await next();
    expect(guideText()).toBe(copy().guideJuz);
    await press(onlyHost('mushaf-guide-back'));
    expect(guideText()).toBe(copy().guideAyah);
    await act(async () => modal.props.onRequestClose()); // Android Back: one step back
    expect(guideText()).toBe(copy().guideMarker);
    await press(onlyHost('mushaf-guide-close'));
    expect(guide()).toHaveLength(0);
    expect(stored()).toEqual({ status: 'done', finished: false });
  });

  it('closed early, it does not show by itself again and the Help icon stays; Help opens it again at step 1', async () => {
    await renderFresh();
    await press(onlyHost('mushaf-guide-close'));
    expect(helpShown()).toBe(true);
    await act(async () => root.unmount());
    await renderFresh();
    expect(guide()).toHaveLength(0);
    expect(helpShown()).toBe(true);
    await press(onlyHost('mushaf-guide-open'));
    await settle();
    expect(guide()).toHaveLength(1);
    expect(guideText()).toBe(copy().guideMarker);
    expect(onlyHost('mushaf-guide-open').props.accessibilityLabel).toBe(copy().guideHelp);
  });

  it('step 6 ends with where to find the guide again, just above Start Reading; no other step shows it', async () => {
    await renderFresh();
    for (let step = 0; step < 5; step += 1) {
      expect(hosts('mushaf-guide-reopen-hint'), `step ${step + 1}`).toHaveLength(0);
      await next();
    }
    const hint = onlyHost('mushaf-guide-reopen-hint');
    expect(hint.props.children).toBe('You can view this guide again anytime from Settings → Quran → Mushaf Guide.');
    // In the card's own note style, above the buttons.
    const card = onlyHost('mushaf-guide-card');
    const flow = card.findAll((node) => typeof node.type === 'string' && (node.props.testID === 'mushaf-guide-reopen-hint' || node.props.testID === 'mushaf-guide-start'));
    expect(flow.map((node) => node.props.testID)).toEqual(['mushaf-guide-reopen-hint', 'mushaf-guide-start']);
    expect(styleOf(hint)).toMatchObject({ fontSize: 13, writingDirection: 'ltr', textAlign: 'left' });
  });

  it('Start Reading on step 6 finishes it: recorded as finished, the Help icon hidden, still hidden after a restart', async () => {
    await renderFresh();
    await toLastStep();
    expect(guideText()).toBe(copy().guideSurah);
    await press(onlyHost('mushaf-guide-start'));
    expect(guide()).toHaveLength(0);
    expect(stored()).toEqual({ status: 'done', finished: true });
    expect(helpShown()).toBe(false);
    expect(currentPage()).toBe(61);
    await act(async () => root.unmount());
    await renderFresh();
    expect(guide()).toHaveLength(0);
    expect(helpShown()).toBe(false);
    // Full screen as before: no Help icon either.
    await press(toggle());
    expect(helpShown()).toBe(false);
  });

  it('users who completed the guide before this update keep it completed: no Help icon, nothing rewritten', async () => {
    state.storage.set(GUIDE_KEY, JSON.stringify({ status: 'done' }));
    await renderFresh();
    expect(guide()).toHaveLength(0);
    expect(helpShown()).toBe(false);
    expect(state.storage.get(GUIDE_KEY)).toBe(JSON.stringify({ status: 'done' }));
  });

  it('Settings → Quran → Mushaf Guide opens it at step 1 even after it was finished; going through or closing it never brings the Help icon back', async () => {
    state.storage.set(GUIDE_KEY, JSON.stringify({ status: 'done', finished: true }));
    await renderFresh();
    expect(guide()).toHaveLength(0);
    await requestFromSettings('1000');
    expect(guide()).toHaveLength(1);
    expect(guideText()).toBe(copy().guideMarker);
    expect(texts()).toContain('1 of 6');
    // Opening it saves nothing.
    expect(stored()).toEqual({ status: 'done', finished: true });
    for (let step = 0; step < 5; step += 1) await next();
    expect(guideText()).toBe(copy().guideSurah);
    expect(stored()).toEqual({ status: 'done', finished: true }); // moving through it saves no progress
    await press(onlyHost('mushaf-guide-close'));
    expect(stored()).toEqual({ status: 'done', finished: true });
    expect(helpShown()).toBe(false);
    // The same request again (a re-render) does not reopen it; a new one does.
    await act(async () => root.update(createElement(MushafScreen)));
    expect(guide()).toHaveLength(0);
    await requestFromSettings('2000');
    expect(guideText()).toBe(copy().guideMarker);
  });

  it('the Settings request changes no page, ورد or reading progress', async () => {
    state.storage.set(GUIDE_KEY, JSON.stringify({ status: 'done', finished: false }));
    await renderFresh();
    const before = new Map([...state.storage].filter(([key]) => !/mushaf-guide/.test(key)));
    await requestFromSettings('3000');
    await press(onlyHost('mushaf-guide-close'));
    expect(currentPage()).toBe(61);
    expect(new Map([...state.storage].filter(([key]) => !/mushaf-guide/.test(key)))).toEqual(before);
  });

  it('interrupted (the app reloaded mid-way): it opens again at the step reached', async () => {
    await renderFresh();
    await next();
    await next();
    expect(stored()).toEqual({ status: 'unseen', step: 2, order: 2 });
    await act(async () => root.unmount());
    await renderFresh();
    expect(guideText()).toBe(copy().guideJuz);
  });

  it('a step reached in the original order (before this update) is not resumed in the new order: the guide starts at step 1', async () => {
    state.storage.set(GUIDE_KEY, JSON.stringify({ status: 'unseen', step: 3 }));
    await renderFresh();
    expect(guideText()).toBe(copy().guideMarker);
    expect(texts()).toContain('1 of 6');
  });

  it('Arabic: the approved wording (step 1 now «وقم بالتأكيد»), mirrored buttons, «التالي / السابق / إغلاق / ابدأ القراءة», and the closing line', async () => {
    state.locale = 'ar';
    await renderFresh();
    expect(guideText()).toBe('اضغط على رقم الآية وقم بالتأكيد لحفظ موضع الوِرد');
    expect(styleOf(onlyHost('mushaf-guide-text'))).toMatchObject({ writingDirection: 'rtl', textAlign: 'right' });
    expect(texts()).toContain('التالي');
    expect(texts()).toContain('إغلاق');
    const actions = onlyHost('mushaf-guide-close').parent!;
    expect(styleOf(actions)).toMatchObject({ flexDirection: 'row-reverse' });
    await toLastStep();
    expect(guideText()).toBe('اضغط على اسم السورة للانتقال إلى سورة');
    expect(texts()).toContain('ابدأ القراءة');
    expect(texts()).toContain('السابق');
    const hint = onlyHost('mushaf-guide-reopen-hint');
    expect(hint.props.children).toBe('يمكنك عرض هذا الدليل مرة أخرى في أي وقت من الإعدادات ← القرآن ← دليل المصحف.');
    expect(styleOf(hint)).toMatchObject({ writingDirection: 'rtl', textAlign: 'right' });
  });

  it('English and Arabic stay paired step by step (the same control, its own text)', async () => {
    for (const locale of ['en', 'ar'] as const) {
      state.locale = locale;
      state.storage.delete(GUIDE_KEY);
      await renderFresh();
      for (let step = 0; step < 6; step += 1) {
        expect(guideText(), `${locale} ${step + 1}`).toBe(MESSAGES[locale].mushaf[ORDER[step][0]]);
        if (step < 5) await next();
      }
      await act(async () => root.unmount());
    }
  });

  it('Light and Dark: the reader`s panel colours, the highlight in its accent', async () => {
    for (const theme of ['light', 'dark'] as const) {
      state.theme = theme;
      state.storage.delete(GUIDE_KEY);
      await renderFresh();
      expect(styleOf(onlyHost('mushaf-guide-card'))).toMatchObject({ backgroundColor: MUSHAF_PANEL_COLORS[theme].sheet.backgroundColor });
      await toLastStep();
      expect(hole()).toMatchObject({ borderColor: MUSHAF_PANEL_COLORS[theme].accent });
      await act(async () => root.unmount());
    }
  });

  it('full screen: no Help icon (Normal Mode only); a guide already open keeps pointing at the real control, measured again', async () => {
    await renderFresh();
    await toLastStep();
    expect(guide()).toHaveLength(1);
    await press(toggle());
    expect(hosts('mushaf-guide-open')).toHaveLength(0);
    await settle();
    expect(guide()).toHaveLength(1);
    expect(hole()).toMatchObject(padded('mushaf-nav-surah'));
    await press(toggle());
    expect(hosts('mushaf-guide-open')).toHaveLength(1);
  });

  it('a small phone: the card fits the screen width with its margins', async () => {
    await renderFresh({ width: 320, height: 548 });
    await toLastStep(); // a step with a control on this page: the card is placed beside it
    const card = styleOf(onlyHost('mushaf-guide-card'));
    // useWindowDimensions is 390 wide here; the card is never wider than the screen less 16 pt each side.
    expect(card.width).toBeLessThanOrEqual(390 - 32);
    expect(card.left).toBeGreaterThanOrEqual(16);
  });
});

describe('tablets: rotation and window resizing (one centred page, nothing lost)', () => {
  // These tests draw page 61's Quran SVG (Traditional frame: fitMushafPage's `taller` false).
  // An 11" iPad (820 × 1180 pt, 24-pt status bar, 20-pt home indicator): its reading area under the status bar and the
  // Back row, in portrait and landscape.
  const PORTRAIT = { width: 820, height: 1180 - 24 - BACK_BAR_HEIGHT };
  const LANDSCAPE = { width: 1180, height: 820 - 24 - BACK_BAR_HEIGHT };
  const iPadInsets = { top: 24, bottom: 20, left: 0, right: 0 };
  const layout = async (area: { width: number; height: number }) => {
    await act(async () => root.root.findByProps({ testID: 'mushaf-page-area' }).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, ...area } } }));
    await flush();
  };
  /** Longer than the resize settling window (layout/resizeSettler.ts): a rotation's layouts have been applied. */
  const quiet = async () => {
    await act(async () => { await new Promise((done) => setTimeout(done, 260)); });
    await flush();
  };
  const pageSize = () => {
    const style = styleOf(root.root.findByProps({ testID: 'mushaf-zoom-page' }));
    return { width: style.width as number, height: style.height as number };
  };
  const selected = () => root.root.findAll((n) => typeof n.type !== 'string' && n.props.selectedVerseKey !== undefined && n.props.selectedVerseKey !== null).map((n) => n.props.selectedVerseKey as string);
  const ayahAnchor = () => root.root.findAll((n) => typeof n.type !== 'string' && n.props.anchor && n.props.copied !== undefined)[0]?.props.anchor as { x: number; y: number } | undefined;

  it('portrait and landscape both show one whole page, centred at its approved proportions; a rotation refits it once its layouts stop', async () => {
    state.insets = iPadInsets;
    await render(PORTRAIT);
    expect(pageSize()).toEqual(fitMushafPage(PORTRAIT, 20, false, false).page);
    await quiet();
    await layout(LANDSCAPE);
    await quiet();
    const landscape = fitMushafPage(LANDSCAPE, 20, false, false);
    expect(pageSize()).toEqual(landscape.page);
    // Same width-to-height proportions as on a phone at that width (never stretched to fill the landscape width).
    expect(landscape.page.height / landscape.page.width).toBeCloseTo(fitMushafPage({ width: landscape.page.width + 6, height: 10000 }, 0, false, false).page.height / (landscape.page.width), 5);
    expect(landscape.page.width).toBeLessThan(LANDSCAPE.width / 2); // one page; the rest is paper
    const viewport = styleOf(root.root.findByProps({ testID: 'mushaf-zoom-viewport' }));
    expect(viewport.width).toBe(LANDSCAPE.width);
    expect(styleOf(inPage().parent!)).toMatchObject({ alignItems: 'center' }); // centred across it
  });

  it('rotating while zoomed returns to the fitted 1× page (never left off screen), on the same page with the same ayah selected', async () => {
    state.insets = iPadInsets;
    await render(PORTRAIT);
    await quiet();
    const before = currentPage();
    await tapPage(100, 130); // 3:85
    expect(selected()).toContain('3:85');
    await pinch(2.5, { x: 600, y: 900 });
    expect(zoom().scale).toBe(2.5);
    await layout(LANDSCAPE);
    await quiet();
    expect(zoom()).toEqual({ scale: 1, x: 0, y: 0 });
    expect(currentPage()).toBe(before);
    expect(selected()).toContain('3:85');
    // Zoom works again at the new size, within the new bounds.
    await pinch(2);
    expect(zoom().scale).toBe(2);
  });

  it('an open ayah popup follows its ayah to where the page is after the rotation', async () => {
    state.insets = iPadInsets;
    await render(PORTRAIT);
    await quiet();
    await tapPage(100, 130);
    await afterTapWindow();
    const before = ayahAnchor()!;
    expect(before).toBeDefined();
    const box = (area: { width: number; height: number }) => {
      const fit = fitMushafPage(area, 20, false, false);
      return { x: (area.width - fit.page.width) / 2, y: 24 + BACK_BAR_HEIGHT, width: fit.page.width, height: fit.page.height };
    };
    const from = box(PORTRAIT);
    await layout(LANDSCAPE);
    await quiet();
    const after = ayahAnchor()!;
    const to = box(LANDSCAPE);
    expect((after.x - to.x) / to.width).toBeCloseTo((before.x - from.x) / from.width, 6);
    expect((after.y - to.y) / to.height).toBeCloseTo((before.y - from.y) / from.height, 6);
    expect(after.x).not.toBeCloseTo(before.x, 0);
  });

  it('a window being resized (Stage Manager, Android freeform) refits the page once it stops, to the last size, never an intermediate one', async () => {
    state.insets = iPadInsets;
    await render(PORTRAIT);
    await quiet();
    for (const size of [{ width: 700, height: 1000 }, { width: 650, height: 990 }, { width: 600, height: 980 }]) await layout(size);
    expect(pageSize()).toEqual(fitMushafPage(PORTRAIT, 20, false, false).page); // held while the window is still moving
    await quiet();
    expect(pageSize()).toEqual(fitMushafPage({ width: 600, height: 980 }, 20, false, false).page);
  });

  it('landscape side insets (a side cutout or navigation bar) are kept clear by the whole reader', async () => {
    state.insets = { top: 0, bottom: 24, left: 48, right: 0 };
    await render({ width: 1280 - 48, height: 800 - BACK_BAR_HEIGHT });
    expect(styleOf(root.root.findByType('GestureHandlerRootView' as never))).toMatchObject({ paddingTop: 0, paddingLeft: 48, paddingRight: 0 });
  });

  it('phones are unchanged: no side padding, the same fitted page as before', async () => {
    await render();
    expect(styleOf(root.root.findByType('GestureHandlerRootView' as never))).toMatchObject({ paddingTop: 47, paddingLeft: 0, paddingRight: 0 });
    expect(pageSize()).toEqual(fitMushafPage({ width: 390, height: 797 }, 34, false, false).page);
  });
});

describe('Quran audio in the reader (audio/)', () => {
  // The fixture pages are 61-62 (Al-Imran). The default, Maher Al-Muaiqly, has no verified timing for Al-Imran since
  // the 2026-10-17 audit (tools/quran-audio), so these tests listen with a Favorite Reciter who has: Abdul Basit.
  beforeEach(() => {
    state.favoriteReciterId = 'abdulbasit';
  });
  const engine = async () => (await import('@/audio/index')).audioEngine;
  const onlyHost = (testID: string) => {
    const found = hosts(testID);
    expect(found, testID).toHaveLength(1);
    return found[0];
  };
  /** The ayah being recited, as the reader shows it highlighted (the page's selected ayah while nothing is selected). */
  const highlighted = () => root.root.findAll((node) => typeof node.type !== 'string' && 'selectedVerseKey' in node.props && node.props.onSelectVerse && node.props.accessibilityActions)[0]?.props.selectedVerseKey ?? null;
  /** The player reports playback reaching the end of the ayah being recited (after a status inside it). */
  async function finishAyah() {
    const { position } = (await engine()).getState();
    const start = 4000 + (position!.ayah - 1) * 10_000;
    for (const positionMs of [start + 100, start + 10_000]) {
      await act(async () => {
        for (const listener of audio.listeners) listener({ positionMs, playing: true, buffering: false, loaded: true, finished: false, error: null });
      });
      await flush();
    }
  }

  it('the headphones play from the first ayah of the page shown, in the Favorite Reciter; while playing they give way to the chip', async () => {
    await render();
    expect(hosts('audio-chip')).toHaveLength(0);
    expect(hosts('mushaf-audio-idle')).toHaveLength(1);
    await press(onlyHost('mushaf-play-page'));
    await flush();
    const state = (await engine()).getState();
    expect(state).toMatchObject({ phase: 'playing', mode: 'continuous', position: { surah: 3, ayah: 84 }, reciterId: 'abdulbasit' });
    expect(audio.loads).toEqual(['https://cdn.mp3quran.net/audio/abdulbasit-abdulsamad/r3/003.mp3@834000']);
    expect(hosts('audio-chip')).toHaveLength(1);
    expect(hosts('mushaf-play-page')).toHaveLength(0);
    expect(highlighted()).toBe('3:84');
  });

  it('the page keeps its size and place while the player shows (the chip lives in the top bar)', async () => {
    await render();
    const before = styleOf(root.root.findByProps({ testID: 'mushaf-paper' }));
    await press(onlyHost('mushaf-play-page'));
    await flush();
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-paper' }))).toEqual(before);
    expect(styleOf(root.root.findByProps({ testID: 'mushaf-back-bar' })).height).toBe(BACK_BAR_HEIGHT);
  });

  it('continues ayah after ayah and turns the page when the recitation reaches the next page; no ورد or last page is saved', async () => {
    await render();
    const stopsBefore = state.storage.get(READING_STOPS_STORAGE_KEY);
    await press(onlyHost('mushaf-play-page'));
    await flush();
    const lastPageBefore = state.storage.get('quran-heals:mushaf-last-page:v1');
    for (let ayah = 84; ayah <= 91; ayah++) await finishAyah();
    expect((await engine()).getState().position).toEqual({ surah: 3, ayah: 92 });
    expect(currentPage()).toBe(62);
    expect(state.storage.get(READING_STOPS_STORAGE_KEY)).toBe(stopsBefore);
    expect(state.storage.get('quran-heals:mushaf-last-page:v1')).toBe(lastPageBefore);
  });

  it('swiping away stops following (never pulled back); Follow recitation returns to the recited page', async () => {
    await render();
    await press(onlyHost('mushaf-play-page'));
    await flush();
    await turnPage(1);
    expect(currentPage()).toBe(62);
    expect(hosts('audio-follow')).toHaveLength(1);
    await finishAyah();
    expect((await engine()).getState().position).toEqual({ surah: 3, ayah: 85 });
    expect(currentPage()).toBe(62);
    await press(onlyHost('audio-follow'));
    await flush();
    expect(currentPage()).toBe(61);
    expect(hosts('audio-follow')).toHaveLength(0);
  });

  it('swiping back to the recited page follows it again', async () => {
    await render();
    await press(onlyHost('mushaf-play-page'));
    await flush();
    await turnPage(1);
    await turnPage(-1);
    expect(hosts('audio-follow')).toHaveLength(0);
    for (let ayah = 84; ayah <= 91; ayah++) await finishAyah();
    expect(currentPage()).toBe(62);
  });

  it('an ayah\'s Listen recites from that ayah; the popup closes and the recited ayah is highlighted', async () => {
    await render();
    await tapPage(100, 130); // 3:85
    await afterTapWindow();
    await press(onlyHost('mushaf-ayah-listen'));
    await flush();
    expect(hosts('mushaf-ayah-actions')).toHaveLength(0);
    expect((await engine()).getState()).toMatchObject({ phase: 'playing', position: { surah: 3, ayah: 85 }, reciterId: 'abdulbasit' });
    expect(highlighted()).toBe('3:85');
  });

  describe('Full Surah and Repeat Ayah in the window', () => {
    it('Full Surah sits on the right of the Surah/ayah row (the Surah and ayah on the left); it plays the surah from ayah 1', async () => {
      await render();
      await tapPage(100, 130); // 3:85
      await afterTapWindow();
      await press(onlyHost('mushaf-ayah-listen'));
      await flush();
      await press(onlyHost('audio-expand'));
      const row = onlyHost('audio-info-row');
      // Physical order, left to right: the Surah and ayah, then Full Surah.
      expect(flat(row.props.style).flexDirection).toBe('row');
      expect((row.children as ReactTestInstance[]).map((n) => n.props.testID)).toEqual(['audio-ayah', 'audio-full-surah']);
      expect(textOfNode(onlyHost('audio-full-surah'))).toBe('Full Surah');
      expect(onlyHost('audio-full-surah').props.accessibilityLabel).toBe('Full Surah');
      expect(flat(onlyHost('audio-ayah').props.style).textAlign).toBe('left');
      await press(onlyHost('audio-full-surah'));
      await flush();
      expect((await engine()).getState()).toMatchObject({ mode: 'fullSurah', phase: 'playing', position: { surah: 3, ayah: 1 }, reciterId: 'abdulbasit' });
      // Same reciter, same surah file already loaded: one stream, sought back to the start (no reload).
      expect(audio.loads.at(-1)).toBe('seek@0');
      // The recitation is followed and highlighted (Aal-i-Imraan begins on page 50, outside this fixture's pages).
      expect(textOfNode(onlyHost('audio-ayah'))).toBe('Aal-i-Imraan · Ayah 1');
    });

    it('Arabic: the same physical row, not mirrored: «سورة … · الآية …» on the left, «السورة كاملة» on the right', async () => {
      state.locale = 'ar';
      await render();
      await press(onlyHost('mushaf-play-page'));
      await flush();
      await press(onlyHost('audio-expand'));
      const row = onlyHost('audio-info-row');
      expect(flat(row.props.style).flexDirection).toBe('row');
      expect((row.children as ReactTestInstance[]).map((n) => n.props.testID)).toEqual(['audio-ayah', 'audio-full-surah']);
      expect(textOfNode(onlyHost('audio-full-surah'))).toBe('السورة كاملة');
      expect(flat(onlyHost('audio-ayah').props.style).textAlign).toBe('left');
      expect(textOfNode(onlyHost('audio-ayah'))).toBe('سورة آل عمران · الآية ٨٤');
    });

    it('Repeat Ayah: at the bar\'s far right in both languages, outside the centred five; Off → 1 → 2 → 3 → ∞ → Off, the count inside the loop', async () => {
      for (const locale of ['en', 'ar'] as const) {
        state.locale = locale;
        await render();
        await press(onlyHost('mushaf-play-page'));
        await flush();
        await press(onlyHost('audio-expand'));
        // The five main controls stay one centred group, in their unchanged order; Repeat is not part of it.
        const row = onlyHost('audio-controls');
        expect(flat(row.props.style).flexDirection, locale).toBe('row-reverse');
        expect((row.children as ReactTestInstance[]).map((n) => n.props.testID), locale).toEqual(['audio-previous-page', 'audio-previous', 'audio-toggle-large', 'audio-next', 'audio-next-page']);
        const bar = onlyHost('audio-controls-bar');
        expect(flat(bar.props.style).justifyContent, locale).toBe('center');
        expect(onlyHost('audio-repeat').parent?.props.testID ?? onlyHost('audio-repeat').parent?.parent?.props.testID, locale).toBe('audio-controls-bar');
        const repeatStyleProp = onlyHost('audio-repeat').props.style;
        const repeatStyle = flat(typeof repeatStyleProp === 'function' ? repeatStyleProp({ pressed: false }) : repeatStyleProp);
        expect(repeatStyle, locale).toMatchObject({ position: 'absolute', right: 0 });
        const labels: string[] = [];
        const counts: string[] = [];
        for (let i = 0; i < 6; i++) {
          labels.push(onlyHost('audio-repeat').props.accessibilityLabel);
          counts.push(hosts('audio-repeat-count').map((n) => textOfNode(n)).join('') || '-');
          await press(onlyHost('audio-repeat'));
        }
        if (locale === 'en') {
          expect(labels).toEqual(['Repeat ayah: off', 'Repeat ayah: once', 'Repeat ayah: twice', 'Repeat ayah: 3 times', 'Repeat ayah: continuously', 'Repeat ayah: off']);
          expect(counts).toEqual(['-', '1', '2', '3', '∞', '-']);
        } else {
          expect(labels).toEqual(['تكرار الآية: متوقف', 'تكرار الآية: مرة واحدة', 'تكرار الآية: مرتين', 'تكرار الآية: ٣ مرات', 'تكرار الآية: باستمرار', 'تكرار الآية: متوقف']);
          expect(counts).toEqual(['-', '١', '٢', '٣', '∞', '-']);
        }
        expect(onlyHost('audio-repeat').props.accessibilityHint, locale).toBeTruthy();
        await act(async () => root.unmount());
        (await engine()).stop();
      }
    });

    it('Repeat on: the ayah is recited again from its verified start in the same file, then the next ayah', async () => {
      await render();
      await press(onlyHost('mushaf-play-page')); // 3:84
      await flush();
      await press(onlyHost('audio-expand'));
      await press(onlyHost('audio-repeat')); // 1
      const loadsBefore = audio.loads.length;
      await finishAyah();
      expect((await engine()).getState().position).toEqual({ surah: 3, ayah: 84 });
      expect(audio.loads.slice(loadsBefore)).toEqual([`seek@${4000 + 83 * 10_000}`]);
      expect(highlighted()).toBe('3:84');
      await finishAyah();
      expect((await engine()).getState().position).toEqual({ surah: 3, ayah: 85 });
      expect(highlighted()).toBe('3:85');
    });
  });

  describe('a whole-surah recording (no verified ayah timing): surah-only mode', () => {
    const report = async (positionMs: number, patch: { playing?: boolean; finished?: boolean } = {}) => {
      await act(async () => {
        for (const listener of audio.listeners) listener({ positionMs, playing: true, buffering: false, loaded: true, finished: false, error: null, durationMs: 1_234_000, ...patch });
      });
      await flush();
    };

    it('Listen on an ayah never starts elsewhere: the player opens with the choice, and Cancel plays nothing', async () => {
      audio.wholeSurah.add('abdulbasit:3');
      await render();
      await tapPage(100, 130); // 3:85
      await afterTapWindow();
      await press(onlyHost('mushaf-ayah-listen'));
      await flush();
      expect((await engine()).getState()).toMatchObject({ phase: 'error', position: { surah: 3, ayah: 85 }, error: { kind: 'surah-only', surah: 3, reciterId: 'abdulbasit' } });
      expect(audio.loads).toEqual([]);
      // The ayah asked for is not highlighted as if recited: this recording cannot recite it (seen on the emulator).
      expect(highlighted()).not.toBe('3:85');
      expect(hosts('audio-panel')).toHaveLength(1);
      expect(textOfNode(onlyHost('audio-problem'))).toBe(
        "Abdul Basit Abdus Samad's recording of Surah Aal-i-Imraan can only be played complete, from its beginning: it has no verified ayah timing, so it can't start at this ayah. Play the whole surah Cancel",
      );
      await press(onlyHost('audio-whole-surah-cancel'));
      await flush();
      expect((await engine()).getState().phase).toBe('idle');
      expect(audio.loads).toEqual([]);
      expect(hosts('audio-panel')).toHaveLength(0);
    });

    it('plays the whole surah from its start once chosen: no ayah highlighted, no page turned; the time, a position bar and surah controls', async () => {
      audio.wholeSurah.add('abdulbasit:3');
      await render();
      await press(onlyHost('mushaf-play-page')); // page 61 begins at 3:84, inside the surah: the choice
      await flush();
      expect(audio.loads).toEqual([]);
      await press(onlyHost('audio-play-whole-surah'));
      await flush();
      expect(audio.loads).toEqual(['https://cdn.mp3quran.net/audio/abdulbasit-abdulsamad/r3/003.mp3@0']);
      expect((await engine()).getState()).toMatchObject({ phase: 'playing', granularity: 'surah', position: { surah: 3, ayah: 0 } });
      await report(1000);
      await report(65_000);
      expect(highlighted()).toBeNull();
      expect(currentPage()).toBe(61); // Aal-i-Imraan begins on page 50: never turned to (the page being recited is unknown)
      // The chip names the surah where it shows the ayah number in ayah playback.
      expect(textOfNode(onlyHost('audio-chip'))).toMatch(/^Abdul Basit Abdus Samad.* · Aal-i-Imraan$/);
      expect(textOfNode(onlyHost('audio-chip'))).not.toMatch(/\d/);
      expect(textOfNode(onlyHost('audio-ayah'))).toBe('Aal-i-Imraan · Whole surah');
      expect(textOfNode(onlyHost('audio-whole-surah-note'))).toBe("This recording plays as a complete surah. Ayahs aren't followed or highlighted.");
      expect(hosts('audio-progress')).toHaveLength(0);
      expect(textOfNode(onlyHost('audio-elapsed'))).toBe('1:05');
      expect(textOfNode(onlyHost('audio-duration'))).toBe('20:34');
      expect(hosts('audio-previous-page')).toHaveLength(0);
      expect(hosts('audio-next-page')).toHaveLength(0);
      expect(hosts('audio-follow')).toHaveLength(0);
      expect(hosts('audio-follow-panel')).toHaveLength(0);
      expect(onlyHost('audio-previous').props.accessibilityLabel).toBe('Previous surah');
      expect(onlyHost('audio-next').props.accessibilityLabel).toBe('Next surah');
      // The screen reader moves 15 s at a time.
      await act(async () => onlyHost('audio-seek').props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
      await flush();
      expect(audio.loads.at(-1)).toBe('seek@80000');
      // Next surah: An-Nisaa, ayah by ayah again (its verified timing), from its first ayah; the page now follows it.
      await press(onlyHost('audio-next'));
      await flush();
      expect((await engine()).getState()).toMatchObject({ phase: 'playing', granularity: 'ayah', position: { surah: 4, ayah: 1 } });
    });

    it('in Arabic: the surah, the whole-surah note and the time in Arabic', async () => {
      state.locale = 'ar';
      audio.wholeSurah.add('abdulbasit:3');
      await render();
      (await engine()).start({ surah: 3, ayah: 1 }, { mode: 'continuous', reciterId: 'abdulbasit' });
      await flush();
      await report(1000);
      await report(65_000);
      await press(onlyHost('audio-expand'));
      expect(textOfNode(onlyHost('audio-ayah'))).toBe('آل عمران · السورة كاملة');
      expect(textOfNode(onlyHost('audio-whole-surah-note'))).toBe('يُشغَّل هذا التسجيل سورةً كاملة، ولا تُتابَع الآيات ولا تُظلَّل.');
      expect(textOfNode(onlyHost('audio-elapsed'))).toBe('١:٠٥');
      expect(textOfNode(onlyHost('audio-duration'))).toBe('٢٠:٣٤');
      expect(onlyHost('audio-previous').props.accessibilityLabel).toBe('السورة السابقة');
      expect(highlighted()).toBeNull();
    });
  });

  it('Listen while listening uses the player\'s reciter (its up-next choice too), never the Favorite Reciter setting', async () => {
    await render();
    await press(onlyHost('mushaf-play-page'));
    await flush();
    (await engine()).selectReciter('naina');
    await flush();
    await tapPage(100, 130);
    await afterTapWindow();
    await press(onlyHost('mushaf-ayah-listen'));
    await flush();
    expect((await engine()).getState()).toMatchObject({ position: { surah: 3, ayah: 85 }, reciterId: 'naina' });
    expect(state.storage.has('quran-heals:favorite-reciter:v1')).toBe(false);
  });

  it('full screen: the headphones while idle start the page; the chip while playing; Pause brings the headphones back', async () => {
    await render();
    await press(onlyHost('mushaf-fullscreen-toggle'));
    expect(hosts('mushaf-play-page')).toHaveLength(1);
    expect(hosts('audio-chip')).toHaveLength(0);
    await press(onlyHost('mushaf-play-page'));
    await flush();
    expect((await engine()).getState()).toMatchObject({ phase: 'playing', position: { surah: 3, ayah: 84 } });
    expect(hosts('audio-chip')).toHaveLength(1);
    expect(hosts('mushaf-play-page')).toHaveLength(0);
    await press(onlyHost('audio-toggle'));
    expect(hosts('audio-chip')).toHaveLength(0);
    expect(hosts('mushaf-play-page')).toHaveLength(1);
    await press(onlyHost('mushaf-play-page'));
    await flush();
    expect((await engine()).getState()).toMatchObject({ phase: 'playing', position: { surah: 3, ayah: 84 } });
    // The window opens from the chip in full screen too, and hides without stopping.
    await press(onlyHost('audio-expand'));
    expect(hosts('audio-panel')).toHaveLength(1);
    await press(onlyHost('audio-panel-backdrop'));
    expect((await engine()).getState().phase).toBe('playing');
  });

  it('entering and leaving full screen never restarts, reloads or duplicates the recitation; a pause stays a pause', async () => {
    await render();
    await press(onlyHost('mushaf-play-page'));
    await flush();
    await finishAyah(); // 3:85
    const loads = audio.loads.length;
    await press(onlyHost('mushaf-fullscreen-toggle'));
    expect((await engine()).getState()).toMatchObject({ phase: 'playing', position: { surah: 3, ayah: 85 }, reciterId: 'abdulbasit' });
    expect(textOfNode(onlyHost('audio-expand'))).toContain('Abdul Basit Abdus Samad');
    await press(onlyHost('mushaf-fullscreen-toggle'));
    expect((await engine()).getState()).toMatchObject({ phase: 'playing', position: { surah: 3, ayah: 85 } });
    expect(audio.loads).toHaveLength(loads);
    await press(onlyHost('audio-toggle'));
    await press(onlyHost('mushaf-fullscreen-toggle'));
    expect((await engine()).getState().phase).toBe('paused');
    expect(hosts('mushaf-play-page')).toHaveLength(1);
    expect(hosts('audio-chip')).toHaveLength(0);
  });

  it('the toolbar has no page arrows in either mode (they are in the audio window); swipes still only change the page', async () => {
    await render();
    for (const id of ['mushaf-page-next', 'mushaf-page-previous', 'audio-next-page', 'audio-previous-page']) expect(hosts(id), id).toHaveLength(0);
    await press(onlyHost('mushaf-play-page'));
    await flush();
    const loads = audio.loads.length;
    // A manual page change (the page's own next-page action, as a swipe): the recitation carries on, unfollowed.
    await turnPage(1);
    expect(currentPage()).toBe(62);
    expect((await engine()).getState()).toMatchObject({ phase: 'playing', position: { surah: 3, ayah: 84 } });
    expect(audio.loads).toHaveLength(loads);
    expect(hosts('audio-follow')).toHaveLength(1);
    expect(hosts('mushaf-page-next')).toHaveLength(0);
    await press(onlyHost('mushaf-fullscreen-toggle'));
    expect(hosts('mushaf-page-next')).toHaveLength(0);
    expect(hosts('mushaf-page-previous')).toHaveLength(0);
  });

  async function playing() {
    await render();
    await press(onlyHost('mushaf-play-page'));
    await flush();
  }
  /** The chip's label as read: the name and the (nested) ayah number, strings only. */
  const chipText = () => onlyHost('audio-expand').findAllByType('Text' as never).flatMap((t) => [t.props.children].flat()).filter((c): c is string => typeof c === 'string').join('');

  it('the chip while playing: its own Pause, then the Sheikh and the ayah (updating as it advances), each its own touch target', async () => {
    await playing();
    const chip = onlyHost('audio-chip');
    const targets = chip.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'button').map((node) => node.props.testID);
    expect(targets.slice(0, 2)).toEqual(['audio-toggle', 'audio-expand']);
    expect(onlyHost('audio-toggle').findAllByType('Pause' as never)).toHaveLength(1);
    expect(chipText()).toBe('Abdul Basit Abdus Samad · 84');
    await finishAyah();
    expect(chipText()).toBe('Abdul Basit Abdus Samad · 85');
    // The Pause button acts at once, without opening the window.
    expect(hosts('audio-panel')).toHaveLength(0);
  });

  it('Pause in the chip: paused in place, the whole chip gone and the headphones back; the headphones resume from there', async () => {
    await playing();
    await finishAyah(); // 3:85
    await press(onlyHost('audio-toggle'));
    expect((await engine()).getState()).toMatchObject({ phase: 'paused', position: { surah: 3, ayah: 85 }, reciterId: 'abdulbasit' });
    expect(hosts('audio-chip')).toHaveLength(0);
    expect(hosts('mushaf-audio-idle')).toHaveLength(1);
    expect(onlyHost('mushaf-play-page').props.accessibilityLabel).toBe(MESSAGES.en.audio.play);
    const loads = audio.loads.length;
    await press(onlyHost('mushaf-play-page'));
    await flush();
    expect((await engine()).getState()).toMatchObject({ phase: 'playing', position: { surah: 3, ayah: 85 } });
    expect(audio.loads).toHaveLength(loads); // resumed in place: no reload, no second player
    expect(hosts('audio-chip')).toHaveLength(1);
    expect(hosts('mushaf-play-page')).toHaveLength(0);
  });

  it('Stop (touch and hold the chip`s Pause, or the screen reader action) closes the player; the headphones return', async () => {
    await playing();
    expect(onlyHost('audio-toggle').props.accessibilityActions).toEqual([{ name: 'stop', label: MESSAGES.en.audio.stop }]);
    await act(async () => onlyHost('audio-toggle').props.onLongPress());
    expect((await engine()).getState().phase).toBe('idle');
    expect(hosts('audio-chip')).toHaveLength(0);
    expect(hosts('mushaf-audio-idle')).toHaveLength(1);
    // A paused recitation can be stopped from the headphones too.
    await press(onlyHost('mushaf-play-page'));
    await flush();
    await press(onlyHost('audio-toggle'));
    await act(async () => onlyHost('mushaf-play-page').props.onLongPress());
    expect((await engine()).getState().phase).toBe('idle');
  });

  it('the headphones return (and the chip goes) after the end of the Quran and after an error that stops playback', async () => {
    await render();
    (await engine()).start({ surah: 114, ayah: 6 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await flush();
    expect(hosts('audio-chip')).toHaveLength(1);
    await finishAyah();
    expect((await engine()).getState().phase).toBe('ended');
    expect(hosts('audio-chip')).toHaveLength(0);
    expect(hosts('mushaf-audio-idle')).toHaveLength(1);
    audio.without.add('minshawi:54'); // fixture: no verified recording
    (await engine()).start({ surah: 54, ayah: 1 }, { mode: 'continuous', reciterId: 'minshawi' });
    await flush();
    expect((await engine()).getState().phase).toBe('error');
    expect(hosts('audio-chip')).toHaveLength(0);
    expect(hosts('mushaf-audio-idle')).toHaveLength(1);
  });

  it('the chip`s arrow: ⌄ with the window closed, ⌃ while it is open, ⌄ again once a tap outside closes it (playback untouched)', async () => {
    await playing();
    expect(hosts('audio-chip-chevron-down')).toHaveLength(1);
    expect(hosts('audio-chip-chevron-up')).toHaveLength(0);
    await press(onlyHost('audio-expand'));
    expect(hosts('audio-panel')).toHaveLength(1);
    expect(hosts('audio-chip-chevron-up')).toHaveLength(1);
    expect(hosts('audio-chip-chevron-down')).toHaveLength(0);
    expect(onlyHost('audio-expand').props.accessibilityState).toEqual({ expanded: true });
    await press(onlyHost('audio-panel-backdrop'));
    expect(hosts('audio-panel')).toHaveLength(0);
    expect(hosts('audio-chip-chevron-down')).toHaveLength(1);
    expect((await engine()).getState().phase).toBe('playing');
    expect(audio.loads).toHaveLength(1); // opening and closing never reloaded or restarted
  });

  it('the window: Sheikh ⌄ first, then the Surah and ayah, its progress, then Previous — Play/Pause — Next; no X', async () => {
    await playing();
    await press(onlyHost('audio-expand'));
    const panel = onlyHost('audio-panel');
    const order = panel.findAll((node) => typeof node.type === 'string' && /^audio-(reciter-dropdown|ayah|progress|previous-page|previous|toggle-large|next|next-page)$/.test(node.props.testID ?? '')).map((node) => node.props.testID);
    expect(order).toEqual(['audio-reciter-dropdown', 'audio-ayah', 'audio-progress', 'audio-previous-page', 'audio-previous', 'audio-toggle-large', 'audio-next', 'audio-next-page']);
    // The Sheikh header has no Surah name; the row under it has the Surah and the ayah.
    expect(textOfNode(onlyHost('audio-reciter-dropdown'))).toBe('Abdul Basit Abdus Samad');
    expect(textOfNode(onlyHost('audio-ayah'))).toBe('Aal-i-Imraan · Ayah 84');
    expect(onlyHost('audio-progress').props.accessibilityLabel).toBe('Ayah 84 of 200');
    // Previous and Next are drawn (icons with no style transform, which react-native-svg would move off their box).
    for (const id of ['audio-previous-icon', 'audio-next-icon', 'audio-previous-page-icon', 'audio-next-page-icon']) expect(root.root.findByProps({ testID: id }).props.style).toBeUndefined();
    // Page jumps and ayah jumps look different: double chevrons vs skip icons; Play / Pause is the largest.
    expect(onlyHost('audio-previous-page').findAllByType('ChevronsRight' as never)).toHaveLength(1);
    expect(onlyHost('audio-next-page').findAllByType('ChevronsLeft' as never)).toHaveLength(1);
    expect(onlyHost('audio-previous').findAllByType('SkipForward' as never)).toHaveLength(1);
    const width = (id: string) => flat(onlyHost(id).props.style({ pressed: false })).width as number;
    expect(width('audio-toggle-large')).toBeGreaterThan(width('audio-previous'));
    expect(width('audio-previous')).toBeGreaterThanOrEqual(width('audio-previous-page'));
    // The row fits the narrowest iPhone window (320 − 16 margin − 24 padding = 280 pt): 40 + 44 + 48 + 44 + 40 + 4 × 12.
    const gap = flat(onlyHost('audio-previous').parent!.props.style).gap as number;
    expect(width('audio-previous-page') * 2 + width('audio-previous') * 2 + width('audio-toggle-large') + gap * 4).toBeLessThanOrEqual(280);
    expect(hosts('audio-stop')).toHaveLength(0);
    expect(panel.findAllByType('X' as never)).toHaveLength(0);
    // Pausing inside the window keeps it open (the chip goes; the headphones are back behind it).
    await press(onlyHost('audio-toggle-large'));
    expect((await engine()).getState().phase).toBe('paused');
    expect(hosts('audio-panel')).toHaveLength(1);
    expect(onlyHost('audio-toggle-large').props.accessibilityLabel).toBe(MESSAGES.en.audio.play);
  });

  it('the Surah and ayah follow the recitation, across a surah', async () => {
    await render();
    (await engine()).start({ surah: 3, ayah: 200 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await flush();
    await press(onlyHost('audio-expand'));
    expect(textOfNode(onlyHost('audio-ayah'))).toBe('Aal-i-Imraan · Ayah 200');
    await finishAyah();
    expect(textOfNode(onlyHost('audio-ayah'))).toBe('An-Nisaa · Ayah 1');
  });

  it('Previous and Next play that ayah (from a pause too), across surahs and pages, and the page follows it', async () => {
    await playing();
    await turnPage(1); // reading page 62: not following
    expect(hosts('audio-follow')).toHaveLength(1);
    await press(onlyHost('audio-expand'));
    await press(onlyHost('audio-toggle-large')); // pause
    await press(onlyHost('audio-next'));
    await flush();
    expect((await engine()).getState()).toMatchObject({ phase: 'playing', position: { surah: 3, ayah: 85 } });
    expect(audio.loads.at(-1)).toBe('seek@844000');
    expect(currentPage()).toBe(61);
    expect(hosts('audio-follow')).toHaveLength(0);
    await press(onlyHost('audio-previous'));
    await flush();
    expect((await engine()).getState().position).toEqual({ surah: 3, ayah: 84 });
    // Across a page: from 3:91 (page 61), Next plays 3:92 and the page turns to 62.
    (await engine()).start({ surah: 3, ayah: 91 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await flush();
    await press(onlyHost('audio-next'));
    await flush();
    expect((await engine()).getState().position).toEqual({ surah: 3, ayah: 92 });
    expect(currentPage()).toBe(62);
    // Across a surah: Previous from 4:1 plays 3:200 from Aal-i-Imraan's file.
    (await engine()).start({ surah: 4, ayah: 1 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await flush();
    await press(onlyHost('audio-previous'));
    await flush();
    expect((await engine()).getState()).toMatchObject({ phase: 'playing', position: { surah: 3, ayah: 200 } });
    expect(audio.loads.at(-1)).toBe(`https://cdn.mp3quran.net/audio/abdulbasit-abdulsamad/r3/003.mp3@${4000 + 199 * 10_000}`);
  });

  it('Next page in the window: the next page`s first ayah plays (from a pause too), the page shows it and follows again', async () => {
    await playing(); // page 61, 3:84
    await press(onlyHost('audio-expand'));
    await press(onlyHost('audio-toggle-large')); // pause
    await press(onlyHost('audio-next-page'));
    await flush();
    expect((await engine()).getState()).toMatchObject({ phase: 'playing', position: { surah: 3, ayah: 92 } }); // page 62 begins at 3:92
    expect(audio.loads.at(-1)).toBe(`seek@${4000 + 91 * 10_000}`);
    expect(currentPage()).toBe(62);
    expect(textOfNode(onlyHost('audio-ayah'))).toBe('Aal-i-Imraan · Ayah 92');
    await press(onlyHost('audio-panel-backdrop'));
    expect(chipText()).toBe('Abdul Basit Abdus Samad · 92');
    // Recitation continues from there, and the page follows it.
    for (let ayah = 92; ayah <= 100; ayah++) await finishAyah();
    expect(currentPage()).toBe(63); // page 63 begins at 3:101
  });

  it('page jumps start from the page being recited, not the page merely shown; they restore following', async () => {
    await playing(); // reciting page 61
    await turnPage(1);
    await turnPage(1); // reading page 63
    expect(hosts('audio-follow')).toHaveLength(1);
    await press(onlyHost('audio-expand'));
    await press(onlyHost('audio-previous-page'));
    await flush();
    expect((await engine()).getState().position).toEqual({ surah: 3, ayah: 78 }); // page 60 begins at 3:78
    expect(currentPage()).toBe(60);
    expect(hosts('audio-follow')).toHaveLength(0);
  });

  it('Previous page is unavailable while page 1 is recited, Next page while page 604 is', async () => {
    await render();
    (await engine()).start({ surah: 1, ayah: 4 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await flush();
    await press(onlyHost('audio-expand'));
    expect(onlyHost('audio-previous-page').props).toMatchObject({ disabled: true, accessibilityState: { disabled: true } });
    expect(onlyHost('audio-next-page').props.disabled).toBe(false);
    await press(onlyHost('audio-panel-backdrop'));
    (await engine()).start({ surah: 114, ayah: 1 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await flush();
    await press(onlyHost('audio-expand'));
    expect(onlyHost('audio-next-page').props).toMatchObject({ disabled: true, accessibilityState: { disabled: true } });
    expect(onlyHost('audio-previous-page').props.disabled).toBe(false);
  });

  it('a pending Sheikh takes over at once on a page jump; a Sheikh without the target surah stops there with the message', async () => {
    await playing();
    await press(onlyHost('audio-expand'));
    await press(onlyHost('audio-reciter-dropdown'));
    await press(onlyHost('audio-reciter-minshawi'));
    await flush();
    await press(onlyHost('audio-next-page'));
    await flush();
    expect((await engine()).getState()).toMatchObject({ reciterId: 'minshawi', pendingReciterId: null, position: { surah: 3, ayah: 92 }, phase: 'playing' });
    expect(state.storage.has('quran-heals:favorite-reciter:v1')).toBe(false);
    audio.without.add('minshawi:52'); // fixture: Al-Minshawi without At-Tur
    (await engine()).start({ surah: 51, ayah: 52 }, { mode: 'continuous', reciterId: 'minshawi' }); // page 523; page 524 begins at 52:15
    await flush();
    await press(onlyHost('audio-next-page'));
    await flush();
    expect((await engine()).getState()).toMatchObject({ phase: 'error', reciterId: 'minshawi', position: { surah: 52, ayah: 15 } });
    expect(textOfNode(onlyHost('audio-problem'))).toMatch(/Muhammad Siddiq Al-Minshawi has no verified recording of Surah At-Tur/);
    expect(hosts('audio-chip')).toHaveLength(0); // not shown as playing
  });

  it('the five controls in full screen too', async () => {
    await render();
    await press(onlyHost('mushaf-fullscreen-toggle'));
    await press(onlyHost('mushaf-play-page'));
    await flush();
    await press(onlyHost('audio-expand'));
    for (const id of ['audio-previous-page', 'audio-previous', 'audio-toggle-large', 'audio-next', 'audio-next-page']) expect(hosts(id), id).toHaveLength(1);
    await press(onlyHost('audio-next-page'));
    await flush();
    expect((await engine()).getState().position).toEqual({ surah: 3, ayah: 92 });
    expect(currentPage()).toBe(62);
  });

  it('the five controls keep the Mushaf`s right-to-left order and glyphs in English and Arabic, normal and full screen', async () => {
    for (const locale of ['en', 'ar'] as const) {
      for (const full of [false, true]) {
        state.locale = locale;
        await render();
        if (full) await press(onlyHost('mushaf-fullscreen-toggle'));
        await press(onlyHost('mushaf-play-page'));
        await flush();
        await press(onlyHost('audio-expand'));
        const label = `${locale}${full ? ' full screen' : ''}`;
        const row = onlyHost('audio-controls');
        // row-reverse in every language: the first child is drawn on the right.
        expect(flat(row.props.style).flexDirection, label).toBe('row-reverse');
        const rightToLeft = (row.children as ReactTestInstance[]).map((node) => node.props.testID);
        expect(rightToLeft, label).toEqual(['audio-previous-page', 'audio-previous', 'audio-toggle-large', 'audio-next', 'audio-next-page']);
        // Previous glyphs point right, next glyphs left; chosen directly, never transformed.
        const glyph = (id: string, type: string) => onlyHost(id).findAllByType(type as never);
        expect(glyph('audio-previous-page', 'ChevronsRight'), label).toHaveLength(1);
        expect(glyph('audio-previous', 'SkipForward'), label).toHaveLength(1);
        expect(glyph('audio-next', 'SkipBack'), label).toHaveLength(1);
        expect(glyph('audio-next-page', 'ChevronsLeft'), label).toHaveLength(1);
        for (const id of ['audio-previous-icon', 'audio-next-icon', 'audio-previous-page-icon', 'audio-next-page-icon']) expect(root.root.findByProps({ testID: id }).props.style, `${label} ${id}`).toBeUndefined();
        // Each does its own thing.
        await press(onlyHost('audio-next'));
        await flush();
        expect((await engine()).getState().position, label).toEqual({ surah: 3, ayah: 85 });
        await press(onlyHost('audio-previous'));
        await flush();
        expect((await engine()).getState().position, label).toEqual({ surah: 3, ayah: 84 });
        await press(onlyHost('audio-next-page'));
        await flush();
        expect((await engine()).getState().position, label).toEqual({ surah: 3, ayah: 92 });
        await press(onlyHost('audio-previous-page'));
        await flush();
        expect((await engine()).getState().position, label).toEqual({ surah: 3, ayah: 84 });
        (await engine()).stop();
        await act(async () => root.unmount());
      }
    }
  });

  it('Previous is unavailable at Al-Fatiha 1 and Next at An-Nas 6', async () => {
    await render();
    (await engine()).start({ surah: 1, ayah: 1 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await flush();
    await press(onlyHost('audio-expand'));
    expect(onlyHost('audio-previous').props).toMatchObject({ disabled: true, accessibilityState: { disabled: true } });
    expect(onlyHost('audio-next').props.disabled).toBe(false);
    await press(onlyHost('audio-panel-backdrop'));
    (await engine()).start({ surah: 114, ayah: 6 }, { mode: 'continuous', reciterId: 'abdulbasit' });
    await flush();
    await press(onlyHost('audio-expand'));
    expect(onlyHost('audio-next').props).toMatchObject({ disabled: true, accessibilityState: { disabled: true } });
    expect(onlyHost('audio-previous').props.disabled).toBe(false);
  });

  it('the Sheikh dropdown: its arrow always shown, ⌄ closed and ⌃ open; the offered reciters (17 in a release build), the current highlighted; a choice is Up next, a manual Next applies it at once', async () => {
    await playing();
    await press(onlyHost('audio-expand'));
    expect(hosts('audio-reciter-chevron-down')).toHaveLength(1);
    expect(hosts('audio-reciter-list')).toHaveLength(0);
    await press(onlyHost('audio-reciter-dropdown'));
    expect(hosts('audio-reciter-chevron-up')).toHaveLength(1);
    expect(hosts('audio-reciter-chevron-down')).toHaveLength(0);
    const rows = () => root.root.findAll((node) => typeof node.type === 'string' && /^audio-reciter-(?!dropdown|name|list|chevron)/.test(node.props.testID ?? ''));
    expect(rows()).toHaveLength(17);
    expect(rows().map((node) => node.props.testID.replace('audio-reciter-', ''))).toEqual(['minshawi', 'husary', 'abdulbasit', 'banna', 'sufi', 'ahmed-salama', 'hudhaifi', 'shuraim', 'maher', 'shatri', 'ajmi', 'jaber', 'basfar', 'yasser-salama', 'naina', 'islam-sobhi', 'saleh-talib']);
    expect(rows().filter((node) => node.props.accessibilityState?.selected).map((node) => node.props.testID)).toEqual(['audio-reciter-abdulbasit']);
    // Tapping it again closes the list.
    await press(onlyHost('audio-reciter-dropdown'));
    expect(hosts('audio-reciter-list')).toHaveLength(0);
    expect(hosts('audio-reciter-chevron-down')).toHaveLength(1);
    await press(onlyHost('audio-reciter-dropdown'));
    await press(onlyHost('audio-reciter-minshawi'));
    await flush();
    expect(hosts('audio-reciter-list')).toHaveLength(0); // the list closes after a choice
    expect(hosts('audio-reciter-chevron-down')).toHaveLength(1);
    expect(textOfNode(onlyHost('audio-up-next'))).toBe('Up next: Muhammad Siddiq Al-Minshawi');
    // The ayah being recited is not interrupted: same voice, same ayah, no reload.
    expect((await engine()).getState()).toMatchObject({ phase: 'playing', reciterId: 'abdulbasit', pendingReciterId: 'minshawi', position: { surah: 3, ayah: 84 } });
    expect(audio.loads).toHaveLength(1);
    expect(state.storage.has('quran-heals:favorite-reciter:v1')).toBe(false);
    await press(onlyHost('audio-next'));
    await flush();
    expect((await engine()).getState()).toMatchObject({ reciterId: 'minshawi', pendingReciterId: null, position: { surah: 3, ayah: 85 } });
    // The new name, its arrow still there.
    expect(textOfNode(onlyHost('audio-reciter-dropdown'))).toBe('Muhammad Siddiq Al-Minshawi');
    expect(hosts('audio-reciter-chevron-down')).toHaveLength(1);
    // A reciter without a verified recording of this surah (Saleh Al-Talib, 3) is listed, and refused with a notice when chosen.
    await press(onlyHost('audio-reciter-dropdown'));
    await press(onlyHost('audio-reciter-saleh-talib'));
    await flush();
    expect(textOfNode(onlyHost('audio-problem'))).toMatch(/Saleh Al-Talib has no verified recording of Surah Aal-i-Imraan/);
  });

  it('Arabic: the chip «[⏸] عبد الباسط عبد الصمد · ٨٤» (Pause on the right of the name), «سورة آل عمران · الآية ٨٤», the controls mirrored with the right-pointing glyphs', async () => {
    state.locale = 'ar';
    await playing();
    expect(chipText()).toBe('عبد الباسط عبد الصمد · ٨٤');
    // row-reverse: the first child, Pause, is drawn on the right, immediately beside the name.
    expect(flat(onlyHost('audio-chip').props.style).flexDirection).toBe('row-reverse');
    expect((onlyHost('audio-chip').children as ReactTestInstance[])[0].props.testID).toBe('audio-toggle');
    await press(onlyHost('audio-expand'));
    expect(textOfNode(onlyHost('audio-reciter-dropdown'))).toBe('عبد الباسط عبد الصمد');
    expect(textOfNode(onlyHost('audio-ayah'))).toBe('سورة آل عمران · الآية ٨٤');
    expect(flat(onlyHost('audio-reciter-dropdown').props.style({ pressed: false })).flexDirection).toBe('row-reverse');
    expect(flat(onlyHost('audio-previous').parent!.props.style).flexDirection).toBe('row-reverse');
    // Previous (on the right) points right, Next (on the left) points left: chosen glyphs, never a mirroring transform.
    expect(onlyHost('audio-previous').findAllByType('SkipForward' as never)).toHaveLength(1);
    expect(onlyHost('audio-next').findAllByType('SkipBack' as never)).toHaveLength(1);
    // Page jumps on the outside: Previous page (on the right) points right, Next page (on the left) points left.
    expect(onlyHost('audio-previous-page').findAllByType('ChevronsRight' as never)).toHaveLength(1);
    expect(onlyHost('audio-next-page').findAllByType('ChevronsLeft' as never)).toHaveLength(1);
    expect(onlyHost('audio-previous-page').props.accessibilityLabel).toBe('الصفحة السابقة');
    expect(onlyHost('audio-next-page').props.accessibilityLabel).toBe('الصفحة التالية');
    const controls = (onlyHost('audio-previous').parent!.children as ReactTestInstance[]).map((node) => node.props.testID);
    expect(controls).toEqual(['audio-previous-page', 'audio-previous', 'audio-toggle-large', 'audio-next', 'audio-next-page']);
    await press(onlyHost('audio-reciter-dropdown'));
    expect(hosts('audio-reciter-chevron-up')).toHaveLength(1);
  });

  it('no directional icon in the player is mirrored or rotated with a style transform (react-native-svg would draw it off its box)', () => {
    const source = readFileSync(resolve(__dirname, '../src/components/MushafAudioPlayer.tsx'), 'utf-8');
    expect(source).not.toMatch(/scaleX:\s*-1|rotate:\s*'180deg'/);
    expect(source).not.toMatch(/<(ChevronDown|ChevronUp|SkipBack|SkipForward)[^>]*\bstyle=/);
  });

});
