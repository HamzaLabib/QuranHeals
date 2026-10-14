import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fill, localNumber } from '@/localization/fill';
import { MESSAGES } from '@/localization/messages';
import type { Emotion } from '@/types/domain';
import { formatCivilDate } from '@/utils/formatDate';

/**
 * The four tabs, Home's redesign (Continue Reading, four emotions, View All),
 * the emotion list, the Khatma completion screen and the du'a's confirmation
 * for a pending ورد — rendered over the real reading data on an in-memory
 * AsyncStorage.
 */
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
  storage: new Map<string, string>(),
  params: {} as Record<string, string>,
  emotions: [] as unknown[],
  heightReports: [] as number[],
  /** The screen, and where a measured view is on it (measureInWindow: x, y, width, height). */
  window: { width: 390, height: 844 },
  anchor: [24, 200, 120, 32] as [number, number, number, number],
  /** Where the Wird menu's overlay (a separate native window) measures itself: the whole screen unless a test moves it. */
  overlay: [0, 0, 390, 844] as [number, number, number, number],
  /** The name can't be measured (its view not ready). */
  unmeasurable: false,
  /** Animations held mid-way (Reanimated mock): their completions wait in `pending` until run. */
  holdAnimations: false,
  pending: [] as ((finished: boolean) => void)[],
}));
vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  return {
    Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
    StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
    Modal: ({ visible, children, ...rest }: { visible: boolean; children: unknown }) => (visible ? h('Modal', rest, children as never) : null),
    ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
    Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
    useWindowDimensions: () => state.window,
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
    // The style as rendered, carrying (not enumerable) the function itself, to read it live.
    useAnimatedStyle: (style: () => object) => Object.defineProperty(style(), '__live', { value: style }),
    // Arrives at once; its completion runs after the value is set (or, held, when `pending` is run).
    withTiming: (value: number, _config?: unknown, done?: (finished: boolean) => void) => {
      if (done && state.holdAnimations) state.pending.push(done);
      else if (done) queueMicrotask(() => done(true));
      return value;
    },
    Easing: { out: (easing: unknown) => easing, cubic: 'cubic' },
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
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
vi.mock('lucide-react-native', () => Object.fromEntries(
  ['ArrowLeft', 'ArrowRight', 'BookHeart', 'BookMarked', 'BookOpen', 'BookOpenText', 'Check', 'ChevronDown', 'Heart', 'House', 'Minus', 'NotebookPen', 'Plus', 'RefreshCw'].map((name) => [name, name]),
));
vi.mock('expo-router', () => ({
  router: { push: vi.fn(), navigate: vi.fn(), back: vi.fn(), replace: vi.fn(), dismissTo: vi.fn(), canGoBack: () => true },
  useLocalSearchParams: () => state.params,
}));
vi.mock('expo-router/tabs', async () => {
  const { createContext } = await import('react');
  return { BottomTabBarHeightCallbackContext: createContext((height: number) => { state.heightReports.push(height); }) };
});
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette, useThemeName: () => 'light', useThemedStyles: (factory: (colors: unknown) => unknown) => factory(lightPalette) };
});
// The du'a screen's ornament (components/KhatmDuaOrnament.tsx).
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Circle: 'Circle' }));
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));
vi.mock('@/services/api', () => ({ getEmotions: async () => state.emotions, getApiErrorMessage: () => 'error' }));
vi.mock('@/storage/emotionsCache', () => ({ getCachedEmotions: async () => null, setCachedEmotions: async () => undefined }));
vi.mock('@/components/StateView', () => ({ StateView: 'StateView' }));
vi.mock('@/utils/emotionIcons', () => ({ EMOTION_ICONS: {}, EMOTION_ICON_FALLBACK: 'EmotionIcon' }));

const { AppTabBar, APP_TABS } = await import('@/components/AppTabBar');
const { ContinueReadingCard } = await import('@/components/ContinueReadingCard');
const { default: AllEmotionsScreen } = await import('@/app/emotions');
const { default: KhatmaCompleteScreen } = await import('@/app/khatma-complete');
const { lightPalette } = await import('@/constants/theme');
const { default: KhatmDuaScreen } = await import('@/app/khatm-dua');
const { confirmKhatma, loadReadingData, saveWirdPage } = await import('@/mushaf/khatmas');
const { setActiveReadingStopId } = await import('@/mushaf/readingStops');
const { RECENT_EMOTIONS_STORAGE_KEY } = await import('@/storage/recentEmotions');
const { resetLocalDataOwnerForTests } = await import('@/storage/localDataOwner');
const { router } = await import('expo-router');

let root: ReactTestRenderer;
const flush = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };
const all = (id: string) => root.root.findAllByProps({ testID: id }).filter((node) => typeof node.type === 'string');
const byId = (id: string) => all(id)[0];
const textOf = (node: ReactTestInstance) => node.findAllByType('Text' as never).map((t) => [t.props.children].flat().join('')).join(' | ');
const press = async (id: string) => { await act(async () => { await byId(id).props.onPress(); }); await flush(); await flush(); };
const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean));
async function mount(element: ReturnType<typeof createElement>) {
  // Host views measure where the test says: the menu's overlay at state.overlay, any other (the Wird name) at state.anchor.
  const createNodeMock = (element: { props: unknown }) => ({
    measureInWindow: (done: (...box: number[]) => void) => {
      if ((element.props as { testID?: string }).testID === 'home-wird-overlay') done(...state.overlay);
      else if (!state.unmeasurable) done(...state.anchor);
    },
  });
  await act(async () => { root = create(element, { createNodeMock }); });
  await flush();
  await flush();
}
const source = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8').split(String.fromCharCode(13)).join('');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.storage.clear();
  state.params = {};
  state.heightReports = [];
  state.window = { width: 390, height: 844 };
  state.anchor = [24, 200, 120, 32];
  state.overlay = [0, 0, 390, 844];
  state.unmeasurable = false;
  state.holdAnimations = false;
  state.pending = [];
  resetLocalDataOwnerForTests();
  for (const fn of [router.push, router.navigate, router.replace, router.dismissTo]) vi.mocked(fn).mockClear();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('the four bottom tabs', () => {
  const routes = APP_TABS.map((name) => ({ key: `${name}-key`, name, params: undefined }));
  const props = (index: number, options: Record<string, unknown> = {}) => {
    const navigation = { emit: vi.fn(() => ({ defaultPrevented: false })), navigate: vi.fn() };
    return {
      navigation,
      props: {
        state: { index, routes, key: 'tabs', routeNames: [...APP_TABS], type: 'tab', stale: false, history: [] },
        descriptors: Object.fromEntries(routes.map((r) => [r.key, { options: r.name === APP_TABS[index] ? options : {} }])),
        navigation,
        insets: { top: 0, bottom: 34, left: 0, right: 0 },
      } as never,
    };
  };

  it('exactly four tabs: Home, Mushaf, Recitations, Reflections — in this order, with the approved labels in every language', async () => {
    expect(APP_TABS).toEqual(['index', 'mushaf', 'my-reading', 'reflections']);
    const expected = { en: ['Home', 'Mushaf', 'Recitations', 'Reflections'], ar: ['الرئيسية', 'المصحف', 'أورادي', 'خواطري'], 'ar-EG': ['الرئيسية', 'المصحف', 'أورادي', 'خواطري'] } as const;
    for (const locale of ['en', 'ar', 'ar-EG'] as const) {
      state.locale = locale;
      await mount(createElement(AppTabBar, props(0).props));
      expect(APP_TABS.map((name) => byId(`tab-${name}`).props.accessibilityLabel)).toEqual(expected[locale]);
      // One line, shrinking to fit rather than wrapping or clipping on a narrow iPhone.
      for (const label of root.root.findByProps({ testID: 'app-tab-bar' }).findAllByType('Text' as never)) {
        expect(label.props).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true });
      }
      expect(flat(byId('app-tab-bar').props.style).flexDirection).toBe(locale === 'en' ? 'row' : 'row-reverse');
      await act(async () => root.unmount());
    }
  });

  it('marks the current tab; another tab navigates; the current one again does nothing (no remount, the Mushaf keeps its page)', async () => {
    const { props: p, navigation } = props(1);
    await mount(createElement(AppTabBar, p));
    expect(byId('tab-mushaf').props.accessibilityState).toEqual({ selected: true });
    await press('tab-mushaf');
    expect(navigation.navigate).not.toHaveBeenCalled();
    await press('tab-my-reading');
    expect(navigation.navigate).toHaveBeenCalledWith('my-reading', undefined);
  });

  it('hidden on the Mushaf (Normal Mode and full screen), and back on every other tab', async () => {
    const { MUSHAF_TAB_OPTIONS } = await import('@/mushaf/screenOptions');
    const withMushaf = (index: number) => {
      const p = props(index).props as unknown as { descriptors: Record<string, { options: object }> };
      p.descriptors['mushaf-key'] = { options: MUSHAF_TAB_OPTIONS };
      return p;
    };
    await mount(createElement(AppTabBar, withMushaf(1) as never));
    expect(all('app-tab-bar')).toHaveLength(0);
    for (const index of [0, 2, 3]) {
      await act(async () => root.unmount());
      await mount(createElement(AppTabBar, withMushaf(index) as never));
      expect(all('app-tab-bar')).toHaveLength(1);
      expect(byId(`tab-${APP_TABS[index]}`).props.accessibilityState).toEqual({ selected: true });
    }
  });

  it('hidden when the screen asks (the Mushaf`s full screen), and reports its height otherwise', async () => {
    await mount(createElement(AppTabBar, props(1, { tabBarStyle: { display: 'none' } }).props));
    expect(all('app-tab-bar')).toHaveLength(0);
    await act(async () => root.unmount());
    await mount(createElement(AppTabBar, props(0).props));
    await act(async () => byId('app-tab-bar').props.onLayout({ nativeEvent: { layout: { height: 83 } } }));
    expect(state.heightReports).toEqual([83]);
  });

  it('the tabs layout registers exactly these four screens; the third is the existing أورادي وختماتي page (/my-reading)', () => {
    const layout = source('src/app/(tabs)/_layout.tsx');
    expect([...layout.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map((m) => m[1])).toEqual(['index', 'mushaf', 'my-reading', 'reflections']);
    expect(layout).not.toMatch(/favorites/);
  });

  it('long labels stay on one line (shrinking a little) rather than wrapping or clipping', () => {
    expect(source('src/components/AppTabBar.tsx')).toMatch(/numberOfLines=\{1\} adjustsFontSizeToFit minimumFontScale=\{0\.75\}/);
  });
});

describe('Home', () => {
  const home = source('src/app/(tabs)/index.tsx');

  it('in the approved order: Continue Reading, then the four emotions and View All, then A Message from the Quran', () => {
    const at = (needle: string) => home.indexOf(needle);
    expect(at('<ContinueReadingCard />')).toBeGreaterThan(-1);
    expect(at('<ContinueReadingCard />')).toBeLessThan(at('styles.grid'));
    expect(at('styles.grid')).toBeLessThan(at('testID="home-view-all"'));
    expect(at('testID="home-view-all"')).toBeLessThan(at("router.push('/ayah/general')"));
  });

  it('shows four emotions, chosen by recency with catalog defaults, as the shorter cards; View All opens every emotion', () => {
    expect(home).toMatch(/const homeEmotions = pickHomeEmotions\(emotions, recentKeys\);/);
    expect(home).toMatch(/\{homeEmotions\.map\(\(emotion\) => \(\s*<EmotionCard\s*key=\{emotion\.key\}\s*emotion=\{emotion\}\s*compact/);
    expect(home).toMatch(/onPress=\{\(\) => router\.push\('\/emotions'\)\}/);
    expect(MESSAGES.en.emotionsAll.viewAll).toBe('View All');
    expect(MESSAGES.ar.emotionsAll.viewAll).toBe('عرض الكل');
  });

  it('the header keeps Favorites and Settings; the approved English and Arabic names', () => {
    expect(home).toMatch(/<Link href="\/favorites" asChild>/);
    expect(home).toMatch(/<Link href="\/settings" asChild>/);
    expect(MESSAGES.en.continueReading.title).toBe('Continue Reciting');
    expect(MESSAGES.ar.continueReading.title).toBe('متابعة التلاوة');
    expect(MESSAGES['ar-EG'].continueReading.title).toBe('متابعة التلاوة');
    // The page keeps its full title; only the tab is shortened.
    expect(MESSAGES.en.myReading.title).toBe('My Recitations & Khatmas');
    expect(MESSAGES.ar.myReading.title).toBe('أورادي وختماتي');
    expect(MESSAGES['ar-EG'].myReading.title).toBe('أورادي وختماتي');
    expect(MESSAGES.en.tabs.myReading).toBe('Recitations');
    expect(MESSAGES.ar.tabs.myReading).toBe('أورادي');
    expect(MESSAGES['ar-EG'].tabs.myReading).toBe('أورادي');
    // The Continue Reciting card's button: shorter in English; Arabic unchanged.
    expect(MESSAGES.en.continueReading.myReading).toBe('My Recitations');
    expect(MESSAGES.ar.continueReading.myReading).toBe('أورادي وختماتي');
    expect(MESSAGES['ar-EG'].continueReading.myReading).toBe('أورادي وختماتي');
  });
});

describe('Continue Reading (متابعة القراءة)', () => {
  it('with no ورد: a first-reading state that opens the Mushaf at page 1, without inventing progress', async () => {
    await mount(createElement(ContinueReadingCard));
    expect(textOf(byId('home-continue-reading'))).toContain(MESSAGES.en.continueReading.firstTitle);
    expect(all('home-continue-wird')).toHaveLength(0);
    await press('home-open-mushaf');
    expect(router.navigate).toHaveBeenLastCalledWith({ pathname: '/mushaf', params: { page: '1', at: expect.any(String) } });
  });

  it('with no ورد: invites reflection with a new ورد under the unchanged title; gone once a ورد exists', async () => {
    const expected = {
      en: 'Open the Mushaf to its first page and reflect on its verses as you begin a new Wird.',
      ar: 'افتح المصحف من صفحته الأولى، وتفكّر في آياته مع وردٍ جديد.',
      'ar-EG': 'افتح المصحف من أول صفحة، واتأمّل في آياته مع ورد جديد.',
    } as const;
    expect(MESSAGES.ar.continueReading.firstTitle).toBe('ابدأ قراءتك');
    for (const locale of ['en', 'ar', 'ar-EG'] as const) {
      state.locale = locale;
      state.storage.clear();
      resetLocalDataOwnerForTests();
      if (root) await act(async () => root.unmount());
      await mount(createElement(ContinueReadingCard));
      expect(MESSAGES[locale].continueReading.firstBody).toBe(expected[locale]);
      const first = byId('home-continue-first').findAllByType('Text' as never).map((t) => t.props.children);
      expect(first).toEqual([MESSAGES[locale].continueReading.firstTitle, expected[locale]]);
      expect(flat(byId('home-continue-first').findAllByType('Text' as never)[1].props.style).writingDirection).toBe(locale === 'en' ? 'ltr' : 'rtl');
      // A saved ورد replaces the invitation.
      await act(async () => { await saveWirdPage({ name: 'Personal', page: 12 }); });
      await flush();
      expect(all('home-continue-first')).toHaveLength(0);
      expect(textOf(byId('home-continue-reading'))).not.toContain(expected[locale]);
      expect(textOf(byId('home-continue-reading'))).toContain('Personal');
    }
  });

  it('shows the active ورد, its saved page and progress; المصحف opens that page; أورادي وختماتي opens its page', async () => {
    state.locale = 'ar';
    await saveWirdPage({ name: 'ورد التدبر', page: 150 });
    await saveWirdPage({ name: 'ورد الفجر', page: 302 });
    await mount(createElement(ContinueReadingCard));
    const text = textOf(byId('home-continue-reading'));
    expect(text).toContain('متابعة التلاوة');
    expect(text).toContain('ورد الفجر');
    expect(text).toContain('صفحة ٣٠٢ من ٦٠٤');
    expect(text).toContain('٥٠٪');
    await press('home-open-mushaf');
    expect(router.navigate).toHaveBeenLastCalledWith({ pathname: '/mushaf', params: { page: '302', at: expect.any(String) } });
    await press('home-open-my-reading');
    // The tab: navigate switches to it; nothing is pushed twice.
    expect(router.navigate).toHaveBeenLastCalledWith('/my-reading');
  });

  describe('the ورد selector', () => {
    const optionIds = () => byId('home-wird-menu').findAll((n) => typeof n.type === 'string' && /^home-wird-option-/.test(String(n.props.testID))).map((n) => n.props.testID as string);
    const shown = () => textOf(byId('home-continue-wird'));
    const nameShown = () => byId('home-wird-selector').findByType('Text' as never).props.children;

    it('one ورد: no chevron and nothing to open; the card is as before', async () => {
      await saveWirdPage({ name: 'Fajr', page: 40 });
      await mount(createElement(ContinueReadingCard));
      expect(all('home-wird-selector')).toHaveLength(0);
      expect(root.root.findAllByType('ChevronDown' as never)).toHaveLength(0);
      expect(shown()).toContain('Fajr');
    });

    it('two or more: a chevron beside the name opens every ورد with its page and a check on the shown one', async () => {
      await saveWirdPage({ name: 'Isha', page: 302 });
      await saveWirdPage({ name: 'Fajr', page: 40 });
      await mount(createElement(ContinueReadingCard));
      const selector = byId('home-wird-selector');
      expect(nameShown()).toBe('Fajr');
      expect(selector.findAllByType('ChevronDown' as never)).toHaveLength(1);
      expect(selector.props).toMatchObject({ accessibilityRole: 'button', accessibilityHint: MESSAGES.en.continueReading.switchHint, accessibilityState: { expanded: false } });
      expect(all('home-wird-menu')).toHaveLength(0);
      await press('home-wird-selector');
      expect(byId('home-wird-selector').props.accessibilityState).toEqual({ expanded: true });
      const { wirds } = await loadReadingData();
      expect(optionIds()).toEqual(wirds.map((w) => `home-wird-option-${w.stop.id}`));
      const fajr = wirds.find((w) => w.stop.name === 'Fajr')!;
      const isha = wirds.find((w) => w.stop.name === 'Isha')!;
      expect(textOf(byId(`home-wird-option-${fajr.stop.id}`))).toBe('Fajr | Page 40');
      expect(textOf(byId(`home-wird-option-${isha.stop.id}`))).toBe('Isha | Page 302');
      expect(byId(`home-wird-option-${fajr.stop.id}`).props.accessibilityState).toEqual({ selected: true });
      expect(byId(`home-wird-option-${fajr.stop.id}`).findAllByType('Check' as never)).toHaveLength(1);
      expect(byId(`home-wird-option-${isha.stop.id}`).findAllByType('Check' as never)).toHaveLength(0);
      expect(textOf(byId('home-wird-menu'))).toContain(MESSAGES.en.continueReading.chooseWird);
      // A tap outside closes it, choosing nothing.
      await press('home-wird-backdrop');
      expect(all('home-wird-menu')).toHaveLength(0);
      expect(nameShown()).toBe('Fajr');
      expect((await loadReadingData()).activeStopId).toBe(before(wirds));
    });
    const before = (wirds: readonly { stop: { id: string; name: string } }[]) => wirds.find((w) => w.stop.name === 'Fajr')!.stop.id;

    it('choosing another ورد updates the name, page, percentage and bar at once; it is stored as the active ورد; المصحف opens its page', async () => {
      await saveWirdPage({ name: 'Isha', page: 302 });
      await saveWirdPage({ name: 'Fajr', page: 40 });
      const start = await loadReadingData();
      const isha = start.wirds.find((w) => w.stop.name === 'Isha')!;
      await mount(createElement(ContinueReadingCard));
      expect(shown()).toContain('Page 40 of 604');
      await press('home-wird-selector');
      // Shown at once, in the same update as the choice (before storage answers).
      await act(async () => { byId(`home-wird-option-${isha.stop.id}`).props.onPress(); });
      expect(all('home-wird-menu')).toHaveLength(0);
      expect(nameShown()).toBe('Isha');
      expect(shown()).toContain('Page 302 of 604');
      expect(shown()).toContain('50%');
      expect(shown()).toContain(MESSAGES.en.continueReading.activeWird);
      const bar = byId('home-continue-wird').findAll((n) => n.props.accessibilityRole === 'progressbar')[0];
      expect(bar.props.accessibilityValue).toMatchObject({ now: 50 });
      expect(flat((bar.children[0] as ReactTestInstance).props.style).width).toBe('50%');
      await flush();
      // Stored through the existing reading state as the active ورد.
      const after = await loadReadingData();
      expect(after.activeStopId).toBe(isha.stop.id);
      // Each ورد keeps its own page, cycle and Khatmas; no record changes.
      const summary = (data: typeof start) => data.wirds.map((w) => [w.stop.id, w.stop.page, w.cycle.id, w.khatmas].join()).sort();
      expect(summary(after)).toEqual(summary(start));
      expect(after.records).toEqual(start.records);
      // After the reload the choice triggers, still Isha; المصحف opens its saved page.
      expect(nameShown()).toBe('Isha');
      await press('home-open-mushaf');
      expect(router.navigate).toHaveBeenLastCalledWith({ pathname: '/mushaf', params: { page: '302', at: expect.any(String) } });
      expect((await loadReadingData()).activeStopId).toBe(isha.stop.id);
    });

    it('a ورد chosen elsewhere (the reader) shows here too', async () => {
      await saveWirdPage({ name: 'Isha', page: 302 });
      await saveWirdPage({ name: 'Fajr', page: 40 });
      await mount(createElement(ContinueReadingCard));
      const isha = (await loadReadingData()).wirds.find((w) => w.stop.name === 'Isha')!;
      await act(async () => { await setActiveReadingStopId(isha.stop.id); });
      await flush();
      expect(nameShown()).toBe('Isha');
    });

    describe('anchored under the name, its chevron showing the way it opens and closes', () => {
      type Live = { __live: () => { transform: Record<string, string | number>[] } };
      const live = (node: ReactTestInstance) => ([node.props.style].flat(3).find((style) => style && (style as Live).__live) as Live).__live();
      /** The chevron's turn: 0 points down, 180 up. */
      const chevron = () => Number(String(live(byId('home-wird-chevron')).transform[0].rotate).replace('deg', ''));
      const menuBox = () => flat(byId('home-wird-menu').props.style);
      const twoWirds = async () => {
        await saveWirdPage({ name: 'Isha', page: 302 });
        await saveWirdPage({ name: 'Fajr', page: 40 });
        await mount(createElement(ContinueReadingCard));
      };

      it('English: opens just below the name, from its left edge, floating (not centred, not a sheet); the chevron turns up', async () => {
        state.anchor = [24, 200, 120, 32];
        await twoWirds();
        expect(chevron()).toBe(0);
        await press('home-wird-selector');
        // Just under the name (6 pt), its left edge on the name's, 300 pt wide at most.
        expect(menuBox()).toMatchObject({ position: 'absolute', top: 200 + 32 + 6, left: 24, width: 300 });
        expect(menuBox().bottom).toBeUndefined();
        expect(menuBox()).not.toHaveProperty('alignSelf');
        expect(chevron()).toBe(180); // open: up, though the list opens downward
        expect(byId('home-wird-selector').props.accessibilityState).toEqual({ expanded: true });
        // Nothing behind is dimmed: the backdrop only catches the tap outside.
        expect(flat(byId('home-wird-backdrop').props.style).backgroundColor).toBeUndefined();
      });

      it('Arabic: its right edge on the name`s right edge; kept inside the screen`s 14-pt margin', async () => {
        state.locale = 'ar';
        state.anchor = [250, 200, 120, 32]; // the name's right edge at 370
        await twoWirds();
        await press('home-wird-selector');
        expect(menuBox()).toMatchObject({ top: 238, left: 370 - 300, width: 300 });
        // A name further right still keeps the whole menu on screen.
        await press('home-wird-backdrop');
        state.anchor = [300, 200, 88, 32];
        await press('home-wird-selector');
        expect(menuBox().left).toBe(390 - 14 - 300);
      });

      it('near the bottom of the screen: opens upward, anchored above the name; the chevron points up', async () => {
        state.anchor = [24, 760, 120, 32];
        await twoWirds();
        await press('home-wird-selector');
        expect(menuBox()).toMatchObject({ bottom: 844 - 760 + 6, left: 24 });
        expect(menuBox().top).toBeUndefined();
        expect(chevron()).toBe(180);
        // Reopened where there is room below: below this time (placement measured at every opening); open, so still up.
        await press('home-wird-backdrop');
        expect(chevron()).toBe(0);
        state.anchor = [24, 200, 120, 32];
        await press('home-wird-selector');
        expect(menuBox().top).toBe(238);
        expect(chevron()).toBe(180);
      });

      it('closing a menu below: the chevron is down as soon as it closes, while the list goes back up toward the name', async () => {
        await twoWirds();
        await press('home-wird-selector');
        state.holdAnimations = true;
        await press('home-wird-backdrop');
        // Still on screen, closing (held): closed, so the chevron is already down.
        expect(all('home-wird-menu')).toHaveLength(1);
        expect(byId('home-wird-selector').props.accessibilityState).toEqual({ expanded: false });
        expect(chevron()).toBe(0);
        expect(live(byId('home-wird-menu')).transform[0].translateY).toBe(-8); // toward the name
        await act(async () => { state.pending.splice(0).forEach((done) => done(true)); });
        await flush();
        expect(all('home-wird-menu')).toHaveLength(0);
        expect(chevron()).toBe(0);
      });

      it('closing a menu above: it goes back down and the chevron points down; tapping the name again also closes it', async () => {
        state.anchor = [24, 760, 120, 32];
        await twoWirds();
        await press('home-wird-selector');
        expect(chevron()).toBe(180);
        state.holdAnimations = true;
        await press('home-wird-selector'); // the name again: a toggle
        expect(all('home-wird-menu')).toHaveLength(1);
        expect(chevron()).toBe(0);
        expect(live(byId('home-wird-menu')).transform[0].translateY).toBe(8);
        await act(async () => { state.pending.splice(0).forEach((done) => done(true)); });
        await flush();
        expect(all('home-wird-menu')).toHaveLength(0);
        expect(chevron()).toBe(0);
      });

      it('rapid taps: reopened while closing, it stays open and its chevron is up (a late close never shuts it)', async () => {
        state.anchor = [24, 760, 120, 32];
        await twoWirds();
        state.holdAnimations = true;
        await press('home-wird-selector');
        await press('home-wird-selector');
        await press('home-wird-selector');
        // The first closing's completion arrives late: ignored, the menu is open again.
        await act(async () => { state.pending.splice(0).forEach((done) => done(true)); });
        await flush();
        expect(all('home-wird-menu')).toHaveLength(1);
        expect(byId('home-wird-selector').props.accessibilityState).toEqual({ expanded: true });
        expect(chevron()).toBe(180);
      });

      for (const [locale, top] of [['en', 200], ['ar', 200], ['en', 760], ['ar', 760]] as const) {
        it(`${locale}, list ${top === 200 ? 'below' : 'above'} the name: the chevron is down whenever it is closed and up whenever it is open, through every way of opening and closing`, async () => {
          state.locale = locale;
          state.anchor = locale === 'ar' ? [250, top, 120, 32] : [24, top, 120, 32];
          await twoWirds();
          const expanded = () => byId('home-wird-selector').props.accessibilityState.expanded as boolean;
          const agrees = () => expect(chevron()).toBe(expanded() ? 180 : 0);
          // Loaded: closed, down.
          expect(expanded()).toBe(false);
          expect(chevron()).toBe(0);
          // Opened by the name; closed by the name again.
          await press('home-wird-selector');
          expect(chevron()).toBe(180);
          await press('home-wird-selector');
          expect(chevron()).toBe(0);
          // Opened; closed by a tap outside.
          await press('home-wird-selector');
          expect(chevron()).toBe(180);
          await press('home-wird-backdrop');
          expect(chevron()).toBe(0);
          // Opened; closed by choosing another ورد.
          await press('home-wird-selector');
          const other = (await loadReadingData()).wirds.find((w) => w.stop.name !== byId('home-wird-selector').findByType('Text' as never).props.children)!;
          await press(`home-wird-option-${other.stop.id}`);
          expect(expanded()).toBe(false);
          expect(chevron()).toBe(0);
          // Rapid toggles with every animation interrupted (held), then their late completions: it always ends on the state.
          state.holdAnimations = true;
          for (let i = 0; i < 5; i++) {
            await press('home-wird-selector');
            agrees();
          }
          expect(expanded()).toBe(true);
          await act(async () => { state.pending.splice(0).forEach((done) => done(true)); });
          await flush();
          agrees();
          expect(chevron()).toBe(180);
          await press('home-wird-backdrop');
          await act(async () => { state.pending.splice(0).forEach((done) => done(false)); }); // interrupted
          await flush();
          agrees();
          expect(chevron()).toBe(0);
        });
      }

      it('choosing a ورد closes the menu and the chevron comes back to rest; the card shows the choice', async () => {
        await twoWirds();
        const isha = (await loadReadingData()).wirds.find((w) => w.stop.name === 'Isha')!;
        await press('home-wird-selector');
        await press(`home-wird-option-${isha.stop.id}`);
        expect(all('home-wird-menu')).toHaveLength(0);
        expect(chevron()).toBe(0);
        expect(byId('home-wird-selector').findByType('Text' as never).props.children).toBe('Isha');
        expect(textOf(byId('home-continue-wird'))).toContain('Page 302 of 604');
      });

      it('the overlay is its own window: placed by the name`s box minus the overlay`s, it lands under the name wherever that window starts', async () => {
        // An overlay window starting 24 pt down (below an Android status bar), the name at y 200 in the app's window.
        state.overlay = [0, 24, 390, 820];
        await twoWirds();
        await press('home-wird-selector');
        // In the overlay: 200 − 24 + 32 + 6; on screen (overlay + menu): exactly 6 pt under the name's bottom (232).
        expect(menuBox().top).toBe(200 - 24 + 32 + 6);
        expect(state.overlay[1] + menuBox().top).toBe(200 + 32 + 6);
        expect(menuBox().left).toBe(24);
        // Arabic, an overlay offset sideways too: the right edges still meet on screen.
        await press('home-wird-backdrop');
        await act(async () => root.unmount());
        state.locale = 'ar';
        state.overlay = [10, 24, 380, 820];
        state.anchor = [250, 200, 120, 32];
        await mount(createElement(ContinueReadingCard));
        await press('home-wird-selector');
        expect(state.overlay[0] + menuBox().left + menuBox().width).toBe(250 + 120);
        // Opening upward in such a window: its bottom 6 pt above the name, on screen.
        await press('home-wird-backdrop');
        state.anchor = [250, 740, 120, 32];
        await press('home-wird-selector');
        expect(menuBox().top).toBeUndefined();
        expect(state.overlay[1] + state.overlay[3] - menuBox().bottom).toBe(740 - 6);
      });

      it('laid out again (rotation, a window resize), the overlay re-measures and the menu follows', async () => {
        await twoWirds();
        await press('home-wird-selector');
        expect(menuBox().top).toBe(238);
        state.overlay = [0, 30, 390, 814];
        await act(async () => { byId('home-wird-overlay').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 814 } } }); });
        expect(menuBox().top).toBe(238 - 30);
      });

      it('a name that can`t be measured never opens the menu anywhere else (never centred, never at a guess)', async () => {
        state.unmeasurable = true;
        await twoWirds();
        await press('home-wird-selector');
        expect(all('home-wird-menu')).toHaveLength(0);
        expect(all('home-wird-overlay')).toHaveLength(0);
        expect(byId('home-wird-selector').props.accessibilityState).toEqual({ expanded: false });
      });

      it('many Wirds: the menu stops at 320 pt and scrolls; long names stay on one line', async () => {
        const long = 'ورد قراءة سورة البقرة كاملة';
        for (let i = 0; i < 12; i++) await saveWirdPage({ name: i === 0 ? long : `Wird ${i + 1}`, page: 10 + i });
        await mount(createElement(ContinueReadingCard));
        await press('home-wird-selector');
        expect(menuBox().maxHeight).toBe(320);
        expect(byId('home-wird-menu').findAllByType('ScrollView' as never)).toHaveLength(1);
        const { wirds } = await loadReadingData();
        expect(byId('home-wird-menu').findAll((n) => typeof n.type === 'string' && /^home-wird-option-/.test(String(n.props.testID)))).toHaveLength(12);
        const longRow = byId(`home-wird-option-${wirds.find((w) => w.stop.name === long)!.stop.id}`);
        expect(longRow.findAllByType('Text' as never)[0].props.numberOfLines).toBe(1);
      });
    });

    for (const locale of ['ar', 'ar-EG', 'en'] as const) {
      it(`${locale}: the name and chevron, and each row, follow the language's direction`, async () => {
        state.locale = locale;
        await saveWirdPage({ name: 'ورد العشاء', page: 302 });
        await saveWirdPage({ name: 'ورد الفجر', page: 40 });
        await mount(createElement(ContinueReadingCard));
        const rtl = locale !== 'en';
        expect(flat(byId('home-wird-selector').props.style({ pressed: false }))).toMatchObject({ flexDirection: rtl ? 'row-reverse' : 'row', alignSelf: rtl ? 'flex-end' : 'flex-start' });
        expect(flat(byId('home-wird-selector').findByType('Text' as never).props.style)).toMatchObject({ textAlign: rtl ? 'right' : 'left', fontSize: 22, fontWeight: '800' });
        await press('home-wird-selector');
        const copy = MESSAGES[locale];
        expect(textOf(byId('home-wird-menu')).split(' | ')[0]).toBe(copy.continueReading.chooseWird);
        const { wirds } = await loadReadingData();
        for (const w of wirds) {
          const row = byId(`home-wird-option-${w.stop.id}`);
          expect(flat(row.props.style({ pressed: false })).flexDirection).toBe(rtl ? 'row-reverse' : 'row');
          const page = locale === 'en' ? String(w.stop.page) : w.stop.page === 40 ? '٤٠' : '٣٠٢';
          expect(textOf(row)).toBe(`${w.stop.name} | ${copy.mushaf.pageShort} ${page}`);
        }
      });
    }
  });

  it('follows changes made elsewhere (the reader, أورادي وختماتي) without reopening Home', async () => {
    await saveWirdPage({ name: 'Fajr', page: 10 });
    await mount(createElement(ContinueReadingCard));
    await act(async () => { await saveWirdPage({ name: 'Fajr', page: 11 }); });
    await flush();
    expect(textOf(byId('home-continue-reading'))).toContain('Page 11 of 604');
  });
});

describe('View All (/emotions)', () => {
  const catalog = Array.from({ length: 30 }, (_, i) => ({ key: `e${i}`, names: { en: `Emotion ${i}`, ar: `شعور ${i}` }, icon: 'heart' }) as unknown as Emotion);

  it('shows every emotion the app serves, in the original full-size cards; Back returns', async () => {
    state.emotions = catalog;
    await mount(createElement(AllEmotionsScreen));
    const cards = byId('emotions-grid').children as ReactTestInstance[];
    expect(cards).toHaveLength(30);
    expect(cards.every((card) => card.props.compact !== true)).toBe(true);
    expect(byId('emotions-back')).toBeDefined();
  });

  it('ends with the spiritual disclaimer (moved from Home), its exact wording in every language, after the cards', async () => {
    state.emotions = catalog;
    for (const locale of ['en', 'ar', 'ar-EG'] as const) {
      state.locale = locale;
      await mount(createElement(AllEmotionsScreen));
      const disclaimer = byId('emotions-disclaimer');
      expect(disclaimer.props.children).toBe(MESSAGES[locale].home.disclaimer);
      expect(flat(disclaimer.props.style)).toMatchObject({ fontSize: 13, lineHeight: 19, writingDirection: locale === 'en' ? 'ltr' : 'rtl' });
      const siblings = disclaimer.parent!.children as ReactTestInstance[];
      expect(siblings.indexOf(disclaimer)).toBe(siblings.length - 1);
      expect(siblings.indexOf(byId('emotions-grid'))).toBe(siblings.length - 2);
      await act(async () => root.unmount());
    }
    expect(MESSAGES.en.home.disclaimer).toMatch(/^Quran Heals offers spiritual/);
  });

  it('choosing one opens its ayah exactly as Home does and is remembered for Home`s four', async () => {
    state.emotions = catalog;
    await mount(createElement(AllEmotionsScreen));
    await act(async () => { (byId('emotions-grid').children as ReactTestInstance[])[7].props.onPress(); });
    await flush();
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/ayah/[emotion]', params: { emotion: 'e7', namesJson: JSON.stringify(catalog[7].names) } });
    expect(JSON.parse(state.storage.get(RECENT_EMOTIONS_STORAGE_KEY)!)).toEqual(['e7']);
  });
});

describe('the Khatma completion screen (/khatma-complete)', () => {
  it('تقبل الله ختمتك, the supporting text, the optional du`a and the way back to the Khatmas', async () => {
    state.locale = 'ar';
    await saveWirdPage({ name: 'ورد الفجر', page: 300 });
    await saveWirdPage({ name: 'ورد الفجر', page: 604 });
    const [w] = (await loadReadingData()).wirds;
    const { record } = await confirmKhatma(w.stop.id, w.cycle.id);
    state.params = { id: record.id };
    await mount(createElement(KhatmaCompleteScreen));
    expect(byId('khatma-complete-title').props.children).toBe('تقبل الله ختمتك');
    expect(byId('khatma-complete-body').props.children).toBe('نسأل الله أن يجعل القرآن نورًا لقلبك وشفيعًا لك');
    expect(textOf(byId('khatma-complete-dua'))).toBe('قراءة دعاء ختم القرآن');
    expect(textOf(byId('khatma-complete-back'))).toBe('العودة إلى ختماتي');
    expect(byId('khatma-complete-name').props.children).toBe('ورد الفجر');
    await press('khatma-complete-dua');
    expect(router.push).toHaveBeenLastCalledWith('/khatm-dua');
    await press('khatma-complete-back');
    expect(router.dismissTo).toHaveBeenLastCalledWith('/my-reading');
    // Showing it again records nothing more.
    expect((await loadReadingData()).stats.total).toBe(1);
  });

  /** A ورد named `name` confirmed at `at` (local time); then its stored record's localDate set to `localDate`, if given. */
  async function completed(name: string, at: Date, localDate?: string) {
    await saveWirdPage({ name, page: 300 });
    await saveWirdPage({ name, page: 604 });
    const w = (await loadReadingData()).wirds.find((x) => x.stop.name === name)!;
    const { record } = await confirmKhatma(w.stop.id, w.cycle.id, { now: () => at });
    if (localDate) {
      for (const [key, value] of state.storage) {
        if (value.includes(record.id)) state.storage.set(key, value.split(`"localDate":"${record.localDate}"`).join(`"localDate":"${localDate}"`));
      }
    }
    state.params = { id: record.id };
    await mount(createElement(KhatmaCompleteScreen));
    return record;
  }
  const detailTexts = () => byId('khatma-complete-detail').findAllByType('Text' as never).map((t) => [t.props.children].flat().join(''));

  it('the ورد name, the date and the Ramadan tag are separate lines: no name, English or Arabic, ever lands inside the date', async () => {
    const names = ['Hi', 'ورد الفجر', 'Personal 2026', 'ورد Personal', 'Mosque ورد ٢'];
    for (const locale of ['ar', 'en', 'ar-EG'] as const) {
      for (const name of names) {
        state.locale = locale;
        state.storage.clear();
        resetLocalDataOwnerForTests();
        const record = await completed(name, new Date(2026, 9, 13, 21, 0));
        const date = formatCivilDate('2026-10-13', locale);
        const texts = detailTexts();
        expect(texts).toEqual([name, date, MESSAGES[locale].myReading.nonRamadanTag]);
        // The date line is exactly the formatted date: nothing joined to it, and the name is not in it.
        expect(byId('khatma-complete-date').props.children).toBe(date);
        expect(date).not.toContain(name);
        // The name takes its own direction (its first strong letter); the date and tag the app language's.
        const rtl = locale !== 'en';
        expect(flat(byId('khatma-complete-name').props.style).writingDirection).toBeUndefined();
        expect(flat(byId('khatma-complete-name').props.style).textAlign).toBe('center');
        for (const id of ['khatma-complete-date', 'khatma-complete-tag']) {
          expect(flat(byId(id).props.style)).toMatchObject({ textAlign: 'center', writingDirection: rtl ? 'rtl' : 'ltr' });
        }
        // The stored record and the counts are as confirmed.
        const data = await loadReadingData();
        expect(data.records.find((r) => r.id === record.id)).toMatchObject({ stopName: name, localDate: '2026-10-13', ramadan: false });
        expect(data.stats).toEqual({ total: 1, ramadan: 0, nonRamadan: 1 });
        await act(async () => root.unmount());
      }
    }
    expect(source('src/app/khatma-complete.tsx')).not.toMatch(/join\('\s*·\s*'\)/);
  });

  it('a Ramadan Khatma shows its own tag line under the date', async () => {
    state.locale = 'ar';
    // 1 Ramadan 1448 ≈ 2027-02-08: mid-Ramadan 1448.
    await completed('Hi', new Date(2027, 1, 20, 12, 0));
    const record = (await loadReadingData()).records[0];
    expect(record.ramadan).toBe(true);
    expect(detailTexts()).toEqual(['Hi', formatCivilDate(record.localDate, 'ar'), fill(MESSAGES.ar.myReading.ramadanTag, { year: localNumber('ar', record.ramadanHijriYear!) })]);
  });

  it('shows the record`s stored local calendar day, not the completion instant`s day in this time zone', async () => {
    state.locale = 'en';
    // Confirmed late on 13 October on a device ahead of UTC is stored as localDate 2026-10-14 there; this one re-reads it.
    await completed('Hi', new Date(2026, 9, 13, 23, 30), '2026-10-14');
    expect(byId('khatma-complete-date').props.children).toBe('Oct 14, 2026');
    state.locale = 'ar';
    await act(async () => root.unmount());
    await mount(createElement(KhatmaCompleteScreen));
    expect(byId('khatma-complete-date').props.children).toBe(formatCivilDate('2026-10-14', 'ar'));
    expect(byId('khatma-complete-date').props.children).toContain('14');
  });
  /** Fajr confirmed after a save at 604 (its new cycle at page 1); Isha selected meanwhile, unless `keepFajr`. */
  async function confirmedFajr(options: { keepFajr?: boolean } = {}) {
    await saveWirdPage({ name: 'Fajr', page: 300 });
    await saveWirdPage({ name: 'Fajr', page: 604 });
    const fajr = (await loadReadingData()).wirds.find((w) => w.stop.name === 'Fajr')!;
    const { record } = await confirmKhatma(fajr.stop.id, fajr.cycle.id);
    if (!options.keepFajr) await saveWirdPage({ name: 'Isha', page: 120 }); // another ورد becomes the selected one
    state.params = { id: record.id };
    return { fajr, record };
  }
  const actionIds = () => root.root.findByProps({ testID: 'khatma-complete-dua' }).parent!.children.map((child) => (child as ReactTestInstance).props.testID);

  for (const locale of ['en', 'ar', 'ar-EG'] as const) {
    it(`${locale}: three stacked actions — Back to Mushaf, Back to My Recitations, the du\`a — in the App Language`, async () => {
      state.locale = locale;
      await confirmedFajr();
      await mount(createElement(KhatmaCompleteScreen));
      expect(actionIds()).toEqual(['khatma-complete-mushaf', 'khatma-complete-back', 'khatma-complete-dua']);
      const en = locale === 'en';
      expect(textOf(byId('khatma-complete-mushaf'))).toBe(en ? 'Back to Mushaf' : 'العودة إلى المصحف');
      expect(textOf(byId('khatma-complete-back'))).toBe(en ? 'Back to My Recitations & Khatmas' : 'العودة إلى ختماتي');
      expect(textOf(byId('khatma-complete-dua'))).toBe(en ? 'Read the Khatma Du’a' : 'قراءة دعاء ختم القرآن');
      // Each a full-width, 54 pt button in the app's palette (Light and Dark follow from it); the icon side mirrors in Arabic.
      const style = (id: string) => Object.assign({}, ...[byId(id).props.style({ pressed: false })].flat(3).filter(Boolean));
      for (const id of ['khatma-complete-mushaf', 'khatma-complete-back', 'khatma-complete-dua']) expect(style(id).minHeight).toBe(54);
      expect(style('khatma-complete-mushaf')).toMatchObject({ backgroundColor: lightPalette.secondaryButtonSurface, borderColor: lightPalette.secondaryButtonBorder, flexDirection: en ? 'row' : 'row-reverse' });
    });
  }

  it('Back to Mushaf: closes this screen to the Mushaf tab with the completed ورد selected, at its new cycle`s page 1 — never 604 — and records nothing', async () => {
    const { fajr } = await confirmedFajr();
    const { loadActiveReadingStopId } = await import('@/mushaf/readingStops');
    expect(await loadActiveReadingStopId()).not.toBe(fajr.stop.id);
    await mount(createElement(KhatmaCompleteScreen));
    await press('khatma-complete-mushaf');
    await flush();
    expect(router.dismissTo).toHaveBeenCalledTimes(1);
    expect(router.dismissTo).toHaveBeenLastCalledWith({ pathname: '/mushaf', params: { page: '1', at: expect.any(String) } });
    expect(router.push).not.toHaveBeenCalled();
    expect(await loadActiveReadingStopId()).toBe(fajr.stop.id);
    const data = await loadReadingData();
    expect(data.stats.total).toBe(1);
    expect(data.wirds.find((w) => w.stop.id === fajr.stop.id)).toMatchObject({ status: 'reading' });
    expect(data.wirds.find((w) => w.stop.id === fajr.stop.id)!.stop.page).toBe(1);
  });

  it('a double tap navigates once', async () => {
    await confirmedFajr({ keepFajr: true });
    await mount(createElement(KhatmaCompleteScreen));
    await act(async () => {
      byId('khatma-complete-mushaf').props.onPress();
      byId('khatma-complete-mushaf').props.onPress();
    });
    await flush();
    expect(router.dismissTo).toHaveBeenCalledTimes(1);
  });

  it('a ورد deleted meanwhile: the Mushaf at page 1, the selection left as it is, the Khatma kept in the history', async () => {
    const { fajr } = await confirmedFajr();
    const { deleteWird } = await import('@/mushaf/khatmas');
    await deleteWird(fajr.stop.id);
    const { loadActiveReadingStopId } = await import('@/mushaf/readingStops');
    const selected = await loadActiveReadingStopId();
    await mount(createElement(KhatmaCompleteScreen));
    await press('khatma-complete-mushaf');
    await flush();
    expect(router.dismissTo).toHaveBeenLastCalledWith({ pathname: '/mushaf', params: { page: '1', at: expect.any(String) } });
    expect(await loadActiveReadingStopId()).toBe(selected);
    expect((await loadReadingData()).stats.total).toBe(1);
  });

  it('My Recitations and the du`a keep their navigation; nothing on this screen records or confirms a Khatma', async () => {
    await confirmedFajr();
    await mount(createElement(KhatmaCompleteScreen));
    await press('khatma-complete-back');
    expect(router.dismissTo).toHaveBeenLastCalledWith('/my-reading');
    await press('khatma-complete-dua');
    expect(router.push).toHaveBeenLastCalledWith('/khatm-dua');
    expect((await loadReadingData()).stats.total).toBe(1);
    expect(source('src/app/khatma-complete.tsx')).not.toMatch(/confirmKhatma|saveWirdPage|removeKhatma/);
  });
});

describe('the du`a screen has no Khatma action', () => {
  for (const locale of ['ar', 'en'] as const) {
    it(`${locale}: only the title, the du\`a, its size controls and Back — no confirmation card or button, even for a pending ورد (an older ?wird= link)`, async () => {
      state.locale = locale;
      await saveWirdPage({ name: 'Fajr', page: 300 });
      await saveWirdPage({ name: 'Fajr', page: 604 });
      const [w] = (await loadReadingData()).wirds;
      expect(w.status).toBe('pending');
      state.params = { wird: w.stop.id };
      await mount(createElement(KhatmDuaScreen));
      expect(all('khatm-dua-khatma')).toHaveLength(0);
      expect(all('khatm-dua-confirm-khatma')).toHaveLength(0);
      expect(textOf(root.root)).not.toMatch(/تأكيد إتمام الختمة|Confirm Khatma|page 604|الصفحة ٦٠٤/);
      const buttons = root.root.findAll((node) => String(node.type) === 'Pressable').map((node) => node.props.testID);
      expect(buttons.sort()).toEqual(['khatm-dua-back', 'khatm-dua-larger', 'khatm-dua-smaller']);
      expect(all('khatm-dua-text')).toHaveLength(1);
    });
  }

  it('opening, scrolling, resizing and leaving the du`a never records a Khatma; the completion stays pending and is still confirmed manually', async () => {
    await saveWirdPage({ name: 'Fajr', page: 300 });
    await saveWirdPage({ name: 'Fajr', page: 604 });
    const before = await loadReadingData();
    const [w] = before.wirds;
    await mount(createElement(KhatmDuaScreen));
    // Scrolling is plain native scrolling: the screen listens to no scroll event, so it cannot save one.
    const scroll = byId('khatm-dua-scroll');
    expect(Object.keys(scroll.props).filter((key) => /^on/.test(key))).toEqual([]);
    await press('khatm-dua-larger');
    await press('khatm-dua-smaller');
    await press('khatm-dua-back');
    await act(async () => root.unmount());
    const data = await loadReadingData();
    expect(data.stats.total).toBe(0);
    expect(data.wirds[0].status).toBe('pending');
    // Reading progress, counts and everything else untouched.
    expect(data).toEqual(before);
    expect(router.replace).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/khatma-complete' }));
    // Still confirmable by hand (أورادي وختماتي's card makes this same call), exactly once.
    expect((await confirmKhatma(w.stop.id, w.cycle.id)).alreadyRecorded).toBe(false);
    expect((await loadReadingData()).stats.total).toBe(1);
  });

  it('the du`a screen reads and writes no reading data at all', () => {
    const screen = source('src/app/khatm-dua.tsx');
    expect(screen).not.toMatch(/@\/mushaf\/khatmas|confirmKhatma|loadReadingData|useLocalSearchParams|khatma-complete/);
  });
});
