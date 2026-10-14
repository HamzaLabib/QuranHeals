import { describe, expect, it } from 'vitest';

import { MESSAGES } from '@/localization/messages';
import { applyToWirdLabel, navigationArrow, pageAtTrackX, trackXOfPage } from '@/mushaf/pageSelector';

/** The page selector's physical rules (mushaf/pageSelector.ts): RTL slider, contextual arrow, the Apply label. */

describe('the RTL slider: page 1 at the right, page 604 at the left, whole pages only', () => {
  const W = 300;
  it('the ends and the middle', () => {
    expect(pageAtTrackX(W, W)).toBe(1);
    expect(pageAtTrackX(0, W)).toBe(604);
    expect(pageAtTrackX(W / 2, W)).toBe(303); // 1 + round(0.5 × 603)
  });
  it('dragging left raises the page, dragging right lowers it; every value is an integer 1–604', () => {
    let previous = pageAtTrackX(W, W);
    for (let x = W; x >= 0; x -= 0.7) {
      const page = pageAtTrackX(x, W);
      expect(Number.isInteger(page)).toBe(true);
      expect(page).toBeGreaterThanOrEqual(previous);
      previous = page;
    }
    expect(pageAtTrackX(-50, W)).toBe(604); // beyond the ends: clamped
    expect(pageAtTrackX(W + 50, W)).toBe(1);
  });
  it('every page has its own position, and reading it back gives the same page', () => {
    for (let page = 1; page <= 604; page++) expect(pageAtTrackX(trackXOfPage(page, W), W)).toBe(page);
    expect(trackXOfPage(1, W)).toBe(W);
    expect(trackXOfPage(604, W)).toBe(0);
  });
  it('a track with no width yet never produces a page out of range', () => {
    expect(pageAtTrackX(10, 0)).toBe(1);
    expect(trackXOfPage(300, 0)).toBe(0);
  });
});

describe('the contextual arrow beside the selected number', () => {
  it('higher page → left arrow (on the number`s left); lower → right arrow (on its right); same → none', () => {
    expect(navigationArrow(200, 125)).toBe('left');
    expect(navigationArrow(60, 125)).toBe('right');
    expect(navigationArrow(125, 125)).toBeNull();
    expect(navigationArrow(604, 1)).toBe('left');
    expect(navigationArrow(1, 604)).toBe('right');
  });
});

describe('Apply to [Wird name] Wird', () => {
  const en = MESSAGES.en.mushaf;
  const ar = MESSAGES.ar.mushaf;
  const strip = (label: string) => label.replace(/[⁨⁩]/g, '');
  it('English: the actual name, never the placeholder, and "Wird" never doubled', () => {
    expect(strip(applyToWirdLabel('Morning', en))).toBe('Apply to Morning Wird');
    expect(strip(applyToWirdLabel('Morning Wird', en))).toBe('Apply to Morning Wird');
    expect(strip(applyToWirdLabel('wird of Fajr', en))).toBe('Apply to wird of Fajr');
    expect(applyToWirdLabel('Morning', en)).not.toContain('{name}');
    // "Wirdless" is not the word Wird.
    expect(strip(applyToWirdLabel('Wirdless', en))).toBe('Apply to Wirdless Wird');
  });
  it('Arabic wording around the user`s own name, which keeps its own direction (isolated)', () => {
    expect(strip(applyToWirdLabel('الفجر', ar))).toBe('تطبيق على ورد الفجر');
    expect(strip(applyToWirdLabel('ورد الفجر', ar))).toBe('تطبيق على ورد الفجر');
    expect(strip(applyToWirdLabel('الورد اليومي', ar))).toBe('تطبيق على الورد اليومي');
    // A Latin name inside the Arabic label: wrapped in first-strong isolates, so it reads left to right in place.
    expect(applyToWirdLabel('Morning', ar)).toBe('تطبيق على ورد ⁨Morning⁩');
  });
});
