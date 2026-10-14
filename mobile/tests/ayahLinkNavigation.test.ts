/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@/localization/messages';

/**
 * A shared ayah link opens the existing ayah screen (the real route file +
 * the real AyahExperience) at exactly that ayah — and nothing else changes:
 * same Share | Add Reflection | Favorite actions, nothing opened
 * automatically, no sign-in. Data/service boundaries and child components
 * are mocked.
 */

const state = vi.hoisted(() => ({
  params: {} as Record<string, unknown>,
  getAyah: vi.fn(),
  getRandomAyah: vi.fn(),
  getRandomVerseKey: vi.fn(),
  excluded: [] as string[],
  recordShownAyah: vi.fn(),
  back: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value },
  Pressable: 'Pressable', RefreshControl: 'RefreshControl', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('lucide-react-native', () => ({ ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Flag: 'Flag', RefreshCw: 'RefreshCw', Share2: 'Share2' }));
vi.mock('expo-router', () => ({ router: { back: state.back }, useLocalSearchParams: () => state.params }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) } }));
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette, useThemedStyles: (factory: (colors: unknown) => unknown) => factory(lightPalette) };
});
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: 'en', messages: MESSAGES.en }) }));
vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ refreshSync: vi.fn(async () => undefined) }) }));
vi.mock('@/hooks/useFavorites', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn(), error: null, refreshFavorites: vi.fn(async () => undefined) }),
}));
vi.mock('@/services/api', () => ({
  getAyah: state.getAyah,
  getRandomAyah: state.getRandomAyah,
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock('@/services/quran', () => ({ getRandomVerseKey: state.getRandomVerseKey }));
vi.mock('@/services/retry', () => ({ withRetry: (task: () => Promise<unknown>) => task() }));
vi.mock('@/storage/recentAyahHistory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/storage/recentAyahHistory')>()),
  getExcludedVerseKeys: vi.fn(async () => state.excluded),
  recordShownAyah: state.recordShownAyah,
}));
vi.mock('@/components/AyahCard', () => ({ AyahCard: 'AyahCard' }));
vi.mock('@/components/AyahConnectionAccordion', () => ({ AyahConnectionAccordion: 'AyahConnectionAccordion' }));
vi.mock('@/components/FavoriteButton', () => ({ FavoriteButton: 'FavoriteButton' }));
vi.mock('@/components/ReflectionSheet', () => ({ ReflectionSheet: 'ReflectionSheet' }));
vi.mock('@/components/ReportIssueSheet', () => ({ ReportIssueSheet: 'ReportIssueSheet' }));
vi.mock('@/components/ShareAyahSheet', () => ({ ShareAyahSheet: 'ShareAyahSheet' }));
vi.mock('@/components/StateView', () => ({ StateView: 'StateView' }));

const { default: LinkedAyahScreen } = await import('@/app/ayah/[surah]/[ayah]');
const { default: EmotionAyahScreen } = await import('@/app/ayah/[emotion]');
const { default: GeneralQuranAyahScreen } = await import('@/app/ayah/general');
const { GENERAL_QURAN_HISTORY_KEY } = await import('@/storage/recentAyahHistory');

const ayahFor = (verseKey: string) => {
  const [surah, ayah] = verseKey.split(':').map(Number);
  return {
    id: `id-${verseKey}`, verseKey, referenceKey: verseKey, surahNumber: surah, ayahNumber: ayah, surahNameArabic: '', surahNameEnglish: '',
    arabicText: `arabic ${verseKey}`, englishTranslation: 'translation', emotions: [], quranTextSource: 'Tanzil', translationSource: 'Pickthall',
  };
};

let root: ReactTestRenderer;
const shownAyah = () => root.root.findAllByType('AyahCard' as never)[0]?.props.ayah?.verseKey as string | undefined;
const button = (label: string) => root.root.findAllByType('Pressable' as never).find((node) => node.props.accessibilityLabel === label);
const stateViews = () => root.root.findAllByType('StateView' as never);
const flush = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };

async function render(component: () => unknown, params: Record<string, unknown>) {
  state.params = params;
  await act(async () => { root = create(createElement(component as never)); });
  await flush();
}
async function navigateTo(params: Record<string, unknown>, component: () => unknown = LinkedAyahScreen) {
  state.params = params;
  await act(async () => root.update(createElement(component as never)));
  await flush();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.getAyah.mockReset().mockImplementation(async (verseKey: string) => ayahFor(verseKey));
  state.getRandomAyah.mockReset().mockImplementation(async () => ayahFor('2:153'));
  state.getRandomVerseKey.mockReset().mockResolvedValue('3:139');
  state.recordShownAyah.mockReset().mockResolvedValue(undefined);
  state.excluded = [];
  state.back.mockReset();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('opening a shared ayah link', () => {
  it('/ayah/94/5 shows exactly 94:5 on the existing ayah screen, with no random pick', async () => {
    await render(LinkedAyahScreen, { surah: '94', ayah: '5' });
    expect(state.getAyah).toHaveBeenCalledWith('94:5');
    expect(state.getRandomVerseKey).not.toHaveBeenCalled();
    expect(state.getRandomAyah).not.toHaveBeenCalled();
    expect(shownAyah()).toBe('94:5');
  });

  it('keeps the usual Share | Add Reflection | Favorite actions and opens nothing by itself', async () => {
    await render(LinkedAyahScreen, { surah: '94', ayah: '5' });
    expect(button(MESSAGES.en.ayah.shareAyah)).toBeDefined();
    expect(button(MESSAGES.en.reflection.writeAction)).toBeDefined();
    expect(root.root.findAllByType('FavoriteButton' as never)).toHaveLength(1);
    expect(root.root.findByType('ReflectionSheet' as never).props.visible).toBe(false);
    expect(root.root.findByType('ShareAyahSheet' as never).props.visible).toBe(false);
    // Add Reflection still opens the existing sheet for this ayah, only when tapped.
    await act(async () => button(MESSAGES.en.reflection.writeAction)!.props.onPress());
    expect(root.root.findByType('ReflectionSheet' as never).props).toMatchObject({ visible: true, verseKey: '94:5' });
  });

  it('is a general-flow screen: app name in the header, general history, no emotion in issue reports', async () => {
    await render(LinkedAyahScreen, { surah: '94', ayah: '5' });
    expect(root.root.findAllByType('Text' as never).map((node) => node.props.children)).toContain(MESSAGES.en.appName);
    expect(state.recordShownAyah).toHaveBeenCalledWith(GENERAL_QURAN_HISTORY_KEY, expect.objectContaining({ verseKey: '94:5' }));
    expect(root.root.findByType('ReportIssueSheet' as never).props.context.emotionKey).toBeUndefined();
  });

  it('shows the linked ayah even when it is in recent history (never swapped for another)', async () => {
    state.excluded = ['94:5', '1:1'];
    await render(LinkedAyahScreen, { surah: '94', ayah: '5' });
    expect(shownAyah()).toBe('94:5');
    expect(state.getAyah).toHaveBeenCalledTimes(1);
  });

  it('"Another ayah" then continues as the general Quran flow', async () => {
    await render(LinkedAyahScreen, { surah: '94', ayah: '5' });
    await act(async () => { await button(MESSAGES.en.ayah.loadAnotherAyah)!.props.onPress(); });
    expect(state.getRandomVerseKey).toHaveBeenCalledTimes(1);
    expect(shownAyah()).toBe('3:139');
  });

  it('a failed load retries the same linked ayah', async () => {
    state.getAyah.mockRejectedValueOnce(new Error('offline'));
    await render(LinkedAyahScreen, { surah: '94', ayah: '5' });
    expect(shownAyah()).toBeUndefined();
    await act(async () => { await stateViews().find((view) => view.props.onAction)!.props.onAction(); });
    expect(state.getAyah).toHaveBeenLastCalledWith('94:5');
    expect(shownAyah()).toBe('94:5');
    expect(state.getRandomVerseKey).not.toHaveBeenCalled();
  });
});

describe('links arriving while the app is open', () => {
  it('a different link loads that ayah on the same screen', async () => {
    await render(LinkedAyahScreen, { surah: '94', ayah: '5' });
    await navigateTo({ surah: '2', ayah: '255' });
    expect(shownAyah()).toBe('2:255');
    expect(state.getRandomVerseKey).not.toHaveBeenCalled();
  });

  it('a second link that arrives while the first ayah is still loading is not lost', async () => {
    let finishFirst!: () => void;
    state.getAyah.mockImplementationOnce((verseKey: string) => new Promise((done) => { finishFirst = () => done(ayahFor(verseKey)); }));
    await render(LinkedAyahScreen, { surah: '94', ayah: '5' });
    await navigateTo({ surah: '2', ayah: '255' });
    await act(async () => finishFirst());
    await flush();
    expect(state.getAyah).toHaveBeenLastCalledWith('2:255');
    expect(shownAyah()).toBe('2:255');
  });

  it('opening the same link again does not reload or duplicate anything', async () => {
    await render(LinkedAyahScreen, { surah: '94', ayah: '5' });
    await navigateTo({ surah: '94', ayah: '5' });
    expect(state.getAyah).toHaveBeenCalledTimes(1);
  });
});

describe('invalid links', () => {
  it.each([
    ['94', '9'], // 94 has 8 ayahs
    ['115', '1'],
    ['0', '1'],
    ['2', '0'],
    ['02', '5'],
    ['abc', '1'],
    [['94', '5'], '5'],
    [undefined, undefined],
  ])('surah %j ayah %j → a clear message, nothing loaded', async (surah, ayah) => {
    await render(LinkedAyahScreen, { surah, ayah });
    expect(state.getAyah).not.toHaveBeenCalled();
    expect(state.getRandomVerseKey).not.toHaveBeenCalled();
    expect(shownAyah()).toBeUndefined();
    expect(stateViews().map((view) => view.props.message)).toContain(MESSAGES.en.ayah.invalidLink);
    // The back button still works.
    await act(async () => button(MESSAGES.en.ayah.goBack)!.props.onPress());
    expect(state.back).toHaveBeenCalledTimes(1);
  });
});

describe('the other flows are unchanged', () => {
  it('emotion mode still loads through its approved mapping', async () => {
    await render(EmotionAyahScreen, { emotion: 'sad' });
    expect(state.getRandomAyah).toHaveBeenCalledWith('sad', []);
    expect(state.getAyah).not.toHaveBeenCalled();
    expect(shownAyah()).toBe('2:153');
  });

  it('general mode still picks a random ayah', async () => {
    await render(GeneralQuranAyahScreen, {});
    expect(state.getRandomVerseKey).toHaveBeenCalledTimes(1);
    expect(shownAyah()).toBe('3:139');
  });
});

describe('cold starts and routing', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf-8');

  it('the link path maps to the route file, next to (not replacing) the existing ayah routes', () => {
    for (const route of ['src/app/ayah/[surah]/[ayah].tsx', 'src/app/ayah/[emotion].tsx', 'src/app/ayah/general.tsx']) {
      expect(existsSync(resolve(__dirname, '..', route)), route).toBe(true);
    }
    expect(read('src/app/ayah/[surah]/[ayah].tsx')).toMatch(/<AyahExperience source=\{source\} \/>/);
  });

  it('a cold-start link opens with Home beneath it, so Back returns Home', () => {
    // Home is the first tab of the (tabs) group (app/(tabs)/_layout.tsx).
    expect(read('src/app/_layout.tsx')).toMatch(/export const unstable_settings = \{ initialRouteName: '\(tabs\)' \};/);
    expect(read('src/app/(tabs)/_layout.tsx')).toMatch(/<Tabs\.Screen name="index" \/>[\s\S]*?<Tabs\.Screen name="mushaf"/);
    expect(read('src/app/(tabs)/_layout.tsx').indexOf('<Tabs.Screen name="index"')).toBeLessThan(read('src/app/(tabs)/_layout.tsx').indexOf('<Tabs.Screen'.concat(' name="mushaf"')));
  });
});
