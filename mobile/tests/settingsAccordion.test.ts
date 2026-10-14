import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { darkPalette, lightPalette } from '@/constants/theme';
import { MESSAGES } from '@/localization/messages';

/**
 * The Settings accordion: App, Emotions and Quran Language, Appearance,
 * Legal & Privacy — rendered with the real locale / emotions / translation / appearance providers over an in-memory AsyncStorage, so a
 * selection is proven to go through the existing persisted preference
 * setters — not a parallel implementation.
 */
const LEGAL_SITE = 'https://quranheals.github.io/legal/';

const state = vi.hoisted(() => ({
  scheme: 'light' as 'light' | 'dark',
  storage: new Map<string, string>(),
  openURL: (_url: string) => Promise.resolve(),
  openedUrls: [] as string[],
  layoutAnimations: 0,
  refreshSyncCalls: 0,
}));

vi.mock('react-native', () => {
  class AnimatedValue {
    constructor(public value: number) {}
    interpolate() { return `${this.value}deg`; }
  }
  return {
    useColorScheme: () => state.scheme,
    Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
    StyleSheet: { create: (value: unknown) => value },
    Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', RefreshControl: 'RefreshControl',
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
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Check: 'Check',
  ChevronDown: 'ChevronDown', ChevronLeft: 'ChevronLeft', ChevronRight: 'ChevronRight', Flag: 'Flag',
}));
vi.mock('expo-router', () => ({ router: { back: () => undefined } }));
// Rendered for real in reportIssueSheet.test.ts and feedbackReporting.test.ts; here only how Settings opens it matters.
vi.mock('@/components/ReportIssueSheet', async () => {
  const { createElement: h } = await import('react');
  return { ReportIssueSheet: (props: object) => h('ReportIssueSheet', props) };
});
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ refreshSync: async () => { state.refreshSyncCalls += 1; } }) }));
// Rendered for real in accountSectionRender.test.ts; here only its position matters.
vi.mock('@/components/AccountSection', async () => {
  const { createElement: h } = await import('react');
  return { AccountSection: (props: object) => h('AccountSection', props) };
});

import SettingsScreen from '@/app/settings';
import { AppLocaleProvider } from '@/localization/useAppLocale';
import { EmotionsLanguageProvider } from '@/localization/useEmotionsLanguage';
import { QuranTranslationPreferenceProvider } from '@/localization/useQuranTranslationPreference';
import { AppearancePreferenceProvider } from '@/theme/useAppearancePreference';

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
  state.openURL = () => Promise.resolve();
  state.openedUrls = [];
  state.layoutAnimations = 0;
  state.refreshSyncCalls = 0;
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
          createElement(AppearancePreferenceProvider, null, children))));
  await act(async () => { root = create(tree(createElement(SettingsScreen))); });
}

const isType = (type: string) => (node: ReactTestInstance) => node.type === (type as never);
const all = (type: string) => root!.root.findAll(isType(type));

/** Accordion headers, in screen order. */
function headers() {
  return all('Pressable').filter((node) => node.props.accessibilityState && 'expanded' in node.props.accessibilityState);
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

const EN_HEADERS = ['App Language', 'Emotions Language', 'Quran Language', 'Appearance', 'Legal & Privacy'];
const AR_HEADERS = ['لغة التطبيق', 'لغة المشاعر', 'لغة القرآن', 'المظهر', 'السياسات والشروط'];

describe('Settings: section order and initial state', () => {
  it('exactly three language settings — App, Emotions, Quran — then Appearance, Legal & Privacy and the Account section; no Quran Translation row', async () => {
    await renderSettings();
    const order = root!.root
      .findAll((node) => node.type === ('AccountSection' as never) || headers().includes(node))
      .map((node) => (node.type === ('AccountSection' as never) ? 'Account' : node.props.accessibilityLabel.split(', ')[0]));
    expect(order).toEqual([...EN_HEADERS, 'Account']);
    expect(texts()).not.toContain(en.settings.quranTranslationSection);
    expect(en.settings.legalSection).toBe('Legal & Privacy');
  });

  it('starts with every section collapsed and no option or legal rows rendered', async () => {
    await renderSettings();
    expect(expandedStates()).toEqual([false, false, false, false, false]);
    expect(optionRows()).toHaveLength(0);
    expect(linkRows()).toHaveLength(0);
  });

  it('shows each current selection under its collapsed heading, and nothing under Legal & Privacy', async () => {
    await renderSettings();
    expect(headers().map((node) => node.props.accessibilityLabel)).toEqual([
      'App Language, English',
      'Emotions Language, Follow App Language',
      'Quran Language, The Quranic Text',
      'Appearance, Light',
      'Legal & Privacy',
    ]);
    expect(texts(header('Legal & Privacy'))).toEqual(['Legal & Privacy']);
  });
});

describe('Settings: accordion behavior', () => {
  it('tapping a header expands it and tapping it again collapses it', async () => {
    await renderSettings();
    await pressHeader('App Language');
    expect(expandedStates()).toEqual([true, false, false, false, false]);
    // Exactly English and Arabic: Egyptian Arabic is an Emotions Language only.
    expect(optionRows().map((node) => node.props.accessibilityLabel)).toEqual(['English', 'العربية']);
    await pressHeader('App Language');
    expect(expandedStates()).toEqual([false, false, false, false, false]);
    expect(optionRows()).toHaveLength(0);
  });

  it('opening another section closes the previously open one', async () => {
    await renderSettings();
    await pressHeader('App Language');
    await pressHeader('Appearance');
    expect(expandedStates()).toEqual([false, false, false, true, false]);
    await pressHeader('Legal & Privacy');
    expect(expandedStates()).toEqual([false, false, false, false, true]);
    expect(optionRows()).toHaveLength(0);
  });

  it('animates opening and closing, and never touches storage, sync, or the network', async () => {
    await renderSettings();
    const before = new Map(state.storage);
    for (const title of [...EN_HEADERS, 'Legal & Privacy']) await pressHeader(title);
    expect(state.layoutAnimations).toBe(6);
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
    expect(expandedStates()).toEqual([false, false, false, false, false]);
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

describe('Settings: Quran Language', () => {
  it('exactly one option today — The Quranic Text / النص القرآني — stored as a stable id, never a label; no unreleased languages', async () => {
    await renderSettings();
    await pressHeader('Quran Language');
    expect(optionRows().map((node) => [node.props.accessibilityLabel, node.props.accessibilityState.selected])).toEqual([['The Quranic Text', true]]);
    expect(ar.settings.quranTextOption).toBe('النص القرآني');
    for (const unreleased of ['Turkish', 'French', 'Urdu', 'Coming soon']) expect(texts(root!.root)).not.toContain(unreleased);
    await pressOption('The Quranic Text');
    expect(state.storage.get(QURAN_LANGUAGE_KEY)).toBe('quran-text');
    expect(expandedStates()).toEqual([false, false, false, false, false]);
  });

  it('Arabic: لغة القرآن / النص القرآني, and the choice is kept after a restart', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    state.storage.set(QURAN_LANGUAGE_KEY, 'quran-text');
    await renderSettings();
    expect(header('لغة القرآن').props.accessibilityLabel).toBe('لغة القرآن, النص القرآني');
    // An unknown stored mode (e.g. from a future version) falls back to the Arabic Mushaf.
    await act(async () => root!.unmount());
    root = undefined;
    state.storage.set(QURAN_LANGUAGE_KEY, 'turkish');
    await renderSettings();
    expect(header('لغة القرآن').props.accessibilityLabel).toBe('لغة القرآن, النص القرآني');
  });
});

describe('Settings: Appearance', () => {
  it('persists the unchanged internal value, updates the summary, and collapses', async () => {
    await renderSettings();
    await pressHeader('Appearance');
    expect(optionRows().map((node) => node.props.accessibilityLabel)).toEqual(['Auto', 'Light', 'Dark']);
    await pressOption('Dark');
    expect(JSON.parse(state.storage.get(APPEARANCE_KEY)!)).toBe('dark');
    expect(header('Appearance').props.accessibilityLabel).toBe('Appearance, Dark');
    expect(expandedStates()).toEqual([false, false, false, false, false]);
    await pressHeader('Appearance');
    await pressOption('Auto');
    expect(JSON.parse(state.storage.get(APPEARANCE_KEY)!)).toBe('system');
  });

  it('re-selecting the current option still collapses the section', async () => {
    await renderSettings();
    await pressHeader('Appearance');
    await pressOption('Light');
    expect(expandedStates()).toEqual([false, false, false, false, false]);
  });

  it('saved choices are shown after a restart', async () => {
    state.storage.set(APPEARANCE_KEY, JSON.stringify('dark'));
    await renderSettings();
    expect(header('Appearance').props.accessibilityLabel).toBe('Appearance, Dark');
  });
});

describe('Settings: Arabic labels', () => {
  it('Appearance reads تلقائي / وضع النهار / وضع الليل, collapsed and expanded', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    expect(header('المظهر').props.accessibilityLabel).toBe('المظهر, وضع النهار');
    expect(texts(header('المظهر'))).toEqual(['المظهر', 'وضع النهار']);
    await pressHeader('المظهر');
    expect(optionRows().map((node) => node.props.accessibilityLabel)).toEqual(['تلقائي', 'وضع النهار', 'وضع الليل']);
    await pressOption('وضع الليل');
    expect(texts(header('المظهر'))).toEqual(['المظهر', 'وضع الليل']);
  });

  it('the sections in Arabic; Legal & Privacy opens the Arabic pages', async () => {
    state.storage.set(LOCALE_KEY, 'ar');
    await renderSettings();
    expect(headers().map((node) => texts(node)[0])).toEqual(AR_HEADERS);
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

  it('uses the light palette card for every accordion in Light', async () => {
    await renderSettings();
    expect(cardBackgrounds()).toEqual(Array(5).fill(lightPalette.card));
  });

  it('uses the dark palette card for every accordion in Dark, including expanded and selected rows', async () => {
    state.storage.set(APPEARANCE_KEY, JSON.stringify('dark'));
    await renderSettings();
    expect(cardBackgrounds()).toEqual(Array(5).fill(darkPalette.card));
    await pressHeader('Emotions Language');
    const selected = optionRows().find((node) => node.props.accessibilityState.selected)!;
    expect(resolveStyle(selected)).toContainEqual(expect.objectContaining({ backgroundColor: darkPalette.accentSoft }));
  });

  it('Auto follows the device appearance', async () => {
    state.storage.set(APPEARANCE_KEY, JSON.stringify('system'));
    state.scheme = 'dark';
    await renderSettings();
    expect(cardBackgrounds()).toEqual(Array(5).fill(darkPalette.card));
    expect(header('Appearance').props.accessibilityLabel).toBe('Appearance, Auto');
  });
});

describe('Settings: accessibility', () => {
  it('every header is a button announcing its expanded state and current selection', async () => {
    await renderSettings();
    for (const node of headers()) {
      expect(node.props.accessibilityRole).toBe('button');
      expect(node.props.accessibilityLabel).toBeTruthy();
    }
    await pressHeader('Quran Language');
    expect(header('Quran Language').props.accessibilityState).toEqual({ expanded: true });
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

  it('one row after the five sections and before Account, outside the accordion (the sections are unchanged)', async () => {
    await renderSettings();
    const order = root!.root
      .findAll((node) => node.type === ('AccountSection' as never) || headers().includes(node) || node.props?.testID === 'settings-report-issue')
      .filter((node) => typeof node.type === 'string')
      .map((node) => (node.type === ('AccountSection' as never) ? 'Account' : node.props.testID === 'settings-report-issue' ? 'Report' : node.props.accessibilityLabel.split(', ')[0]));
    expect(order).toEqual([...EN_HEADERS, 'Report', 'Account']);
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
