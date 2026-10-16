/**
 * Unicode Mushaf prototype — on-device diagnostics (development builds only; the reader's "Check" chip).
 *
 * The layout places words from HarfBuzz widths measured at build time. On a phone the platform shapes the text itself
 * (iOS: CoreText; Android: Minikin, with HarfBuzz). If its advance for a word differs, the word sits off-centre in its
 * slot and, by more than a gap, could touch its neighbour — the kind of problem only a device shows. Each word's Text
 * reports what the platform laid out (onTextLayout: the line's width, its y and ascender); this compares it with the
 * layout and summarises it per page, for the Metro log and a badge on the page, so device testing yields numbers
 * rather than impressions.
 *
 * Caveats (docs/unicode-mushaf/device-testing-checklist.md): onTextLayout reports the platform's layout, not pixels.
 * On iOS it did not match where TextKit drew the QCF glyphs (2026-10-12), so baseline figures are indicative only;
 * screenshots remain the authority. Widths are reliable on both platforms.
 */

/** The check mode's own colours (development only; the same in Light and Dark, chosen to show on both papers). */
export const CHECK_COLORS = {
  slot: 'rgba(200, 30, 30, 0.55)',
  baseline: 'rgba(30, 90, 200, 0.55)',
  badgeBackground: 'rgba(255, 255, 255, 0.85)',
  badgeText: '#7A1010',
} as const;

export type WordMeasure = {
  line: number;
  index: number;
  verseKey: string;
  /** The layout's advance for the word (px) and where it sits (its slot's left edge). */
  expectedWidth: number;
  x: number;
  /** What the platform laid out: the line width, and the baseline from the Text's top (y + ascender). */
  measuredWidth: number;
  measuredBaseline: number;
  /** Where the layout means the baseline, from the same top. */
  expectedBaseline: number;
};

export type UnicodeDiagnosticsReport = {
  page: number;
  words: number;
  widthMaxDelta: number;
  widthMeanAbsDelta: number;
  /** Words whose platform width differs from the layout's by more than 1 px. */
  widthOver1px: number;
  baselineMaxDelta: number;
  /** Neighbouring words whose platform-drawn extents (centred in their slots) would touch or overlap. */
  touching: string[];
};

/** Summary of one page's measurements. Pure. */
export function summarise(page: number, measures: readonly WordMeasure[]): UnicodeDiagnosticsReport {
  let widthMax = 0;
  let widthSum = 0;
  let over = 0;
  let baselineMax = 0;
  const touching: string[] = [];
  const byLine = new Map<number, WordMeasure[]>();
  for (const m of measures) {
    const delta = m.measuredWidth - m.expectedWidth;
    if (Math.abs(delta) > Math.abs(widthMax)) widthMax = delta;
    widthSum += Math.abs(delta);
    if (Math.abs(delta) > 1) over += 1;
    const baseline = m.measuredBaseline - m.expectedBaseline;
    if (Math.abs(baseline) > Math.abs(baselineMax)) baselineMax = baseline;
    byLine.set(m.line, [...(byLine.get(m.line) ?? []), m]);
  }
  for (const [line, words] of byLine) {
    // Right to left: each word's drawn left edge against the next word's drawn right edge.
    const sorted = [...words].sort((a, b) => b.x - a.x);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const aLeft = a.x + (a.expectedWidth - a.measuredWidth) / 2;
      const bRight = b.x + (b.expectedWidth + b.measuredWidth) / 2;
      if (aLeft - bRight < 0.5) touching.push(`line ${line}: ${a.verseKey} / ${b.verseKey} (${(aLeft - bRight).toFixed(1)} px)`);
    }
  }
  return {
    page,
    words: measures.length,
    widthMaxDelta: widthMax,
    widthMeanAbsDelta: measures.length ? widthSum / measures.length : 0,
    widthOver1px: over,
    baselineMaxDelta: baselineMax,
    touching,
  };
}

/** One line for the badge and the log. */
export function describeReport(r: UnicodeDiagnosticsReport): string {
  return `p${r.page}: ${r.words} words · width Δmax ${r.widthMaxDelta.toFixed(2)} px, mean ${r.widthMeanAbsDelta.toFixed(2)}, >1px ${r.widthOver1px} · baseline Δmax ${r.baselineMaxDelta.toFixed(2)} px · touching ${r.touching.length}`;
}
