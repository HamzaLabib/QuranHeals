import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { darkPalette, lightPalette } from '@/constants/theme';
import { MESSAGES } from '@/localization/messages';

/**
 * The Settings screen's five sections (App, Emotions, Quran, Support,
 * Account) and their collapsible cards — App Language, Appearance, Emotions
 * Language, Quran Translation, Legal & Privacy — rendered with the real locale /
 * emotions / translation / appearance / keep-awake / reminder providers over
 * an in-memory AsyncStorage (and a fake notification platform), so a
 * selection is proven to go through the existing persisted preference
 * setters — not a parallel implementation.
 */
const LEGAL_SITE = 'https://quranheals.github.io/legal/';

const state = vi.hoisted(() => ({
  scheme: 'light' as 'light' | 'dark',
  storage: new Map<string, string>(),
  /** router.navigate calls (Settings → Quran → Mushaf Guide). */
  navigations: [] as unknown[],
  openURL: (_url: string) => Promise.resolve(),
  openedUrls: [] as string[],
  layoutAnimations: 0,
  refreshSyncCalls: 0,
  window: { width: 390, height: 844, fontScale: 1, scale: 3 },
  permission: { status: 'undetermined', canAskAgain: true } as { status: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean },
  permissionAfterRequest: { status: 'granted', canAskAgain: true } as { status: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean },
  permissionRequests: 0,
  settingsOpened: 0,
  pending: new Map<string, { identifier: string; trigger: unknown; data: Record<string, unknown> }>(),
  /** Whether this build carries Word Meanings (wordMeanings/bundledDataset.ts: development builds; vitest's __DEV__ is false). */
  wordMeaningsBundled: true,
}));

vi.mock('react-native', () => {
  class AnimatedValue {
    constructor(public value: number) {}
    interpolate() { return `${this.value}deg`; }
  }
  return {
    useColorScheme: () => state.scheme,
    Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
    StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
    Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch', Text: 'Text', View: 'View', RefreshControl: 'RefreshControl',
    Modal: 'Modal', ActivityIndicator: 'ActivityIndicator',
    useWindowDimensions: () => state.window,
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
    Linking: { openURL: (url: string) => { state.openedUrls.push(url); return state.openURL(url); } },
    LayoutAnimation: { configureNext: () => { state.layoutAnimations += 1; }, Presets: { easeInEaseOut: {} } },
    Animated: { Value: AnimatedValue, View: 'Animated.View', timing: () => ({ start: () => undefined }) },
  };
});
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => state.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { state.storage.set(key, value); },
  },
}));
vi.mock('lucide-react-native', () => ({
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Check: 'Check', CircleHelp: 'CircleHelp', CircleAlert: 'CircleAlert', CircleCheck: 'CircleCheck', Download: 'Download',
  ChevronDown: 'ChevronDown', ChevronLeft: 'ChevronLeft', ChevronRight: 'ChevronRight', Flag: 'Flag',
}));
// The Mushaf Guide row's icon (components/MushafIcon.tsx) draws with react-native-svg.
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Rect: 'Rect' }));
vi.mock('expo-router', () => ({ router: { back: () => undefined, navigate: (route: unknown) => { state.navigations.push(route); } } }));
// The system time picker is native-only; here only what the row asks of it, and what it does with the confirmed time, matter.
vi.mock('@/components/ReminderTimePicker', async () => {
  const { createElement: h } = await import('react');
  return { ReminderTimePicker: (props: object) => h('ReminderTimePicker', props) };
});
// Rendered for real in reportIssueSheet.test.ts and feedbackReporting.test.ts; here only how Settings opens it matters.
vi.mock('@/components/ReportIssueSheet', async () => {
  const { createElement: h } = await import('react');
  return { ReportIssueSheet: (props: object) => h('ReportIssueSheet', props) };
});
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ refreshSync: async () => { state.refreshSyncCalls += 1; } }) }));
vi.mock('@/wordMeanings/bundledDataset', () => ({ isWordMeaningsBundled: () => state.wordMeaningsBundled, bundledWordMeanings: () => null }));
// Rendered for real in accountSectionRender.test.ts; here only its position matters.
vi.mock('@/components/AccountSection', async () => {
  const { createElement: h } = await import('react');
  return { AccountSection: (props: object) => h('AccountSection', props) };
});

import SettingsScreen from '@/app/settings';
import { AppLocaleProvider } from '@/localization/useAppLocale';
import { EmotionsLanguageProvider } from '@/localization/useEmotionsLanguage';
import { QuranTranslationPreferenceProvider } from '@/localization/useQuranTranslationPreference';
import { KeepAwakePreferenceProvider } from '@/mushaf/useKeepAwakePreference';
import { FavoriteReciterProvider } from '@/audio/useFavoriteReciter';
import { NotificationsProvider } from '@/notifications/useNotifications';
import type { NotificationsApi } from '@/notifications/api';
import { AppearancePreferenceProvider } from '@/theme/useAppearancePreference';
import { WordMeaningsVisibilityProvider } from '@/mushaf/useWordMeaningsVisibility';

/** Reminders: a supported platform that has not been asked for permission yet (a fresh install). */
const fakeNotificationsApi: NotificationsApi = {
  supported: true,
  getPermission: async () => state.permission,
  requestPermission: async () => { state.permissionRequests += 1; state.permission = state.permissionAfterRequest; return state.permission; },
  ensureChannels: async () => undefined,
  getPending: async () => [...state.pending.values()].map(({ identifier, data }) => ({ identifier, data })),
  schedule: async ({ identifier, trigger, content }) => { state.pending.set(identifier, { identifier, trigger, data: content.data }); },
  cancel: async (identifier) => { state.pending.delete(identifier); },
  getLastResponse: () => null,
  clearLastResponse: () => undefined,
  addResponseListener: () => ({ remove: () => undefined }),
  setForegroundPresentation: () => undefined,
  openSystemSettings: async () => { state.settingsOpened += 1; },
};
const NOTIFICATIONS_KEY = 'quran-heals:notification-preferences:v1';
/** The Random Quran Ayah's verse source (the real one is checked against quran.sqlite in randomAyahNotification.test.ts). */
let fakePick = 0;
const fakeVerses = {
  getVerseByKey: async (verseKey: string) => ({ surah: Number(verseKey.split(':')[0]), ayah: Number(verseKey.split(':')[1]), verseKey, arabicText: 'نص' }),
  getRandomVerseKey: async () => `2:${(fakePick += 1)}`,
};

const LOCALE_KEY = 'quran-heals:app-locale:v1';
const TRANSLATION_KEY = 'quran-heals:quran-translation-preference:v1';
const APPEARANCE_KEY = 'quran-heals:appearance-preference:v1';
const EMOTIONS_KEY = 'quran-heals:emotions-language:v1';
const QURAN_LANGUAGE_KEY = 'quran-heals:quran-language:v1';

const en = MESSAGES.en;
const ar = MESSAGES.ar;

let root: ReactTestRenderer | undefined;
const fetchSpy = vi.fn();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.scheme = 'light';
  state.storage.clear();
  state.navigations = [];
  state.openURL = () => Promise.resolve();
  state.openedUrls = [];
  state.layoutAnimations = 0;
  state.refreshSyncCalls = 0;
  state.window = { width: 390, height: 844, fontScale: 1, scale: 3 };
  state.permission = { status: 'undetermined', canAskAgain: true };
  state.permissionAfterRequest = { status: 'granted', canAskAgain: true };
  state.permissionRequests = 0;
  state.settingsOpened = 0;
  state.pending.clear();
  state.wordMeaningsBundled = true;
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

async function renderSettings() {
  const tree = (children: ReactNode) =>
    createElement(AppLocaleProvider, null,
      createElement(EmotionsLanguageProvider, null,
        createElement(QuranTranslationPreferenceProvider, null,
          createElement(AppearancePreferenceProvider, null, createElement(KeepAwakePreferenceProvider, null, createElement(WordMeaningsVisibilityProvider, null, createElement(FavoriteReciterProvider, null,
            createElement(NotificationsProvider, { api: fakeNotificationsApi, now: () => new Date(2026, 9, 14, 12, 0), verses: fakeVerses }, children))))))));
  await act(async () => { root = create(tree(createElement(SettingsScreen))); });
}

const isType = (type: string) => (node: ReactTestInstance) => node.type === (type as never);
const all = (type: string) => root!.root.findAll(isType(type));

/** Accordion headers, in screen order (the reminders' small frequency selectors also announce `expanded`, and carry a testID). */
function headers() {
  return all('Pressable').filter((node) => node.props.accessibilityState && 'expanded' in node.props.accessibilityState && !node.props.testID);
}
function header(title: string) {
  const match = headers().find((node) => node.props.accessibilityLabel === title || node.props.accessibilityLabel.startsWith(`${title}, `));
  if (!match) throw new Error(`no header ${title}`);
  return match;
}
const expandedStates = () => headers().map((node) => node.props.accessibilityState.expanded as boolean);
const optionRows = () => all('Pressable').filter((node) => node.props.accessibilityState && 'selected' in node.props.accessibilityState);
const linkRows = () => all('Pressable').filter((node) => node.props.accessibilityRole === 'link');
const texts = (node: ReactTestInstance = root!.root) => node.findAll(isType('Text')).map((text) => text.props.children);
const press = async (node: ReactTestInstance) => { await act(async () => { node.props.onPress(); }); };
const pressHeader = (title: string) => press(header(title));
const pressOption = (label: string) => press(optionRows().find((node) => node.props.accessibilityLabel === label)!);
const resolveStyle = (node: ReactTestInstance) =>
  [typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style].flat(Infinity).filter(Boolean);

const EN_HEADERS = ['App Language', 'Appearance', 'Emotions Language', 'Favorite Reciter', 'Quran Translation', 'Legal & Privacy'];
const AR_HEADERS = ['لغة التطبيق', 'المظهر', 'لغة المشاعر', 'القارئ المفضل', 'ترجمة القرآن', 'السياسات والشروط'];
const EN_SECTIONS = ['App', 'Emotions', 'Quran', 'Support'];
const AR_SECTIONS = ['التطبيق', 'المشاعر', 'القرآن', 'الدعم'];
/** The four section headings this screen draws (Account draws its own, inside AccountSection). */
const sectionHeadings = () => root!.root
  .findAll((node) => typeof node.type === 'string' && /^settings-section-/.test(node.props.testID ?? ''))
  .map((section) => section.findAll((node) => node.type === ('Text' as never) && node.props.accessibilityRole === 'header')[0].props.children);

describe('Settings: section order and initial state', () => {
  it('exactly five sections — App, Emotions, Quran, Support, Account — with no Notifications section', async () => {
    await renderSettings();
    const sections = root!.root.findAll((node) => typeof node.type === 'string' && /^settings-section-/.test(node.props.testID ?? ''));
    expect(sections.map((node) => node.props.testID)).toEqual(['settings-section-app', 'settings-section-emotions', 'settings-section-quran', 'settings-section-support']);
    expect(sectionHeadings()).toEqual(EN_SECTIONS);
    // Account is the fifth, last on the screen.
    const order = root!.root
      .findAll((node) => node.type === ('AccountSection' as never) || sections.includes(node))
      .map((node) => (node.type === ('AccountSection' as never) ? 'Account' : node.props.testID));
    expect(order).toEqual(['settings-section-app', 'settings-section-emotions', 'settings-section-quran', 'settings-section-support', 'Account']);
    expect(texts()).not.toContain('Notifications');
    // Quran Translation is the one row for the Quran's language (formerly titled Quran Language): never a second one.
    expect(texts().filter((text) => text === en.settings.quranTranslationSection)).toHaveLength(1);
    expect(texts()).not.toContain('Quran Language');
  });

  it('each section holds its own settings: App (App Language, Appearance), Emotions (Emotions Language, Show Translation, Emotional Check-in), Quran (Favorite Reciter, Offline listening, Quran Translation, Keep Screen Awake, Reciting Reminder, Random Quran Ayah, offline Mushaf), Support (Report an Issue, Legal & Privacy)', async () => {
    await renderSettings();
    const section = (id: string) => root!.root.find((node) => node.props.testID === id && typeof node.type === 'string');
    const headersIn = (id: string) => section(id).findAll((node) => headers().includes(node)).map((node) => node.props.accessibilityLabel.split(', ')[0]);
    const idsIn = (id: string) => section(id).findAll((node) => typeof node.type === 'string' && typeof node.props.testID === 'string' && /^settings-(show-translation|keep-awake|word-meanings|report-issue|offline-mushaf|offline-audio|reminder-[a-zA-Z]+)$/.test(node.props.testID)).map((node) => node.props.testID);
    expect(headersIn('settings-section-app')).toEqual(['App Language', 'Appearance']);
    expect(headersIn('settings-section-emotions')).toEqual(['Emotions Language']);
    expect(idsIn('settings-section-emotions')).toEqual(['settings-show-translation', 'settings-reminder-emotionCheckIn']);
    expect(headersIn('settings-section-quran')).toEqual(['Favorite Reciter', 'Quran Translation']);
    expect(idsIn('settings-section-quran')).toEqual(['settings-keep-awake', 'settings-word-meanings', 'settings-reminder-wird', 'settings-reminder-randomAyah', 'settings-offline-mushaf']);
    expect(headersIn('settings-section-support')).toEqual(['Legal & Privacy']);
    expect(idsIn('settings-section-support')).toEqual(['settings-report-issue']);
    expect(en.settings.legalSection).toBe('Legal & Privacy');
  });

  it('starts with every section collapsed and no option or legal rows rendered', async () => {
    await renderSettings();
    expect(expandedStates()).toEqual([false, false, false, false, false, false]);
    expect(optionRows()).toHaveLength(0);
    expect(linkRows()).toHaveLength(0);
  });

  it('shows each current selection under its collapsed heading, and nothing under Legal & Privacy', async () => {
    await renderSettings();
    expect(headers().map((node) => node.props.accessibilityLabel)).toEqual([
      'App Language, English',
      'Appearance, System',
      'Emotions Language, Follow App Language',
      'Favorite Reciter, Muhammad Siddiq Al-Minshawi',
      'Quran Translation, None',
      'Legal & Privacy',
    ]);
    expect(texts(header('Legal & Privacy'))).toEqual(['Legal & Privacy']);
  });
});

describe('Settings: accordion behavior', () => {
  it('tapping a header expands it and tapping it again collapses it', async () => {
    await renderSettings();
    await pressHeader('App Language');
    expect(expandedStates()).toEqual([true, false, false, false, false, false]);
    // Exactly English and Arabic: Egyptian Arabic is an Emotions Language only.
    expect(optionRows().map((node) => node.props.accessibilityLabel)).toEqual(['English', 'العربية']);
    await pressHeader('App Language');
    expect(expandedStates()).toEqual([false, false, false, false, false, false]);
    expect(optionRows()).toHaveLength(0);
  });

  it('opening another section closes the previously open one', async () => {
    await renderSettings();
    await pressHeader('App Language');
    await pressHeader('Appearance');
    expect(expandedStates()).toEqual([false, true, false, false, false, false]);
    await pressHeader('Legal & Privacy');
    expect(expandedStates()).toEqual([false, false, false, false, false, true]);
    expect(optionRows()).toHaveLength(0);
  });

  it('animates opening and closing, and never touches storage, sync, or the network', async () => {
    await renderSettings();
    const before = new Map(state.storage);
    for (const title of [...EN_HEADERS, 'Legal & Privacy']) await pressHeader(title);
    expect(state.layoutAnimations).toBe(EN_HEADERS.length + 1);
    expect(state.storage).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.refreshSyncCalls).toBe(0);
  });
});

describe('Settings: App Language', () => {
  it('applies the locale immediately, persists it, switches to RTL, and collapses', async () => {
    await renderSettings();
    await pressHeader('App Language');
    await pressOption('العربية');
    expect(state.storage.get(LOCALE_KEY)).toBe('ar');
    expect(expandedStates()).toEqual([false, false, false, false, false, false]);
    const languageHeader = header(ar.settings.appLanguageSection);
    expect(languageHeader.props.accessibilityLabel).toBe('لغة التطبيق, العربية');
    expect(resolveStyle(languageHeader)).toContainEqual({ flexDirection: 'row-reverse' });
    expect(languageHeader.findAll(isType('Text'))[0].props.style).toContainEqual({ writingDirection: 'rtl', textAlign: 'right' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('switching back to English restores LTR', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    expect(header(ar.settings.appLanguageSection).props.accessibilityLabel).toBe('لغة التطبيق, العربية');
    await pressHeader(ar.settings.appLanguageSection);
    await pressOption('English');
    expect(state.storage.get(LOCALE_KEY)).toBe('en');
    expect(resolveStyle(header('App Language'))).not.toContainEqual({ flexDirection: 'row-reverse' });
  });

  it('an existing Egyptian Arabic App Language migrates: Arabic interface, Egyptian Arabic emotions; an explicit Emotions choice survives', async () => {
    state.storage.set(LOCALE_KEY, 'ar-EG');
    state.storage.set(TRANSLATION_KEY, JSON.stringify({ translationId: 'en.pickthall.gutenberg16955', displayMode: 'off' }));
    await renderSettings();
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(state.storage.get(LOCALE_KEY)).toBe('ar');
    expect(state.storage.get(EMOTIONS_KEY)).toBe('ar-EG');
    expect(header('لغة التطبيق').props.accessibilityLabel).toBe('لغة التطبيق, العربية');
    expect(header('لغة المشاعر').props.accessibilityLabel).toBe('لغة المشاعر, العربية المصرية');
    // Unrelated preferences untouched.
    expect(JSON.parse(state.storage.get(TRANSLATION_KEY)!)).toMatchObject({ displayMode: 'off' });
    await act(async () => root!.unmount());
    root = undefined;

    // Already chosen: kept. And running again changes nothing (idempotent).
    state.storage.set(LOCALE_KEY, 'ar-EG');
    state.storage.set(EMOTIONS_KEY, 'en');
    await renderSettings();
    await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    expect(state.storage.get(LOCALE_KEY)).toBe('ar');
    expect(state.storage.get(EMOTIONS_KEY)).toBe('en');
  });
});

describe('Settings: Emotions Language', () => {
  it('offers Follow App Language, English, العربية الفصحى and العربية المصرية; Follow is the default', async () => {
    await renderSettings();
    await pressHeader('Emotions Language');
    const rows = optionRows();
    expect(rows.map((node) => node.props.accessibilityLabel)).toEqual(['Follow App Language', 'English', 'العربية الفصحى', 'العربية المصرية']);
    expect(rows.map((node) => node.props.accessibilityState.selected)).toEqual([true, false, false, false]);
    // Each choice in its own direction: the two Arabic names right to left, even in an English interface.
    const labelDirection = (node: ReactTestInstance) => resolveStyle(node.findAll(isType('Text'))[0]).find((style) => style.writingDirection)?.writingDirection;
    expect(rows.map(labelDirection)).toEqual(['ltr', 'ltr', 'rtl', 'rtl']);
  });

  it('a choice persists independently of the App Language, and survives an App Language change and a restart', async () => {
    await renderSettings();
    await pressHeader('Emotions Language');
    await pressOption('العربية المصرية');
    expect(state.storage.get(EMOTIONS_KEY)).toBe('ar-EG');
    expect(header('Emotions Language').props.accessibilityLabel).toBe('Emotions Language, العربية المصرية');
    expect(state.storage.get(LOCALE_KEY)).toBeUndefined(); // the App Language is untouched

    await pressHeader('App Language');
    await pressOption('العربية');
    expect(header('لغة المشاعر').props.accessibilityLabel).toBe('لغة المشاعر, العربية المصرية');
    await pressHeader('لغة المشاعر');
    expect(optionRows().map((node) => node.props.accessibilityLabel)).toEqual(['حسب لغة التطبيق', 'الإنجليزية', 'العربية الفصحى', 'العربية المصرية']);

    await act(async () => root!.unmount());
    root = undefined;
    await renderSettings();
    expect(header('لغة المشاعر').props.accessibilityLabel).toBe('لغة المشاعر, العربية المصرية');
  });
});

describe('Settings: Quran Translation', () => {
  it('exactly one option today — None / بدون ترجمة — stored as a stable id, never a label; no unreleased languages', async () => {
    await renderSettings();
    await pressHeader('Quran Translation');
    expect(optionRows().map((node) => [node.props.accessibilityLabel, node.props.accessibilityState.selected])).toEqual([['None', true]]);
    expect(ar.settings.quranTranslationNone).toBe('بدون ترجمة');
    expect(MESSAGES['ar-EG'].settings.quranTranslationNone).toBe('بدون ترجمة');
    for (const unreleased of ['Turkish', 'French', 'Urdu', 'Coming soon']) expect(texts(root!.root)).not.toContain(unreleased);
    await pressOption('None');
    expect(state.storage.get(QURAN_LANGUAGE_KEY)).toBe('quran-text');
    expect(expandedStates()).toEqual([false, false, false, false, false, false]);
  });

  it('Arabic: ترجمة القرآن / بدون ترجمة, and the choice is kept after a restart', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    state.storage.set(QURAN_LANGUAGE_KEY, 'quran-text');
    await renderSettings();
    expect(header('ترجمة القرآن').props.accessibilityLabel).toBe('ترجمة القرآن, بدون ترجمة');
    // An unknown stored mode (e.g. from a future version, or a translation not in this build) reads as None.
    await act(async () => root!.unmount());
    root = undefined;
    state.storage.set(QURAN_LANGUAGE_KEY, 'turkish');
    await renderSettings();
    expect(header('ترجمة القرآن').props.accessibilityLabel).toBe('ترجمة القرآن, بدون ترجمة');
  });
});

describe('Settings: Appearance', () => {
  it('persists the unchanged internal value, updates the summary, and collapses', async () => {
    await renderSettings();
    await pressHeader('Appearance');
    expect(optionRows().map((node) => node.props.accessibilityLabel)).toEqual(['System', 'Light', 'Dark']);
    expect(optionRows().map((node) => node.props.accessibilityState.selected)).toEqual([true, false, false]);
    await pressOption('Dark');
    expect(JSON.parse(state.storage.get(APPEARANCE_KEY)!)).toBe('dark');
    expect(header('Appearance').props.accessibilityLabel).toBe('Appearance, Dark');
    expect(expandedStates()).toEqual([false, false, false, false, false, false]);
    await pressHeader('Appearance');
    await pressOption('System');
    expect(JSON.parse(state.storage.get(APPEARANCE_KEY)!)).toBe('system');
  });

  it('re-selecting the current option still collapses the section', async () => {
    await renderSettings();
    await pressHeader('Appearance');
    await pressOption('System');
    expect(expandedStates()).toEqual([false, false, false, false, false, false]);
  });

  it('saved choices are shown after a restart — an existing Light or Dark is kept, never replaced by the new System default', async () => {
    state.storage.set(APPEARANCE_KEY, JSON.stringify('dark'));
    await renderSettings();
    expect(header('Appearance').props.accessibilityLabel).toBe('Appearance, Dark');
    await act(async () => root!.unmount());
    root = undefined;
    state.storage.set(APPEARANCE_KEY, JSON.stringify('light'));
    state.scheme = 'dark';
    await renderSettings();
    expect(header('Appearance').props.accessibilityLabel).toBe('Appearance, Light');
    expect(JSON.parse(state.storage.get(APPEARANCE_KEY)!)).toBe('light');
  });
});

describe('Settings: Arabic labels', () => {
  it('Appearance reads حسب النظام / وضع النهار / وضع الليل, collapsed and expanded', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    expect(header('المظهر').props.accessibilityLabel).toBe('المظهر, حسب النظام');
    expect(texts(header('المظهر'))).toEqual(['المظهر', 'حسب النظام']);
    await pressHeader('المظهر');
    expect(optionRows().map((node) => node.props.accessibilityLabel)).toEqual(['حسب النظام', 'وضع النهار', 'وضع الليل']);
    await pressOption('وضع الليل');
    expect(texts(header('المظهر'))).toEqual(['المظهر', 'وضع الليل']);
  });

  it('the sections in Arabic; Legal & Privacy opens the Arabic pages', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    expect(headers().map((node) => texts(node)[0])).toEqual(AR_HEADERS);
    expect(sectionHeadings()).toEqual(AR_SECTIONS);
    await pressHeader('السياسات والشروط');
    expect(linkRows().map((node) => node.props.accessibilityLabel)).toEqual(['سياسة الخصوصية', 'شروط الخدمة', 'حذف الحساب والبيانات']);
    for (const row of linkRows()) expect(resolveStyle(row)).toContainEqual({ flexDirection: 'row-reverse' });
    expect(linkRows()[0].findByType('ChevronLeft' as never)).toBeTruthy();
    for (const row of linkRows()) await press(row);
    expect(state.openedUrls).toEqual([`${LEGAL_SITE}ar/privacy/`, `${LEGAL_SITE}ar/terms/`, `${LEGAL_SITE}ar/delete-account/`]);
  });
});

describe('Settings: Legal & Privacy links', () => {
  it('lists Privacy Policy, Terms of Service and Account & Data Deletion as links', async () => {
    await renderSettings();
    await pressHeader('Legal & Privacy');
    expect(linkRows().map((node) => node.props.accessibilityLabel)).toEqual(['Privacy Policy', 'Terms of Service', 'Account & Data Deletion']);
    for (const row of linkRows()) expect(row.findByType('ChevronRight' as never)).toBeTruthy();
  });

  it('opens each English page in the browser', async () => {
    await renderSettings();
    await pressHeader('Legal & Privacy');
    for (const row of linkRows()) await press(row);
    expect(state.openedUrls).toEqual([`${LEGAL_SITE}privacy/`, `${LEGAL_SITE}terms/`, `${LEGAL_SITE}delete-account/`]);
    expect(linkRows()[0].props.accessibilityHint).toBe(en.settings.opensInBrowser);
  });

  it('every row is enabled: no row is disabled or shows an "unavailable" note', async () => {
    await renderSettings();
    await pressHeader('Legal & Privacy');
    for (const row of linkRows()) {
      expect(row.props.disabled).toBeFalsy();
      expect(typeof row.props.onPress).toBe('function');
      expect(texts(row)).toHaveLength(1);
    }
  });

  it('a failed openURL does not crash the screen', async () => {
    state.openURL = () => Promise.reject(new Error('no browser'));
    await renderSettings();
    await pressHeader('Legal & Privacy');
    await press(linkRows()[0]);
    expect(linkRows()).toHaveLength(3);
  });
});

describe('Settings: theming', () => {
  const cardBackgrounds = () =>
    all('View').map((node) => resolveStyle(node)).flat().filter((style) => style.borderRadius !== undefined && style.backgroundColor !== undefined).map((style) => style.backgroundColor);

  // The six accordions, the Show Translation, Keep Screen Awake and Word Meanings cards, the three reminder cards
  // (components/NotificationReminderRow.tsx) and the offline Mushaf row (components/OfflineMushafSettingsRow.tsx), all
  // in the same palette card. (Offline listening is a small icon on Favorite Reciter's card, not a card of its own.)
  const CARDS = 13;

  it('uses the light palette card for every accordion in Light', async () => {
    await renderSettings();
    expect(cardBackgrounds()).toEqual(Array(CARDS).fill(lightPalette.card));
  });

  it('uses the dark palette card for every accordion in Dark, including expanded and selected rows', async () => {
    state.storage.set(APPEARANCE_KEY, JSON.stringify('dark'));
    await renderSettings();
    expect(cardBackgrounds()).toEqual(Array(CARDS).fill(darkPalette.card));
    await pressHeader('Emotions Language');
    const selected = optionRows().find((node) => node.props.accessibilityState.selected)!;
    expect(resolveStyle(selected)).toContainEqual(expect.objectContaining({ backgroundColor: darkPalette.accentSoft }));
  });

  it('System follows the device appearance — saved, and as the default when nothing is saved', async () => {
    state.storage.set(APPEARANCE_KEY, JSON.stringify('system'));
    state.scheme = 'dark';
    await renderSettings();
    expect(cardBackgrounds()).toEqual(Array(CARDS).fill(darkPalette.card));
    expect(header('Appearance').props.accessibilityLabel).toBe('Appearance, System');
    await act(async () => root!.unmount());
    root = undefined;
    state.storage.delete(APPEARANCE_KEY);
    await renderSettings();
    expect(cardBackgrounds()).toEqual(Array(CARDS).fill(darkPalette.card));
    expect(state.storage.has(APPEARANCE_KEY)).toBe(false);
  });
});

describe('Settings: accessibility', () => {
  it('every header is a button announcing its expanded state and current selection', async () => {
    await renderSettings();
    for (const node of headers()) {
      expect(node.props.accessibilityRole).toBe('button');
      expect(node.props.accessibilityLabel).toBeTruthy();
    }
    await pressHeader('Quran Translation');
    expect(header('Quran Translation').props.accessibilityState).toEqual({ expanded: true });
  });

  it('options announce which one is selected', async () => {
    await renderSettings();
    await pressHeader('App Language');
    expect(optionRows().map((node) => [node.props.accessibilityRole, node.props.accessibilityState.selected])).toEqual([['button', true], ['button', false]]);
  });

  it('headers and rows keep a 56pt minimum touch target with no fixed height that could clip large text', async () => {
    await renderSettings();
    await pressHeader('Emotions Language');
    for (const node of [...headers(), ...optionRows()]) {
      const styles = resolveStyle(node);
      expect(styles).toContainEqual(expect.objectContaining({ minHeight: 56 }));
      expect(styles.some((style) => style.height !== undefined || style.maxHeight !== undefined)).toBe(false);
    }
    for (const text of all('Text')) expect(text.props.numberOfLines).toBeUndefined();
  });
});

describe('Settings: Report an issue', () => {
  const reportRow = () => all('Pressable').find((node) => node.props.testID === 'settings-report-issue')!;
  const sheet = () => all('ReportIssueSheet')[0];

  it('in Support, before Legal & Privacy and the Account section, as a row of its own', async () => {
    await renderSettings();
    const order = root!.root
      .findAll((node) => node.type === ('AccountSection' as never) || headers().includes(node) || node.props?.testID === 'settings-report-issue')
      .filter((node) => typeof node.type === 'string' || node.type === ('AccountSection' as never))
      .map((node) => (node.type === ('AccountSection' as never) ? 'Account' : node.props.testID === 'settings-report-issue' ? 'Report' : node.props.accessibilityLabel.split(', ')[0]));
    expect(order).toEqual(['App Language', 'Appearance', 'Emotions Language', 'Favorite Reciter', 'Quran Translation', 'Report', 'Legal & Privacy', 'Account']);
    expect(reportRow().props.accessibilityState).toBeUndefined();
    expect(reportRow().props).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: en.issueReport.action, accessibilityHint: en.issueReport.settingsDescription });
    expect(texts(reportRow())).toEqual([en.issueReport.action, en.issueReport.settingsDescription]);
  });

  it('opens the shared reporting sheet for general issues (no ayah attached), and closes it', async () => {
    await renderSettings();
    expect(sheet().props).toMatchObject({ visible: false, variant: 'settings' });
    expect(sheet().props.context).toBeUndefined();
    await press(reportRow());
    expect(sheet().props.visible).toBe(true);
    await act(async () => sheet().props.onClose());
    expect(sheet().props.visible).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Arabic: the row mirrors and uses the Standard Arabic copy', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    expect(texts(reportRow())).toEqual([ar.issueReport.action, ar.issueReport.settingsDescription]);
    expect(resolveStyle(reportRow())).toContainEqual({ flexDirection: 'row-reverse' });
  });
});

describe('Settings: Keep Screen Awake', () => {
  const KEEP_AWAKE_KEY = 'quran-heals:mushaf-keep-awake:v1';
  const toggle = () => root!.root.findByProps({ testID: 'settings-keep-awake' });
  /** The card holding the switch: its title and description, in screen order. */
  const card = () => toggle().parent!;

  it('sits in the Quran section directly below Quran Translation, as a card of its own, ON by default with nothing saved', async () => {
    await renderSettings();
    const order = root!.root
      .findAll((node) => node === toggle() || headers().includes(node))
      .map((node) => (node === toggle() ? 'switch' : node.props.accessibilityLabel.split(', ')[0]));
    expect(order).toEqual(['App Language', 'Appearance', 'Emotions Language', 'Favorite Reciter', 'Quran Translation', 'switch', 'Legal & Privacy']);
    expect(texts(card())).toEqual([en.settings.keepAwakeTitle, en.settings.keepAwakeDescription]);
    expect(en.settings.keepAwakeTitle).toBe('Keep Screen Awake');
    expect(en.settings.keepAwakeDescription).toBe('Prevent automatic screen locking while reading the Mushaf.');
    expect(toggle().props).toMatchObject({ value: true, accessibilityRole: 'switch', accessibilityLabel: 'Keep Screen Awake', accessibilityState: { checked: true } });
    expect(state.storage.has(KEEP_AWAKE_KEY)).toBe(false);
    // Still exactly the six accordion sections: the switch is not one of them, and opens nothing.
    expect(headers().map((node) => node.props.accessibilityLabel.split(', ')[0])).toEqual(EN_HEADERS);
  });

  it('switching OFF and back ON applies and saves at once, with no other preference written and no network', async () => {
    await renderSettings();
    const before = new Map(state.storage);
    await act(async () => toggle().props.onValueChange(false));
    expect(toggle().props.value).toBe(false);
    expect(state.storage.get(KEEP_AWAKE_KEY)).toBe('false');
    await act(async () => toggle().props.onValueChange(true));
    expect(toggle().props.value).toBe(true);
    expect(state.storage.get(KEEP_AWAKE_KEY)).toBe('true');
    expect([...state.storage.keys()].filter((key) => !before.has(key) && key !== NOTIFICATIONS_KEY)).toEqual([KEEP_AWAKE_KEY]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.layoutAnimations).toBe(0);
  });

  it('a saved OFF is shown OFF after a restart', async () => {
    state.storage.set(KEEP_AWAKE_KEY, 'false');
    await renderSettings();
    expect(toggle().props.value).toBe(false);
  });

  it('Arabic: the Modern Standard Arabic title and description, right to left', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    expect(ar.settings.keepAwakeTitle).toBe('إبقاء الشاشة مضاءة');
    expect(ar.settings.keepAwakeDescription).toBe('منع قفل الشاشة تلقائيًا أثناء قراءة المصحف.');
    expect(texts(card())).toEqual([ar.settings.keepAwakeTitle, ar.settings.keepAwakeDescription]);
    expect(toggle().props.accessibilityLabel).toBe(ar.settings.keepAwakeTitle);
    expect(resolveStyle(card())).toContainEqual({ flexDirection: 'row-reverse' });
    for (const text of card().findAll(isType('Text'))) expect(resolveStyle(text)).toContainEqual({ writingDirection: 'rtl', textAlign: 'right' });
  });

  it.each([['light', lightPalette], ['dark', darkPalette]] as const)('%s mode: the same card as the accordions, in the theme colours', async (scheme, palette) => {
    state.storage.set(APPEARANCE_KEY, JSON.stringify(scheme));
    await renderSettings();
    const accordionCard = header('Quran Translation').parent!;
    const pick = (styles: object[]) => Object.assign({}, ...styles) as Record<string, unknown>;
    const mine = pick(resolveStyle(card()));
    const theirs = pick(resolveStyle(accordionCard));
    for (const key of ['backgroundColor', 'borderColor', 'borderRadius', 'borderWidth']) expect(mine[key]).toBe(theirs[key]);
    expect(mine.backgroundColor).toBe(palette.card);
    expect(toggle().props.trackColor).toEqual({ false: palette.border, true: palette.accentFill });
    expect(toggle().props.thumbColor).toBe(palette.onAccentFill);
    const [title, description] = card().findAll(isType('Text')).map((text) => pick(resolveStyle(text)));
    expect(title.color).toBe(palette.textPrimary);
    expect(description.color).toBe(palette.textSecondary);
  });
});

describe('Settings: Word Meanings', () => {
  const VISIBLE_KEY = 'quran-heals:word-meanings-visible:v1';
  const toggle = () => root!.root.findByProps({ testID: 'settings-word-meanings' });
  const toggles = () => root!.root.findAllByProps({ testID: 'settings-word-meanings' });
  const card = () => toggle().parent!;
  /** The Quran section's rows in screen order: accordion headers by title, every other row by its testID. */
  const quranRows = () => {
    const quran = root!.root.find((node) => node.props.testID === 'settings-section-quran' && typeof node.type === 'string');
    return quran
      .findAll((node) => typeof node.type === 'string' && (headers().includes(node) || /^settings-(keep-awake|word-meanings|reminder-(wird|randomAyah)|offline-mushaf|mushaf-guide)$/.test(String(node.props.testID))))
      .map((node) => (headers().includes(node) ? node.props.accessibilityLabel.split(', ')[0] : node.props.testID));
  };

  it.each([['en', en], ['ar', ar]] as const)('%s: the Quran section in the approved order, Word Meanings directly after Keep Screen Awake', async (locale, copy) => {
    if (locale === 'ar') state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    expect(quranRows()).toEqual([
      copy.audio.favoriteTitle,
      copy.settings.quranTranslationSection,
      'settings-keep-awake',
      'settings-word-meanings',
      'settings-reminder-wird',
      'settings-reminder-randomAyah',
      'settings-offline-mushaf',
      'settings-mushaf-guide',
    ]);
  });

  it('a switch card of its own, ON by default with nothing saved; its title alone', async () => {
    await renderSettings();
    expect(en.settings.wordMeaningsVisibleTitle).toBe('Word Meanings');
    expect(texts(card())).toEqual(['Word Meanings']);
    expect(toggle().props).toMatchObject({ value: true, accessibilityRole: 'switch', accessibilityLabel: 'Word Meanings', accessibilityState: { checked: true } });
    expect(state.storage.has(VISIBLE_KEY)).toBe(false);
    // Not an accordion: the six headings are unchanged.
    expect(headers().map((node) => node.props.accessibilityLabel.split(', ')[0])).toEqual(EN_HEADERS);
  });

  it('switching OFF and back ON applies and saves at once, with no other preference written and no network', async () => {
    await renderSettings();
    const before = new Map(state.storage);
    await act(async () => toggle().props.onValueChange(false));
    expect(toggle().props).toMatchObject({ value: false, accessibilityState: { checked: false } });
    expect(state.storage.get(VISIBLE_KEY)).toBe('false');
    await act(async () => toggle().props.onValueChange(true));
    expect(toggle().props.value).toBe(true);
    expect(state.storage.get(VISIBLE_KEY)).toBe('true');
    expect([...state.storage.keys()].filter((key) => !before.has(key) && key !== NOTIFICATIONS_KEY)).toEqual([VISIBLE_KEY]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.layoutAnimations).toBe(0);
  });

  it('a saved OFF is shown OFF after a restart', async () => {
    state.storage.set(VISIBLE_KEY, 'false');
    await renderSettings();
    expect(toggle().props.value).toBe(false);
  });

  it('Arabic: «معاني الكلمات», right to left', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    expect(ar.settings.wordMeaningsVisibleTitle).toBe('معاني الكلمات');
    expect(MESSAGES['ar-EG'].settings.wordMeaningsVisibleTitle).toBe('معاني الكلمات');
    expect(texts(card())).toEqual(['معاني الكلمات']);
    expect(toggle().props.accessibilityLabel).toBe('معاني الكلمات');
    expect(resolveStyle(card())).toContainEqual({ flexDirection: 'row-reverse' });
    for (const text of card().findAll(isType('Text'))) expect(resolveStyle(text)).toContainEqual({ writingDirection: 'rtl', textAlign: 'right' });
  });

  it('the same card, switch colours and title style as Keep Screen Awake', async () => {
    await renderSettings();
    const keepAwake = root!.root.findByProps({ testID: 'settings-keep-awake' });
    expect(resolveStyle(card())).toEqual(resolveStyle(keepAwake.parent!));
    for (const key of ['trackColor', 'thumbColor', 'ios_backgroundColor']) expect(toggle().props[key]).toEqual(keepAwake.props[key]);
    const title = (switchNode: ReactTestInstance) => resolveStyle(switchNode.parent!.findAll(isType('Text'))[0]);
    expect(title(toggle())).toEqual(title(keepAwake));
  });

  it('a build without Word Meanings (release) shows no switch, and the rest of the section is unchanged', async () => {
    state.wordMeaningsBundled = false;
    await renderSettings();
    expect(toggles()).toHaveLength(0);
    expect(quranRows()).toEqual(['Favorite Reciter', 'Quran Translation', 'settings-keep-awake', 'settings-reminder-wird', 'settings-reminder-randomAyah', 'settings-offline-mushaf', 'settings-mushaf-guide']);
  });
});

describe('Settings: reminders (the compact rows)', () => {
  const row = (kind: string) => root!.root.find((node) => typeof node.type === 'string' && node.props.testID === `settings-reminder-${kind}`);
  const part = (kind: string, name: string) => root!.root.find((node) => typeof node.type === 'string' && node.props.testID === `settings-reminder-${kind}-${name}`);
  const parts = (kind: string, name: string) => root!.root.findAll((node) => typeof node.type === 'string' && node.props.testID === `settings-reminder-${kind}-${name}`);
  const stored = () => JSON.parse(state.storage.get(NOTIFICATIONS_KEY) ?? 'null');
  const flush = () => act(async () => { await new Promise((done) => setTimeout(done, 0)); });
  const openMenu = async (kind: string, name: string) => { await press(part(kind, name)); };
  const menuOptions = (kind: string, name: string) => root!.root.findAll((node) => typeof node.type === 'string' && typeof node.props.testID === 'string' && node.props.testID.startsWith(`settings-reminder-${kind}-${name}-option-`));
  const permissionSheet = () => root!.root.find((node) => node.props.testID === 'settings-notification-permission' && node.props.visible !== undefined);
  const KINDS = ['emotionCheckIn', 'wird', 'randomAyah'];

  it('exactly three reminders, each with its name, its time underneath, a frequency selector and a switch — all ON with the approved defaults', async () => {
    await renderSettings();
    const rows = root!.root.findAll((node) => typeof node.type === 'string' && /^settings-reminder-[a-zA-Z]+$/.test(node.props.testID ?? ''));
    expect(rows.map((node) => node.props.testID)).toEqual(KINDS.map((k) => `settings-reminder-${k}`));
    expect(texts(row('emotionCheckIn')).slice(0, 2)).toEqual(['You Deserve Peace', '9:00 PM']);
    expect(texts(row('wird')).slice(0, 2)).toEqual(['Reciting Reminder', '9:00 PM']);
    expect(texts(row('randomAyah')).slice(0, 2)).toEqual(['Random Quran Ayah', '8:00 AM']);
    expect(part('emotionCheckIn', 'frequency').props.accessibilityLabel).toBe('You Deserve Peace, Frequency, Daily');
    expect(part('wird', 'frequency').props.accessibilityLabel).toBe('Reciting Reminder, Frequency, Daily');
    expect(part('randomAyah', 'frequency').props.accessibilityLabel).toBe('Random Quran Ayah, Frequency, Daily');
    for (const kind of KINDS) {
      expect(part(kind, 'switch').props).toMatchObject({ value: true, accessibilityRole: 'switch', accessibilityState: { checked: true } });
      // The time under the name, then the frequency, then the switch at the far end.
      const ids = [`settings-reminder-${kind}-time`, `settings-reminder-${kind}-frequency`, `settings-reminder-${kind}-switch`];
      const order = row(kind).findAll((node) => typeof node.type === 'string' && ids.includes(node.props.testID)).map((node) => String(node.props.testID).split('-').pop());
      expect(order).toEqual(['time', 'frequency', 'switch']);
    }
    // The OS has not been asked: nothing is scheduled and no prompt appears on its own.
    expect(state.permissionRequests).toBe(0);
    expect(state.pending.size).toBe(0);
    expect(permissionSheet().props.visible).toBe(false);
  });

  it('the frequency menu offers exactly Daily, Every 3 days and Weekly (no Auto); there is no Save, Done or expandable panel', async () => {
    await renderSettings();
    await openMenu('wird', 'frequency');
    expect(menuOptions('wird', 'frequency').map((node) => node.props.accessibilityLabel)).toEqual(['Daily', 'Every 3 days', 'Weekly']);
    // Android: the menu's modal shares measureInWindow's coordinates (as ContinueReadingCard's menu), so it opens beside its selector.
    const menuModal = root!.root.findAll((node) => node.type === ('Modal' as never) && node.props.visible === true)[0];
    expect(menuModal.props).toMatchObject({ transparent: true, statusBarTranslucent: true });
    for (const word of ['Auto', 'Done', 'Save', 'Repeat', 'Preferred Time']) expect(texts()).not.toContain(word);
    expect(headers().map((node) => node.props.accessibilityLabel.split(', ')[0])).toEqual(EN_HEADERS);
  });

  it('choosing a frequency applies and saves at once, for that reminder only', async () => {
    await renderSettings();
    // A new install saves nothing until something is changed (the defaults need no cycle to be fixed).
    expect(stored()).toBeNull();
    await openMenu('randomAyah', 'frequency');
    await press(part('randomAyah', 'frequency-option-every3days'));
    await flush();
    expect(stored().randomAyah).toMatchObject({ frequency: 'every3days', time: '08:00', enabled: true });
    expect(stored().randomAyah.anchor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stored().wird).toEqual({ enabled: true, frequency: 'daily', time: '21:00', weekday: null, anchor: null });
    expect(stored().emotionCheckIn).toMatchObject({ enabled: true, frequency: 'daily', time: '21:00', twice: { morning: '09:00', evening: '21:00' } });
    expect(part('randomAyah', 'frequency').props.accessibilityLabel).toBe('Random Quran Ayah, Frequency, Every 3 days');
  });

  it('Weekly adds a small weekday selector before the time ("Wednesday · 9:00 PM"), stored per reminder', async () => {
    await renderSettings();
    expect(parts('wird', 'weekday')).toHaveLength(0);
    await openMenu('wird', 'frequency');
    await press(part('wird', 'frequency-option-weekly'));
    await flush();
    expect(texts(row('wird')).slice(0, 4)).toEqual(['Reciting Reminder', 'Wednesday', '·', '9:00 PM']);
    await openMenu('wird', 'weekday');
    expect(menuOptions('wird', 'weekday').map((node) => node.props.accessibilityLabel)).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    await press(part('wird', 'weekday-option-1'));
    await flush();
    expect(stored().wird).toMatchObject({ frequency: 'weekly', weekday: 1 });
    expect(stored().emotionCheckIn.weekday).toBeNull();
    expect(part('wird', 'switch').props.accessibilityHint).toContain('Weekly · Sunday · 9:00 PM');
  });

  it('tapping the time opens the picker; a confirmed time is saved and shown, a cancelled one changes nothing', async () => {
    await renderSettings();
    const picker = () => row('emotionCheckIn').findByType('ReminderTimePicker' as never);
    expect(picker().props.visible).toBe(false);
    await press(part('emotionCheckIn', 'time'));
    expect(picker().props).toMatchObject({ visible: true, value: { hour: 21, minute: 0 } });
    await act(async () => picker().props.onCancel());
    expect(picker().props.visible).toBe(false);
    expect(stored()).toBeNull(); // cancelled: nothing written
    await press(part('emotionCheckIn', 'time'));
    await act(async () => picker().props.onConfirm({ hour: 6, minute: 5 }));
    await flush();
    expect(stored().emotionCheckIn.time).toBe('06:05');
    expect(texts(row('emotionCheckIn'))[1]).toBe('6:05 AM');
  });

  it('OFF keeps the frequency and time but disables and dims them; ON restores them as they were', async () => {
    await renderSettings();
    await press(part('randomAyah', 'time'));
    await act(async () => row('randomAyah').findByType('ReminderTimePicker' as never).props.onConfirm({ hour: 7, minute: 30 }));
    await act(async () => part('randomAyah', 'switch').props.onValueChange(false));
    await flush();
    expect(stored().randomAyah).toMatchObject({ enabled: false, time: '07:30', frequency: 'daily' });
    expect(part('randomAyah', 'frequency').props.disabled).toBe(true);
    expect(part('randomAyah', 'time').props.disabled).toBe(true);
    expect(resolveStyle(part('randomAyah', 'frequency'))).toContainEqual(expect.objectContaining({ opacity: 0.5 }));
    expect(stored().wird.enabled).toBe(true);
    await act(async () => part('randomAyah', 'switch').props.onValueChange(true));
    await flush();
    expect(stored().randomAyah).toMatchObject({ enabled: true, time: '07:30', frequency: 'daily' });
    expect(part('randomAyah', 'time').props.disabled).toBe(false);
  });

  it('turning a reminder back ON is the moment to explain and ask, if the OS was never asked', async () => {
    await renderSettings();
    await act(async () => part('wird', 'switch').props.onValueChange(false));
    expect(permissionSheet().props.visible).toBe(false);
    await act(async () => part('wird', 'switch').props.onValueChange(true));
    expect(permissionSheet().props.visible).toBe(true);
    expect(state.permissionRequests).toBe(0);
  });

  it('without OS permission: an honest "Permission required" line; tapping it explains first, then asks the OS, then schedules', async () => {
    await renderSettings();
    expect(texts(part('wird', 'permission'))).toEqual(['Permission required', 'Allow notifications']);
    expect(permissionSheet().props.visible).toBe(false);
    await press(part('wird', 'permission'));
    expect(permissionSheet().props.visible).toBe(true);
    expect(state.permissionRequests).toBe(0);
    // The approved explanation, then its privacy note as a second paragraph, in the same sheet.
    const sheet = root!.root.find((node) => typeof node.type === 'string' && node.props.testID === 'settings-notification-permission');
    const body = MESSAGES.en.notifications.permissionSheetBody;
    const note = MESSAGES.en.notifications.permissionSheetPrivacy;
    expect(texts(sheet).slice(0, 3)).toEqual(['Allow notifications?', body, note]);
    expect(note).toBe('Reminders are scheduled on your device and work offline.');
    await act(async () => permissionSheet().props.onConfirm());
    await flush();
    expect(state.permissionRequests).toBe(1);
    expect(parts('wird', 'permission')).toHaveLength(0);
    expect([...state.pending.keys()].filter((id) => id.startsWith('quranheals.wird.'))).toEqual(['quranheals.wird.daily']);
    expect([...state.pending.keys()].some((id) => id.startsWith('quranheals.checkin.'))).toBe(true);
  });

  it('"Not now" keeps everything as it is and asks nothing', async () => {
    await renderSettings();
    await press(part('wird', 'permission'));
    await act(async () => permissionSheet().props.onCancel());
    expect(state.permissionRequests).toBe(0);
    expect(stored()).toBeNull(); // nothing changed, nothing written
  });

  it('denied for good: the line opens the device settings instead of asking again; frequency and time stay editable', async () => {
    state.permission = { status: 'denied', canAskAgain: false };
    await renderSettings();
    await flush();
    expect(texts(part('wird', 'permission'))).toEqual(['Permission required', 'Open device settings']);
    await press(part('wird', 'permission'));
    expect(state.settingsOpened).toBe(1);
    expect(state.permissionRequests).toBe(0);
    expect(part('wird', 'frequency').props.disabled).toBe(false);
    expect(part('wird', 'time').props.disabled).toBe(false);
  });

  it('granted: turning one reminder OFF cancels only its own pending notifications', async () => {
    state.permission = { status: 'granted', canAskAgain: true };
    await renderSettings();
    await flush();
    const ofKind = (prefix: string) => [...state.pending.keys()].filter((id) => id.startsWith(prefix)).length;
    expect(ofKind('quranheals.wird.')).toBe(1);
    const checkIns = ofKind('quranheals.checkin.');
    expect(checkIns).toBeGreaterThan(0);
    await act(async () => part('wird', 'switch').props.onValueChange(false));
    await flush();
    expect(ofKind('quranheals.wird.')).toBe(0);
    expect(ofKind('quranheals.checkin.')).toBe(checkIns);
    expect(parts('wird', 'permission')).toHaveLength(0);
  });

  it('You Deserve Peace: Daily, Every 3 days, Weekly, then Twice Daily last — only here; the Wird and Random Ayah keep three', async () => {
    await renderSettings();
    await openMenu('emotionCheckIn', 'frequency');
    expect(menuOptions('emotionCheckIn', 'frequency').map((node) => node.props.accessibilityLabel)).toEqual(['Daily', 'Every 3 days', 'Weekly', 'Twice Daily']);
    await press(part('emotionCheckIn', 'frequency'));
    for (const kind of ['wird', 'randomAyah']) {
      await openMenu(kind, 'frequency');
      expect(menuOptions(kind, 'frequency').map((node) => node.props.accessibilityLabel), kind).toEqual(['Daily', 'Every 3 days', 'Weekly']);
      await press(part(kind, 'frequency'));
    }
  });

  it('Twice Daily: two times instead of one (Morning 9:00 AM · Evening 9:00 PM), each changed on its own with the same picker, saved at once; the single time is kept', async () => {
    await renderSettings();
    const picker = () => row('emotionCheckIn').findByType('ReminderTimePicker' as never);
    await openMenu('emotionCheckIn', 'frequency');
    await press(part('emotionCheckIn', 'frequency-option-twiceDaily'));
    await flush();
    expect(parts('emotionCheckIn', 'time')).toHaveLength(0);
    expect(texts(part('emotionCheckIn', 'time-morning'))).toEqual(['Morning 9:00 AM']);
    expect(texts(part('emotionCheckIn', 'time-evening'))).toEqual(['Evening 9:00 PM']);
    expect(part('emotionCheckIn', 'frequency').props.accessibilityLabel).toBe('You Deserve Peace, Frequency, Twice Daily');
    expect(stored().emotionCheckIn).toMatchObject({ frequency: 'twiceDaily', time: '21:00', twice: { morning: '09:00', evening: '21:00' } });
    // The morning time.
    await press(part('emotionCheckIn', 'time-morning'));
    expect(picker().props).toMatchObject({ visible: true, value: { hour: 9, minute: 0 } });
    await act(async () => picker().props.onConfirm({ hour: 7, minute: 15 }));
    await flush();
    // The evening time.
    await press(part('emotionCheckIn', 'time-evening'));
    expect(picker().props).toMatchObject({ visible: true, value: { hour: 21, minute: 0 } });
    await act(async () => picker().props.onConfirm({ hour: 22, minute: 30 }));
    await flush();
    expect(stored().emotionCheckIn).toMatchObject({ frequency: 'twiceDaily', time: '21:00', twice: { morning: '07:15', evening: '22:30' } });
    expect(texts(part('emotionCheckIn', 'time-morning'))).toEqual(['Morning 7:15 AM']);
    expect(texts(part('emotionCheckIn', 'time-evening'))).toEqual(['Evening 10:30 PM']);
    // Back to Daily: the single time as it was; to Twice Daily again: both times as they were.
    await openMenu('emotionCheckIn', 'frequency');
    await press(part('emotionCheckIn', 'frequency-option-daily'));
    await flush();
    expect(texts(part('emotionCheckIn', 'time'))).toEqual(['9:00 PM']);
    await openMenu('emotionCheckIn', 'frequency');
    await press(part('emotionCheckIn', 'frequency-option-twiceDaily'));
    await flush();
    expect(texts(part('emotionCheckIn', 'time-morning'))).toEqual(['Morning 7:15 AM']);
    expect(texts(part('emotionCheckIn', 'time-evening'))).toEqual(['Evening 10:30 PM']);
    // The other reminders were never touched.
    expect(stored().wird).toEqual({ enabled: true, frequency: 'daily', time: '21:00', weekday: null, anchor: null });
  });

  it('Twice Daily: the same time as the other one is refused with a note, and nothing is saved', async () => {
    await renderSettings();
    const picker = () => row('emotionCheckIn').findByType('ReminderTimePicker' as never);
    await openMenu('emotionCheckIn', 'frequency');
    await press(part('emotionCheckIn', 'frequency-option-twiceDaily'));
    await flush();
    const before = state.storage.get(NOTIFICATIONS_KEY);
    await press(part('emotionCheckIn', 'time-morning'));
    await act(async () => picker().props.onConfirm({ hour: 21, minute: 0 }));
    await flush();
    expect(state.storage.get(NOTIFICATIONS_KEY)).toBe(before);
    expect(texts(part('emotionCheckIn', 'same-time'))).toEqual(['Choose two different times.']);
    expect(texts(part('emotionCheckIn', 'time-morning'))).toEqual(['Morning 9:00 AM']);
    // A different time clears the note and is saved.
    await press(part('emotionCheckIn', 'time-morning'));
    await act(async () => picker().props.onConfirm({ hour: 8, minute: 0 }));
    await flush();
    expect(parts('emotionCheckIn', 'same-time')).toHaveLength(0);
    expect(stored().emotionCheckIn.twice).toEqual({ morning: '08:00', evening: '21:00' });
  });

  it('Twice Daily in Arabic: مرتين يوميًا last, the two times labelled صباحًا and مساءً with Arabic-Indic digits, mirrored', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    await openMenu('emotionCheckIn', 'frequency');
    expect(menuOptions('emotionCheckIn', 'frequency').map((node) => node.props.accessibilityLabel)).toEqual(['يوميًا', 'كل ٣ أيام', 'أسبوعيًا', 'مرتين يوميًا']);
    await press(part('emotionCheckIn', 'frequency-option-twiceDaily'));
    await flush();
    expect(texts(part('emotionCheckIn', 'time-morning'))).toEqual(['صباحًا ٠٩:٠٠']);
    expect(texts(part('emotionCheckIn', 'time-evening'))).toEqual(['مساءً ٢١:٠٠']);
    const firstRow = row('emotionCheckIn').children[0] as ReactTestInstance;
    expect(resolveStyle(firstRow)).toContainEqual({ flexDirection: 'row-reverse' });
  });

  it('Arabic: the approved names, frequency words, mirrored rows and Arabic-Indic times', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    expect(texts(row('wird')).slice(0, 2)).toEqual(['تذكير الوِرد', '٢١:٠٠']);
    expect(texts(row('randomAyah'))[0]).toBe('آية من القرآن');
    expect(texts(row('emotionCheckIn'))[0]).toBe('تستحق الطمأنينة');
    expect(part('emotionCheckIn', 'frequency').props.accessibilityLabel).toBe('تستحق الطمأنينة, التكرار, يوميًا');
    await openMenu('wird', 'frequency');
    expect(menuOptions('wird', 'frequency').map((node) => node.props.accessibilityLabel)).toEqual(['يوميًا', 'كل ٣ أيام', 'أسبوعيًا']);
    const firstRow = row('wird').children[0] as ReactTestInstance;
    expect(resolveStyle(firstRow)).toContainEqual({ flexDirection: 'row-reverse' });
    expect(texts(part('wird', 'permission'))).toEqual(['يلزم السماح بالإشعارات', 'السماح بالإشعارات']);
  });

  it('narrow screens and large text: the frequency moves under the time instead of squeezing the row; no text is cut', async () => {
    state.window = { width: 320, height: 568, fontScale: 1, scale: 2 };
    await renderSettings();
    const firstRow = row('emotionCheckIn').children[0] as ReactTestInstance;
    expect(firstRow.findAll((node) => node.props.testID === 'settings-reminder-emotionCheckIn-frequency')).toHaveLength(0);
    expect(parts('emotionCheckIn', 'frequency')).toHaveLength(1);
    for (const text of row('emotionCheckIn').findAll(isType('Text'))) expect(text.props.numberOfLines).toBeUndefined();
    await act(async () => root!.unmount());
    root = undefined;
    state.window = { width: 414, height: 896, fontScale: 1.5, scale: 3 };
    await renderSettings();
    const scaledRow = row('wird').children[0] as ReactTestInstance;
    expect(scaledRow.findAll((node) => node.props.testID === 'settings-reminder-wird-frequency')).toHaveLength(0);
  });

  it.each([['light', lightPalette], ['dark', darkPalette]] as const)('%s mode: reminder cards and switches use the theme colours', async (scheme, palette) => {
    state.storage.set(APPEARANCE_KEY, JSON.stringify(scheme));
    await renderSettings();
    for (const kind of KINDS) {
      expect(Object.assign({}, ...resolveStyle(row(kind))).backgroundColor).toBe(palette.card);
      expect(part(kind, 'switch').props.trackColor).toEqual({ false: palette.border, true: palette.accentFill });
    }
  });

  it('touch targets: each control is a labelled button with room to tap', async () => {
    await renderSettings();
    for (const kind of KINDS) {
      expect(part(kind, 'time').props).toMatchObject({ accessibilityRole: 'button', hitSlop: { top: 12, bottom: 12 } });
      expect(part(kind, 'time').props.accessibilityLabel).toMatch(/Reminder time/);
      expect(resolveStyle(part(kind, 'frequency'))).toContainEqual(expect.objectContaining({ minHeight: 36 }));
    }
  });
});

describe('Settings: Show Translation (switch + dropdown)', () => {
  const part = (id: string) => root!.root.find((node) => typeof node.type === 'string' && node.props.testID === id);
  const stored = () => JSON.parse(state.storage.get(TRANSLATION_KEY) ?? 'null');
  const menuOptions = () => root!.root.findAll((node) => typeof node.type === 'string' && typeof node.props.testID === 'string' && node.props.testID.startsWith('settings-show-translation-mode-option-'));

  it('a new user: OFF, the dropdown dimmed and disabled on On Demand; nothing is written until the user changes it', async () => {
    await renderSettings();
    expect(part('settings-show-translation').props).toMatchObject({ value: false, accessibilityState: { checked: false } });
    const dropdown = part('settings-show-translation-mode');
    expect(dropdown.props).toMatchObject({ disabled: true, accessibilityLabel: 'Show Translation, Translation display, On Demand' });
    expect(resolveStyle(dropdown)).toContainEqual(expect.objectContaining({ opacity: 0.5 }));
    expect(state.storage.has(TRANSLATION_KEY)).toBe(false);
  });

  it('exactly two choices — Always and On Demand; ON applies the dropdown`s choice, the dropdown applies at once while ON, and OFF keeps it', async () => {
    await renderSettings();
    await act(async () => part('settings-show-translation').props.onValueChange(true));
    expect(stored()).toMatchObject({ displayMode: 'on-demand', enabledMode: 'on-demand' });
    expect(part('settings-show-translation-mode').props.disabled).toBe(false);
    await act(async () => part('settings-show-translation-mode').props.onPress());
    expect(menuOptions().map((node) => node.props.accessibilityLabel)).toEqual(['Always', 'On Demand']);
    await act(async () => part('settings-show-translation-mode-option-always').props.onPress());
    expect(stored()).toMatchObject({ displayMode: 'always', enabledMode: 'always' });
    await act(async () => part('settings-show-translation').props.onValueChange(false));
    expect(stored()).toMatchObject({ displayMode: 'off', enabledMode: 'always' }); // the choice is kept
    expect(part('settings-show-translation-mode').props.accessibilityLabel).toBe('Show Translation, Translation display, Always');
    await act(async () => part('settings-show-translation').props.onValueChange(true));
    expect(stored()).toMatchObject({ displayMode: 'always', enabledMode: 'always' }); // restored
  });

  it.each([
    ['always', true, 'Always'],
    ['on-demand', true, 'On Demand'],
    ['off', false, 'On Demand'],
  ] as const)('an earlier saved value %s is shown as ON=%s with %s', async (displayMode, on, label) => {
    state.storage.set(TRANSLATION_KEY, JSON.stringify({ translationId: 'en.pickthall.gutenberg16955', displayMode }));
    await renderSettings();
    expect(part('settings-show-translation').props.value).toBe(on);
    expect(part('settings-show-translation-mode').props.accessibilityLabel).toBe(`Show Translation, Translation display, ${label}`);
    expect(stored()).toEqual({ translationId: 'en.pickthall.gutenberg16955', displayMode }); // nothing rewritten on open
  });

  it('Arabic: دائمًا / عند الطلب, mirrored', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    state.storage.set(TRANSLATION_KEY, JSON.stringify({ translationId: 'en.pickthall.gutenberg16955', displayMode: 'always' }));
    await renderSettings();
    const row = part('settings-show-translation-row');
    expect(resolveStyle(row.children[0] as ReactTestInstance)).toContainEqual({ flexDirection: 'row-reverse' });
    expect(texts(row)[0]).toBe('إظهار الترجمة');
    await act(async () => part('settings-show-translation-mode').props.onPress());
    expect(menuOptions().map((node) => node.props.accessibilityLabel)).toEqual(['دائمًا', 'عند الطلب']);
  });

  it.each([['light', lightPalette], ['dark', darkPalette]] as const)('%s mode: the same card and switch colours as the reminder rows', async (scheme, palette) => {
    state.storage.set(APPEARANCE_KEY, JSON.stringify(scheme));
    await renderSettings();
    expect(Object.assign({}, ...resolveStyle(part('settings-show-translation-row'))).backgroundColor).toBe(palette.card);
    expect(part('settings-show-translation').props.trackColor).toEqual({ false: palette.border, true: palette.accentFill });
  });

  it('small screens: the dropdown moves under the text instead of squeezing the row', async () => {
    state.window = { width: 320, height: 568, fontScale: 1, scale: 2 };
    await renderSettings();
    const firstRow = part('settings-show-translation-row').children[0] as ReactTestInstance;
    expect(firstRow.findAll((node) => node.props.testID === 'settings-show-translation-mode')).toHaveLength(0);
    expect(root!.root.findAll((node) => typeof node.type === 'string' && node.props.testID === 'settings-show-translation-mode')).toHaveLength(1);
  });
});

describe('Settings: Favorite Reciter and offline listening (audio/)', () => {
  const FAVORITE_KEY = 'quran-heals:favorite-reciter:v1';
  const reciterRows = () => all('Pressable').filter((node) => /^settings-reciter-(?!download)/.test(node.props.testID ?? ''));
  const offlineCard = () => root!.root.find((node) => node.props.testID === 'settings-offline-audio' && typeof node.type === 'string');

  it('Quran → Favorite Reciter: Muhammad Siddiq Al-Minshawi by default, nothing saved', async () => {
    await renderSettings();
    expect(header('Favorite Reciter').props.accessibilityLabel).toBe('Favorite Reciter, Muhammad Siddiq Al-Minshawi');
    expect(state.storage.has(FAVORITE_KEY)).toBe(false);
  });

  it('lists exactly the offered reciters in English, in the owner\'s order, each with its availability; the current one selected', async () => {
    await renderSettings();
    await pressHeader('Favorite Reciter');
    // A release-equivalent build (tests): the owner's 17 without the development preview (Ali Abdullah Jaber).
    expect(reciterRows()).toHaveLength(16);
    const labels = reciterRows().map((node) => node.props.accessibilityLabel as string);
    expect(labels.map((label) => label.split(', ')[0])).toEqual([
      'Muhammad Siddiq Al-Minshawi', 'Mahmoud Khalil Al-Husary', 'Abdul Basit Abdus Samad', 'Mahmoud Ali Al-Banna', 'Abdul Rashid Ali Sufi',
      'Ahmed Mohamed Salama', 'Ali Al-Hudhaifi', 'Saud Al-Shuraim', 'Maher Al-Muaiqly', 'Abu Bakr Al-Shatri', 'Ahmed Al-Agamy', 'Abdullah Basfar',
      'Yasser Mahmoud Salama', 'Ahmed Naina', 'Islam Sobhi', 'Saleh Al-Talib',
    ]);
    expect(labels).toContain('Abdul Basit Abdus Samad'); // all 114 surahs: no count shown
    expect(labels).toContain('Maher Al-Muaiqly, 101 of 114 surahs');
    expect(labels).toContain('Ahmed Mohamed Salama, Ayah-by-ayah playback not available');
    expect(labels).toContain('Mahmoud Khalil Al-Husary, 103 of 114 surahs');
    for (const onHold of ['Muhammad Rifaat', 'Mohamed Gebril']) expect(labels.some((l) => l.startsWith(onHold))).toBe(false);
    expect(reciterRows().filter((node) => node.props.accessibilityState.selected).map((node) => node.props.testID)).toEqual(['settings-reciter-minshawi']);
  });

  it('a choice applies and is saved at once, and the list closes', async () => {
    await renderSettings();
    await pressHeader('Favorite Reciter');
    await press(reciterRows().find((node) => node.props.testID === 'settings-reciter-minshawi')!);
    expect(state.storage.get(FAVORITE_KEY)).toBe('minshawi');
    expect(reciterRows()).toHaveLength(0);
    expect(header('Favorite Reciter').props.accessibilityLabel).toBe('Favorite Reciter, Muhammad Siddiq Al-Minshawi');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a saved choice is restored', async () => {
    state.storage.set(FAVORITE_KEY, 'basfar');
    await renderSettings();
    expect(header('Favorite Reciter').props.accessibilityLabel).toBe('Favorite Reciter, Abdullah Basfar');
  });

  it('in Arabic: القارئ المفضل, with the reciters\' Arabic names', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    expect(header('القارئ المفضل').props.accessibilityLabel).toBe('القارئ المفضل, محمد صديق المنشاوي');
    await pressHeader('القارئ المفضل');
    // The owner's order, the same in Arabic: Al-Minshawi first.
    expect(reciterRows()[0].props.accessibilityLabel).toBe('محمد صديق المنشاوي, ١٠٧ من ١١٤ سورة');
    expect((reciterRows()[6].props.accessibilityLabel as string).split(', ')[0]).toBe('علي بن عبد الرحمن الحذيفي');
  });

  const downloadIcon = () => all('Pressable').find((node) => node.props.testID === 'settings-reciter-download')!;
  const sheetText = () => texts(root!.root.find((node) => node.props.testID === 'settings-reciter-download-sheet' && typeof node.type === 'string')).join(' | ');
  const sheetButtons = () => all('Pressable').filter((node) => /^settings-reciter-download-/.test(node.props.testID ?? '') && node.props.testID !== 'settings-reciter-download-backdrop').map((node) => node.props.testID);

  it('both icons, swapped: the download icon right beside the title and Sheikh, the dropdown chevron after it at the row`s end', async () => {
    await renderSettings();
    const row = header('Favorite Reciter').parent!.parent!;
    const order = row.findAll((node) => typeof node.type === 'string' && (node.props.testID === 'settings-reciter-download' || node.props.testID === 'settings-accordion-chevron' || node === header('Favorite Reciter'))).map((node) => node.props.testID ?? 'header');
    expect(order).toEqual(['header', 'settings-reciter-download', 'settings-accordion-chevron']);
    expect(resolveStyle(row)).toContainEqual(expect.objectContaining({ flexDirection: 'row' }));
    expect(resolveStyle(row)).not.toContainEqual({ flexDirection: 'row-reverse' });
    // One chevron (now its own button) and one download/status icon, both visible.
    const chevron = row.find((node) => node.props.testID === 'settings-accordion-chevron' && typeof node.type === 'string');
    expect(chevron.findAllByType('ChevronDown' as never)).toHaveLength(1);
    expect(header('Favorite Reciter').findAllByType('ChevronDown' as never)).toHaveLength(0);
    expect(row.findAll((node) => /^reciter-download-icon-/.test(node.props.testID ?? ''))).toHaveLength(1);
    // The chevron is not a second screen-reader button: the header already announces the section.
    expect(chevron.props).toMatchObject({ accessible: false });
    // Other sections are unchanged: the chevron inside their header button.
    expect(header('App Language').findAllByType('ChevronDown' as never)).toHaveLength(1);
  });

  it('independent touch targets: the chevron and the title open the reciter list; the download icon opens its sheet only', async () => {
    await renderSettings();
    const chevron = () => all('Pressable').find((node) => node.props.testID === 'settings-accordion-chevron')!;
    await press(chevron());
    expect(reciterRows()).toHaveLength(16);
    expect(header('Favorite Reciter').props.accessibilityState).toEqual({ expanded: true });
    await press(chevron());
    expect(reciterRows()).toHaveLength(0);
    await pressHeader('Favorite Reciter');
    expect(reciterRows()).toHaveLength(16);
    await pressHeader('Favorite Reciter');
    await press(downloadIcon());
    expect(reciterRows()).toHaveLength(0);
    expect(header('Favorite Reciter').props.accessibilityState).toEqual({ expanded: false });
    expect(sheetText()).toContain(en.audio.offlineNotPermitted); // downloads stay off
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('in Arabic the row is mirrored: the Sheikh, then the download icon to its left, then the chevron at the left end', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    const row = header('القارئ المفضل').parent!.parent!;
    expect(resolveStyle(row)).toContainEqual({ flexDirection: 'row-reverse' });
    const chevron = row.find((node) => node.props.testID === 'settings-accordion-chevron' && typeof node.type === 'string');
    // Its outer (row-end) padding is on the left in Arabic.
    const padding = Object.assign({}, ...resolveStyle(chevron)) as { paddingLeft: number; paddingRight: number };
    expect(padding.paddingLeft).toBeGreaterThan(padding.paddingRight);
  });

  it('no large download card: offline listening is one small icon beside the Favorite Reciter dropdown', async () => {
    await renderSettings();
    expect(root!.root.findAll((node) => node.props.testID === 'settings-offline-audio')).toHaveLength(0);
    const card = header('Favorite Reciter').parent!.parent!;
    expect(card.findAll((node) => node.props.testID === 'settings-reciter-download' && typeof node.type === 'string')).toHaveLength(1);
    // Beside the header button, outside it: the header still only opens and closes the section.
    expect(header('Favorite Reciter').findAll((node) => node.props.testID === 'settings-reciter-download')).toHaveLength(0);
  });

  it('downloads not permitted (licensing): the icon shows as unavailable, its sheet explains and offers no download; nothing fetched', async () => {
    await renderSettings();
    expect(downloadIcon().props.accessibilityLabel).toBe('Offline listening: Muhammad Siddiq Al-Minshawi, Offline download not available');
    expect(downloadIcon().props.accessibilityState).toMatchObject({ disabled: true });
    expect(downloadIcon().findAll((node) => node.props.testID === 'reciter-download-icon-not-permitted')).toHaveLength(1);
    expect(downloadIcon().findAll((node) => node.props.testID === 'reciter-download-icon-complete')).toHaveLength(0);
    await press(downloadIcon());
    expect(sheetText()).toContain(en.audio.offlineNotPermitted);
    expect(sheetText()).toMatch(/Download Muhammad Siddiq Al-Minshawi to listen without internet: 107 surahs, about [\d.]+ GB\./);
    expect(sheetButtons()).toEqual(['settings-reciter-download-close']); // no Download, Retry or Delete
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an incomplete reciter`s sheet shows the surahs a download would leave out', async () => {
    state.storage.set(FAVORITE_KEY, 'husary');
    await renderSettings();
    await press(downloadIcon());
    const missing = root!.root.find((node) => node.props.testID === 'settings-reciter-download-missing' && typeof node.type === 'string');
    expect(texts(missing)).toEqual(['Not included (no verified recording): Surahs 1, 21, 27–28, 31, 46–47, 49, 58, 66, 98']);
  });

  it('a reciter with nothing to download: unavailable, says so', async () => {
    state.storage.set(FAVORITE_KEY, 'islam-sobhi');
    await renderSettings();
    expect(downloadIcon().findAll((node) => node.props.testID === 'reciter-download-icon-unavailable')).toHaveLength(1);
    await press(downloadIcon());
    expect(sheetText()).toContain("Islam Sobhi has no surahs that can play ayah by ayah, so there's nothing to download.");
    expect(sheetButtons()).toEqual(['settings-reciter-download-close']);
  });

  it('follows the Favorite Reciter: a new choice shows that reciter`s state', async () => {
    await renderSettings();
    await pressHeader('Favorite Reciter');
    await press(reciterRows().find((node) => node.props.testID === 'settings-reciter-yasser-salama')!);
    expect(downloadIcon().props.accessibilityLabel).toBe('Offline listening: Yasser Mahmoud Salama, Offline download not available');
    expect(downloadIcon().findAll((node) => node.props.testID === 'reciter-download-icon-unavailable')).toHaveLength(1);
  });

  it('in Arabic, mirrored beside the dropdown', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    expect(downloadIcon().props.accessibilityLabel).toBe('الاستماع دون اتصال: محمد صديق المنشاوي, التنزيل غير متاح');
    // The header row holding the dropdown and the icon is mirrored (the icon on the left, beside the chevron).
    const ancestors: ReactTestInstance[] = [];
    for (let node = downloadIcon().parent; node; node = node.parent) if (typeof node.type === 'string') ancestors.push(node);
    const row = ancestors.find((node) => node.findAll((n) => n.props.accessibilityState && 'expanded' in n.props.accessibilityState).length > 0)!;
    expect(resolveStyle(row)).toContainEqual({ flexDirection: 'row-reverse' });
  });
});

describe('Settings: Quran → Mushaf Guide', () => {
  const row = () => all('Pressable').find((node) => node.props.testID === 'settings-mushaf-guide')!;

  it('is the last row of the Quran section, in English', async () => {
    await renderSettings();
    const quran = root!.root.find((node) => node.props.testID === 'settings-section-quran' && typeof node.type === 'string');
    const ids = quran.findAll((node) => typeof node.type === 'string' && /^settings-(offline-mushaf|mushaf-guide)$/.test(node.props.testID ?? '')).map((node) => node.props.testID);
    expect(ids).toEqual(['settings-offline-mushaf', 'settings-mushaf-guide']);
    expect(row().props).toMatchObject({ accessibilityRole: 'button', accessibilityLabel: 'Mushaf Guide' });
    // The title alone: no description under it.
    expect(texts(row())).toEqual(['Mushaf Guide']);
    // The Mushaf toolbar's Help (?) icon (lucide CircleHelp), at the other Settings icons' size and colour.
    const icon = row().findByType('CircleHelp' as never);
    expect(icon.props).toMatchObject({ size: 18, strokeWidth: 2, color: lightPalette.icon });
    expect(row().findAllByType('MushafIcon' as never)).toHaveLength(0);
    // Laid out like Keep Screen Awake: the same card.
    const keepAwakeCard = root!.root.findByProps({ testID: 'settings-keep-awake' }).parent!;
    expect(resolveStyle(row())).toContainEqual(expect.objectContaining({ minHeight: 56, borderRadius: resolveStyle(keepAwakeCard).find((style) => style.borderRadius !== undefined)?.borderRadius }));
  });

  it('opens the Mushaf`s own guide (a new request each time), changing no setting, storage or progress', async () => {
    await renderSettings();
    const before = new Map(state.storage);
    await press(row());
    await press(row());
    expect(state.navigations).toHaveLength(2);
    for (const route of state.navigations) expect(route).toMatchObject({ pathname: '/mushaf', params: { guide: expect.stringMatching(/^\d+$/) } });
    expect(state.storage).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps its (?) icon after the guide has been finished (only the Mushaf toolbar`s Help icon hides then)', async () => {
    state.storage.set('quran-heals:mushaf-guide:v1', JSON.stringify({ status: 'done', finished: true }));
    await renderSettings();
    expect(row().findAllByType('CircleHelp' as never)).toHaveLength(1);
    expect(texts(row())).toEqual(['Mushaf Guide']);
  });

  it('in Arabic: دليل المصحف, mirrored', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    expect(texts(row())).toEqual(['دليل المصحف']);
    expect(resolveStyle(row())).toContainEqual({ flexDirection: 'row-reverse' });
  });
});
