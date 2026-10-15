import { QCF_V1_LINE_BOX_EM, QCF_V1_METRICS, qcfV1AndroidRowShiftEm, qcfV1DrawnLineShiftEm, qcfV1IntendedBaselineUnits, surahHeadingShift } from './ayahMarkers';
import { SURAH_HEADING_NEIGHBOURS } from './generated/surahHeadingNeighbours';
import { mushafTextLift, textVerticalInset } from './pageGeometry';

/**
 * Where a Surah heading row (its ornament and name, which fill the row) is drawn, from the real ink next to it
 * (2026-10-12).
 *
 * Its place is first the approved one: moved down with the Quran lines as the platform draws them, plus a clearance
 * (surahHeadingShift). Then it is kept inside its own gap, HEADING_INK_CLEARANCE_PT clear of:
 * - the lowest ink of the line above (letters, marks, medallions: generated/surahHeadingNeighbours.ts);
 * - the highest ink of the row below (the Basmala, or for Surahs 1 and 9 a Quran line);
 * - the frame's inner edge (the text area is mushafTextLift up in the frame), which a heading on a page's last
 *   line may reach past the text area towards.
 * Every neighbour is placed as the platform draws it (iOS draws QPC V1 glyphs lower; Android's rows move by the same;
 * the web neither). A gap narrower than the row plus both clearances: the heading is centred in it (page 506 on the
 * widest phones, 0.48 pt each side; the only one, checked in surahHeadingClearance.test.ts).
 */
export const HEADING_INK_CLEARANCE_PT = 0.5;

/**
 * iOS draws an ayah medallion from the baseline it reports, measured 399–500 font units above the glyphs' drawn
 * baseline (iPhone screenshots of pages 5 and 61). For a Quran line below a heading the medallion's top is taken that
 * much higher on iOS (the line above's medallions only get further away).
 */
export const IOS_MEDALLION_LIFT_UNITS = 500;

const UPM = QCF_V1_METRICS.unitsPerEm;
const LINE_BOX = QCF_V1_LINE_BOX_EM * UPM;

export type SurahHeadingPlacementInput = {
  page: number;
  line: number;
  os: string;
  fontSize: number;
  rowPitch: number;
  /** A row's top in the text area (QpcV1PageText's rowTop: pages 1–2 have their own block). */
  rowTop: (line: number) => number;
  textWidth: number;
  textHeight: number;
};

/** The heading row's top in the text area (pt), and the gap it was placed in (for tests and audits). */
export function placeSurahHeading({ page, line, os, fontSize, rowPitch, rowTop, textWidth, textHeight }: SurahHeadingPlacementInput) {
  const preferred = rowTop(line) + surahHeadingShift(page, os, fontSize, rowPitch);
  const neighbours = SURAH_HEADING_NEIGHBOURS[page]?.find((n) => n.line === line);
  const inset = textVerticalInset(textWidth);
  const lift = mushafTextLift(textWidth, os);
  const frameTop = -(inset - lift);
  const frameBottom = textHeight + inset + lift;
  if (!neighbours) return { top: preferred, upper: frameTop, lower: frameBottom };
  const em = fontSize / UPM;
  const baseline = (row: number, fontPage: number) =>
    rowTop(row) + rowPitch / 2 + (qcfV1IntendedBaselineUnits(fontPage) - LINE_BOX / 2) * em + (qcfV1DrawnLineShiftEm(fontPage, os) + qcfV1AndroidRowShiftEm(fontPage, os)) * fontSize;
  let upper = frameTop;
  if (neighbours.above !== undefined) upper = Math.max(upper, baseline(line - 1, page) - neighbours.above * em);
  let lower = frameBottom;
  const below = neighbours.below;
  if (below?.kind === 'basmala') lower = Math.min(lower, baseline(line + 1, 1) - below.high * em);
  if (below?.kind === 'line') {
    const medallion = below.medallionTop !== undefined && os === 'ios' ? below.medallionTop + IOS_MEDALLION_LIFT_UNITS : -Infinity;
    lower = Math.min(lower, baseline(line + 1, page) - Math.max(below.high, medallion) * em);
  }
  const room = lower - upper - rowPitch;
  const clearance = Math.min(HEADING_INK_CLEARANCE_PT, room / 2);
  const top = Math.min(Math.max(preferred, upper + clearance), lower - rowPitch - clearance);
  return { top, upper, lower };
}
