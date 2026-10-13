import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGES } from '@/localization/messages';
import type { Emotion } from '@/types/domain';

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
}));
vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  return {
    Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
    StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
    Modal: ({ visible, children, ...rest }: { visible: boolean; children: unknown }) => (visible ? h('Modal', rest, children as never) : null),
    ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
    Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
  };
});
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { state.storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { state.storage.delete(key); }),
  },
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
vi.mock('lucide-react-native', () => Object.fromEntries(
  ['AArrowDown', 'AArrowUp', 'ArrowLeft', 'ArrowRight', 'BookHeart', 'BookMarked', 'BookOpen', 'BookOpenText', 'Heart', 'House', 'NotebookPen', 'RefreshCw'].map((name) => [name, name]),
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
  return { usePalette: () => lightPalette, useThemedStyles: (factory: (colors: unknown) => unknown) => factory(lightPalette) };
});
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));
vi.mock('@/services/api', () => ({ getEmotions: async () => state.emotions, getApiErrorMessage: () => 'error' }));
vi.mock('@/storage/emotionsCache', () => ({ getCachedEmotions: async () => null, setCachedEmotions: async () => undefined }));
vi.mock('@/components/StateView', () => ({ StateView: 'StateView' }));
vi.mock('@/utils/emotionIcons', () => ({ EMOTION_ICONS: {}, EMOTION_ICON_FALLBACK: 'EmotionIcon' }));

const { AppTabBar, APP_TABS } = await import('@/components/AppTabBar');
const { ContinueReadingCard } = await import('@/components/ContinueReadingCard');
const { default: AllEmotionsScreen } = await import('@/app/emotions');
const { default: KhatmaCompleteScreen } = await import('@/app/khatma-complete');
const { default: KhatmDuaScreen } = await import('@/app/khatm-dua');
const { confirmKhatma, loadReadingData, saveWirdPage } = await import('@/mushaf/khatmas');
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
  await act(async () => { root = create(element); });
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
    expect(byId('khatma-complete-detail').props.children).toContain('ورد الفجر');
    await press('khatma-complete-dua');
    expect(router.push).toHaveBeenLastCalledWith('/khatm-dua');
    await press('khatma-complete-back');
    expect(router.dismissTo).toHaveBeenLastCalledWith('/my-reading');
    // Showing it again records nothing more.
    expect((await loadReadingData()).stats.total).toBe(1);
  });
});

describe('the du`a screen for a pending ورد (?wird=)', () => {
  it('offers تأكيد إتمام الختمة as a separate tap (even with the du`a text still pending approval); it records once', async () => {
    state.locale = 'ar';
    await saveWirdPage({ name: 'ورد الفجر', page: 300 });
    await saveWirdPage({ name: 'ورد الفجر', page: 604 });
    const [w] = (await loadReadingData()).wirds;
    state.params = { wird: w.stop.id };
    await mount(createElement(KhatmDuaScreen, { dua: null }));
    expect(byId('khatm-dua-unavailable')).toBeDefined();
    expect(textOf(byId('khatm-dua-khatma'))).toContain('تأكيد إتمام الختمة');
    // Opening it counted nothing.
    expect((await loadReadingData()).stats.total).toBe(0);
    await act(async () => {
      byId('khatm-dua-confirm-khatma').props.onPress();
      byId('khatm-dua-confirm-khatma').props.onPress();
    });
    await flush();
    await flush();
    const data = await loadReadingData();
    expect(data.stats.total).toBe(1);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/khatma-complete', params: { id: data.records[0].id } });
  });

  it('opening, scrolling, resizing and leaving the approved du`a never records a Khatma; the completion stays pending, confirmable without the du`a', async () => {
    await saveWirdPage({ name: 'Fajr', page: 300 });
    await saveWirdPage({ name: 'Fajr', page: 604 });
    const before = await loadReadingData();
    const [w] = before.wirds;
    state.params = { wird: w.stop.id };
    await mount(createElement(KhatmDuaScreen));
    expect(all('khatm-dua-text')).toHaveLength(1); // the approved du`a, with the confirmation below it
    expect(textOf(byId('khatm-dua-khatma'))).toContain('Confirm Khatma completion');
    // Scrolling is plain native scrolling: the screen listens to no scroll event, so it cannot save one.
    const scroll = byId('khatm-dua-scroll');
    expect(Object.keys(scroll.props).filter((key) => /^on/.test(key))).toEqual([]);
    await press('khatm-dua-larger');
    await press('khatm-dua-back');
    await act(async () => root.unmount());
    const data = await loadReadingData();
    expect(data.stats.total).toBe(0);
    expect(data.wirds[0].status).toBe('pending');
    // Reading progress is untouched: the ورد still stands on page 604, and nothing else changed.
    expect(data).toEqual(before);
    // Confirmable directly (أورادي وختماتي's card uses this same call), no du'a involved.
    expect((await confirmKhatma(w.stop.id, w.cycle.id)).alreadyRecorded).toBe(false);
  });

  it('offers nothing for a ورد that is not pending, or without ?wird=', async () => {
    await saveWirdPage({ name: 'Fajr', page: 300 });
    const [w] = (await loadReadingData()).wirds;
    state.params = { wird: w.stop.id };
    await mount(createElement(KhatmDuaScreen, { dua: null }));
    expect(all('khatm-dua-khatma')).toHaveLength(0);
    await act(async () => root.unmount());
    state.params = {};
    await mount(createElement(KhatmDuaScreen, { dua: null }));
    expect(all('khatm-dua-khatma')).toHaveLength(0);
  });
});
