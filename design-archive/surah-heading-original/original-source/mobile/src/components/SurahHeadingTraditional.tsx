import { memo } from 'react';
import Svg, { Circle, ClipPath, Defs, G, Path } from 'react-native-svg';

import { SURAH_HEADER_INKS, SURAH_HEADING_TRADITIONAL_INKS } from '@/constants/mushafTheme';
import { BORDER_INKS } from '@/mushaf/borderPattern';

/**
 * The Surah heading (approved 2026-10-14, the default; mushaf/decorations.ts — the earlier design, SurahHeaderOrnament,
 * stays available): a traditional printed-Mushaf heading after the reference (سورة يس in a Madinah print). An original
 * vector drawing, made for this app.
 *
 * One long rectangular band between thin double rules, its whole width: dark-olive side panels filled with a gold
 * interlaced lattice and small florets, a rosette at each outer end, and in the middle an elongated cartouche with
 * pointed ogee ends, open (the page's own paper behind the name, in every appearance), joined to the panels by small
 * gold palmettes at its tips.
 *
 * Drop-in for SurahHeaderOrnament (the original heading, kept unchanged): the same box and props. The name's room
 * follows the same rule: the cartouche's straight part is at least the widest name plus SurahHeaderOrnament's
 * clearance, and nothing is drawn across it but the band's two hairline rules at the very top and bottom of the row,
 * outside the names' ink. Everything else is clipped to the side panels.
 */
const { gold: GOLD, goldDeep: GOLD_DEEP } = SURAH_HEADER_INKS;
const CREAM = BORDER_INKS.cream;
/** The panels' ground and florets: dark olive and a muted green (the reference's tones). */
const { olive: OLIVE, mutedGreen: MUTED_GREEN } = SURAH_HEADING_TRADITIONAL_INKS;

/** In units of the row height / 100 (u). */
const RULE_OUT = 0.25; // the band's outer rule (top; the bottom mirrors it)
const RULE_IN = 1.45; // its inner rule: across the name, the cartouche's edge
const END_ROSETTE_X = 17;
const END_ROSETTE_R = 13;
const TIP = 30; // a cartouche end: its pointed tip → where its top and bottom become straight
const LATTICE = 24; // the lattice's period
/** The cartouche at least this share of the width (as the reference), and the panels at least MIN_PANEL u each. */
const CARTOUCHE_SHARE = 0.46;
const MIN_PANEL = 70;
/** The name's clearance from the cartouche's straight part, in name widths (as SurahHeaderOrnament). */
const NAME_CLEARANCE = 0.18;

const f = (v: number) => Number(v.toFixed(2));
/** A petal pointing up from (0, 0): `l` long, `w` wide. */
const petal = (l: number, w: number) => `M0 0 C${f(w)} ${f(-0.3 * l)} ${f(0.85 * w)} ${f(-0.78 * l)} 0 ${f(-l)} C${f(-0.85 * w)} ${f(-0.78 * l)} ${f(-w)} ${f(-0.3 * l)} 0 0 Z`;

/** Where the cartouche's tips and straight part are, for a box `width` × `height` and the widest name `nameWidth` (pt). */
export function traditionalHeadingGeometry(width: number, height: number, nameWidth = 0) {
  const u = height / 100;
  const straight = Math.max(nameWidth * (1 + 2 * NAME_CLEARANCE), width * CARTOUCHE_SHARE - 2 * TIP * u);
  const half = Math.min(straight / 2 + TIP * u, width / 2 - MIN_PANEL * u);
  const tipL = width / 2 - half;
  const tipR = width / 2 + half;
  return {
    u,
    tipL,
    tipR,
    /** The name's room: the cartouche's straight part, inside the band's rules. */
    nameBox: { left: tipL + TIP * u, right: tipR - TIP * u, top: RULE_IN * u, bottom: height - RULE_IN * u },
  };
}

/** A small floret: four muted-green petals, gold between, a cream heart. */
function Floret({ x, y, r, u }: { x: number; y: number; r: number; u: number }) {
  return (
    <G transform={`translate(${f(x)} ${f(y)})`}>
      {[0, 90, 180, 270].map((deg) => <Path key={deg} d={petal(r, r * 0.42)} transform={`rotate(${deg})`} fill={MUTED_GREEN} stroke={GOLD} strokeWidth={0.5 * u} />)}
      {[45, 135, 225, 315].map((deg) => <Path key={deg} d={petal(r * 0.7, r * 0.22)} transform={`rotate(${deg})`} fill={GOLD} stroke="none" />)}
      <Circle r={r * 0.26} fill={CREAM} stroke={GOLD_DEEP} strokeWidth={0.4 * u} />
    </G>
  );
}

/** An end rosette: eight muted-green petals ringed in gold on a cream disc, gold between, an olive heart. */
function EndRosette({ x, y, r, u }: { x: number; y: number; r: number; u: number }) {
  return (
    <G transform={`translate(${f(x)} ${f(y)})`}>
      <Circle r={r * 1.04} fill={CREAM} stroke={GOLD_DEEP} strokeWidth={0.8 * u} />
      {Array.from({ length: 8 }, (_, i) => <Path key={`o${i}`} d={petal(r * 0.95, r * 0.34)} transform={`rotate(${i * 45})`} fill={MUTED_GREEN} stroke={GOLD} strokeWidth={0.6 * u} />)}
      {Array.from({ length: 8 }, (_, i) => <Path key={`i${i}`} d={petal(r * 0.6, r * 0.18)} transform={`rotate(${i * 45 + 22.5})`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.35 * u} />)}
      <Circle r={r * 0.26} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.45 * u} />
      <Circle r={r * 0.11} fill={OLIVE} />
    </G>
  );
}

type SurahHeadingTraditionalProps = { width: number; height: number; left: number; top: number; nameWidth?: number; testID: string };

export const SurahHeadingTraditional = memo(function SurahHeadingTraditional({ width, height, left, top, nameWidth = 0, testID }: SurahHeadingTraditionalProps) {
  const W = width;
  const H = height;
  const { u, tipL, tipR } = traditionalHeadingGeometry(W, H, nameWidth);
  const cy = H / 2;
  const yo = RULE_OUT * u;
  const yi = RULE_IN * u;
  const t = TIP * u;
  // One side panel (the left; the right mirrors it): from the band's end to the cartouche's pointed end, its inner
  // edge following the cartouche's ogee curve.
  const panelLeft = `M${f(yi)} ${f(yi)} H${f(tipL + t)} C${f(tipL + 0.5 * t)} ${f(yi)} ${f(tipL + 0.32 * t)} ${f(cy - 0.24 * H)} ${f(tipL)} ${f(cy)} `
    + `C${f(tipL + 0.32 * t)} ${f(cy + 0.24 * H)} ${f(tipL + 0.5 * t)} ${f(H - yi)} ${f(tipL + t)} ${f(H - yi)} H${f(yi)} Z`;
  const panelRight = `M${f(W - yi)} ${f(yi)} H${f(tipR - t)} C${f(tipR - 0.5 * t)} ${f(yi)} ${f(tipR - 0.32 * t)} ${f(cy - 0.24 * H)} ${f(tipR)} ${f(cy)} `
    + `C${f(tipR - 0.32 * t)} ${f(cy + 0.24 * H)} ${f(tipR - 0.5 * t)} ${f(H - yi)} ${f(tipR - t)} ${f(H - yi)} H${f(W - yi)} Z`;
  // The cartouche's ends: the same curves, a gold double line (across the name, the band's rules are its edge).
  const endLeft = (d: number) => `M${f(tipL + t + d)} ${f(yi + d)} C${f(tipL + 0.5 * t + d)} ${f(yi + d)} ${f(tipL + 0.32 * t + d)} ${f(cy - 0.24 * H)} ${f(tipL + d)} ${f(cy)} `
    + `C${f(tipL + 0.32 * t + d)} ${f(cy + 0.24 * H)} ${f(tipL + 0.5 * t + d)} ${f(H - yi - d)} ${f(tipL + t + d)} ${f(H - yi - d)}`;
  const endRight = (d: number) => `M${f(tipR - t - d)} ${f(yi + d)} C${f(tipR - 0.5 * t - d)} ${f(yi + d)} ${f(tipR - 0.32 * t - d)} ${f(cy - 0.24 * H)} ${f(tipR - d)} ${f(cy)} `
    + `C${f(tipR - 0.32 * t - d)} ${f(cy + 0.24 * H)} ${f(tipR - 0.5 * t - d)} ${f(H - yi - d)} ${f(tipR - t - d)} ${f(H - yi - d)}`;
  // The lattice: gold diagonals both ways, a period of LATTICE u, centred on the row; florets at alternate crossings.
  const p = LATTICE * u;
  const diagonals: string[] = [];
  for (let x = -H; x < W + H; x += p) {
    diagonals.push(`M${f(x)} 0 L${f(x + H)} ${f(H)}`, `M${f(x + H)} 0 L${f(x)} ${f(H)}`);
  }
  const crossings: { x: number; y: number }[] = [];
  for (let x = p / 2; x < W; x += p) crossings.push({ x, y: cy });
  const inPanel = (x: number) => x < tipL + 0.15 * t - 4 * u || x > tipR - 0.15 * t + 4 * u;
  const florets = crossings.filter(({ x }) => inPanel(x) && x > (END_ROSETTE_X + END_ROSETTE_R + 6) * u && x < W - (END_ROSETTE_X + END_ROSETTE_R + 6) * u);
  return (
    <Svg pointerEvents="none" testID={testID} width={W} height={H} viewBox={`0 0 ${f(W)} ${f(H)}`} style={{ position: 'absolute', left, top }}>
      <Defs>
        <ClipPath id={`${testID}-panels`}>
          <Path d={panelLeft} />
          <Path d={panelRight} />
        </ClipPath>
      </Defs>
      {/* The side panels: dark olive, a gold lattice over it, a fine gold rule just inside their edge. */}
      <Path d={panelLeft} fill={OLIVE} stroke="none" />
      <Path d={panelRight} fill={OLIVE} stroke="none" />
      <G clipPath={`url(#${testID}-panels)`}>
        {diagonals.map((d, i) => <Path key={i} d={d} stroke={GOLD} strokeWidth={0.55 * u} opacity={0.85} fill="none" />)}
        {/* Small gold diamonds at the lattice's half-steps, above and below the centre line. */}
        {crossings.filter(({ x }) => inPanel(x)).flatMap(({ x }) => [cy - p / 2, cy + p / 2].map((y) => (
          <Path key={`${f(x)}-${f(y)}`} d={`M${f(x + p / 2)} ${f(y - 2.6 * u)} L${f(x + p / 2 + 2.6 * u)} ${f(y)} L${f(x + p / 2)} ${f(y + 2.6 * u)} L${f(x + p / 2 - 2.6 * u)} ${f(y)} Z`} fill={GOLD} stroke="none" />
        )))}
        {florets.map(({ x, y }) => <Floret key={f(x)} x={x} y={y} r={11 * u} u={u} />)}
      </G>
      <Path d={panelLeft} fill="none" stroke={GOLD} strokeWidth={0.9 * u} />
      <Path d={panelRight} fill="none" stroke={GOLD} strokeWidth={0.9 * u} />
      {/* The cartouche's pointed ends: a gold double line (its straight part is the band's rules). */}
      {[endLeft, endRight].map((end, i) => (
        <G key={i}>
          <Path d={end(0)} fill="none" stroke={GOLD_DEEP} strokeWidth={1.1 * u} />
          <Path d={end(2.6 * u)} fill="none" stroke={GOLD} strokeWidth={0.6 * u} />
        </G>
      ))}
      {/* At each tip, a small gold palmette pointing out into the panel: the cartouche joined to its panels. */}
      {[{ x: tipL, s: 1 }, { x: tipR, s: -1 }].map(({ x, s }) => (
        <G key={x} transform={`translate(${f(x)} ${f(cy)}) scale(${s} 1)`}>
          <Path d={petal(12 * u, 4.6 * u)} transform="rotate(-90)" fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.5 * u} />
          <Path d={petal(9 * u, 3.4 * u)} transform="rotate(-125)" fill={MUTED_GREEN} stroke={GOLD} strokeWidth={0.45 * u} />
          <Path d={petal(9 * u, 3.4 * u)} transform="rotate(-55)" fill={MUTED_GREEN} stroke={GOLD} strokeWidth={0.45 * u} />
          <Circle r={2.4 * u} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.4 * u} />
        </G>
      ))}
      {/* The band's ends: a rosette on each. */}
      <EndRosette x={END_ROSETTE_X * u} y={cy} r={END_ROSETTE_R * u} u={u} />
      <EndRosette x={W - END_ROSETTE_X * u} y={cy} r={END_ROSETTE_R * u} u={u} />
      {/* The band's double rules, the whole width, at the very top and bottom (outside the names' ink), and its ends. */}
      <Path d={`M${f(yo)} ${f(yo)} H${f(W - yo)} V${f(H - yo)} H${f(yo)} Z`} fill="none" stroke={GOLD_DEEP} strokeWidth={0.5 * u} />
      <Path d={`M${f(yi)} ${f(yi)} H${f(W - yi)} V${f(H - yi)} H${f(yi)} Z`} fill="none" stroke={GOLD} strokeWidth={0.9 * u} />
    </Svg>
  );
});
