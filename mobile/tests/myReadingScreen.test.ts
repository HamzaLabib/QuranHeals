import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGES } from '@/localization/messages';

/**
 * أورادي وختماتي (/my-reading), rendered over the real reading data
 * (mushaf/khatmas.ts) on an in-memory AsyncStorage.
 */
const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' | 'ar-EG', storage: new Map<string, string>() }));
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
vi.mock('lucide-react-native', () => Object.fromEntries(['ArrowLeft', 'ArrowRight', 'BookOpen', 'BookOpenText', 'Pencil', 'Plus', 'Trash2'].map((name) => [name, name])));
vi.mock('expo-router', () => ({ router: { push: vi.fn(), navigate: vi.fn(), back: vi.fn(), replace: vi.fn(), canGoBack: () => true } }));
vi.mock('@/theme/useTheme', async () => {
  const { lightPalette } = await import('@/constants/theme');
  return { usePalette: () => lightPalette, useThemedStyles: (factory: (colors: unknown) => unknown) => factory(lightPalette) };
});
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));

const { default: MyReadingScreen } = await import('@/app/(tabs)/my-reading');
const { confirmKhatma, loadReadingData, saveWirdPage } = await import('@/mushaf/khatmas');
const { READING_STOPS_STORAGE_KEY, ACTIVE_READING_STOP_STORAGE_KEY } = await import('@/mushaf/readingStops');
const { resetLocalDataOwnerForTests } = await import('@/storage/localDataOwner');
const { router } = await import('expo-router');

let root: ReactTestRenderer;
const copy = () => MESSAGES[state.locale].myReading;
const flush = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };
const all = (id: string) => root.root.findAllByProps({ testID: id }).filter((node) => typeof node.type === 'string' && String(node.type) !== 'Modal');
const byId = (id: string) => all(id)[0];
const textOf = (node: ReactTestInstance) => node.findAllByType('Text' as never).map((t) => [t.props.children].flat().join('')).join(' | ');
const press = async (id: string) => { await act(async () => { await byId(id).props.onPress(); }); await flush(); await flush(); };
const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean));
async function render() {
  await act(async () => { root = create(createElement(MyReadingScreen)); });
  await flush();
  await flush();
}
const readTo = async (name: string, ...pages: number[]) => { for (const page of pages) await saveWirdPage({ name, page }); };
const wirds = async () => (await loadReadingData()).wirds;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.storage.clear();
  resetLocalDataOwnerForTests();
  vi.mocked(router.push).mockClear();
  vi.mocked(router.navigate).mockClear();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('أورادي وختماتي', () => {
  it('with no ورد: an empty state, zero statistics, the new-ورد action and the du`a entry', async () => {
    await render();
    expect(byId('my-reading-empty')).toBeDefined();
    for (const id of ['total', 'ramadan', 'non-ramadan']) expect(textOf(byId(`my-reading-stat-${id}`))).toMatch(/^0 \| /);
    expect(byId('my-reading-new')).toBeDefined();
    await press('my-reading-dua');
    expect(router.push).toHaveBeenLastCalledWith('/khatm-dua');
  });

  it('one card per ورد: its own name, page of 604, percentage, progress bar and Khatma count', async () => {
    await readTo('وردي اليومي', 1, 604);
    await readTo('ورد رمضان', 320);
    await readTo('ورد التدبر', 150);
    const daily = (await wirds()).find((w) => w.stop.name === 'وردي اليومي')!;
    await confirmKhatma(daily.stop.id, daily.cycle.id);
    await render();
    const cards = (await wirds()).map((w) => [w.stop.name, textOf(byId(`wird-card-${w.stop.id}`))] as const);
    // A position (the saved page), never presented as pages recited.
    expect(cards.find(([name]) => name === 'ورد رمضان')![1]).toMatch(/Page 320 of 604 \| Position 52% \| Khatmas: 0/);
    expect(cards.find(([name]) => name === 'ورد التدبر')![1]).toMatch(/Page 150 of 604 \| Position 24% \| Khatmas: 0/);
    expect(cards.find(([name]) => name === 'وردي اليومي')![1]).toMatch(/Page 1 of 604 \| Position 0% \| Khatmas: 1/);
    const bar = byId(`wird-card-${daily.stop.id}`).findAll((node) => node.props.accessibilityRole === 'progressbar')[0];
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 0 });
    expect(bar.props.accessibilityLabel).toBe(copy().positionLabel);
    // Says plainly: on this device only; a position, not pages recited; counted only when confirmed.
    expect(byId('my-reading-footnote').props.children).toMatch(/on this device only.*not a count of pages recited.*only when you confirm/);
    expect(textOf(byId('my-reading-stat-total'))).toMatch(/^1 \| /);
  });

  it('a pending ورد shows تأكيد إتمام الختمة; confirming (even tapped twice) records one Khatma and opens the completion screen', async () => {
    state.locale = 'ar';
    await readTo('ورد الفجر', 300, 604);
    const [w] = await wirds();
    await render();
    expect(textOf(byId(`wird-pending-${w.stop.id}`))).toContain('تأكيد إتمام الختمة');
    await press(`wird-confirm-${w.stop.id}`);
    expect(textOf(byId('wird-confirm-sheet'))).toContain('ما شاء الله، أتممت ختم القرآن');
    await act(async () => {
      byId('wird-confirm-sheet-confirm').props.onPress();
      byId('wird-confirm-sheet-confirm').props.onPress();
    });
    await flush();
    await flush();
    const data = await loadReadingData();
    expect(data.stats.total).toBe(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/khatma-complete', params: { id: data.records[0].id } });
  });

  it('ليس الآن keeps the completion pending and counts nothing', async () => {
    await readTo('Fajr', 300, 604);
    const [w] = await wirds();
    await render();
    await press(`wird-confirm-${w.stop.id}`);
    await press('wird-confirm-sheet-cancel');
    expect(all('wird-confirm-sheet')).toHaveLength(0);
    expect((await loadReadingData()).stats.total).toBe(0);
    expect(byId(`wird-pending-${w.stop.id}`)).toBeDefined();
  });

  it('a legacy stop already at 604 is never counted by itself: its own, explicitly worded choice records it', async () => {
    state.storage.set(READING_STOPS_STORAGE_KEY, JSON.stringify([{ id: 'old', name: 'Mum', page: 604, updatedAt: '2026-09-01T08:00:00.000Z' }]));
    await render();
    expect(textOf(byId('wird-unconfirmed-old'))).toContain(copy().unconfirmedTitle);
    expect(all('wird-confirm-old')).toHaveLength(0);
    expect((await loadReadingData()).stats.total).toBe(0);
    await press('wird-record-old');
    expect(textOf(byId('wird-confirm-sheet'))).toContain(copy().unconfirmedConfirmTitle);
    await press('wird-confirm-sheet-confirm');
    expect((await loadReadingData()).stats.total).toBe(1);
  });

  it('Continue reading opens the Mushaf tab on that ورد`s saved page and makes it the active ورد', async () => {
    await readTo('A', 120);
    await readTo('B', 450);
    const a = (await wirds()).find((w) => w.stop.name === 'A')!;
    await render();
    await press(`wird-continue-${a.stop.id}`);
    expect(state.storage.get(ACTIVE_READING_STOP_STORAGE_KEY)).toBe(a.stop.id);
    expect(router.navigate).toHaveBeenLastCalledWith({ pathname: '/mushaf', params: { page: '120', at: expect.any(String) } });
    expect((await wirds()).map((w) => w.stop.page).sort()).toEqual([120, 450]);
  });

  it('creates a ورد with its own name and starting page; a taken name is explained and changes nothing', async () => {
    await readTo('Daily', 200);
    await render();
    await press('my-reading-new');
    await act(async () => byId('wird-name-input').props.onChangeText('ورد المراجعة'));
    await act(async () => byId('wird-page-input').props.onChangeText('٢٥'));
    await press('wird-name-submit');
    expect((await wirds()).find((w) => w.stop.name === 'ورد المراجعة')!.stop.page).toBe(25);
    await press('my-reading-new');
    await act(async () => byId('wird-name-input').props.onChangeText('daily'));
    await press('wird-name-submit');
    expect(textOf(byId('wird-name-sheet'))).toContain(copy().nameTaken);
    expect((await wirds()).find((w) => w.stop.name === 'Daily')!.stop.page).toBe(200);
  });

  it('renames one ورد; its page and Khatmas stay', async () => {
    await readTo('Daily', 200);
    const [w] = await wirds();
    await render();
    await press(`wird-rename-${w.stop.id}`);
    await act(async () => byId('wird-name-input').props.onChangeText('Morning'));
    await press('wird-name-submit');
    expect((await wirds())[0]).toMatchObject({ stop: { name: 'Morning', page: 200 } });
  });

  it('deleting asks first; cancelling keeps it; confirming removes only that ورد and keeps its Khatmas in the history', async () => {
    await readTo('Daily', 1, 604);
    await readTo('Other', 77);
    const daily = (await wirds()).find((w) => w.stop.name === 'Daily')!;
    await confirmKhatma(daily.stop.id, daily.cycle.id);
    await render();
    await press(`wird-delete-${daily.stop.id}`);
    expect(textOf(byId('wird-delete-sheet'))).toContain(copy().deleteBody);
    await press('wird-delete-sheet-cancel');
    expect(await wirds()).toHaveLength(2);
    await press(`wird-delete-${daily.stop.id}`);
    await press('wird-delete-sheet-confirm');
    expect((await wirds()).map((w) => w.stop.name)).toEqual(['Other']);
    expect((await loadReadingData()).stats.total).toBe(1);
    expect(textOf(root.root)).toContain('Daily'); // still named in the history
  });

  it('the history shows each Khatma`s ورد, date and Ramadan classification; removing one asks first and recalculates', async () => {
    await readTo('Daily', 1, 604);
    const [w] = await wirds();
    const { record } = await confirmKhatma(w.stop.id, w.cycle.id, { now: () => new Date(2027, 1, 10, 12) });
    await render();
    expect(textOf(byId(`khatma-record-${record.id}`))).toMatch(/Daily \| .+ \| Ramadan 1448 AH/);
    expect(textOf(byId('my-reading-stat-ramadan'))).toMatch(/^1 \| /);
    await press(`khatma-remove-${record.id}`);
    expect(textOf(byId('khatma-remove-sheet'))).toContain(copy().removeTitle);
    await press('khatma-remove-sheet-confirm');
    const data = await loadReadingData();
    expect(data.stats).toEqual({ total: 0, ramadan: 0, nonRamadan: 0 });
    expect(data.wirds[0].status).toBe('pending'); // not saved since: back to 604, awaiting confirmation
  });

  it('the du`a entry passes a pending ورد along, so the du`a screen can offer its confirmation', async () => {
    await readTo('Fajr', 300, 604);
    const [w] = await wirds();
    await render();
    await press('my-reading-dua');
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/khatm-dua', params: { wird: w.stop.id } });
  });

  it('Arabic: right to left, Arabic-Indic digits, and the approved wording', async () => {
    state.locale = 'ar';
    await readTo('ورد', 302);
    const [w] = await wirds();
    await render();
    expect(root.root.findAll((node) => node.props.accessibilityRole === 'header')[0].props.children).toBe('أورادي وختماتي');
    expect(textOf(byId('my-reading-stats'))).toContain('إجمالي الختمات');
    expect(textOf(byId('my-reading-stats'))).toContain('ختمات رمضان');
    expect(textOf(byId('my-reading-stats'))).toContain('ختمات خارج رمضان');
    expect(textOf(byId(`wird-card-${w.stop.id}`))).toContain('صفحة ٣٠٢ من ٦٠٤');
    expect(flat(byId('my-reading-stats').props.style).flexDirection).toBe('row-reverse');
  });
});
