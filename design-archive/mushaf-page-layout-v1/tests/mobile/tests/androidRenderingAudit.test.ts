import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

/**
 * Android rendering audit (tools/mushaf-audit/audit_android_rendering.py; report committed beside it), 2026-10-12.
 * Every word occurrence on all 604 pages, the Basmala, and 104 Android configurations (6 phone sizes × system bars ×
 * densities × Normal/Full-Screen, page sizes from the app's fitMushafPage). Pinned so that a change to the drawing room,
 * the lift, the Android baseline parity or the font data shows here.
 */
const report = JSON.parse(readFileSync(new URL('../../tools/mushaf-audit/android-rendering.report.json', import.meta.url), 'utf8'));
const { ANDROID_MATCHES_IPHONE_BASELINE, QCF_V1_INK_OVERFLOW_EM, QCF_V1_INK_ROOM_V_EM, QCF_V1_NORMAL_BOX_MARGIN_EM } = await import('@/mushaf/ayahMarkers');
const { MUSHAF_TEXT_LIFT_PT } = await import('@/mushaf/pageGeometry');

describe('Android rendering audit, all 604 pages', () => {
  it('was run with the app`s drawing room, lift and Android baseline parity, over every word and glyph', () => {
    expect(report.constants).toMatchObject({ R_em: QCF_V1_INK_OVERFLOW_EM, RV_em: QCF_V1_INK_ROOM_V_EM, margin_em: { normal: QCF_V1_NORMAL_BOX_MARGIN_EM, fullScreen: 0 }, liftPt: MUSHAF_TEXT_LIFT_PT });
    expect(report.androidMatchesIphoneBaseline).toBe(ANDROID_MATCHES_IPHONE_BASELINE);
    expect(report).toMatchObject({ pages: 604, wordOccurrences: 77429, glyphs: 88444, basmalaGlyphs: 4, configurations: 104 });
    expect(report.androidMetrics).toEqual({ typoPages: [1, 565], otherMetricsPages: { 237: [2327, 1331] } });
    expect(report.multiGlyphWords.count).toBe(4579); // drawn right to left (Arabic presentation forms)
  });

  it('no letter or mark is clipped: at least 1 px of drawable room on every side, after pixel snapping, in every configuration', () => {
    for (const side of ['left', 'right', 'top', 'bottom']) expect(report.minimumPx[side][0], side).toBeGreaterThanOrEqual(1);
    for (const checks of Object.values(report.failuresByConfiguration) as Record<string, number[]>[]) {
      for (const check of Object.keys(checks)) expect(check.startsWith('frame'), check).toBe(true); // only frame contacts
    }
    // The tightest: page 11's 2:70 (a waqf sign 2.155 em past its advance, of 2.4 em room) on the smallest page at 1.5×.
    expect(report.worstEm.left).toEqual([0.2452, 'p11 l2 2:70:14']);
  });

  it('frame: nothing reaches the top; at the bottom the pages the iPhone model flags (approved there), page 556`s left edge within a pixel', () => {
    const pages = (check: string) => [...new Set(Object.values(report.failuresByConfiguration).flatMap((c) => (c as Record<string, number[]>)[check] ?? []))].sort((a, b) => a - b);
    expect(pages('frameTop')).toEqual([]);
    expect(pages('frameRight')).toEqual([]);
    expect(pages('frameLeft')).toEqual([556]);
    expect(pages('frameBottom')).toEqual([5, 26, 65, 142, 202, 381, 459, 467, 550, 553, 556, 560]);
  });
});
