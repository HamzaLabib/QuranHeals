import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { darkPalette, lightPalette } from '@/constants/theme';
import { MESSAGES } from '@/localization/messages';

/**
 * The Settings accordion redesign, rendered with the real locale /
 * translation / appearance providers over an in-memory AsyncStorage, so a
 * selection is proven to go through the existing persisted preference
 * setters — not a parallel implementation.
 *
 * Legal URLs are read when settings.tsx is first imported, so this build is
 * configured before any import: Privacy Policy and Terms valid, the
 * account-deletion page missing — covering both an opening row and a
 * safely disabled one.
 */
const legal = vi.hoisted(() => {
  const urls = { privacy: 'https://quranheals.example.org/privacy', terms: 'https://quranheals.example.org/terms' };
  const previous = {
    EXPO_PUBLIC_PRIVACY_POLICY_URL: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
    EXPO_PUBLIC_TERMS_URL: process.env.EXPO_PUBLIC_TERMS_URL,
    EXPO_PUBLIC_ACCOUNT_DELETION_URL: process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL,
  };
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL = urls.privacy;
  process.env.EXPO_PUBLIC_TERMS_URL = urls.terms;
  delete process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL;
  return { urls, previous };
});

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
  ChevronDown: 'ChevronDown', ChevronLeft: 'ChevronLeft', ChevronRight: 'ChevronRight',
}));
vi.mock('expo-router', () => ({ router: { back: () => undefined } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ refreshSync: async () => { state.refreshSyncCalls += 1; } }) }));
// Rendered for real in accountSectionRender.test.ts; here only its position matters.
vi.mock('@/components/AccountSection', async () => {
  const { createElement: h } = await import('react');
  return { AccountSection: (props: object) => h('AccountSection', props) };
});

import SettingsScreen from '@/app/settings';
import { AppLocaleProvider } from '@/localization/useAppLocale';
import { QuranTranslationPreferenceProvider } from '@/localization/useQuranTranslationPreference';
import { AppearancePreferenceProvider } from '@/theme/useAppearancePreference';

const LOCALE_KEY = 'quran-heals:app-locale:v1';
const TRANSLATION_KEY = 'quran-heals:quran-translation-preference:v1';
const APPEARANCE_KEY = 'quran-heals:appearance-preference:v1';

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
afterAll(() => {
  for (const [name, value] of Object.entries(legal.previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function renderSettings() {
  const tree = (children: ReactNode) =>
    createElement(AppLocaleProvider, null,
      createElement(QuranTranslationPreferenceProvider, null,
        createElement(AppearancePreferenceProvider, null, children)));
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

describe('Settings: section order and initial state', () => {
  it('shows Languages, Quran Translation, Appearance, Legal & Privacy, then the Account section (which owns the Danger Zone)', async () => {
    await renderSettings();
    const order = root!.root
      .findAll((node) => node.type === ('AccountSection' as never) || headers().includes(node))
      .map((node) => (node.type === ('AccountSection' as never) ? 'Account' : node.props.accessibilityLabel.split(', ')[0]));
    expect(order).toEqual([en.settings.appLanguageSection, en.settings.quranTranslationSection, en.appearance.sectionLabel, en.settings.legalSection, 'Account']);
    expect(en.settings.appLanguageSection).toBe('Languages');
    expect(en.settings.legalSection).toBe('Legal & Privacy');
  });

  it('starts with all four sections collapsed and no option or legal rows rendered', async () => {
    await renderSettings();
    expect(expandedStates()).toEqual([false, false, false, false]);
    expect(optionRows()).toHaveLength(0);
    expect(linkRows()).toHaveLength(0);
  });

  it('shows each current selection under its collapsed heading, and nothing under Legal & Privacy', async () => {
    await renderSettings();
    expect(headers().map((node) => node.props.accessibilityLabel)).toEqual([
      'Languages, English',
      `Quran Translation, ${en.settings.translationDisplayAlways}`,
      'Appearance, Light',
      'Legal & Privacy',
    ]);
    expect(texts(header('Legal & Privacy'))).toEqual(['Legal & Privacy']);
  });
});

describe('Settings: accordion behavior', () => {
  it('tapping a header expands it and tapping it again collapses it', async () => {
    await renderSettings();
    await pressHeader('Languages');
    expect(expandedStates()).toEqual([true, false, false, false]);
    expect(optionRows().map((node) => node.props.accessibilityLabel)).toEqual(['English', 'العربية', 'العربية المصرية']);
    await pressHeader('Languages');
    expect(expandedStates()).toEqual([false, false, false, false]);
    expect(optionRows()).toHaveLength(0);
  });

  it('opening another section closes the previously open one', async () => {
    await renderSettings();
    await pressHeader('Languages');
    await pressHeader('Appearance');
    expect(expandedStates()).toEqual([false, false, true, false]);
    await pressHeader('Legal & Privacy');
    expect(expandedStates()).toEqual([false, false, false, true]);
    expect(optionRows()).toHaveLength(0);
  });

  it('animates opening and closing, and never touches storage, sync, or the network', async () => {
    await renderSettings();
    const before = new Map(state.storage);
    for (const title of ['Languages', 'Quran Translation', 'Appearance', 'Legal & Privacy', 'Legal & Privacy']) await pressHeader(title);
    expect(state.layoutAnimations).toBe(5);
    expect(state.storage).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.refreshSyncCalls).toBe(0);
  });
});

describe('Settings: selecting an option', () => {
  it('Languages: applies the locale immediately, persists it, switches to RTL, and collapses', async () => {
    await renderSettings();
    await pressHeader('Languages');
    await pressOption('العربية');

    expect(state.storage.get(LOCALE_KEY)).toBe('ar');
    expect(expandedStates()).toEqual([false, false, false, false]);
    const languageHeader = header(ar.settings.appLanguageSection);
    expect(languageHeader.props.accessibilityLabel).toBe('لغة التطبيق, العربية');
    expect(resolveStyle(languageHeader)).toContainEqual({ flexDirection: 'row-reverse' });
    const title = languageHeader.findAll(isType('Text'))[0];
    expect(title.props.style).toContainEqual({ writingDirection: 'rtl', textAlign: 'right' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Languages: switching back to English restores LTR', async () => {
    state.storage.set(LOCALE_KEY, 'ar-EG');
    await renderSettings();
    expect(header(ar.settings.appLanguageSection).props.accessibilityLabel).toBe('لغة التطبيق, العربية المصرية');
    await pressHeader(ar.settings.appLanguageSection);
    await pressOption('English');
    expect(state.storage.get(LOCALE_KEY)).toBe('en');
    expect(resolveStyle(header('Languages'))).not.toContainEqual({ flexDirection: 'row-reverse' });
  });

  it('Quran Translation: keeps every option description, persists the mode, updates the summary, and collapses', async () => {
    await renderSettings();
    await pressHeader('Quran Translation');
    for (const hint of [en.settings.translationDisplayAlwaysHint, en.settings.translationDisplayOnDemandHint, en.settings.translationDisplayOffHint]) {
      expect(texts()).toContain(hint);
    }
    expect(optionRows().find((node) => node.props.accessibilityState.selected)!.props.accessibilityLabel).toBe(en.settings.translationDisplayAlways);

    await pressOption(en.settings.translationDisplayOff);
    expect(JSON.parse(state.storage.get(TRANSLATION_KEY)!)).toMatchObject({ displayMode: 'off' });
    expect(header('Quran Translation').props.accessibilityLabel).toBe(`Quran Translation, ${en.settings.translationDisplayOff}`);
    expect(expandedStates()).toEqual([false, false, false, false]);
  });

  it('Appearance: persists the unchanged internal value, updates the summary, and collapses', async () => {
    await renderSettings();
    await pressHeader('Appearance');
    expect(optionRows().map((node) => node.props.accessibilityLabel)).toEqual(['Auto', 'Light', 'Dark']);
    await pressOption('Dark');
    expect(JSON.parse(state.storage.get(APPEARANCE_KEY)!)).toBe('dark');
    expect(header('Appearance').props.accessibilityLabel).toBe('Appearance, Dark');
    expect(expandedStates()).toEqual([false, false, false, false]);

    await pressHeader('Appearance');
    await pressOption('Auto');
    expect(JSON.parse(state.storage.get(APPEARANCE_KEY)!)).toBe('system');
  });

  it('re-selecting the current option still collapses the section', async () => {
    await renderSettings();
    await pressHeader('Appearance');
    await pressOption('Light');
    expect(expandedStates()).toEqual([false, false, false, false]);
  });

  it('saved choices are shown after a restart', async () => {
    state.storage.set(TRANSLATION_KEY, JSON.stringify({ translationId: 20, displayMode: 'on-demand' }));
    state.storage.set(APPEARANCE_KEY, JSON.stringify('dark'));
    await renderSettings();
    expect(header('Quran Translation').props.accessibilityLabel).toBe(`Quran Translation, ${en.settings.translationDisplayOnDemand}`);
    expect(header('Appearance').props.accessibilityLabel).toBe('Appearance, Dark');
  });
});

describe('Settings: Arabic labels', () => {
  it.each(['ar', 'ar-EG'] as const)('%s: Appearance reads تلقائي / وضع النهار / وضع الليل, collapsed and expanded', async (locale) => {
    state.storage.set(LOCALE_KEY, locale);
    await renderSettings();
    expect(header('المظهر').props.accessibilityLabel).toBe('المظهر, وضع النهار');
    expect(texts(header('المظهر'))).toEqual(['المظهر', 'وضع النهار']);
    await pressHeader('المظهر');
    expect(optionRows().map((node) => node.props.accessibilityLabel)).toEqual(['تلقائي', 'وضع النهار', 'وضع الليل']);
    await pressOption('وضع الليل');
    expect(texts(header('المظهر'))).toEqual(['المظهر', 'وضع الليل']);
  });

  it.each(['ar', 'ar-EG'] as const)('%s: Legal & Privacy is titled الخصوصية والشروط with the three approved rows', async (locale) => {
    state.storage.set(LOCALE_KEY, locale);
    await renderSettings();
    expect(headers().map((node) => texts(node)[0])).toEqual(['لغة التطبيق', 'ترجمة القرآن', 'المظهر', 'الخصوصية والشروط']);
    await pressHeader('الخصوصية والشروط');
    expect(linkRows().map((node) => node.props.accessibilityLabel)).toEqual(['سياسة الخصوصية', 'شروط الاستخدام', 'حذف الحساب والبيانات']);
    for (const row of linkRows()) expect(resolveStyle(row)).toContainEqual({ flexDirection: 'row-reverse' });
    expect(linkRows()[0].findByType('ChevronLeft' as never)).toBeTruthy();
  });
});

describe('Settings: Legal & Privacy links', () => {
  it('lists Privacy Policy, Terms of Service, and Account & Data Deletion as links', async () => {
    await renderSettings();
    await pressHeader('Legal & Privacy');
    expect(linkRows().map((node) => node.props.accessibilityLabel)).toEqual(['Privacy Policy', 'Terms of Service', 'Account & Data Deletion']);
    expect(linkRows()[0].findByType('ChevronRight' as never)).toBeTruthy();
  });

  it('opens each configured page in the browser', async () => {
    await renderSettings();
    await pressHeader('Legal & Privacy');
    await press(linkRows()[0]);
    await press(linkRows()[1]);
    expect(state.openedUrls).toEqual([legal.urls.privacy, legal.urls.terms]);
    expect(linkRows()[0].props.accessibilityHint).toBe(en.settings.opensInBrowser);
  });

  it('disables a row whose page URL is not configured, says so, and opens nothing', async () => {
    await renderSettings();
    await pressHeader('Legal & Privacy');
    const deletionRow = linkRows()[2];
    expect(deletionRow.props.disabled).toBe(true);
    expect(deletionRow.props.onPress).toBeUndefined();
    expect(deletionRow.props.accessibilityState).toEqual({ disabled: true });
    expect(texts(deletionRow)).toEqual(['Account & Data Deletion', en.settings.legalUnavailable]);
    expect(deletionRow.findAllByType('ChevronRight' as never)).toHaveLength(0);
    expect(state.openedUrls).toEqual([]);
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
    expect(cardBackgrounds()).toEqual(Array(4).fill(lightPalette.card));
  });

  it('uses the dark palette card for every accordion in Dark, including expanded and selected rows', async () => {
    state.storage.set(APPEARANCE_KEY, JSON.stringify('dark'));
    await renderSettings();
    expect(cardBackgrounds()).toEqual(Array(4).fill(darkPalette.card));
    await pressHeader('Appearance');
    const selected = optionRows().find((node) => node.props.accessibilityState.selected)!;
    expect(resolveStyle(selected)).toContainEqual(expect.objectContaining({ backgroundColor: darkPalette.accentSoft }));
  });

  it('Auto follows the device appearance', async () => {
    state.storage.set(APPEARANCE_KEY, JSON.stringify('system'));
    state.scheme = 'dark';
    await renderSettings();
    expect(cardBackgrounds()).toEqual(Array(4).fill(darkPalette.card));
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
    await pressHeader('Quran Translation');
    expect(header('Quran Translation').props.accessibilityState).toEqual({ expanded: true });
  });

  it('options announce which one is selected', async () => {
    await renderSettings();
    await pressHeader('Languages');
    expect(optionRows().map((node) => [node.props.accessibilityRole, node.props.accessibilityState.selected])).toEqual([
      ['button', true], ['button', false], ['button', false],
    ]);
  });

  it('headers and rows keep a 56pt minimum touch target with no fixed height that could clip large text', async () => {
    await renderSettings();
    await pressHeader('Quran Translation');
    for (const node of [...headers(), ...optionRows()]) {
      const styles = resolveStyle(node);
      expect(styles).toContainEqual(expect.objectContaining({ minHeight: 56 }));
      expect(styles.some((style) => style.height !== undefined || style.maxHeight !== undefined)).toBe(false);
    }
    for (const text of all('Text')) expect(text.props.numberOfLines).toBeUndefined();
  });
});
