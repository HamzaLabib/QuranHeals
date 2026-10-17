import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The shareable image card's content and its fit measurement (mocked React Native host components). */

vi.mock('lucide-react-native', () => ({ Leaf: 'Leaf', PenLine: 'PenLine' }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios },
  Image: 'Image',
  Text: 'Text',
  View: 'View',
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop' }));
// The bundled photographs themselves: tests/shareCardScenery.test.ts checks the real files.
vi.mock('@/constants/shareCardSceneryImages', () => ({
  SHARE_CARD_SCENERY_IMAGES: new Proxy({}, { get: (_target, id) => ({ testUri: `scenery:${String(id)}` }) }),
}));

import { ShareAyahCard } from '@/components/ShareAyahCard';
import { SCENERY_CARD_THEME, SHARE_CARD_SCENERY, sceneryEdgeOpacity } from '@/constants/shareCardScenery';
import { SHARE_CARD_THEMES } from '@/constants/shareCardThemes';
import { QURAN_TEXT_CARD_ATTRIBUTION, REFLECTION_INVITATION, SHARE_CARD_FORMAT_SPECS, type ShareCardPage } from '@/utils/shareCardLayout';

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
      page, format: 'story', theme: 'sage', scenery: null, width: 360, reference: REFERENCE, translationCredit: 'Marmaduke Pickthall', ...extra,
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

describe('pen icon and leaf divider', () => {
  it.each(['sage', 'cream', 'dark'] as const)('%s, every format: a thin pen beside the invitation and a leaf divider under the reference, in the reference colours, never interactive', async (theme) => {
    for (const format of ['story', 'post', 'square'] as const) {
      await render(onePage, { theme, format });
      const colors = SHARE_CARD_THEMES[theme];

      const pen = root.root.findByType('PenLine' as never);
      expect(pen.props).toMatchObject({ color: colors.reference, strokeWidth: 1.5 });
      const english = texts().find((node) => node.props.children === REFLECTION_INVITATION.en)!;
      expect(pen.parent).toBe(english.parent); // same row as the invitation
      expect(pen.props.size).toBeLessThanOrEqual(styleOf(english).fontSize as number);

      const ornament = root.root.find((node) => node.props.testID === 'share-card-ornament');
      expect(ornament.props.accessibilityElementsHidden).toBe(true);
      expect(ornament.findByType('Leaf' as never).props).toMatchObject({ color: colors.divider, strokeWidth: 1.5 });
      expect(ornament.findAllByType('View' as never).filter((node) => node !== ornament)).toHaveLength(2); // the two hairlines
      // Directly after the reference line, inside the measured content block (above the footer invitation).
      const reference = texts().find((node) => node.props.children === REFERENCE)!;
      const siblings = reference.parent!.children as unknown[];
      expect(siblings.indexOf(ornament)).toBe(siblings.indexOf(reference) + 1);

      for (const node of [pen, ornament, pen.parent!]) expect(node.props.onPress).toBeUndefined();
      await act(async () => root.unmount());
    }
  });

  it('the Quran text stays the largest element; no wordmark above the ayah', async () => {
    await render(onePage);
    const quran = texts().find((node) => node.props.children === ARABIC)!;
    expect(root.root.findByType('PenLine' as never).props.size).toBeLessThan(styleOf(quran).fontSize as number);
    expect(strings().indexOf('QURAN HEALS')).toBeGreaterThan(strings().indexOf(ARABIC));
  });
});

describe('Scenery background', () => {
  const images = () => root.root.findAllByType('Image' as never);
  const stops = () => root.root.findAllByType('Stop' as never).map((node) => node.props);

  it('a Colors card draws no photograph and no overlay', async () => {
    await render(onePage, { theme: 'cream' });
    expect(images()).toHaveLength(0);
    expect(root.root.findAllByType('Svg' as never)).toHaveLength(0);
  });

  it.each(['story', 'post', 'square'] as const)('%s: the photograph fills the whole card, cover-cropped, behind every text, with no fade-in', async (format) => {
    await render(onePage, { format, scenery: 'olive-grove', theme: 'dark', width: 270 });
    const card = root.root.findAllByType('View' as never)[0];
    const { width, height } = card.props.style;
    const [image] = images();
    expect(image.props.source).toEqual({ testUri: 'scenery:olive-grove' });
    expect(image.props).toMatchObject({ resizeMode: 'cover', fadeDuration: 0 });
    expect(image.props.style).toMatchObject({ position: 'absolute', top: 0, left: 0, width, height });
    expect(height).toBe(270 * SHARE_CARD_FORMAT_SPECS[format].height / 1080);
    // First child of the card: everything else is drawn on top of it.
    expect(card.children[0]).toBe(image.parent);
    const overlay = root.root.findByType('Svg' as never);
    expect(overlay.props).toMatchObject({ width, height, pointerEvents: 'none' });
  });

  it.each(['story', 'post', 'square'] as const)('%s: the cream overlay is at the photograph`s full strength over the whole text area and fades only outside it', async (format) => {
    for (const { id, overlayOpacity } of SHARE_CARD_SCENERY) {
      await render(onePage, { format, scenery: id });
      const spec = SHARE_CARD_FORMAT_SPECS[format];
      const [top, fullFrom, fullTo, bottom] = stops();
      expect(fullFrom.offset).toBeLessThanOrEqual(spec.paddingTop / spec.height);
      expect(fullTo.offset).toBeGreaterThanOrEqual(1 - spec.paddingBottom / spec.height);
      expect([fullFrom.stopOpacity, fullTo.stopOpacity]).toEqual([overlayOpacity, overlayOpacity]);
      expect([top.stopOpacity, bottom.stopOpacity]).toEqual([sceneryEdgeOpacity(overlayOpacity), sceneryEdgeOpacity(overlayOpacity)]);
      expect([top.offset, bottom.offset]).toEqual([0, 1]);
      for (const stop of stops()) expect(stop.stopColor).toBe('#F7F2EA');
      const gradient = root.root.findByType('LinearGradient' as never);
      expect(root.root.findByType('Rect' as never).props.fill).toBe(`url(#${gradient.props.id})`);
      await act(async () => root.unmount());
    }
  });

  it('shows exactly the same, live text as a Colors card, in the Scenery inks — nothing is baked into the photograph', async () => {
    await render(onePage);
    const colorStrings = strings();
    await act(async () => root.unmount());
    await render(onePage, { scenery: 'soft-clouds' });
    expect(strings()).toEqual(colorStrings);
    const arabic = texts().find((node) => node.props.children === ARABIC)!;
    expect(styleOf(arabic)).toMatchObject({ color: SCENERY_CARD_THEME.arabic, writingDirection: 'rtl' });
    expect(styleOf(texts().find((node) => node.props.children === onePage.translation)!).color).toBe(SCENERY_CARD_THEME.translation);
    expect(styleOf(texts().find((node) => node.props.children === REFERENCE)!).color).toBe(SCENERY_CARD_THEME.reference);
    expect(styleOf(texts().find((node) => node.props.children === 'QURAN HEALS')!).color).toBe(SCENERY_CARD_THEME.branding);
    expect(root.root.findAllByType('View' as never)[0].props.style.backgroundColor).toBe(SCENERY_CARD_THEME.background);
  });

  it('reports when the photograph has loaded, or failed to', async () => {
    const onSceneryLoad = vi.fn();
    await render(onePage, { scenery: 'alpine-lake', onSceneryLoad });
    await act(async () => images()[0].props.onLoad());
    expect(onSceneryLoad).toHaveBeenLastCalledWith(true);
    await act(async () => images()[0].props.onError());
    expect(onSceneryLoad).toHaveBeenLastCalledWith(false);
  });

  it('a different photograph replaces the image source', async () => {
    await render(onePage, { scenery: 'alpine-lake' });
    await act(async () => root.update(createElement(ShareAyahCard, {
      page: onePage, format: 'story', theme: 'sage', scenery: 'golden-dunes', width: 360, reference: REFERENCE, translationCredit: null,
    })));
    expect(images()).toHaveLength(1);
    expect(images()[0].props.source).toEqual({ testUri: 'scenery:golden-dunes' });
  });
});
