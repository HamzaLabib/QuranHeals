import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The shareable image card's content and its fit measurement (mocked React Native host components). */

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  Text: 'Text',
  View: 'View',
}));

import { ShareAyahCard } from '@/components/ShareAyahCard';
import { SHARE_CARD_THEMES } from '@/constants/shareCardThemes';
import { QURAN_TEXT_CARD_ATTRIBUTION, REFLECTION_INVITATION, type ShareCardPage } from '@/utils/shareCardLayout';

const ARABIC = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ';
const REFERENCE = 'Al-Faatiha · 1:1 · الفاتحة';
const onePage: ShareCardPage = {
  key: 'all-1', pageNumber: 1, pageCount: 1, arabic: ARABIC, translation: 'In the name of Allah, the Beneficent, the Merciful.',
  arabicFontSize: 80, translationFontSize: 40,
};

let root: ReactTestRenderer;
const texts = () => root.root.findAllByType('Text' as never);
const strings = () => texts().map((node) => String(node.props.children));
const styleOf = (node: { props: Record<string, unknown> }) => Object.assign({}, ...[node.props.style].flat()) as Record<string, unknown>;
const INVITATION = ['Write your reflection', 'اكتب خاطرتك'];

async function render(page: ShareCardPage, extra: Record<string, unknown> = {}) {
  await act(async () => {
    root = create(createElement(ShareAyahCard, {
      page, format: 'story', theme: 'sage', width: 360, reference: REFERENCE, translationCredit: 'Marmaduke Pickthall', ...extra,
    }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('card content', () => {
  it('shows the exact Arabic, the translation, the reference, the reflection invitation, the branding and both attributions — nothing else', async () => {
    await render(onePage);
    expect(strings()).toEqual([
      ARABIC,
      onePage.translation,
      REFERENCE,
      ...INVITATION,
      'QURAN HEALS',
      QURAN_TEXT_CARD_ATTRIBUTION,
      'Translation: Marmaduke Pickthall',
    ]);
  });

  it('Arabic is right-to-left and is the largest text on the card; nothing follows the system font size', async () => {
    await render(onePage);
    const arabic = texts().find((node) => node.props.children === ARABIC)!;
    expect(arabic.props.style).toMatchObject({ writingDirection: 'rtl', textAlign: 'center' });
    const sizes = texts().map((node) => styleOf(node).fontSize as number);
    expect(Math.max(...sizes)).toBe(arabic.props.style.fontSize);
    expect(texts().every((node) => node.props.allowFontScaling === false)).toBe(true);
  });

  it('an Arabic-only card of a long ayah shows its "2 / 3" position and no translation credit', async () => {
    await render({ ...onePage, key: 'ar-2', pageNumber: 2, pageCount: 3, translation: null });
    expect(strings()).toEqual(['2 / 3', ARABIC, REFERENCE, ...INVITATION, 'QURAN HEALS', QURAN_TEXT_CARD_ATTRIBUTION]);
  });

  it('a translation-only card keeps the reference and the translation credit', async () => {
    await render({ ...onePage, key: 'tr-1', pageNumber: 3, pageCount: 3, arabic: null, arabicFontSize: 0 });
    expect(strings()).toEqual(['3 / 3', onePage.translation, REFERENCE, ...INVITATION, 'QURAN HEALS', QURAN_TEXT_CARD_ATTRIBUTION, 'Translation: Marmaduke Pickthall']);
  });

  it('scales the 1080-unit design to the given width with the format`s aspect ratio and the theme background', async () => {
    await render(onePage, { theme: 'dark', format: 'post', width: 270 });
    const card = root.root.findAllByType('View' as never)[0];
    expect(card.props.style).toMatchObject({ width: 270, height: 337.5, backgroundColor: SHARE_CARD_THEMES.dark.background });
    const arabic = texts().find((node) => node.props.children === ARABIC)!;
    expect(arabic.props.style.fontSize).toBe(20); // 80 units × 270/1080
  });
});

describe('fit measurement', () => {
  const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height } } });

  it('reports whether the content block fits the area reserved for it', async () => {
    const onFitChange = vi.fn();
    await render(onePage, { onFitChange });
    const [area, content] = root.root.findAllByType('View' as never).filter((node) => node.props.onLayout);
    await act(async () => area.props.onLayout(layout(400)));
    expect(onFitChange).not.toHaveBeenCalled(); // needs both measurements
    await act(async () => content.props.onLayout(layout(380)));
    expect(onFitChange).toHaveBeenLastCalledWith(true);
    await act(async () => content.props.onLayout(layout(420)));
    expect(onFitChange).toHaveBeenLastCalledWith(false);
  });
});

describe('reflection invitation', () => {
  it('reads exactly "Write your reflection" and "اكتب خاطرتك"', () => {
    expect(REFLECTION_INVITATION).toEqual({ en: 'Write your reflection', ar: 'اكتب خاطرتك' });
  });

  it.each(['sage', 'cream', 'dark'] as const)('%s, every format: below the Quran text, smaller than it, each language in its own direction, never tappable', async (theme) => {
    for (const format of ['story', 'post', 'square'] as const) {
      await render(onePage, { theme, format });
      const nodes = texts();
      const english = nodes.find((node) => node.props.children === REFLECTION_INVITATION.en)!;
      const arabic = nodes.find((node) => node.props.children === REFLECTION_INVITATION.ar)!;
      const quran = nodes.find((node) => node.props.children === ARABIC)!;
      expect(nodes.indexOf(english)).toBeGreaterThan(nodes.indexOf(quran));
      expect(styleOf(english)).toMatchObject({ writingDirection: 'ltr', color: SHARE_CARD_THEMES[theme].reference });
      expect(styleOf(arabic)).toMatchObject({ writingDirection: 'rtl', color: SHARE_CARD_THEMES[theme].reference });
      expect(styleOf(english).fontSize as number).toBeLessThan(styleOf(quran).fontSize as number);
      expect(english.props.onPress).toBeUndefined();
      expect(english.parent!.props.onPress).toBeUndefined();
      await act(async () => root.unmount());
    }
  });
});
