import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => undefined } }));

const { GUIDE_STEPS, computeGuidePlacement, isGuideFinished, parseGuideProgress, GUIDE_ARROW_LENGTH, GUIDE_HIGHLIGHT_PAD } = await import('@/mushaf/mushafGuide');
const { MESSAGES } = await import('@/localization/messages');

/** The first-time Mushaf guide's pure parts (mushaf/mushafGuide.ts); the overlay itself is rendered in mushafScreen.test.ts. */
describe('steps and saved progress', () => {
  it('six steps in the reversed order (2026-10-17), each carrying its own text with its own control', () => {
    expect(GUIDE_STEPS.map((step) => step.target)).toEqual(['marker', 'ayah', 'juz', 'page', 'hizb', 'surah']);
    expect(GUIDE_STEPS.map((step) => step.text)).toEqual(['guideMarker', 'guideAyah', 'guideJuz', 'guidePage', 'guideHizb', 'guideSurah']);
  });

  it('saved progress is validated: unknown, damaged or out-of-range values mean "not seen, from step 1"', () => {
    expect(parseGuideProgress(null)).toEqual({ status: 'unseen', step: 0 });
    expect(parseGuideProgress({ status: 'unseen', step: 3, order: 2 })).toEqual({ status: 'unseen', step: 3 });
    for (const bad of [{ status: 'unseen', step: 6, order: 2 }, { status: 'unseen', step: -1 }, { status: 'unseen', step: 1.5 }, { status: 'other' }, 'done', 42]) {
      expect(parseGuideProgress(bad)).toEqual({ status: 'unseen', step: 0 });
    }
  });

  it('a step saved in the original order restarts at step 1 in the new one', () => {
    expect(parseGuideProgress({ status: 'unseen', step: 3 })).toEqual({ status: 'unseen', step: 0 });
  });

  it('done: closed early (finished false) or finished; a done saved before this update counts as finished', () => {
    expect(parseGuideProgress({ status: 'done', finished: false })).toEqual({ status: 'done', finished: false });
    expect(parseGuideProgress({ status: 'done', finished: true })).toEqual({ status: 'done', finished: true });
    expect(parseGuideProgress({ status: 'done' })).toEqual({ status: 'done', finished: true });
    expect(isGuideFinished({ status: 'done', finished: true })).toBe(true);
    expect(isGuideFinished({ status: 'done', finished: false })).toBe(false);
    expect(isGuideFinished({ status: 'unseen', step: 5 })).toBe(false);
    expect(isGuideFinished(null)).toBe(false);
  });

  it('every guide text exists in English and Arabic; only the ورد step`s Arabic wording changed («وقم بالتأكيد»)', () => {
    for (const locale of ['en', 'ar', 'ar-EG'] as const) for (const step of GUIDE_STEPS) expect(MESSAGES[locale].mushaf[step.text].length, `${locale} ${step.text}`).toBeGreaterThan(0);
    expect(MESSAGES.ar.mushaf.guideMarker).toBe('اضغط على رقم الآية وقم بالتأكيد لحفظ موضع الوِرد');
    expect(MESSAGES['ar-EG'].mushaf.guideMarker).toBe(MESSAGES.ar.mushaf.guideMarker);
    expect(MESSAGES.en.mushaf.guideMarker).toBe("Tap an ayah's number, then Apply, to save your Reciting position.");
    // No guide text refers to a step by its number or position.
    for (const locale of ['en', 'ar'] as const) for (const step of GUIDE_STEPS) expect(MESSAGES[locale].mushaf[step.text]).not.toMatch(/step|first|last|next|الخطوة|أولا|أخير|التالي/i);
  });
});

describe('placement from the measured control', () => {
  const screens = [{ width: 375, height: 667 }, { width: 390, height: 844 }, { width: 440, height: 956 }, { width: 360, height: 740 }, { width: 412, height: 915 }, { width: 800, height: 1280 }];
  const safe = { top: 47, bottom: 34 };

  it('a control in the upper half: the card below it, the arrow from the card`s top edge up to the highlight', () => {
    for (const screen of screens) {
      const target = { x: 20, y: 90, width: 140, height: 24 };
      const placement = computeGuidePlacement(target, screen, safe);
      expect(placement.side).toBe('below');
      expect(placement.hole).toEqual({ x: 20 - GUIDE_HIGHLIGHT_PAD, y: 90 - GUIDE_HIGHLIGHT_PAD, width: 140 + 2 * GUIDE_HIGHLIGHT_PAD, height: 24 + 2 * GUIDE_HIGHLIGHT_PAD });
      expect('top' in placement.card && placement.card.top).toBe(90 + 24 + GUIDE_HIGHLIGHT_PAD + GUIDE_ARROW_LENGTH);
      expect(placement.arrow.toY).toBe(placement.hole.y + placement.hole.height);
      expect(placement.arrow.fromY - placement.arrow.toY).toBe(GUIDE_ARROW_LENGTH);
    }
  });

  it('a control in the lower half: the card above it, the arrow down to the highlight', () => {
    for (const screen of screens) {
      const target = { x: screen.width / 2 - 40, y: screen.height - 120, width: 80, height: 22 };
      const placement = computeGuidePlacement(target, screen, safe);
      expect(placement.side).toBe('above');
      expect('bottom' in placement.card && placement.card.bottom).toBe(screen.height - (placement.hole.y - GUIDE_ARROW_LENGTH));
      expect(placement.arrow.toY).toBe(placement.hole.y);
    }
  });

  it('the card stays inside the screen with 16 pt margins (at most 360 wide); the arrow stays on the card, aimed at the control`s centre where it can', () => {
    for (const screen of screens) {
      for (const x of [0, screen.width / 2, screen.width - 30]) {
        const target = { x, y: 100, width: 30, height: 20 };
        const placement = computeGuidePlacement(target, screen, safe);
        expect(placement.card.left).toBeGreaterThanOrEqual(16);
        expect(placement.card.left + placement.card.width).toBeLessThanOrEqual(screen.width - 16);
        expect(placement.card.width).toBeLessThanOrEqual(360);
        expect(placement.arrow.x).toBeGreaterThanOrEqual(placement.card.left + 22);
        expect(placement.arrow.x).toBeLessThanOrEqual(placement.card.left + placement.card.width - 22);
        const centre = x + 15;
        if (centre >= placement.card.left + 22 && centre <= placement.card.left + placement.card.width - 22) expect(placement.arrow.x).toBe(centre);
      }
    }
  });
});
