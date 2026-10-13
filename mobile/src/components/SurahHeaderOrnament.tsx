import { memo } from 'react';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';

import { SURAH_HEADER_INKS } from '@/constants/mushafTheme';
import { BORDER_INKS } from '@/mushaf/borderPattern';

/**
 * Surah heading ornament (approved design "Option A", 2026-10-12): an original vector drawing, made for this app.
 *
 * A gold-framed cartouche with pointed ogee ends; deep emerald end panels filled with gold arabesque (a central
 * rosette, scrolling leaves, palmettes); a cream central panel with lobed ends for the Surah name; and, outside the
 * cartouche, a gold stem with leaf sprigs ending in a floral medallion at each side.
 *
 * Drawn for its box, not scaled from a fixed picture: the heading row is about ten times wider than tall, Option A
 * about seven. Every decorative part keeps its own proportions (sized from the row's height), and only the stems
 * and the central panel take the extra width, so the name always gets more room, never less.
 *
 * The name: the central panel's opening is at least `nameWidth` (the widest name's ink, from the caller) plus a
 * clearance on both sides, and no decoration is drawn over it: the panel is plain, and the frame's lines run at the
 * very top and bottom of the row, outside the names' ink (tools/mushaf-audit: every heading's ink is checked).
 * The central panel has no fill: the Mushaf page's own paper shows behind the name, in every appearance.
 */
const { emerald: EMERALD, emeraldLight: EMERALD_LIGHT, gold: GOLD, goldDeep: GOLD_DEEP } = SURAH_HEADER_INKS;
const CREAM = BORDER_INKS.cream;
const MINT = BORDER_INKS.mint;

/** In units of the row height / 100 (u): the parts' sizes and positions from each end. */
const ROSETTE_X = 19; // the end medallion's centre
const ROSETTE_R = 16;
const TIP_X = 100; // the cartouche's pointed tip
const END_PANEL = 150; // tip → the central panel's end
const FRAME_OUT = 0.25; // the frame's outer edge (top; the bottom mirrors it)
const FRAME_IN = 1.45; // the frame's inner edge: across the name, the panel's top and bottom edge
/** The panel's outline is drawn this far (u) in from each end: round its lobes, not across the name. */
const LOBE = 16;
/** The name's clearance from the panel's ends, in name widths. */
const NAME_CLEARANCE = 0.18;

type SurahHeaderOrnamentProps = {
  width: number;
  height: number;
  left: number;
  top: number;
  /** The widest name's ink width (pt): the central panel opens at least this wide, plus clearance. */
  nameWidth?: number;
  testID: string;
};

const f = (v: number) => Number(v.toFixed(2));

/** A petal pointing up from (0, 0): `l` long, `w` wide. */
const petal = (l: number, w: number) => `M0 0 C${f(w)} ${f(-0.3 * l)} ${f(0.85 * w)} ${f(-0.78 * l)} 0 ${f(-l)} C${f(-0.85 * w)} ${f(-0.78 * l)} ${f(-w)} ${f(-0.3 * l)} 0 0 Z`;
/** A scrolling leaf from (0, 0) to the right, curling up: `s` long. */
const scroll = (s: number) => `M0 0 C${f(0.25 * s)} ${f(-0.42 * s)} ${f(0.7 * s)} ${f(-0.5 * s)} ${f(s)} ${f(-0.2 * s)} C${f(0.72 * s)} ${f(-0.26 * s)} ${f(0.42 * s)} ${f(-0.14 * s)} ${f(0.3 * s)} ${f(0.1 * s)} C${f(0.2 * s)} ${f(0.04 * s)} ${f(0.1 * s)} ${f(0.01 * s)} 0 0 Z`;

/** A floral rosette at (cx, cy): eight emerald petals ringed in gold, gold and mint between, a gold heart. */
function Rosette({ cx, cy, r, u }: { cx: number; cy: number; r: number; u: number }) {
  return (
    <G transform={`translate(${f(cx)} ${f(cy)})`}>
      <Circle r={r * 1.02} fill={CREAM} stroke={GOLD_DEEP} strokeWidth={0.9 * u} />
      {Array.from({ length: 8 }, (_, i) => (
        <Path key={`o${i}`} d={petal(r * 0.96, r * 0.36)} transform={`rotate(${i * 45})`} fill={EMERALD} stroke={GOLD} strokeWidth={0.7 * u} />
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <Path key={`i${i}`} d={petal(r * 0.62, r * 0.2)} transform={`rotate(${i * 45 + 22.5})`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.4 * u} />
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <Path key={`m${i}`} d={petal(r * 0.5, r * 0.13)} transform={`rotate(${i * 45})`} fill={MINT} stroke="none" />
      ))}
      <Circle r={r * 0.24} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.5 * u} />
      <Circle r={r * 0.1} fill={EMERALD} />
    </G>
  );
}

/** One end of the heading, drawn for the left; the right is its mirror image. Coordinates in u. */
function End({ u, panelEnd }: { u: number; panelEnd: number }) {
  const tip = TIP_X;
  const mid = (tip + panelEnd) / 2 + 2; // the end panel's rosette
  return (
    <G transform={`scale(${f(u)})`}>
      {/* The stem: a gold double line from the medallion to the cartouche's tip, with a leaf sprig. */}
      <Path d={`M${ROSETTE_X + ROSETTE_R} 50 H${tip}`} stroke={GOLD_DEEP} strokeWidth={1.6} fill="none" />
      <Path d={`M${ROSETTE_X + ROSETTE_R} 50 H${tip}`} stroke={GOLD} strokeWidth={0.7} fill="none" />
      <G transform={`translate(${tip - 22} 50)`}>
        <Path d={petal(15, 4.6)} transform="rotate(-62)" fill={EMERALD} stroke={GOLD} strokeWidth={0.7} />
        <Path d={petal(15, 4.6)} transform="rotate(-118) scale(1 1)" fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.7} />
        <Path d={petal(15, 4.6)} transform="rotate(62)" fill={EMERALD} stroke={GOLD} strokeWidth={0.7} />
        <Path d={petal(15, 4.6)} transform="rotate(118)" fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.7} />
        <Path d={petal(9, 3)} transform="rotate(-90)" fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.5} />
        <Path d={petal(9, 3)} transform="rotate(90)" fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.5} />
        <Circle r={2.6} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.5} />
      </G>
      <Path d={petal(7, 2.4)} transform={`translate(${ROSETTE_X + ROSETTE_R + 8} 50) rotate(-55)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.4} />
      <Path d={petal(7, 2.4)} transform={`translate(${ROSETTE_X + ROSETTE_R + 8} 50) rotate(-125)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.4} />
      {/* The end medallion, with a pointed gold leaf outward. */}
      <Path d="M0.6 50 C3 47.4 5 46.6 7.5 47.2 C6.6 48.4 6.6 51.6 7.5 52.8 C5 53.4 3 52.6 0.6 50 Z" fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.5} />
      <Rosette cx={ROSETTE_X} cy={50} r={ROSETTE_R} u={1} />

      {/* The end panel's arabesque, over its emerald ground (drawn with the frame): a ring of gold scrolls round a
          rosette, palmettes in the corners, a small rosette at the tip, buds along the edges. */}
      <G>
        {[-1, 1].map((sx) =>
          [-1, 1].map((sy) => (
            <G key={`${sx}${sy}`} transform={`translate(${mid} 50) scale(${sx} ${sy})`}>
              <Path d={scroll(40)} transform="translate(12 -4) rotate(-12)" fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.5} />
              <Path d={scroll(26)} transform="translate(4 -16) rotate(-58)" fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.45} />
              <Path d={petal(14, 4.6)} transform="translate(34 -26) rotate(-128)" fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.55} />
              <Path d={petal(8, 2.6)} transform="translate(34 -26) rotate(-128)" fill={MINT} stroke="none" />
              <Circle cx={46} cy={-10} r={1.7} fill={GOLD} />
            </G>
          )),
        )}
        {[tip + 30, panelEnd - 22].map((x) =>
          [12, 88].map((y) => (
            <G key={`${x}-${y}`} transform={`translate(${x} ${y}) scale(1 ${y < 50 ? 1 : -1})`}>
              <Path d={petal(12, 6)} transform="rotate(180)" fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.55} />
              <Path d={petal(10, 3.6)} transform="rotate(135)" fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.4} />
              <Path d={petal(10, 3.6)} transform="rotate(225)" fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.4} />
              <Circle cy={2} r={1.6} fill={GOLD} />
            </G>
          )),
        )}
        <Path d={petal(15, 6)} transform={`translate(${mid} 4) rotate(180)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.5} />
        <Path d={petal(15, 6)} transform={`translate(${mid} 96)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.5} />
        <Rosette cx={tip + 15} cy={50} r={9.5} u={0.6} />
        <Rosette cx={mid} cy={50} r={21} u={1} />
      </G>
    </G>
  );
}

export const SurahHeaderOrnament = memo(function SurahHeaderOrnament({ width, height, left, top, nameWidth = 0, testID }: SurahHeaderOrnamentProps) {
  const u = height / 100;
  const W = width;
  // The central panel: from the end panels inward; wider than the widest name plus its clearance, the end panels
  // giving way (narrower) if a very narrow screen ever needed it.
  const wanted = nameWidth * (1 + 2 * NAME_CLEARANCE);
  const panelEndU = Math.min(TIP_X + END_PANEL, (W / 2 - wanted / 2) / u - 6);
  const pL = panelEndU * u;
  const pR = W - pL;
  const tipL = TIP_X * u;
  const tipR = W - tipL;
  const yo = FRAME_OUT * u;
  const yi = FRAME_IN * u;
  const H = height;
  const cy = H / 2;
  // The cartouche: pointed ogee ends; `inset` draws the same outline inside the frame band.
  const cartouche = (inset: number) => {
    const t = tipL + inset * 1.6;
    const r = tipR - inset * 1.6;
    const y0 = yo + inset;
    const y1 = H - yo - inset;
    const sh = 40 * u; // the shoulder: tip → the straight top
    return `M${f(t)} ${f(cy)} C${f(t + 0.14 * sh)} ${f(cy - 0.22 * H)} ${f(t + 0.36 * sh)} ${f(y0 + 0.16 * H)} ${f(t + 0.6 * sh)} ${f(y0 + 0.05 * H)} C${f(t + 0.76 * sh)} ${f(y0)} ${f(t + 0.88 * sh)} ${f(y0)} ${f(t + sh)} ${f(y0)} `
      + `H${f(r - sh)} C${f(r - 0.88 * sh)} ${f(y0)} ${f(r - 0.76 * sh)} ${f(y0)} ${f(r - 0.6 * sh)} ${f(y0 + 0.05 * H)} C${f(r - 0.36 * sh)} ${f(y0 + 0.16 * H)} ${f(r - 0.14 * sh)} ${f(cy - 0.22 * H)} ${f(r)} ${f(cy)} `
      + `C${f(r - 0.14 * sh)} ${f(cy + 0.22 * H)} ${f(r - 0.36 * sh)} ${f(y1 - 0.16 * H)} ${f(r - 0.6 * sh)} ${f(y1 - 0.05 * H)} C${f(r - 0.76 * sh)} ${f(y1)} ${f(r - 0.88 * sh)} ${f(y1)} ${f(r - sh)} ${f(y1)} `
      + `H${f(t + sh)} C${f(t + 0.88 * sh)} ${f(y1)} ${f(t + 0.76 * sh)} ${f(y1)} ${f(t + 0.6 * sh)} ${f(y1 - 0.05 * H)} C${f(t + 0.36 * sh)} ${f(y1 - 0.16 * H)} ${f(t + 0.14 * sh)} ${f(cy + 0.22 * H)} ${f(t)} ${f(cy)} Z`;
  };
  // The central panel, with lobed (cusped) ends; `inset` for its inner gold line.
  const panel = (inset: number) => {
    const l = pL + inset;
    const r = pR - inset;
    const y0 = yi + inset;
    const y1 = H - yi - inset;
    const d = 16 * u;
    return `M${f(l + d)} ${f(y0)} H${f(r - d)} C${f(r - 0.45 * d)} ${f(y0)} ${f(r - 0.2 * d)} ${f(y0 + 0.12 * H)} ${f(r - 0.22 * d)} ${f(cy - 0.14 * H)} C${f(r - 0.1 * d)} ${f(cy - 0.06 * H)} ${f(r + 0.25 * d)} ${f(cy - 0.03 * H)} ${f(r + 0.45 * d)} ${f(cy)} `
      + `C${f(r + 0.25 * d)} ${f(cy + 0.03 * H)} ${f(r - 0.1 * d)} ${f(cy + 0.06 * H)} ${f(r - 0.22 * d)} ${f(cy + 0.14 * H)} C${f(r - 0.2 * d)} ${f(y1 - 0.12 * H)} ${f(r - 0.45 * d)} ${f(y1)} ${f(r - d)} ${f(y1)} `
      + `H${f(l + d)} C${f(l + 0.45 * d)} ${f(y1)} ${f(l + 0.2 * d)} ${f(y1 - 0.12 * H)} ${f(l + 0.22 * d)} ${f(cy + 0.14 * H)} C${f(l + 0.1 * d)} ${f(cy + 0.06 * H)} ${f(l - 0.25 * d)} ${f(cy + 0.03 * H)} ${f(l - 0.45 * d)} ${f(cy)} `
      + `C${f(l - 0.25 * d)} ${f(cy - 0.03 * H)} ${f(l + 0.1 * d)} ${f(cy - 0.06 * H)} ${f(l + 0.22 * d)} ${f(cy - 0.14 * H)} C${f(l + 0.2 * d)} ${f(y0 + 0.12 * H)} ${f(l + 0.45 * d)} ${f(y0)} ${f(l + d)} ${f(y0)} Z`;
  };
  return (
    <Svg pointerEvents="none" testID={testID} width={W} height={H} viewBox={`0 0 ${f(W)} ${f(H)}`} style={{ position: 'absolute', left, top }}>
      <Defs>
        <ClipPath id={`${testID}-ends`}>
          <Rect x={0} y={0} width={f(pL + 4 * u)} height={H} />
          <Rect x={f(pR - 4 * u)} y={0} width={f(W - pR + 4 * u)} height={H} />
        </ClipPath>
        <ClipPath id={`${testID}-lobes`}>
          <Rect x={0} y={0} width={f(pL + LOBE * u)} height={H} />
          <Rect x={f(pR - LOBE * u)} y={0} width={f(W - pR + LOBE * u)} height={H} />
        </ClipPath>
      </Defs>
      {/* The frame: a gold band; emerald inside it at the ends only (the end panels' ground). */}
      <Path d={cartouche((yi - yo) / 2)} fill="none" stroke={GOLD} strokeWidth={yi - yo} />
      <Path d={cartouche(0)} fill="none" stroke={GOLD_DEEP} strokeWidth={0.5 * u} />
      <Path d={cartouche(yi - yo)} fill={EMERALD} stroke={GOLD_DEEP} strokeWidth={0.4 * u} clipPath={`url(#${testID}-ends)`} />
      <Path d={cartouche(yi - yo)} fill="none" stroke={GOLD} strokeWidth={1.6 * u} clipPath={`url(#${testID}-ends)`} />
      <End u={u} panelEnd={panelEndU} />
      <G transform={`translate(${f(W)} 0) scale(-1 1)`}>
        <End u={u} panelEnd={panelEndU} />
      </G>
      {/* The central panel: open (no fill), so the page's own paper is behind the name in every appearance; a gold double outline. */}
      {/* Its double gold outline round the lobed ends only: across the name the frame's band is its edge, so no line
          runs through the names' tallest letters or deepest descenders. */}
      <Path d={panel(0)} fill="none" stroke={GOLD_DEEP} strokeWidth={1.1 * u} clipPath={`url(#${testID}-lobes)`} />
      <Path d={panel(2.4 * u)} fill="none" stroke={GOLD} strokeWidth={0.6 * u} clipPath={`url(#${testID}-lobes)`} />
    </Svg>
  );
});

/** Exported for tests and audits: the clear opening for the name in a box `width` × `height` (pt). */
export function surahHeaderGeometry(width: number, height: number, nameWidth = 0) {
  const u = height / 100;
  const wanted = nameWidth * (1 + 2 * NAME_CLEARANCE);
  const panelEndU = Math.min(TIP_X + END_PANEL, (width / 2 - wanted / 2) / u - 6);
  return {
    /** Horizontally: inside the panel's outlines where they are drawn (LOBE in from its ends); vertically: inside the frame's band. */
    nameBox: { left: (panelEndU + LOBE) * u, right: width - (panelEndU + LOBE) * u, top: FRAME_IN * u, bottom: height - FRAME_IN * u },
  };
}
