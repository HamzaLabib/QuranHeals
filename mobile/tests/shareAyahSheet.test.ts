/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARE_CARD_SCENERY } from '@/constants/shareCardScenery';
import { MESSAGES } from '@/localization/messages';
import type { Ayah } from '@/types/domain';

/** The Share Ayah sheet: options, export readiness, sharing, saving and their failures (mocked native modules). */

const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar' | 'ar-EG',
  displayMode: 'always' as 'always' | 'on-demand' | 'off',
  capture: vi.fn(),
  share: vi.fn(),
  save: vi.fn(),
  release: vi.fn(),
  openSettings: vi.fn(),
  clipboard: vi.fn(),
}));
vi.mock('react-native', () => ({
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  PixelRatio: { get: () => 3 },
  Linking: { openSettings: state.openSettings },
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  StyleSheet: { create: (value: unknown) => value },
  ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('expo-clipboard', () => ({ setStringAsync: state.clipboard }));
vi.mock('lucide-react-native', () => ({ Check: 'Check', Link2: 'Link2', ChevronLeft: 'ChevronLeft', ChevronRight: 'ChevronRight', Download: 'Download', RefreshCw: 'RefreshCw', Share2: 'Share2', X: 'X' }));
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));
vi.mock('@/localization/useQuranTranslationPreference', () => ({
  useQuranTranslationPreference: () => ({ preference: { displayMode: state.displayMode, translationId: 'en.pickthall.gutenberg16955' } }),
}));
vi.mock('@/services/shareImage', () => ({
  IMAGE_EXPORT_SUPPORTED: true,
  captureCardImage: state.capture,
  shareCardImages: state.share,
  saveCardImages: state.save,
  releaseCardImages: state.release,
}));
// The card itself is covered by shareAyahCard.test.ts; here it is a host element whose props are inspected.
vi.mock('@/components/ShareAyahCard', () => ({ ShareAyahCard: 'ShareAyahCard' }));

import { ShareAyahSheet } from '@/components/ShareAyahSheet';

const db = new DatabaseSync(fileURLToPath(new URL('../assets/quran/quran.sqlite', import.meta.url)), { readOnly: true });
afterAll(() => db.close());
const arabicOf = (key: string) => (db.prepare('SELECT arabic_text AS t FROM verses WHERE verse_key = ?').get(key) as { t: string }).t;

const ayahFor = (key: string, overrides: Partial<Ayah> = {}): Ayah => {
  const [surah, ayah] = key.split(':').map(Number);
  return {
    id: `id-${key}`, verseKey: key, referenceKey: key, surahNumber: surah, ayahNumber: ayah,
    surahNameArabic: '', surahNameEnglish: '', arabicText: arabicOf(key),
    englishTranslation: 'Allah! There is no God save Him, the Alive, the Eternal.', emotions: ['sad'],
    quranTextSource: 'Tanzil Quran Text — Uthmani 1.1 — https://tanzil.net',
    translationSource: 'Marmaduke Pickthall — The Meaning of the Glorious Koran — Project Gutenberg eBook #16955',
    ...overrides,
  };
};

let root: ReactTestRenderer;
let onClose: ReturnType<typeof vi.fn<() => void>>;
const copy = () => MESSAGES[state.locale].share;
const pressables = () => root.root.findAllByType('Pressable' as never);
const button = (label: string) => pressables().find((node) => node.props.accessibilityLabel === label);
const cards = () => root.root.findAllByType('ShareAyahCard' as never);
const exportCards = () => cards().filter((node) => node.props.width === 360); // 1080 px / PixelRatio 3
const previewCard = () => cards().find((node) => node.props.width !== 360)!;
const text = () => JSON.stringify(root.toJSON());

async function render(ayah: Ayah | null = ayahFor('1:1'), visible = true) {
  await act(async () => { root = create(createElement(ShareAyahSheet, { visible, ayah, onClose })); });
}
/** What the off-screen export cards report after layout; also attaches a fake native view to each. */
async function exportCardsFit(fits = true) {
  await act(async () => {
    for (const card of exportCards()) {
      card.props.viewRef({ tag: card.props.page.key });
      card.props.onFitChange(fits);
    }
  });
}
async function press(node: ReactTestInstance | undefined) {
  await act(async () => { await node!.props.onPress(); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.displayMode = 'always';
  let n = 0;
  state.capture.mockReset().mockImplementation(async () => `file:///cache/card-${(n += 1)}.png`);
  state.share.mockReset().mockResolvedValue('shared');
  state.clipboard.mockReset().mockResolvedValue(true);
  state.save.mockReset().mockImplementation(async (uris: string[]) => ({ status: 'saved', count: uris.length }));
  state.release.mockReset();
  state.openSettings.mockReset().mockResolvedValue(undefined);
  onClose = vi.fn();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('opening', () => {
  it('renders nothing while closed or without an ayah', async () => {
    await render(ayahFor('1:1'), false);
    expect(root.toJSON()).toBeNull();
    await act(async () => root.update(createElement(ShareAyahSheet, { visible: true, ayah: null, onClose })));
    expect(root.toJSON()).toBeNull();
  });

  it('shows the header, close button, a live preview, the three formats, three backgrounds, the translation switch, Share and Save', async () => {
    await render();
    expect(text()).toContain('Share Ayah');
    for (const label of [copy().close, `${copy().formatStory} 9:16`, `${copy().formatPost} 4:5`, `${copy().formatSquare} 1:1`,
      copy().themeSage, copy().themeCream, copy().themeDark, copy().showTranslation, copy().share, copy().saveImage]) {
      expect(button(label), label).toBeDefined();
    }
    expect(previewCard().props.reference).toBe('Al-Faatiha · 1:1 · الفاتحة');
  });

  it('defaults to Story and Sage', async () => {
    await render();
    expect(button(`${copy().formatStory} 9:16`)!.props.accessibilityState).toEqual({ selected: true });
    expect(button(copy().themeSage)!.props.accessibilityState).toEqual({ selected: true });
    expect(previewCard().props).toMatchObject({ format: 'story', theme: 'sage' });
  });

  it.each([
    ['always', true],
    ['on-demand', false],
    ['off', false],
  ] as const)('translation display "%s" → translation initially %s', async (mode, expected) => {
    state.displayMode = mode;
    await render();
    expect(button(copy().showTranslation)!.props.accessibilityState).toEqual({ checked: expected });
    expect(previewCard().props.page.translation !== null).toBe(expected);
  });

  it('hides the translation switch when the ayah has no translation text', async () => {
    await render(ayahFor('1:1', { englishTranslation: '' }));
    expect(button(copy().showTranslation)).toBeUndefined();
    expect(previewCard().props.page.translation).toBeNull();
  });

  it('Close (and Android back) closes the sheet', async () => {
    await render();
    await press(button(copy().close));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root.root.findByType('Modal' as never).props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('Arabic interface', () => {
  it.each(['ar', 'ar-EG'] as const)('%s: localized header and controls, right-to-left rows', async (locale) => {
    state.locale = locale;
    await render();
    expect(text()).toContain('مشاركة الآية');
    expect(button(MESSAGES[locale].share.share)).toBeDefined();
    expect(button(MESSAGES[locale].share.themeDark)).toBeDefined();
    const title = root.root.findAllByType('Text' as never).find((node) => node.props.children === 'مشاركة الآية')!;
    expect(title.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ writingDirection: 'rtl', textAlign: 'right' })]));
    const actions = button(MESSAGES[locale].share.share)!.parent!;
    expect(actions.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ flexDirection: 'row-reverse' })]));
  });

  it('the card itself is the same in every interface language', async () => {
    await render();
    const english = previewCard().props;
    await act(async () => root.unmount());
    state.locale = 'ar';
    await render();
    expect(previewCard().props.page).toEqual(english.page);
    expect(previewCard().props.reference).toBe(english.reference);
  });
});

describe('customizing updates the live preview', () => {
  it('format, background and translation changes apply immediately', async () => {
    await render();
    await press(button(`${copy().formatSquare} 1:1`));
    expect(previewCard().props.format).toBe('square');
    expect(exportCards().every((card) => card.props.format === 'square')).toBe(true);
    await press(button(copy().themeDark));
    expect(previewCard().props.theme).toBe('dark');
    expect(button(copy().themeDark)!.props.accessibilityState).toEqual({ selected: true });
    await press(button(copy().showTranslation));
    expect(previewCard().props.page.translation).toBeNull();
    expect(previewCard().props.page.arabic).toBe(arabicOf('1:1'));
  });
});

describe('export readiness', () => {
  it('Share and Save stay disabled until every full-size card has been measured to fit', async () => {
    await render();
    expect(button(copy().share)!.props.disabled).toBe(true);
    expect(button(copy().saveImage)!.props.disabled).toBe(true);
    await exportCardsFit();
    expect(button(copy().share)!.props.disabled).toBe(false);
    expect(button(copy().saveImage)!.props.disabled).toBe(false);
  });

  it('a card that measures too tall is re-planned with smaller text or more cards — never exported clipped', async () => {
    await render(ayahFor('2:255', { englishTranslation: 'Allah! There is no God save Him. '.repeat(12).trim() }));
    const before = exportCards().map((card) => card.props.page);
    await exportCardsFit(false);
    const after = exportCards().map((card) => card.props.page);
    expect(after.length > before.length || after[0].arabicFontSize < before[0].arabicFontSize).toBe(true);
    expect(button(copy().share)!.props.disabled).toBe(true);
    await exportCardsFit(true);
    expect(button(copy().share)!.props.disabled).toBe(false);
  });
});

describe('sharing', () => {
  it('captures the full-size card and opens the share sheet once, however many times Share is tapped', async () => {
    let finish!: (value: string) => void;
    state.share.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    await exportCardsFit();
    await act(async () => { void button(copy().share)!.props.onPress(); });
    expect(button(copy().share)!.props.disabled).toBe(true);
    expect(text()).toContain(copy().preparing);
    await act(async () => { void button(copy().share)!.props.onPress(); });
    expect(state.capture).toHaveBeenCalledTimes(1);
    expect(state.capture).toHaveBeenCalledWith({ current: { tag: 'all-1' } }, { width: 1080, height: 1920 }, 'quran-heals-1-1-1');
    expect(state.share).toHaveBeenCalledTimes(1);
    expect(state.share).toHaveBeenCalledWith(['file:///cache/card-1.png'], 'Share Ayah');
    await act(async () => finish('shared'));
    expect(button(copy().share)!.props.disabled).toBe(false);
    expect(text()).not.toContain(copy().shareFailed);
  });

  it('exports at the selected format`s size', async () => {
    await render();
    await press(button(`${copy().formatPost} 4:5`));
    await exportCardsFit();
    await press(button(copy().share));
    expect(state.capture).toHaveBeenCalledWith(expect.anything(), { width: 1080, height: 1350 }, expect.any(String));
  });

  it('keeps the shared file until the next export or until the sheet closes, then cleans it up', async () => {
    await render();
    await exportCardsFit();
    await press(button(copy().share));
    expect(state.release).not.toHaveBeenCalledWith(['file:///cache/card-1.png']);
    await press(button(copy().close));
    expect(state.release).toHaveBeenCalledWith(['file:///cache/card-1.png']);
  });

  it('explains when sharing is unavailable on the device, and frees the unshared file at once', async () => {
    state.share.mockResolvedValueOnce('unavailable');
    await render();
    await exportCardsFit();
    await press(button(copy().share));
    expect(text()).toContain(copy().shareUnavailable);
    expect(state.release).toHaveBeenCalledWith(['file:///cache/card-1.png']);
  });

  it('format, background and translation are locked while cards are being exported (no mixed designs in one set)', async () => {
    let finish!: (value: string) => void;
    state.share.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    await exportCardsFit();
    await act(async () => { void button(copy().share)!.props.onPress(); });
    for (const label of [`${copy().formatPost} 4:5`, copy().themeDark, copy().showTranslation]) {
      expect(button(label)!.props.disabled, label).toBe(true);
    }
    await act(async () => finish('shared'));
    expect(button(copy().themeDark)!.props.disabled).toBe(false);
  });

  it('a failed capture or share shows a retryable error and frees any captured file', async () => {
    state.share.mockRejectedValueOnce(new Error('native failure'));
    await render();
    await exportCardsFit();
    await press(button(copy().share));
    expect(text()).toContain(copy().shareFailed);
    expect(button(copy().share)!.props.disabled).toBe(false);

    state.capture.mockRejectedValueOnce(new Error('view not found'));
    await press(button(copy().share));
    expect(text()).toContain(copy().shareFailed);
    expect(state.share).toHaveBeenCalledTimes(1);
  });
});

describe('saving', () => {
  it('saves the image, confirms it, and deletes the temp file', async () => {
    await render();
    await exportCardsFit();
    await press(button(copy().saveImage));
    expect(state.save).toHaveBeenCalledWith(['file:///cache/card-1.png']);
    expect(text()).toContain(copy().saved);
    expect(state.release).toHaveBeenLastCalledWith(['file:///cache/card-1.png']);
  });

  it('a declined permission explains why; a permanently blocked one offers Settings', async () => {
    state.save.mockResolvedValueOnce({ status: 'denied', canAskAgain: true });
    await render();
    await exportCardsFit();
    await press(button(copy().saveImage));
    expect(text()).toContain(copy().saveDenied);
    expect(button(copy().openSettings)).toBeUndefined();

    state.save.mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
    await press(button(copy().saveImage));
    expect(text()).toContain(copy().saveBlocked);
    await press(button(copy().openSettings));
    expect(state.openSettings).toHaveBeenCalledTimes(1);
  });

  it('a save failure shows a retryable error', async () => {
    state.save.mockRejectedValueOnce(new Error('disk full'));
    await render();
    await exportCardsFit();
    await press(button(copy().saveImage));
    expect(text()).toContain(copy().saveFailed);
    expect(button(copy().saveImage)!.props.disabled).toBe(false);
  });
});

describe('long ayahs', () => {
  const longAyah = () => ayahFor('2:282', { englishTranslation: 'O ye who believe! When ye contract a debt for a fixed term, record it in writing. '.repeat(16).trim() });

  it('2:282 is shown as numbered cards with every word, in order, and a note explaining it', async () => {
    await render(longAyah());
    const pages = exportCards().map((card) => card.props.page);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.filter((page) => page.arabic).map((page) => page.arabic).join(' ')).toBe(arabicOf('2:282'));
    expect(text()).toContain(copy().longAyahNote);
    expect(previewCard().props.page.pageNumber).toBe(1);
    await press(button(copy().nextCard));
    expect(previewCard().props.page.pageNumber).toBe(2);
    await press(button(copy().previousCard));
    expect(previewCard().props.page.pageNumber).toBe(1);
  });

  it('Share says it shares all cards, and sends every card together in verse order — whichever card is shown', async () => {
    await render(longAyah());
    await exportCardsFit();
    const count = exportCards().length;
    expect(button(copy().share)).toBeUndefined();
    const shareAll = button(`${copy().shareAllCards} (${count})`);
    expect(shareAll).toBeDefined();
    await press(button(copy().nextCard));
    await press(shareAll);
    expect(state.capture.mock.calls.map((call) => call[2])).toEqual(
      Array.from({ length: count }, (_, index) => `quran-heals-2-282-${index + 1}`),
    );
    expect(state.share).toHaveBeenCalledTimes(1);
    expect(state.share.mock.calls[0][0]).toEqual(Array.from({ length: count }, (_, index) => `file:///cache/card-${index + 1}.png`));
  });

  it('a build that cannot share several images never shares part of the ayah: it suggests Save instead', async () => {
    state.share.mockResolvedValueOnce('multiple-unavailable');
    await render(longAyah());
    await exportCardsFit();
    await press(button(`${copy().shareAllCards} (${exportCards().length})`));
    expect(text()).toContain(copy().multipleUnavailable);
  });

  it('Save stores every card', async () => {
    await render(longAyah());
    await exportCardsFit();
    const count = exportCards().length;
    await press(button(copy().saveAllImages));
    expect(state.capture).toHaveBeenCalledTimes(count);
    expect(state.save.mock.calls[0][0]).toHaveLength(count);
    expect(text()).toContain(copy().savedAll);
  });
});

describe('copy ayah link', () => {
  it('copies the HTTPS link for exactly the displayed ayah and confirms it', async () => {
    await render(ayahFor('94:5'));
    await press(button(copy().copyLink));
    expect(state.clipboard).toHaveBeenCalledWith('https://quran-heals-api.onrender.com/ayah/94/5');
    expect(text()).toContain(copy().linkCopied);
    expect(root.root.findAllByType('Check' as never)).toHaveLength(1);
  });

  it('works before the image is ready, and explains that images cannot carry a clickable link', async () => {
    await render(ayahFor('2:255'));
    expect(text()).toContain(copy().linkHint);
    await press(button(copy().copyLink));
    expect(state.clipboard).toHaveBeenCalledWith('https://quran-heals-api.onrender.com/ayah/2/255');
  });

  it('reports a clipboard failure without claiming success', async () => {
    state.clipboard.mockResolvedValueOnce(false);
    await render(ayahFor('94:5'));
    await press(button(copy().copyLink));
    expect(text()).toContain(copy().copyLinkFailed);
    expect(text()).not.toContain(copy().linkCopied);
  });

  it.each(['ar', 'ar-EG'] as const)('%s: localized label and confirmation', async (locale) => {
    state.locale = locale;
    await render(ayahFor('94:5'));
    await press(button(MESSAGES[locale].share.copyLink));
    expect(text()).toContain(MESSAGES[locale].share.linkCopied);
  });
});

describe('the same card from every flow', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf-8');

  it('the ayah screen (emotion and general modes) and Favorites pass the sheet only the ayah', () => {
    expect(read('src/components/AyahExperience.tsx')).toMatch(/<ShareAyahSheet visible=\{isShareVisible\} ayah=\{ayah\} onClose=\{\(\) => setIsShareVisible\(false\)\} \/>/);
    expect(read('src/app/favorites.tsx')).toMatch(/<ShareAyahSheet visible=\{sharedFavorite !== null\} ayah=\{sharedFavorite\} onClose=\{\(\) => setSharedFavorite\(null\)\} \/>/);
  });

  it('the card never receives emotion, connection or reflection data', async () => {
    await render(ayahFor('2:255'));
    for (const card of cards()) {
      expect(Object.keys(card.props).sort()).toEqual(
        ['format', 'onFitChange', 'page', 'reference', 'scenery', 'theme', 'translationCredit', 'width',
          ...(card.props.viewRef ? ['onSceneryLoad', 'viewRef'] : [])].sort(),
      );
    }
    expect(text()).not.toContain('sad');
    const sheetSource = read('src/components/ShareAyahSheet.tsx') + read('src/components/ShareAyahCard.tsx');
    expect(sheetSource).not.toMatch(/emotionKey|AyahConnection|connectionText|useReflections|ayahReflections|useAuth/);
  });
});

describe('sharing copies the ayah link automatically', () => {
  it('Share image copies the exact link before the share sheet opens, then confirms it quietly', async () => {
    const order: string[] = [];
    state.clipboard.mockImplementation(async () => { order.push('copy'); return true; });
    state.share.mockImplementation(async () => { order.push('share'); return 'shared'; });
    await render(ayahFor('94:5'));
    await exportCardsFit();
    await press(button(copy().share));
    expect(state.clipboard).toHaveBeenCalledWith('https://quran-heals-api.onrender.com/ayah/94/5');
    expect(order).toEqual(['copy', 'share']);
    expect(text()).toContain(copy().linkAutoCopied);
    expect(text()).not.toContain(copy().shareFailed);
  });

  it('Share all cards copies the link too, and still shares every card', async () => {
    await render(ayahFor('2:282', { englishTranslation: 'O ye who believe! When ye contract a debt for a fixed term, record it in writing. '.repeat(16).trim() }));
    await exportCardsFit();
    const count = exportCards().length;
    await press(button(`${copy().shareAllCards} (${count})`));
    expect(state.clipboard).toHaveBeenCalledWith('https://quran-heals-api.onrender.com/ayah/2/282');
    expect(state.share.mock.calls[0][0]).toHaveLength(count);
    expect(text()).toContain(copy().linkAutoCopied);
  });

  it('a clipboard failure never blocks sharing and claims nothing', async () => {
    state.clipboard.mockRejectedValueOnce(new Error('denied'));
    await render(ayahFor('94:5'));
    await exportCardsFit();
    await press(button(copy().share));
    expect(state.share).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain(copy().linkAutoCopied);
    expect(text()).not.toContain(copy().shareFailed);
  });

  it('Save does not touch the clipboard; the separate Copy ayah link button still works', async () => {
    await render(ayahFor('94:5'));
    await exportCardsFit();
    await press(button(copy().saveImage));
    expect(state.clipboard).not.toHaveBeenCalled();
    await press(button(copy().copyLink));
    expect(state.clipboard).toHaveBeenCalledTimes(1);
    expect(text()).toContain(copy().linkCopied);
  });

  it('an unavailable share still leaves the link copied but reports the problem', async () => {
    state.share.mockResolvedValueOnce('unavailable');
    await render(ayahFor('94:5'));
    await exportCardsFit();
    await press(button(copy().share));
    expect(state.clipboard).toHaveBeenCalledTimes(1);
    expect(text()).toContain(copy().shareUnavailable);
  });
});

describe('Share Studio helper text', () => {
  it.each([
    ['en', 'The ayah link is copied automatically when you share. Paste it into your Story’s Link sticker.'],
    ['ar', 'عند مشاركة الصورة، يُنسخ رابط الآية تلقائيًا. ألصقه في الرابط في قصتك ليتمكن الآخرون من فتحها.'],
    ['ar-EG', 'لما تشارك الصورة، رابط الآية بيتنسخ تلقائيًا. الصقه في الرابط في الستوري عشان الناس يقدروا يفتحوها.'],
  ] as const)('%s: shows the refined wording beside the link actions', async (locale, wording) => {
    state.locale = locale;
    await render(ayahFor('94:5'));
    expect(MESSAGES[locale].share.linkHint).toBe(wording);
    const hint = root.root.findAllByType('Text' as never).find((node) => node.props.children === wording)!;
    expect(hint).toBeDefined();
    expect(hint.parent!.findAllByType('Pressable' as never).map((node) => node.props.accessibilityLabel)).toContain(MESSAGES[locale].share.copyLink);
  });
});

describe('backgrounds: Colors and Scenery', () => {
  const SCENERY_IDS = SHARE_CARD_SCENERY.map((scenery) => scenery.id);
  const colorsButton = () => button(copy().backgroundColors);
  const sceneryButton = () => button(copy().backgroundScenery);
  const newBackground = () => button(copy().newBackground);
  const shown = () => previewCard().props.scenery;
  /** Every card (preview and export) shows the same background. */
  const everyCardShows = (scenery: string | null) => cards().every((card) => card.props.scenery === scenery);
  /** What the off-screen export cards report once their photograph is drawn (or fails to load). */
  async function sceneryLoads(loaded = true) {
    await act(async () => {
      for (const card of exportCards()) card.props.onSceneryLoad?.(loaded);
    });
  }
  const longAyah = () => ayahFor('2:282', { englishTranslation: 'O ye who believe! When ye contract a debt for a fixed term, record it in writing. '.repeat(16).trim() });

  it('offers Colors and Scenery; Colors (with Sage, Cream and Dark, Sage selected) is the default and has no New Background button', async () => {
    await render();
    expect(text()).toContain(copy().background);
    expect(colorsButton()!.props.accessibilityState).toEqual({ selected: true });
    expect(sceneryButton()!.props.accessibilityState).toEqual({ selected: false });
    for (const label of [copy().themeSage, copy().themeCream, copy().themeDark]) expect(button(label), label).toBeDefined();
    expect(button(copy().themeSage)!.props.accessibilityState).toEqual({ selected: true });
    expect(newBackground()).toBeUndefined();
    expect(everyCardShows(null)).toBe(true);
    expect([copy().backgroundColors, copy().backgroundScenery, copy().newBackground]).toEqual(['Colors', 'Scenery', 'New Background']);
  });

  it('Sage, Cream and Dark behave exactly as before', async () => {
    await render();
    for (const [label, theme] of [[copy().themeCream, 'cream'], [copy().themeDark, 'dark'], [copy().themeSage, 'sage']] as const) {
      await press(button(label));
      expect(cards().every((card) => card.props.theme === theme && card.props.scenery === null), theme).toBe(true);
    }
  });

  it('choosing Scenery shows one random bundled photograph on every card, hides the colour swatches and shows New Background', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await render();
    await press(sceneryButton());
    expect(sceneryButton()!.props.accessibilityState).toEqual({ selected: true });
    const expected = SCENERY_IDS[Math.floor(0.5 * SCENERY_IDS.length)];
    expect(shown()).toBe(expected);
    expect(everyCardShows(expected)).toBe(true);
    expect(button(copy().themeSage)).toBeUndefined();
    expect(newBackground()).toBeDefined();
    expect(root.root.findAllByType('RefreshCw' as never)).toHaveLength(1);
  });

  it.each([0, 0.25, 0.999999])('random %s still picks a valid photograph', async (value) => {
    vi.spyOn(Math, 'random').mockReturnValue(value);
    await render();
    await press(sceneryButton());
    expect(SCENERY_IDS).toContain(shown());
  });

  it('New Background always shows a different photograph, as often as it is tapped', async () => {
    const values = [0, 0, 0.999, 0.999, 0.5, 0.5, 0.3, 0.71, 0, 0.999];
    let call = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => values[call++ % values.length]);
    await render();
    await press(sceneryButton());
    const seen = [shown()];
    for (let tap = 0; tap < 40; tap += 1) {
      await press(newBackground());
      expect(shown()).not.toBe(seen[seen.length - 1]);
      expect(SCENERY_IDS).toContain(shown());
      expect(everyCardShows(shown())).toBe(true);
      seen.push(shown());
    }
    expect(new Set(seen).size).toBeGreaterThan(2);
  });

  it('New Background never changes the ayah, its translation, the reference, the format or the card shown', async () => {
    await render(longAyah());
    await press(button(`${copy().formatPost} 4:5`));
    await press(sceneryButton());
    await press(button(copy().nextCard));
    const before = previewCard().props;
    const exportPages = exportCards().map((card) => card.props.page);
    await press(newBackground());
    const after = previewCard().props;
    expect(after.scenery).not.toBe(before.scenery);
    expect(after.page).toEqual(before.page);
    expect(after.page.pageNumber).toBe(2);
    expect([after.reference, after.format, after.translationCredit]).toEqual([before.reference, before.format, before.translationCredit]);
    expect(exportCards().map((card) => card.props.page)).toEqual(exportPages);
    expect(button(copy().showTranslation)!.props.accessibilityState).toEqual({ checked: true });
  });

  it('the photograph stays put across re-renders, format changes, the translation switch and export — no new random pick', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.42);
    await render();
    await press(sceneryButton());
    const picked = shown();
    expect(random).toHaveBeenCalledTimes(1);
    await act(async () => root.update(createElement(ShareAyahSheet, { visible: true, ayah: ayahFor('1:1'), onClose })));
    await act(async () => root.update(createElement(ShareAyahSheet, { visible: true, ayah: ayahFor('1:1'), onClose })));
    expect(everyCardShows(picked)).toBe(true);
    for (const label of [`${copy().formatSquare} 1:1`, `${copy().formatPost} 4:5`, `${copy().formatStory} 9:16`]) {
      await press(button(label));
      expect(everyCardShows(picked), label).toBe(true);
    }
    await press(button(copy().showTranslation));
    await press(button(copy().showTranslation));
    expect(everyCardShows(picked)).toBe(true);
    await exportCardsFit();
    await sceneryLoads();
    await press(button(copy().share));
    await press(button(copy().saveImage));
    expect(everyCardShows(picked)).toBe(true);
    expect(random).toHaveBeenCalledTimes(1);
  });

  it('switching to Colors and back keeps both the colour and this session`s photograph', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.8);
    await render();
    await press(button(copy().themeDark));
    await press(sceneryButton());
    const picked = shown();
    await press(colorsButton());
    expect(everyCardShows(null)).toBe(true);
    expect(cards().every((card) => card.props.theme === 'dark')).toBe(true);
    expect(button(copy().themeDark)!.props.accessibilityState).toEqual({ selected: true });
    expect(newBackground()).toBeUndefined();
    await press(sceneryButton());
    expect(everyCardShows(picked)).toBe(true);
    expect(random).toHaveBeenCalledTimes(1);
  });

  it('a new Share Studio session starts again from Colors and picks a fresh photograph', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    await render(ayahFor('94:5'));
    await press(sceneryButton());
    await act(async () => root.update(createElement(ShareAyahSheet, { visible: false, ayah: ayahFor('94:5'), onClose })));
    await act(async () => root.update(createElement(ShareAyahSheet, { visible: true, ayah: ayahFor('94:5'), onClose })));
    expect(colorsButton()!.props.accessibilityState).toEqual({ selected: true });
    expect(everyCardShows(null)).toBe(true);
    await press(sceneryButton());
    expect(random).toHaveBeenCalledTimes(2);
  });

  it('Share and Save wait until every export card has drawn the photograph — again after New Background', async () => {
    await render();
    await press(sceneryButton());
    await exportCardsFit();
    expect(button(copy().share)!.props.disabled).toBe(true);
    await sceneryLoads();
    expect(button(copy().share)!.props.disabled).toBe(false);
    expect(button(copy().saveImage)!.props.disabled).toBe(false);
    await press(newBackground());
    expect(button(copy().share)!.props.disabled).toBe(true);
    await sceneryLoads();
    expect(button(copy().share)!.props.disabled).toBe(false);
    // Colors needs no photograph.
    await press(colorsButton());
    expect(button(copy().share)!.props.disabled).toBe(false);
  });

  it('the preview card never gates export; only the full-size export cards report their photograph', async () => {
    await render();
    await press(sceneryButton());
    expect(previewCard().props.onSceneryLoad).toBeUndefined();
    expect(exportCards().every((card) => typeof card.props.onSceneryLoad === 'function')).toBe(true);
  });

  it('exports the selected photograph: the captured export cards show exactly the previewed background', async () => {
    await render();
    await press(sceneryButton());
    await exportCardsFit();
    await sceneryLoads();
    const atCapture: unknown[] = [];
    state.capture.mockImplementation(async () => {
      atCapture.push(...exportCards().map((card) => card.props.scenery));
      return 'file:///cache/card.png';
    });
    await press(button(copy().share));
    expect(state.capture).toHaveBeenCalledTimes(1);
    expect(atCapture).toEqual([shown()]);
  });

  it('a long ayah`s cards all share one photograph, all must load before export, and every card is exported with it', async () => {
    await render(longAyah());
    await press(sceneryButton());
    await exportCardsFit();
    const count = exportCards().length;
    expect(count).toBeGreaterThan(1);
    expect(everyCardShows(shown())).toBe(true);
    await act(async () => { exportCards()[0].props.onSceneryLoad(true); });
    expect(button(`${copy().shareAllCards} (${count})`)!.props.disabled).toBe(true);
    await sceneryLoads();
    const atCapture: unknown[][] = [];
    state.capture.mockImplementation(async () => {
      atCapture.push(exportCards().map((card) => card.props.scenery));
      return `file:///cache/card-${atCapture.length}.png`;
    });
    await press(button(`${copy().shareAllCards} (${count})`));
    expect(atCapture).toHaveLength(count);
    expect(new Set(atCapture.flat())).toEqual(new Set([shown()]));
    expect(state.share.mock.calls[0][0]).toHaveLength(count);
  });

  it('a photograph that fails to load blocks export and says so; New Background recovers', async () => {
    await render();
    await press(sceneryButton());
    await exportCardsFit();
    await sceneryLoads(false);
    expect(text()).toContain(copy().sceneryLoadFailed);
    expect(button(copy().share)!.props.disabled).toBe(true);
    await press(newBackground());
    expect(text()).not.toContain(copy().sceneryLoadFailed);
    await sceneryLoads();
    expect(button(copy().share)!.props.disabled).toBe(false);
  });

  it('categories and New Background are locked while cards are being exported', async () => {
    let finish!: (value: string) => void;
    state.share.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render();
    await press(sceneryButton());
    await exportCardsFit();
    await sceneryLoads();
    await act(async () => { void button(copy().share)!.props.onPress(); });
    for (const label of [copy().backgroundColors, copy().backgroundScenery, copy().newBackground]) {
      expect(button(label)!.props.disabled, label).toBe(true);
    }
    await act(async () => finish('shared'));
    expect(newBackground()!.props.disabled).toBe(false);
  });

  it.each(['ar', 'ar-EG'] as const)('%s: الألوان / المناظر الطبيعية / خلفية جديدة, laid out right to left', async (locale) => {
    state.locale = locale;
    await render();
    expect([copy().backgroundColors, copy().backgroundScenery, copy().newBackground]).toEqual(['الألوان', 'المناظر الطبيعية', 'خلفية جديدة']);
    const categories = colorsButton()!.parent!;
    expect(categories.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ flexDirection: 'row-reverse' })]));
    expect(categories.findAllByType('Pressable' as never).map((node) => node.props.accessibilityLabel)).toEqual(['الألوان', 'المناظر الطبيعية']);
    await press(sceneryButton());
    const refresh = newBackground()!;
    expect(refresh.findByType('Text' as never).props.children).toBe('خلفية جديدة');
    expect(refresh.props.style({ pressed: false })).toEqual(expect.arrayContaining([expect.objectContaining({ flexDirection: 'row-reverse' })]));
    await sceneryLoads(false);
    expect(text()).toContain(MESSAGES[locale].share.sceneryLoadFailed);
  });
});
