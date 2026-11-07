import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tafsirEditions } from '@/tafsir/editions';
import { createTafsirLibrary, type TafsirLibrary } from '@/tafsir/library';
import type { TafsirFileStore } from '@/tafsir/storage';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

import { syntheticFile, syntheticSurahs } from './helpers/tafsirSynthetic';

/**
 * The tafsir reader screen (app/tafsir.tsx): it opens ON the chosen ayah (the list's very first row, in its first
 * render), keeps the ayah being read across an edition switch, links an ayah inside a passage to the passage's single
 * commentary, and falls back to الميسر. FlatList is a stand-in that draws every row it is given (so "the first row"
 * is exactly what the real list would draw first); all tafsir text is SYNTHETIC.
 */
const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  locale: 'ar' as 'en' | 'ar' | 'ar-EG',
  preferred: null as string | null,
  saved: [] as string[],
  library: null as unknown,
  /** Every list rendered, in order: its first row's key and props. */
  lists: [] as { firstKey: string; props: Record<string, unknown> }[],
  scrollToIndex: vi.fn(),
}));

vi.mock('react-native', async () => {
  const React = await import('react');
  const FlatList = React.forwardRef(function FlatList(props: Record<string, unknown>, ref) {
    useImperativeHandleShim(ref);
    const data = props.data as { key: string }[];
    state.lists.push({ firstKey: data[0]?.key, props });
    const render = props.renderItem as (x: { item: unknown; index: number }) => unknown;
    return React.createElement('FlatList', { testID: props.testID }, ...data.map((item, index) => React.createElement(React.Fragment, { key: item.key }, render({ item, index }) as never)), props.ListFooterComponent as never);
  });
  function useImperativeHandleShim(ref: unknown) {
    React.useImperativeHandle(ref as never, () => ({ scrollToIndex: state.scrollToIndex, scrollToOffset: vi.fn() }));
  }
  return {
    StyleSheet: { create: (v: unknown) => v, hairlineWidth: 0.5 },
    Platform: { OS: 'ios', select: (v: { ios: unknown }) => v.ios },
    ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View',
    FlatList,
  };
});
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
vi.mock('lucide-react-native', () => ({ ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Check: 'Check', CircleAlert: 'CircleAlert', Download: 'Download', Lock: 'Lock' }));
vi.mock('expo-router', () => ({ router: { back: vi.fn(), replace: vi.fn(), canGoBack: () => true }, useLocalSearchParams: () => state.params }));
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette, useThemedStyles: (factory: (colors: unknown) => unknown) => factory(lightPalette) };
});
vi.mock('@/localization/useAppLocale', async () => {
  const { MESSAGES } = await import('@/localization/messages');
  return { useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) };
});
vi.mock('@/localization/useQuranFontSizePreference', () => ({ useQuranFontSizePreference: () => ({ preferredSize: 26 }) }));
vi.mock('@/services/quran', () => ({
  getSurahVerses: async (surah: number) => Array.from({ length: SURAH_AYAH_COUNTS[surah - 1] }, (_, i) => ({ surah, ayah: i + 1, verseKey: `${surah}:${i + 1}`, arabicText: `آية ${surah}:${i + 1}` })),
  getVerseByKey: async () => ({ surah: 1, ayah: 1, verseKey: '1:1', arabicText: 'بسم' }),
}));
vi.mock('@/tafsir/preference', () => ({
  loadTafsirEditionPreference: async () => state.preferred,
  saveTafsirEditionPreference: async (id: string) => {
    state.saved.push(id);
  },
}));
vi.mock('@/tafsir/library', async (original) => ({ ...(await original<object>()), tafsirLibrary: () => state.library }));

const { default: TafsirScreen } = await import('@/app/tafsir');

const surahs = syntheticSurahs({ 2: [[183, 187]] });
const counts = { entries: surahs.flat().length, ranges: 1 };
function library(options: { downloaded?: string[] } = {}): { library: TafsirLibrary; finish: (ok: boolean) => void } {
  const files = new Map<string, string>();
  const text = (id: 'saadi' | 'zilal') => JSON.stringify(syntheticFile(id, surahs));
  for (const id of options.downloaded ?? []) files.set(id, text(id as 'saadi' | 'zilal'));
  let resolveDone: (ok: boolean) => void = () => undefined;
  let pending: string | null = null;
  const store: TafsirFileStore = {
    has: async (id) => files.has(id),
    read: async (id) => files.get(id) ?? null,
    download: async (_url, id) => {
      pending = id;
      return { done: new Promise<boolean>((r) => (resolveDone = r)), cancel: () => resolveDone(false) };
    },
    commit: async (id) => {
      files.set(id, text(id as 'saadi' | 'zilal'));
      return pending === id;
    },
    discardPartial: async () => undefined,
    remove: async (id) => {
      files.delete(id);
    },
  };
  const pin = (id: 'saadi' | 'zilal') => ({ status: 'ready' as const, sha256: 'c'.repeat(64), bytes: text(id).length, ...counts });
  const release = {
    muyassar: { status: 'ready' as const, sha256: 'd'.repeat(64), bytes: 1, entries: 6236, ranges: 0 },
    saadi: pin('saadi'),
    jalalayn: { status: 'blocked' as const, reason: 'rights-unverified' },
    zilal: pin('zilal'),
  };
  const lib = createTafsirLibrary({ editions: tafsirEditions(release), files: store, bundled: () => syntheticFile('muyassar'), downloadUrl: () => 'https://x.invalid/' });
  return { library: lib, finish: (ok) => resolveDone(ok) };
}

let root: ReactTestRenderer;
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); });
};
/** The opening ayah's row being laid out (what the native list reports), then the two frames the reader waits. */
async function place() {
  const anchor = root.root.findAll((n: ReactTestInstance) => typeof n.type === 'string' && String(n.props.testID ?? '').startsWith('tafsir-ayah-') && typeof n.props.onLayout === 'function');
  for (const row of anchor) await act(async () => row.props.onLayout());
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  await settle();
}
async function open(surah: number, ayah: number) {
  state.params = { surah: String(surah), ayah: String(ayah) };
  await act(async () => { root = create(createElement(TafsirScreen)); });
  await settle();
  await place();
}
/** The row the reader shows first: the one scrolled to the top before the list was shown (or the first row drawn). */
const opening = () => {
  const list = lastList();
  expect(list.props.style ?? null).toBeNull(); // shown
  const placed = state.scrollToIndex.mock.calls.filter(([arg]) => arg.animated === false).at(-1)?.[0] as { index: number; viewPosition: number } | undefined;
  const data = list.props.data as { key: string }[];
  if (!placed) return data[0].key;
  expect(placed.viewPosition).toBe(0);
  return data[placed.index].key;
};
const byId = (id: string) => root.root.findAll((n: ReactTestInstance) => typeof n.type === 'string' && n.props.testID === id);
const text = (node: ReactTestInstance) => node.findAll((n) => (n.type as unknown) === 'Text').map((n) => [n.props.children].flat().join('')).join('|');
const lastList = () => state.lists[state.lists.length - 1];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0));
  state.lists = [];
  state.saved = [];
  state.preferred = null;
  state.locale = 'ar';
  state.scrollToIndex.mockReset();
  state.library = library().library;
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('the tafsir reader', () => {
  it('opens on the chosen ayah: hidden until 2:186 is at the top, then shown (never ayah 1 first), with الميسر selected', async () => {
    state.params = { surah: '2', ayah: '186' };
    await act(async () => { root = create(createElement(TafsirScreen)); });
    await settle();
    // Drawn from two rows above (2:185 and its commentary), but invisible until placed.
    expect(lastList().firstKey).toBe('a185');
    expect(lastList().props.style).toEqual({ opacity: 0 });
    await place();
    expect(opening()).toBe('a186');
    expect(byId('tafsir-ayah-1')).toHaveLength(0);
    expect(text(byId('tafsir-ayah-186')[0])).toContain('آية 2:186');
    expect(text(byId('tafsir-ayah-186')[0])).toContain('Al-Baqara · 2:186 · البقرة');
    expect(text(byId('tafsir-commentary-186-186')[0])).toBe('نص تجريبي 2:186');
    expect(byId('tafsir-edition-muyassar')[0].props.accessibilityState.selected).toBe(true);
    // The whole rest of the Surah is there below; earlier ayahs come above when scrolled up.
    expect(byId('tafsir-ayah-286')).toHaveLength(1);
  });

  it('earlier ayahs are added above only once the opening ayah is placed, near the top, keeping the content in place', async () => {
    state.params = { surah: '2', ayah: '186' };
    await act(async () => { root = create(createElement(TafsirScreen)); });
    await settle();
    const scroll = (y: number) => act(async () => (lastList().props.onScroll as (e: unknown) => void)({ nativeEvent: { contentOffset: { y } } }));
    expect(lastList().props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
    await act(async () => (lastList().props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { height: 700 } } }));
    // Before the opening ayah is placed (the list still hidden), scroll events add nothing.
    await scroll(0);
    expect(lastList().firstKey).toBe('a185');
    await place();
    // Placed (offset > 0: two rows above it): scrolling near the top adds earlier rows in chunks, down to the first ayah.
    await scroll(400);
    expect(lastList().firstKey).not.toBe('a185');
    for (let i = 0; i < 30; i += 1) await scroll(100);
    expect(lastList().firstKey).toBe('a1');
    // A pull at the very top sends no scroll event on Android: a drag's start also counts.
    expect(typeof lastList().props.onScrollBeginDrag).toBe('function');
  });

  it('the first ayah of a Surah opens at once, with nothing above it to place', async () => {
    await open(2, 1);
    expect(state.scrollToIndex).not.toHaveBeenCalled();
    expect(opening()).toBe('a1');
  });

  it('switching edition mid-Surah keeps the ayah being read, and is remembered', async () => {
    state.library = library({ downloaded: ['zilal'] }).library;
    await open(2, 150);
    await act(async () => (lastList().props.onViewableItemsChanged as (x: unknown) => void)({ viewableItems: [{ isViewable: true, item: { type: 'ayah', key: 'a160', ayah: 160 } }] }));
    await act(async () => byId('tafsir-edition-zilal')[0].props.onPress());
    await settle();
    await place();
    expect(opening()).toBe('a160');
    expect(byId('tafsir-edition-zilal')[0].props.accessibilityState.selected).toBe(true);
    expect(state.saved).toEqual(['zilal']);
  });

  it('inside a passage: lands on the chosen ayah, shows the passage once with its range, and links down to it', async () => {
    state.preferred = 'zilal';
    state.library = library({ downloaded: ['zilal'] }).library;
    await open(2, 185);
    expect(opening()).toBe('a185');
    expect(byId('tafsir-commentary-183-187')).toHaveLength(1);
    expect(text(byId('tafsir-commentary-183-187')[0])).toBe('تفسير الآيات ١٨٣–١٨٧|نص تجريبي 2:183-187');
    for (const ayah of [185, 186, 187]) expect(byId(`tafsir-commentary-${ayah}-${ayah}`)).toHaveLength(0);
    expect(byId('tafsir-jump-187')).toHaveLength(0); // the passage's last ayah: its commentary is right below
    const jump = byId('tafsir-jump-185')[0];
    expect(text(jump)).toBe('تفسير الآيات ١٨٣–١٨٧ في الأسفل');
    state.scrollToIndex.mockClear();
    await act(async () => jump.props.onPress());
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    const rows = lastList().props.data as { key: string }[];
    const index = rows.findIndex((r) => r.key === 'c183-187');
    // Twice: once to draw the rows on the way, then onto the measured commentary.
    expect(state.scrollToIndex.mock.calls).toEqual([[{ index, viewPosition: 0, animated: false }], [{ index, viewPosition: 0, animated: true }]]);
  });

  it('the same screen given another ayah (a link while it is open) reopens at that ayah', async () => {
    await open(2, 186);
    state.params = { surah: '2', ayah: '40' };
    await act(async () => root.update(createElement(TafsirScreen)));
    await settle();
    await place();
    expect(opening()).toBe('a40');
    expect(byId('tafsir-ayah-40')[0].props.style).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: expect.any(String) })]));
  });

  it('the last ayah of a Surah opens at the top, with room below it', async () => {
    await open(2, 286);
    expect(opening()).toBe('a286');
    await open(114, 6);
    expect(opening()).toBe('a6');
  });

  it('a preferred edition that is not on this device opens الميسر, without forgetting the preference', async () => {
    state.preferred = 'saadi';
    await open(1, 1);
    expect(byId('tafsir-edition-muyassar')[0].props.accessibilityState.selected).toBe(true);
    expect(state.saved).toEqual([]);
  });

  it('the selector: all four in order, with what each one is; unavailable is disabled; a download shows progress, then opens at the same ayah', async () => {
    const { library: lib, finish } = library();
    state.library = lib;
    await open(2, 100);
    const status = (id: string) => text(byId(`tafsir-edition-${id}-status`)[0]);
    expect(['muyassar', 'saadi', 'jalalayn', 'zilal'].map((id) => byId(`tafsir-edition-${id}`)).every((n) => n.length === 1)).toBe(true);
    expect(status('muyassar')).toBe('المعروض');
    expect(status('saadi')).toMatch(/^تنزيل · /);
    expect(status('jalalayn')).toBe('غير متاح بعد');
    expect(byId('tafsir-edition-jalalayn')[0].props.disabled).toBe(true);
    await act(async () => byId('tafsir-edition-saadi')[0].props.onPress());
    await settle();
    expect(status('saadi')).toMatch(/^جارٍ التنزيل/);
    expect(byId('tafsir-edition-saadi')[0].props.disabled).toBe(true);
    await act(async () => finish(true));
    await settle();
    await place();
    expect(byId('tafsir-edition-saadi')[0].props.accessibilityState.selected).toBe(true);
    expect(opening()).toBe('a100');
  });

  it('a failed download says so and offers a retry; the edition being read is untouched', async () => {
    const { library: lib, finish } = library();
    state.library = lib;
    await open(2, 100);
    await act(async () => byId('tafsir-edition-saadi')[0].props.onPress());
    await settle();
    await act(async () => finish(false));
    await settle();
    expect(text(byId('tafsir-edition-saadi-status')[0])).toBe('تعذّر التنزيل · إعادة المحاولة');
    expect(text(byId('tafsir-download-error')[0])).toMatch(/توقف التنزيل/);
    expect(byId('tafsir-edition-muyassar')[0].props.accessibilityState.selected).toBe(true);
    expect(opening()).toBe('a100');
  });

  it('English labels; the tafsir and ayahs stay Arabic, right to left', async () => {
    state.locale = 'en';
    await open(2, 186);
    expect(text(byId('tafsir-edition-muyassar-status')[0])).toBe('Reading');
    expect(byId('tafsir-edition-muyassar')[0].findAll((n) => (n.type as unknown) === 'Text')[0].props.children).toBe('التفسير الميسر');
  });

  it('with no verified edition in this build: says so, and shows no text', async () => {
    const lib = createTafsirLibrary({
      editions: tafsirEditions(),
      files: { has: async () => false, read: async () => null, download: async () => ({ done: Promise.resolve(false), cancel: () => undefined }), commit: async () => false, discardPartial: async () => undefined, remove: async () => undefined },
      bundled: () => null,
      downloadUrl: () => '',
    });
    state.library = lib;
    await open(2, 186);
    expect(byId('tafsir-unavailable')).toHaveLength(1);
    expect(state.lists).toHaveLength(0);
    for (const id of ['muyassar', 'saadi', 'jalalayn', 'zilal']) expect(byId(`tafsir-edition-${id}`)[0].props.disabled).toBe(true);
  });
});
