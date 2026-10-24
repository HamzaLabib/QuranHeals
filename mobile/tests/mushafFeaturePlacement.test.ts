import { describe, expect, it, vi } from 'vitest';

// placement.ts reads the theme's spacing, whose module imports react-native: pure geometry needs only this.
vi.mock('react-native', () => ({ Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }, StyleSheet: { create: <T,>(s: T) => s, hairlineWidth: 0.5 } }));

const { BUTTON_SLOP, edgeInset, labelledButtons, MIN_PILL_WIDTH, PILL_CLEARANCE, pillCap, placeFeatureButtons } = await import('@/mushafFeatures/placement');
const { computePageLayout } = await import('@/mushaf/pageGeometry');

/**
 * The feature buttons' placement (mushafFeatures/placement.ts): Meanings LEFT at its approved x (the page frame's left
 * edge, as before Surah Preview existed), the ورد pill centred, Surah Preview RIGHT at the mirrored inset — the same
 * physical order in English and Arabic. Widths are the buttons' as measured on the Android emulator (13-pt semibold,
 * the ورد pill's style): "Meanings ⌄" 102, "Surah Preview ⌄" 129, «المعاني ⌄» 78, «عن السورة ⌄» 95 pt. Arrow-only:
 * FeatureButton's ARROW_ONLY_WIDTH with this mock's 0.5-pt hairline (24 pt padding, the 14-pt chevron, the border).
 */
const WIDTHS = { en: { meanings: 102, preview: 129 }, ar: { meanings: 78, preview: 95 } } as const;
const ARROW = 39;
const H = 26;

/** As the reader lays them out: the pill capped for the arrow-only buttons, then each labelled only where it clears it. */
function layout(areaWidth: number, pageWidth: number, pillWidth: number, opts: { tilesDown?: number; withPreview?: boolean; locale?: 'en' | 'ar'; inset?: number } = {}) {
  const { tilesDown = 29, withPreview = true, locale = 'en' } = opts;
  const w = WIDTHS[locale];
  const inset = opts.inset ?? edgeInset({ areaWidth, pageWidth, tilesDown, rowLeft: 0, page604: false });
  const cap = pillCap({ inset, areaWidth, rowCentre: areaWidth / 2, meaningsWidth: ARROW, previewWidth: withPreview ? ARROW : null });
  // The pill as laid out: its natural width, at most its cap (a long name ends in “…”), centred.
  const width = Math.min(pillWidth, cap.maxWidth ?? Infinity);
  const pill = { left: (areaWidth - width) / 2, top: 800, width, height: H };
  const labelled = labelledButtons({ pill, inset, areaWidth, meaningsWidth: w.meanings, previewWidth: withPreview && cap.previewFits ? w.preview : null });
  const drawn = { meanings: labelled.meanings ? w.meanings : ARROW, preview: labelled.preview ? w.preview : ARROW };
  const places = placeFeatureButtons({
    pill, inset, areaWidth, minTop: 790,
    meanings: { width: drawn.meanings, height: H },
    preview: withPreview && cap.previewFits ? { width: drawn.preview, height: H } : null,
  });
  return { inset, cap, pill, places, w, labelled, drawn };
}

describe('Mushaf feature buttons: placement', () => {
  it("Meanings keeps its approved x (the page frame's left edge) and Surah Preview mirrors it from the right", () => {
    const { inset, places, w } = layout(411, 405, 69);
    expect(inset).toBe((411 - 405) / 2 + computePageLayout(405, 29).frame.x);
    expect(places.meanings!.left).toBe(inset);
    expect(411 - (places.preview!.left + w.preview)).toBeCloseTo(inset, 9);
  });

  it('one line: all three centred on the pill, with a 44-pt touch target, never above minTop', () => {
    const { places, pill } = layout(411, 405, 69);
    for (const place of [places.meanings!, places.preview!]) {
      expect(place.top + H / 2).toBe(pill.top + pill.height / 2);
      expect(H + place.slopTop + place.slopBottom).toBe(44);
      expect(place.top - place.slopTop).toBeGreaterThanOrEqual(790);
    }
  });

  it('the same physical order in English and Arabic: Meanings left of the pill, Surah Preview right of it', () => {
    for (const locale of ['en', 'ar'] as const) {
      const { places, pill, w } = layout(411, 405, 69, { locale });
      expect(places.meanings!.left + w.meanings + BUTTON_SLOP).toBeLessThan(pill.left - 8);
      expect(places.preview!.left - BUTTON_SLOP).toBeGreaterThan(pill.left + pill.width + 8);
    }
  });

  it('a long ورد name: both labels give way first (arrow-only), then the name is shortened (“…”) only as far as they need', () => {
    const { places, pill, cap, labelled, drawn } = layout(411, 405, 0.72 * 411);
    expect(labelled).toEqual({ meanings: false, preview: false });
    expect(pill.width).toBe(cap.maxWidth);
    expect(cap.maxWidth).toBe(Math.floor(2 * (411 / 2 - (places.meanings!.left + ARROW + PILL_CLEARANCE))));
    expect(places.meanings!.left + drawn.meanings + PILL_CLEARANCE).toBeLessThanOrEqual(pill.left + 1);
    expect(places.preview!.left).toBeGreaterThanOrEqual(pill.left + pill.width + PILL_CLEARANCE);
    // Arrow-only keeps a 44-pt touch target across (its 4-pt side slop) and the same mirrored inset.
    expect(ARROW + 2 * BUTTON_SLOP).toBeGreaterThanOrEqual(44);
    expect(411 - (places.preview!.left + ARROW)).toBeCloseTo(places.meanings!.left, 9);
  });

  it('a short name: both labelled, exactly where they were', () => {
    const { places, labelled, inset } = layout(411, 405, 69);
    expect(labelled).toEqual({ meanings: true, preview: true });
    expect(places.meanings!.left).toBe(inset);
    expect(places.preview!.left).toBeCloseTo(411 - inset - WIDTHS.en.preview, 9);
  });

  it('only the side that needs the room collapses; one point less and it is labelled again', () => {
    // English: Surah Preview (129) is wider than Meanings (102), so a pill can reach it alone.
    const inset = edgeInset({ areaWidth: 411, pageWidth: 405, tilesDown: 29, rowLeft: 0, page604: false });
    const previewRoom = 411 - 2 * (inset + WIDTHS.en.preview + PILL_CLEARANCE);
    expect(layout(411, 405, previewRoom + 2).labelled).toEqual({ meanings: true, preview: false });
    expect(layout(411, 405, previewRoom).labelled).toEqual({ meanings: true, preview: true });
  });

  it('pages where no Surah begins: only Meanings, and the pill is narrowed only for its arrow-only form', () => {
    const { places, cap, labelled } = layout(411, 405, 0.72 * 411, { withPreview: false });
    expect(places.preview).toBeNull();
    expect(places.meanings).not.toBeNull();
    expect(labelled.meanings).toBe(false);
    expect(cap.maxWidth).toBe(Math.floor(2 * (411 / 2 - (places.meanings!.left + ARROW + PILL_CLEARANCE))));
  });

  it('Meanings is never hidden; Surah Preview is not shown only where even arrow-only buttons would leave the pill under MIN_PILL_WIDTH', () => {
    // Hypothetical 200-pt wide area: arrow-only buttons on both sides would leave the pill 2 × (100 − (20 + 39 + 16)) = 50 pt.
    const { places, cap } = layout(200, 160, 69, { inset: 20 });
    expect(2 * (100 - (20 + ARROW + PILL_CLEARANCE))).toBeLessThan(MIN_PILL_WIDTH);
    expect(cap.previewFits).toBe(false);
    expect(places.meanings).not.toBeNull();
    expect(places.preview).toBeNull();
    // The cap is then Meanings' alone.
    expect(cap.maxWidth).toBe(Math.floor(2 * (100 - (20 + ARROW + PILL_CLEARANCE))));
  });

  // SIMULATION (no iOS device or simulator here): iPhone widths in points, width-limited pages (fitMushafPage on tall
  // phones: the width less 6 pt), the measured Android widths above (iOS text may differ slightly). A short name and a
  // 40-character one (its natural width beyond the pill's own 72% maximum).
  const IPHONES: [string, number][] = [['375 (12/13 mini)', 375], ['393 (15, 16)', 393], ['402 (16 Pro)', 402], ['430 (16 Plus)', 430], ['440 (16 Pro Max)', 440]];
  for (const [name, width] of IPHONES) {
    for (const locale of ['en', 'ar'] as const) {
      for (const pillWidth of [69, 0.72 * width]) {
        it(`simulated iPhone ${name}, ${locale}, ${pillWidth === 69 ? 'short' : 'long'} name: Meanings left, pill centred, Surah Preview right, no overlap`, () => {
          const { places, pill, cap, labelled, drawn } = layout(width, width - 6, pillWidth, { locale });
          expect(cap.previewFits).toBe(true);
          if (pillWidth === 69) expect(labelled).toEqual({ meanings: true, preview: true });
          expect(places.meanings!.left + drawn.meanings + PILL_CLEARANCE).toBeLessThanOrEqual(pill.left + 1e-9);
          expect(places.preview!.left).toBeGreaterThanOrEqual(pill.left + pill.width + PILL_CLEARANCE - 1e-9);
          expect(places.preview!.left + drawn.preview).toBeLessThanOrEqual(width);
        });
      }
    }
  }

  // Narrow screens (insets from fitMushafPage): where a label would reach the pill, that button is arrow-only, at the
  // same inset; the pill keeps at least MIN_PILL_WIDTH and neither button is lost (before: Meanings' label crushed the
  // pill to 25–69 pt on ≤ 360-pt English screens, and Surah Preview was not shown).
  for (const [name, areaWidth, inset, locale] of [['iPhone SE 3 (375 × 667), English', 375, 25.5, 'en'], ['320 × 568, Arabic', 320, 29.5, 'ar'], ['320 × 568, English', 320, 29.5, 'en'], ['360 × 640, English', 360, 27, 'en']] as const) {
    it(`narrow: ${name}`, () => {
      const { places, pill, cap, labelled, drawn } = layout(areaWidth, areaWidth, 110, { locale, inset });
      expect(cap.previewFits).toBe(true);
      expect(pill.width).toBeGreaterThanOrEqual(MIN_PILL_WIDTH);
      expect(labelled.meanings).toBe(inset + WIDTHS[locale].meanings + PILL_CLEARANCE <= pill.left + 0.5);
      expect(labelled.preview).toBe(areaWidth - inset - WIDTHS[locale].preview >= pill.left + pill.width + PILL_CLEARANCE - 0.5);
      expect(places.meanings!.left).toBe(inset);
      expect(places.preview!.left).toBeCloseTo(areaWidth - inset - drawn.preview, 9);
      expect(places.meanings!.left + drawn.meanings + PILL_CLEARANCE).toBeLessThanOrEqual(pill.left + 1e-9);
      expect(places.preview!.left).toBeGreaterThanOrEqual(pill.left + pill.width + PILL_CLEARANCE - 1e-9);
    });
  }
});
