import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGES } from '@/localization/messages';
import { formatCivilDate } from '@/utils/formatDate';

/**
 * أورادي وختماتي (/my-reading), rendered over the real reading data
 * (mushaf/khatmas.ts) on an in-memory AsyncStorage.
 */
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
  dark: false,
  storage: new Map<string, string>(),
  // useAuth's refreshReading (the account reading sync); a guest's is a no-op.
  refreshReading: async () => {},
}));
vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  return {
    Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
    StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
    Modal: ({ visible, children, ...rest }: { visible: boolean; children: unknown }) => (visible ? h('Modal', rest, children as never) : null),
    ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
    Pressable: 'Pressable', RefreshControl: 'RefreshControl', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
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
vi.mock('lucide-react-native', () => Object.fromEntries(['ArrowLeft', 'ArrowRight', 'BookOpen', 'BookOpenText', 'Pencil', 'Plus', 'Settings', 'Trash2'].map((name) => [name, name])));
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Rect: 'Rect' }));
vi.mock('expo-router', async () => {
  const { createElement: h } = await import('react');
  return { router: { push: vi.fn(), navigate: vi.fn(), back: vi.fn(), replace: vi.fn(), canGoBack: () => true }, Link: ({ href, children }: { href: string; children: unknown }) => h('Link', { href }, children as never) };
});
vi.mock('@/theme/useTheme', async () => {
  const { darkPalette, lightPalette } = await import('@/constants/theme');
  const palette = () => (state.dark ? darkPalette : lightPalette);
  return { usePalette: palette, useThemedStyles: (factory: (colors: unknown) => unknown) => factory(palette()) };
});
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));
vi.mock('@/auth/useAuth', () => ({ useAuth: () => ({ refreshReading: () => state.refreshReading() }) }));

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
  state.dark = false;
  state.storage.clear();
  state.refreshReading = async () => {};
  resetLocalDataOwnerForTests();
  vi.mocked(router.push).mockClear();
  vi.mocked(router.navigate).mockClear();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('أورادي وختماتي', () => {
  it('the title keeps its wording, with «اقرأ وارتقِ» / Recite and Rise directly under it, in the App Language and its direction', async () => {
    for (const [locale, title, subtitle, direction] of [['en', 'My Recitations & Khatmas', 'Recite and Rise', 'ltr'], ['ar', 'أورادي وختماتي', 'اقرأ وارتقِ', 'rtl']] as const) {
      state.locale = locale;
      await render();
      const header = root.root.findAll((node) => node.type === ('Text' as never) && node.props.accessibilityRole === 'header')[0];
      expect(header.props.children).toBe(title);
      const sub = byId('my-reading-subtitle');
      expect(sub.props.children).toBe(subtitle);
      expect(sub.parent).toBe(header.parent);
      expect(flat(sub.props.style)).toMatchObject({ writingDirection: direction });
      await act(async () => root.unmount());
    }
  });

  it('with no ورد: an empty state, zero statistics, the new-ورد action and the du`a entry', async () => {
    await render();
    expect(byId('my-reading-empty')).toBeDefined();
    for (const id of ['total', 'ramadan']) expect(textOf(byId(`my-reading-stat-${id}`))).toMatch(/^0 \| /);
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
    expect(cards.find(([name]) => name === 'ورد رمضان')![1]).toMatch(/Page 320 of 604 \| Completion 52% \| Khatmas: 0/);
    expect(cards.find(([name]) => name === 'ورد التدبر')![1]).toMatch(/Page 150 of 604 \| Completion 24% \| Khatmas: 0/);
    expect(cards.find(([name]) => name === 'وردي اليومي')![1]).toMatch(/Page 1 of 604 \| Completion 0% \| Khatmas: 1/);
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

  describe('history dates: the record`s stored local calendar day, in any time zone', () => {
    const originalTz = process.env.TZ;
    afterEach(() => { process.env.TZ = originalTz; });
    const unmarked = (text: string) => text.replace(/[‎‏؜]/g, '');
    const dateText = (id: string) => byId(`khatma-date-${id}`).props.children as string;

    it('confirmed on 14 Oct in UTC+14 (still 13 Oct in UTC and UTC−11): 14 Oct wherever the history is opened', async () => {
      process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
      await readTo('Daily', 1, 604);
      const [w] = await wirds();
      // 12:00 UTC on 13 Oct is 02:00 on 14 Oct in Kiritimati.
      const { record } = await confirmKhatma(w.stop.id, w.cycle.id, { now: () => new Date(Date.UTC(2026, 9, 13, 12)) });
      expect(record).toMatchObject({ localDate: '2026-10-14', completedAt: '2026-10-13T12:00:00.000Z' });
      for (const tz of ['Pacific/Pago_Pago', 'UTC', 'Asia/Riyadh', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        // In Pago Pago (UTC−11) the completion instant itself is 01:00 on 13 Oct: the old completedAt date was a day early.
        if (tz === 'Pacific/Pago_Pago') expect(new Date(record.completedAt).getDate()).toBe(13);
        for (const locale of ['en', 'ar', 'ar-EG'] as const) {
          state.locale = locale;
          await render();
          const expected = { en: 'Oct 14, 2026', ar: '14/10/2026', 'ar-EG': '١٤/١٠/٢٠٢٦' }[locale];
          expect(unmarked(dateText(record.id))).toBe(expected);
          expect(dateText(record.id)).toBe(formatCivilDate('2026-10-14', locale));
          await act(async () => root.unmount());
        }
      }
      // Nothing stored was changed by showing it.
      const data = await loadReadingData();
      expect(data.records).toEqual([record]);
      expect(data.stats).toEqual({ total: 1, ramadan: 0, nonRamadan: 1 });
    });

    it('English and Arabic ورد names stay on their own line, outside the date, on Arabic and English screens', async () => {
      process.env.TZ = 'UTC';
      const records = [];
      for (const [name, day] of [['Hi', 11], ['ورد الفجر', 12], ['Personal 2026', 13]] as const) {
        await readTo(name, 1, 604);
        const w = (await wirds()).find((x) => x.stop.name === name)!;
        records.push((await confirmKhatma(w.stop.id, w.cycle.id, { now: () => new Date(Date.UTC(2026, 9, day, 12)) })).record);
      }
      for (const locale of ['ar', 'en'] as const) {
        state.locale = locale;
        await render();
        for (const record of records) {
          const row = byId(`khatma-record-${record.id}`).findAllByType('Text' as never).map((t) => [t.props.children].flat().join(''));
          const date = formatCivilDate(record.localDate, locale);
          expect(row.slice(0, 2)).toEqual([record.stopName, date]);
          expect(date).not.toContain(record.stopName);
          expect(unmarked(date)).toBe(locale === 'en' ? `Oct ${record.localDate.slice(8).replace(/^0/, '')}, 2026` : `${record.localDate.slice(8)}/10/2026`);
        }
        await act(async () => root.unmount());
      }
    });
  });

  it('history ورد names, with punctuation and mixed scripts, are read in their own direction and aligned with the language', async () => {
    const names = ['Hi!', 'Mosque (Fajr)', 'Personal 2026?', 'Personal ورد', 'ورد الفجر.', 'ورد (Personal)!', 'ورد Personal'];
    const records = [];
    for (const name of names) {
      await readTo(name, 1, 604);
      const w = (await wirds()).find((x) => x.stop.name === name)!;
      records.push((await confirmKhatma(w.stop.id, w.cycle.id)).record);
    }
    for (const locale of ['ar', 'ar-EG', 'en'] as const) {
      state.locale = locale;
      await render();
      const rtl = locale !== 'en';
      for (const record of records) {
        const nameText = byId(`khatma-name-${record.id}`);
        // The name exactly as typed, punctuation and all: nothing added, moved or stripped.
        expect(nameText.props.children).toBe(record.stopName);
        const style = flat(nameText.props.style);
        // No forced paragraph direction (the platform takes the name's first strong letter), so "Hi!" never reads "!Hi" on an
        // Arabic screen nor "ورد الفجر." gains a leading full stop on an English one; the row's alignment and type stay as they were.
        expect(style.writingDirection).toBeUndefined();
        expect(style).toMatchObject({ textAlign: rtl ? 'right' : 'left', fontSize: 16, fontWeight: '700' });
        // The date beside it keeps the language's direction and its stored day.
        expect(flat(byId(`khatma-date-${record.id}`).props.style)).toMatchObject({ writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' });
        expect(byId(`khatma-date-${record.id}`).props.children).toBe(formatCivilDate(record.localDate, locale));
      }
      await act(async () => root.unmount());
    }
    expect((await loadReadingData()).stats.total).toBe(names.length);
  });

  it('the percentage reads Completion / الإنجاز (still the saved page out of 604), with a matching progress-bar label', async () => {
    const expected = {
      en: ['Completion {percent}%', 'Completion, by the saved page in the Mushaf', 'Completion 52%'],
      ar: ['الإنجاز {percent}٪', 'الإنجاز حسب الصفحة المحفوظة في المصحف', 'الإنجاز ٥٢٪'],
      'ar-EG': ['الإنجاز {percent}٪', 'الإنجاز حسب الصفحة المحفوظة في المصحف', 'الإنجاز ٥٢٪'],
    } as const;
    await readTo('Daily', 320);
    const [w] = await wirds();
    expect(w.percent).toBe(52); // floor(320 / 604 × 100): unchanged
    for (const locale of ['en', 'ar', 'ar-EG'] as const) {
      const [template, barLabel, shown] = expected[locale];
      expect([MESSAGES[locale].myReading.percent, MESSAGES[locale].myReading.positionLabel]).toEqual([template, barLabel]);
      expect(JSON.stringify(MESSAGES[locale].myReading)).not.toMatch(/Position \{|Progress \{|التقدّم|الموضع \{|الموضع المحفوظ/);
      state.locale = locale;
      await render();
      expect(byId(`wird-percent-${w.stop.id}`).props.children).toBe(shown);
      const bar = byId(`wird-card-${w.stop.id}`).findAll((node) => node.props.accessibilityRole === 'progressbar')[0];
      expect(bar.props.accessibilityLabel).toBe(barLabel);
      expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 52 });
      // The note still says the figure is the saved page, not pages recited.
      expect(byId('my-reading-footnote').props.children).toMatch(locale === 'en' ? /not a count of pages recited/ : /وليس عدد الصفحات|مش عدد الصفحات/);
      await act(async () => root.unmount());
    }
  });

  it('a guest: "saved on this device only", and no sync line', async () => {
    await readTo('Daily', 10);
    await render();
    expect(byId('my-reading-footnote').props.children).toBe(copy().footnote);
    expect(copy().footnote).toMatch(/on this device only/);
    expect(all('my-reading-sync')).toHaveLength(0);
  });

  it('signed in: the synced explanation (still: completion is the saved page; a Khatma counts only when confirmed) and a sync line that says "synced" only after the account confirmed', async () => {
    const { setLocalDataOwnerState } = await import('@/storage/localDataOwner');
    const status = await import('@/sync/readingSyncState');
    // Signed in: the account's own partition is the active one.
    setLocalDataOwnerState({ activeUserId: 'user-a', keptSeparate: [], resolved: true });
    await readTo('Daily', 10);
    for (const locale of ['en', 'ar', 'ar-EG'] as const) {
      state.locale = locale;
      status.resetReadingSyncStatus();
      await render();
      const c = MESSAGES[locale].myReading;
      expect(byId('my-reading-footnote').props.children).toBe(c.footnoteSynced);
      expect(all('my-reading-sync')).toHaveLength(0); // nothing known yet: no claim either way
      await act(async () => status.markReadingSyncStarted());
      expect(byId('my-reading-sync').props.children).toBe(c.syncSyncing);
      await act(async () => status.markReadingSyncFinished(false, null));
      expect(byId('my-reading-sync').props.children).toBe(c.syncPending);
      await act(async () => status.markReadingSyncFinished(true, '2026-10-13T10:00:00.000Z'));
      expect(byId('my-reading-sync').props.children).toBe(c.syncSynced);
      await act(async () => status.markReadingChangedLocally());
      expect(byId('my-reading-sync').props.children).toBe(c.syncPending);
      await act(async () => root.unmount());
    }
    expect(MESSAGES.en.myReading.footnoteSynced).toMatch(/sync with your account across the devices signed in to it.*not a count of pages recited.*only when you confirm/);
    // Account-synced, not end-to-end encrypted: never described as encrypted.
    for (const locale of ['en', 'ar', 'ar-EG'] as const) expect(MESSAGES[locale].myReading.footnoteSynced).not.toMatch(/encrypt|مشفّر|متشفّر/i);
    for (const locale of ['ar', 'ar-EG'] as const) expect(MESSAGES[locale].myReading.footnoteSynced).toMatch(/وليس عدد الصفحات|مش عدد الصفحات/);
  });

  it('exactly two counters, side by side in equal-width cards: الختمات (all, Ramadan included) and ختمات رمضان; no non-Ramadan counter', async () => {
    const labels = { en: ['Khatmas', 'Ramadan Khatmas'], ar: ['الختمات', 'ختمات رمضان'], 'ar-EG': ['الختمات', 'ختمات رمضان'] } as const;
    for (const locale of ['en', 'ar', 'ar-EG'] as const) {
      expect([MESSAGES[locale].myReading.statsTotal, MESSAGES[locale].myReading.statsRamadan]).toEqual(labels[locale]);
      expect(MESSAGES[locale].myReading).not.toHaveProperty('statsNonRamadan');
    }
    // One Ramadan and one non-Ramadan Khatma: الختمات counts both, ختمات رمضان only the first.
    await readTo('Daily', 1, 604);
    let [w] = await wirds();
    const ramadan = await confirmKhatma(w.stop.id, w.cycle.id, { now: () => new Date(2027, 1, 10, 12) });
    await readTo('Daily', 604);
    [w] = await wirds();
    await confirmKhatma(w.stop.id, w.cycle.id, { now: () => new Date(2027, 5, 10, 12) });
    for (const locale of ['en', 'ar', 'ar-EG'] as const) {
      state.locale = locale;
      await render();
      const cards = byId('my-reading-stats').children.filter((node) => typeof node !== 'string') as ReactTestInstance[];
      expect(cards.map((card) => card.props.testID)).toEqual(['my-reading-stat-total', 'my-reading-stat-ramadan']);
      expect(cards.map((card) => flat(card.props.style).flex)).toEqual([1, 1]);
      expect(all('my-reading-stat-non-ramadan')).toHaveLength(0);
      const [totalValue, totalLabel] = textOf(byId('my-reading-stat-total')).split(' | ');
      const [ramadanValue, ramadanLabel] = textOf(byId('my-reading-stat-ramadan')).split(' | ');
      expect([totalLabel, ramadanLabel]).toEqual(labels[locale]);
      expect([totalValue, ramadanValue]).toEqual(locale === 'en' ? ['2', '1'] : ['٢', '١']);
      await act(async () => root.unmount());
    }
    // Every record is kept, non-Ramadan included, and the counts stay consistent.
    const data = await loadReadingData();
    expect(data.records).toHaveLength(2);
    expect(data.stats).toEqual({ total: 2, ramadan: 1, nonRamadan: 1 });
    // Removing the Ramadan Khatma updates both counters.
    state.locale = 'en';
    await render();
    await press(`khatma-remove-${ramadan.record.id}`);
    await press('khatma-remove-sheet-confirm');
    expect(textOf(byId('my-reading-stat-total')).split(' | ')[0]).toBe('1');
    expect(textOf(byId('my-reading-stat-ramadan')).split(' | ')[0]).toBe('0');
  });

  for (const [name, dark] of [['Light', false], ['Dark', true]] as const) {
    it(`${name}: the two counters take the theme's card colours`, async () => {
      state.dark = dark;
      const { darkPalette, lightPalette } = await import('@/constants/theme');
      const palette = dark ? darkPalette : lightPalette;
      await render();
      expect(flat(byId('my-reading-stat-ramadan').props.style)).toMatchObject({ backgroundColor: palette.card, borderColor: palette.border });
      expect(flat(byId('my-reading-stat-total').props.style)).toMatchObject({ backgroundColor: palette.sageSurface, borderColor: palette.sageBorder });
    });
  }

  it('the du`a entry opens the du`a only, even for a pending ورد; the Khatma is confirmed here, on the ورد`s own card', async () => {
    await readTo('Fajr', 300, 604);
    const [w] = await wirds();
    await render();
    await press('my-reading-dua');
    expect(router.push).toHaveBeenLastCalledWith('/khatm-dua');
    expect(byId(`wird-confirm-${w.stop.id}`)).toBeDefined();
  });

  it('Arabic: right to left, Arabic-Indic digits, and the approved wording', async () => {
    state.locale = 'ar';
    await readTo('ورد', 302);
    const [w] = await wirds();
    await render();
    expect(root.root.findAll((node) => node.props.accessibilityRole === 'header')[0].props.children).toBe('أورادي وختماتي');
    expect(textOf(byId('my-reading-stats'))).toBe('٠ | الختمات | ٠ | ختمات رمضان');
    expect(textOf(byId(`wird-card-${w.stop.id}`))).toContain('صفحة ٣٠٢ من ٦٠٤');
    expect(flat(byId('my-reading-stats').props.style).flexDirection).toBe('row-reverse');
  });
});

describe('no Complete Khatma here (it is on Mushaf page 604)', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: only the du'a row, as before — no Complete Khatma button, chooser or notice`, async () => {
      state.locale = locale;
      await readTo('Fajr', 300, 604);
      const [w] = await wirds();
      await render();
      expect(all('my-reading-complete-khatma')).toHaveLength(0);
      expect(all('my-reading-dua-actions')).toHaveLength(0);
      expect(all('complete-khatma-choose')).toHaveLength(0);
      expect(all('complete-khatma-none')).toHaveLength(0);
      // The du'a row: full width, its icon and title, opening the du'a only.
      expect(flat(byId('my-reading-dua').props.style({ pressed: false }))).toMatchObject({ flexDirection: locale === 'ar' ? 'row-reverse' : 'row', padding: 14 });
      expect(flat(byId('my-reading-dua').props.style({ pressed: false })).flex).toBeUndefined();
      // Its label follows the App Language, in that language's direction.
      expect(textOf(byId('my-reading-dua'))).toBe(locale === 'en' ? "Quran Completion Du'a" : 'دعاء ختم القرآن');
      expect(byId('my-reading-dua').props.accessibilityLabel).toBe(locale === 'en' ? "Quran Completion Du'a" : 'دعاء ختم القرآن');
      const title = byId('my-reading-dua').findAllByType('Text' as never)[0];
      expect(flat(title.props.style)).toMatchObject(locale === 'en' ? { writingDirection: 'ltr', textAlign: 'left' } : { writingDirection: 'rtl', textAlign: 'right' });
      await press('my-reading-dua');
      expect(router.push).toHaveBeenLastCalledWith('/khatm-dua');
      // The ورد's own confirmation is unchanged.
      expect(byId(`wird-confirm-${w.stop.id}`)).toBeDefined();
    });
  }
});

describe('pull-to-refresh (the same pattern as Favorites and Reflections)', () => {
  const control = () => byId('my-reading-scroll').props.refreshControl as { props: { refreshing: boolean; onRefresh: () => void; tintColor: string; colors: string[]; progressBackgroundColor: string } };
  const pull = async () => { await act(async () => { control().props.onRefresh(); }); };
  /** The reading data another device's changes would leave here, written without notifying the screen (as if by a sync). */
  async function snapshotOf(prepare: () => Promise<void>) {
    await prepare();
    const snapshot = new Map(state.storage);
    state.storage.clear();
    resetLocalDataOwnerForTests();
    return snapshot;
  }

  it('uses the shared spinner: accent tint and colors on the surface background, in Light and Dark', async () => {
    const { darkPalette, lightPalette } = await import('@/constants/theme');
    for (const [dark, palette] of [[false, lightPalette], [true, darkPalette]] as const) {
      state.dark = dark;
      await render();
      expect(control().props).toMatchObject({ refreshing: false, tintColor: palette.accent, colors: [palette.accent], progressBackgroundColor: palette.surface });
      expect(flat(byId('my-reading-scroll').props.style)).toMatchObject({ flex: 1 });
      await act(async () => root.unmount());
    }
  });

  it('signed in: runs the account reading sync, then shows what it stored (أوراد, counters, history); the spinner stays until both finish', async () => {
    const synced = await snapshotOf(async () => {
      await readTo('ورد الفجر', 300, 604);
      const [w] = await wirds();
      await confirmKhatma(w.stop.id, w.cycle.id);
      await readTo('ورد التدبر', 150);
    });
    await render();
    expect(byId('my-reading-empty')).toBeDefined();

    let finishSync!: () => void;
    state.refreshReading = () => new Promise<void>((resolve) => {
      finishSync = () => {
        for (const [key, value] of synced) state.storage.set(key, value);
        resolve();
      };
    });
    await pull();
    expect(control().props.refreshing).toBe(true);
    await flush();
    expect(control().props.refreshing).toBe(true); // the sync is still running

    await act(async () => { finishSync(); });
    await flush();
    await flush();
    expect(control().props.refreshing).toBe(false);
    expect(all('my-reading-empty')).toHaveLength(0);
    expect(textOf(byId('my-reading-stat-total'))).toMatch(/^1 \| /);
    const names = (await wirds()).map((w) => w.stop.name).sort();
    expect(names).toEqual(['ورد التدبر', 'ورد الفجر']);
    for (const w of await wirds()) expect(byId(`wird-card-${w.stop.id}`)).toBeDefined();
  });

  it('a second pull while one is running starts no second sync', async () => {
    await render();
    let calls = 0;
    let finish!: () => void;
    state.refreshReading = () => { calls += 1; return new Promise<void>((resolve) => { finish = resolve; }); };
    await pull();
    await pull();
    await pull();
    expect(calls).toBe(1);
    await act(async () => { finish(); });
    await flush();
    expect(control().props.refreshing).toBe(false);
    await pull();
    expect(calls).toBe(2);
    await act(async () => { finish(); });
    await flush();
  });

  it('a guest (no-op sync) or offline: local data only — the stored ورد, progress and Khatmas are re-read, never changed', async () => {
    await readTo('ورد الفجر', 300, 604);
    const [w] = await wirds();
    await confirmKhatma(w.stop.id, w.cycle.id);
    await readTo('ورد التدبر', 210);
    await render();
    const before = new Map(state.storage);
    const cardsBefore = (await wirds()).map((x) => textOf(byId(`wird-card-${x.stop.id}`)));

    await pull();
    await flush();
    await flush();

    expect(control().props.refreshing).toBe(false);
    expect(new Map(state.storage)).toEqual(before);
    expect((await wirds()).map((x) => textOf(byId(`wird-card-${x.stop.id}`)))).toEqual(cardsBefore);
    expect(textOf(byId('my-reading-stat-total'))).toMatch(/^1 \| /);
  });

  it('Arabic: the same control, the screen still right to left', async () => {
    state.locale = 'ar';
    await render();
    expect(control().props.onRefresh).toBeTypeOf('function');
    expect(flat(byId('my-reading-stats').props.style)).toMatchObject({ flexDirection: 'row-reverse' });
  });
});
