import { memo } from 'react';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { openingCircleGeometry } from '@/components/OpeningPageOrnament';
import { SURAH_HEADER_INKS } from '@/constants/mushafTheme';
import { BORDER_INKS } from '@/mushaf/borderPattern';

/**
 * Mushaf pages 1 and 2 (approved 2026-10-14, the default; mushaf/decorations.ts — the earlier ornament,
 * OpeningPageOrnament, stays available): a richer, more traditional illumination on the approved circular
 * composition. An original vector drawing, made for this app.
 *
 * The circle is the approved one exactly (openingCircleGeometry: centre, radii, band), so the Quran text, which
 * QpcV1PageText centres on it, does not move. Only the ornament is richer, and all of it lies on the band or outside
 * the circle, never inside its inner rim (the text's room):
 * - the band: two interlaced gold vines, rosettes alternating with quatrefoil leaf clusters, gold buds between,
 *   triple rims, a scalloped gold lace outside;
 * - top and bottom: larger layered crests (palmette over palmette, gold scrolls, a finial), and arabesque vines with
 *   leaves and buds running from them along the circle into the spandrels;
 * - the sides: a rosette on the band flanked by gold leaves;
 * - the corners: lobed emerald quarter-medallions (a ring of petals, a rosette) with long scrolling gold tendrils
 *   and buds along both edges of the frame.
 */
const { emerald: EMERALD, emeraldLight: EMERALD_LIGHT, gold: GOLD, goldDeep: GOLD_DEEP } = SURAH_HEADER_INKS;
const CREAM = BORDER_INKS.cream;
const MINT = BORDER_INKS.mint;

const f = (v: number) => Number(v.toFixed(2));
const rad = (deg: number) => (deg * Math.PI) / 180;
/** A petal pointing up from (0, 0): `l` long, `w` wide. */
const petal = (l: number, w: number) => `M0 0 C${f(w)} ${f(-0.3 * l)} ${f(0.85 * w)} ${f(-0.78 * l)} 0 ${f(-l)} C${f(-0.85 * w)} ${f(-0.78 * l)} ${f(-w)} ${f(-0.3 * l)} 0 0 Z`;
/** A scrolling leaf from (0, 0) to the right, curling up: `s` long. */
const scroll = (s: number) => `M0 0 C${f(0.25 * s)} ${f(-0.42 * s)} ${f(0.7 * s)} ${f(-0.5 * s)} ${f(s)} ${f(-0.2 * s)} C${f(0.72 * s)} ${f(-0.26 * s)} ${f(0.42 * s)} ${f(-0.14 * s)} ${f(0.3 * s)} ${f(0.1 * s)} C${f(0.2 * s)} ${f(0.04 * s)} ${f(0.1 * s)} ${f(0.01 * s)} 0 0 Z`;

/** A layered rosette at the origin: emerald petals ringed in gold over a cream disc, gold and mint between, a gold heart. */
function Rosette({ r, n = 8, line }: { r: number; n?: number; line: number }) {
  const step = 360 / n;
  return (
    <G>
      <Circle r={r * 1.06} fill={CREAM} stroke={GOLD_DEEP} strokeWidth={line * 0.9} />
      <Circle r={r * 0.98} fill="none" stroke={GOLD} strokeWidth={line * 0.4} />
      {Array.from({ length: n }, (_, i) => <Path key={`o${i}`} d={petal(r * 0.95, r * 0.36)} transform={`rotate(${i * step})`} fill={EMERALD} stroke={GOLD} strokeWidth={line * 0.7} />)}
      {Array.from({ length: n }, (_, i) => <Path key={`i${i}`} d={petal(r * 0.66, r * 0.2)} transform={`rotate(${i * step + step / 2})`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={line * 0.4} />)}
      {Array.from({ length: n }, (_, i) => <Path key={`m${i}`} d={petal(r * 0.52, r * 0.13)} transform={`rotate(${i * step})`} fill={MINT} stroke="none" />)}
      {Array.from({ length: n }, (_, i) => <Circle key={`d${i}`} cx={f(r * 0.8 * Math.cos(rad(i * step + step / 2)))} cy={f(r * 0.8 * Math.sin(rad(i * step + step / 2)))} r={line * 0.55} fill={GOLD} />)}
      <Circle r={r * 0.26} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={line * 0.5} />
      <Circle r={r * 0.15} fill={EMERALD} />
      <Circle r={r * 0.06} fill={GOLD} />
    </G>
  );
}

/** A quatrefoil leaf cluster at the origin: four emerald leaves, four gold buds, a gold heart. */
function Quatrefoil({ s, line }: { s: number; line: number }) {
  return (
    <G>
      {[45, 135, 225, 315].map((deg) => <Path key={deg} d={petal(s, s * 0.38)} transform={`rotate(${deg})`} fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={line * 0.45} />)}
      {[0, 90, 180, 270].map((deg) => <Path key={deg} d={petal(s * 0.62, s * 0.2)} transform={`rotate(${deg})`} fill={GOLD} stroke="none" />)}
      <Circle r={s * 0.28} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={line * 0.3} />
      <Circle r={s * 0.12} fill={MINT} />
    </G>
  );
}

/** An arabesque vine along the circle at radius `r`, from angle `a0` to `a1` (degrees, 0 = right, clockwise): a gold stem with alternate leaves and buds. */
function CircleVine({ cx, cy, r, a0, a1, leaf, line }: { cx: number; cy: number; r: number; a0: number; a1: number; leaf: number; line: number }) {
  const steps = 48;
  const stem = Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / steps;
    const rr = r + leaf * 0.18 * Math.sin((i / steps) * Math.PI * 6);
    return `${i === 0 ? 'M' : 'L'}${f(cx + rr * Math.cos(rad(a)))} ${f(cy + rr * Math.sin(rad(a)))}`;
  }).join(' ');
  const count = 7;
  return (
    <G>
      <Path d={stem} fill="none" stroke={GOLD_DEEP} strokeWidth={line * 1.3} />
      <Path d={stem} fill="none" stroke={GOLD} strokeWidth={line * 0.6} />
      {Array.from({ length: count }, (_, k) => {
        const a = a0 + ((a1 - a0) * (k + 0.5)) / count;
        const out = k % 2 === 0 ? 1 : -1;
        const x = cx + r * Math.cos(rad(a));
        const y = cy + r * Math.sin(rad(a));
        // Leaves lean along the vine, outward and inward in turn (inward ones stay outside the band: r is beyond it).
        const tilt = a + 90 + (out > 0 ? -40 : 40) * Math.sign(a1 - a0);
        return (
          <G key={k} transform={`translate(${f(x)} ${f(y)})`}>
            <Path d={petal(leaf, leaf * 0.36)} transform={`rotate(${f(tilt + (out > 0 ? 0 : 180))})`} fill={k % 3 === 0 ? EMERALD : EMERALD_LIGHT} stroke={GOLD} strokeWidth={line * 0.45} />
            <Circle r={leaf * 0.16} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={line * 0.25} />
          </G>
        );
      })}
    </G>
  );
}

type OpeningPageOrnamentRichProps = { width: number; height: number; left: number; top: number; testID?: string };

export const OpeningPageOrnamentRich = memo(function OpeningPageOrnamentRich({ width, height, left, top, testID }: OpeningPageOrnamentRichProps) {
  const { cx, cy, outer, inner, band, tile, innerH } = openingCircleGeometry(width, height);
  const u = width / 396; // a point on the reference iPhone page
  const mid = outer - band / 2;
  // Two interlaced vines waving between the band's edges, half a wave apart.
  const vine = (phase: number) => Array.from({ length: 721 }, (_, i) => {
    const a = (i / 720) * 2 * Math.PI;
    const r = mid + band * 0.26 * Math.sin(32 * a + phase);
    return `${i === 0 ? 'M' : 'L'}${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
  }).join(' ') + ' Z';
  const annulus = `M${f(cx + outer)} ${f(cy)} A${f(outer)} ${f(outer)} 0 1 0 ${f(cx - outer)} ${f(cy)} A${f(outer)} ${f(outer)} 0 1 0 ${f(cx + outer)} ${f(cy)} Z `
    + `M${f(cx + inner)} ${f(cy)} A${f(inner)} ${f(inner)} 0 1 1 ${f(cx - inner)} ${f(cy)} A${f(inner)} ${f(inner)} 0 1 1 ${f(cx + inner)} ${f(cy)} Z`;
  // Motifs round the band (at the vines' crossings): rosettes and quatrefoils in turn; none where the crests sit.
  const motifs = Array.from({ length: 64 }, (_, i) => i * (360 / 64)).filter((deg) => [0, 90, 180, 270, 360].every((c) => Math.abs(deg - c) > 10));
  const beads = Array.from({ length: 200 }, (_, i) => (i / 200) * 2 * Math.PI);
  const lace = Array.from({ length: 96 }, (_, i) => (i / 96) * 360).filter((deg) => [90, 270].every((c) => Math.abs(deg - c) > 14));
  const corner = 0.17 * width;
  const lobe = corner * 0.11;
  return (
    <Svg pointerEvents="none" testID={testID} width={width} height={height} viewBox={`0 0 ${f(width)} ${f(height)}`} style={{ position: 'absolute', left, top }}>
      {/* Spandrel vines first (behind the crests): from the top and bottom crests along the circle, outside the band. */}
      {[-90, 90].flatMap((c) => [-1, 1].map((s) => (
        <CircleVine key={`${c}${s}`} cx={cx} cy={cy} r={outer + band * 0.95} a0={c + s * 12} a1={c + s * 58} leaf={band * 0.62} line={u} />
      )))}

      {/* The band: emerald, two interlaced vines, motifs, buds. */}
      <Path d={annulus} fill={EMERALD} fillRule="evenodd" stroke="none" />
      <Path d={vine(0)} fill="none" stroke={GOLD_DEEP} strokeWidth={1.1 * u} />
      <Path d={vine(0)} fill="none" stroke={GOLD} strokeWidth={0.55 * u} />
      <Path d={vine(Math.PI)} fill="none" stroke={GOLD} strokeWidth={0.55 * u} />
      {motifs.map((deg, i) => (
        <G key={deg} transform={`translate(${f(cx)} ${f(cy)}) rotate(${f(deg)}) translate(${f(mid)} 0)`}>
          {i % 2 === 0 ? <Rosette r={band * 0.37} n={8} line={0.6 * u} /> : <Quatrefoil s={band * 0.38} line={u} />}
        </G>
      ))}
      {motifs.map((deg) => (
        <G key={`bud${deg}`} transform={`translate(${f(cx)} ${f(cy)}) rotate(${f(deg + 360 / 128)})`}>
          <Circle cx={f(mid + band * 0.3)} r={0.8 * u} fill={GOLD} />
          <Circle cx={f(mid - band * 0.3)} r={0.8 * u} fill={GOLD} />
        </G>
      ))}
      {/* Rims: gold beads inside each edge; triple rings; a scalloped gold lace with dots just outside. */}
      {beads.map((a, i) => (
        <G key={i}>
          <Circle cx={f(cx + (outer - 3.4 * u) * Math.cos(a))} cy={f(cy + (outer - 3.4 * u) * Math.sin(a))} r={0.5 * u} fill={GOLD} />
          <Circle cx={f(cx + (inner + 3.4 * u) * Math.cos(a))} cy={f(cy + (inner + 3.4 * u) * Math.sin(a))} r={0.5 * u} fill={GOLD} />
        </G>
      ))}
      {lace.map((deg) => {
        const a0 = rad(deg - 1.4);
        const a1 = rad(deg + 1.4);
        const r0 = outer + 0.6 * u;
        const tipR = outer + 3.6 * u;
        const am = rad(deg);
        return (
          <G key={`l${deg}`}>
            <Path d={`M${f(cx + r0 * Math.cos(a0))} ${f(cy + r0 * Math.sin(a0))} Q${f(cx + tipR * Math.cos(am))} ${f(cy + tipR * Math.sin(am))} ${f(cx + r0 * Math.cos(a1))} ${f(cy + r0 * Math.sin(a1))}`} fill="none" stroke={GOLD} strokeWidth={0.6 * u} />
            <Circle cx={f(cx + (tipR + 1.3 * u) * Math.cos(am))} cy={f(cy + (tipR + 1.3 * u) * Math.sin(am))} r={0.55 * u} fill={GOLD} />
          </G>
        );
      })}
      <Circle cx={cx} cy={cy} r={outer} fill="none" stroke={GOLD} strokeWidth={1.4 * u} />
      <Circle cx={cx} cy={cy} r={outer - 1.7 * u} fill="none" stroke={GOLD_DEEP} strokeWidth={0.45 * u} />
      <Circle cx={cx} cy={cy} r={outer - 2.4 * u} fill="none" stroke={MINT} strokeWidth={0.35 * u} />
      <Circle cx={cx} cy={cy} r={inner} fill="none" stroke={GOLD} strokeWidth={1.4 * u} />
      <Circle cx={cx} cy={cy} r={inner + 1.7 * u} fill="none" stroke={GOLD_DEEP} strokeWidth={0.45 * u} />
      <Circle cx={cx} cy={cy} r={inner + 2.4 * u} fill="none" stroke={MINT} strokeWidth={0.35 * u} />

      {/* Top and bottom crests, outward from the band: palmette over palmette, gold double scrolls, a finial; a rosette on the band. */}
      {[-90, 90].map((deg) => (
        <G key={deg} transform={`translate(${f(cx)} ${f(cy)}) rotate(${deg + 90}) translate(0 ${f(-mid)})`}>
          <Path d={scroll(band * 1.9)} transform={`translate(${f(band * 0.3)} ${f(-band * 0.35)}) rotate(-20)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.45 * u} />
          <Path d={scroll(band * 1.9)} transform={`translate(${f(-band * 0.3)} ${f(-band * 0.35)}) scale(-1 1) rotate(-20)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.45 * u} />
          <Path d={petal(band * 2.9, band * 1.15)} transform={`translate(0 ${f(-band * 0.2)})`} fill={EMERALD} stroke={GOLD} strokeWidth={1.1 * u} />
          <Path d={petal(band * 2.55, band * 0.95)} transform={`translate(0 ${f(-band * 0.3)})`} fill="none" stroke={GOLD_DEEP} strokeWidth={0.4 * u} />
          <Path d={petal(band * 2.1, band * 0.7)} transform={`translate(0 ${f(-band * 0.4)})`} fill={MINT} stroke={GOLD} strokeWidth={0.6 * u} />
          <Path d={petal(band * 1.6, band * 0.46)} transform={`translate(0 ${f(-band * 0.55)})`} fill={EMERALD_LIGHT} stroke={GOLD_DEEP} strokeWidth={0.5 * u} />
          <Path d={petal(band * 1.0, band * 0.24)} transform={`translate(0 ${f(-band * 0.75)})`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.4 * u} />
          <Path d={scroll(band * 1.35)} transform={`translate(${f(band * 0.2)} ${f(-band * 1.1)}) rotate(-60)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.4 * u} />
          <Path d={scroll(band * 1.35)} transform={`translate(${f(-band * 0.2)} ${f(-band * 1.1)}) scale(-1 1) rotate(-60)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.4 * u} />
          <Path d={petal(band * 0.85, band * 0.28)} transform={`translate(0 ${f(-band * 3.0)})`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.45 * u} />
          <Circle cy={-band * 3.95} r={band * 0.13} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.4 * u} />
          <Circle cy={-band * 3.0} r={band * 0.1} fill={EMERALD} stroke={GOLD} strokeWidth={0.35 * u} />
          {[-1, 1].map((s) => (
            <G key={s} transform={`scale(${s} 1)`}>
              <Path d={petal(band * 1.0, band * 0.42)} transform={`translate(${f(band * 0.6)} 0) rotate(62)`} fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.5 * u} />
              <Path d={petal(band * 0.7, band * 0.26)} transform={`translate(${f(band * 0.95)} ${f(-band * 0.45)}) rotate(40)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.35 * u} />
              <Circle cx={band * 1.25} cy={-band * 0.9} r={0.9 * u} fill={GOLD} />
            </G>
          ))}
          <Rosette r={band * 0.82} n={12} line={u} />
        </G>
      ))}
      {/* Side crests on the band: a rosette, gold leaves along the circle above and below it, a bud outward. */}
      {[0, 180].map((deg) => (
        <G key={deg} transform={`translate(${f(cx)} ${f(cy)}) rotate(${deg}) translate(${f(mid)} 0)`}>
          {[-1, 1].map((s) => (
            <G key={s} transform={`scale(1 ${s})`}>
              <Path d={petal(band * 1.1, band * 0.34)} transform={`translate(0 ${f(-band * 0.5)}) rotate(-8)`} fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.5 * u} />
              <Path d={petal(band * 0.75, band * 0.2)} transform={`translate(${f(band * 0.15)} ${f(-band * 0.55)}) rotate(20)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.35 * u} />
            </G>
          ))}
          <Rosette r={band * 0.62} n={8} line={0.8 * u} />
        </G>
      ))}

      {/* Corners: a lobed emerald quarter-medallion (a scalloped gold edge, a ring of petals, a rosette), long gold
          tendrils with leaves and buds along both edges of the frame; all clear of the circle. */}
      {[[tile, tile, 1, 1], [width - tile, tile, -1, 1], [tile, tile + innerH, 1, -1], [width - tile, tile + innerH, -1, -1]].map(([x, y, sx, sy], i) => (
        <G key={i} transform={`translate(${f(x)} ${f(y)}) scale(${sx} ${sy})`}>
          {/* Tendrils along the top and side edges. */}
          {[0, 1].map((side) => (
            <G key={side} transform={side === 0 ? undefined : 'matrix(0 1 1 0 0 0)'}>
              <Path d={`M${f(corner * 0.9)} ${f(3 * u)} C${f(corner * 1.2)} ${f(1.5 * u)} ${f(corner * 1.45)} ${f(7 * u)} ${f(corner * 1.75)} ${f(4 * u)}`} fill="none" stroke={GOLD} strokeWidth={0.8 * u} />
              <Path d={scroll(corner * 0.42)} transform={`translate(${f(corner * 1.02)} ${f(4.2 * u)}) rotate(6) scale(0.7)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.4 * u} />
              <Path d={petal(corner * 0.16, corner * 0.06)} transform={`translate(${f(corner * 1.38)} ${f(4.5 * u)}) rotate(120)`} fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.4 * u} />
              <Path d={petal(corner * 0.12, corner * 0.045)} transform={`translate(${f(corner * 1.58)} ${f(5 * u)}) rotate(60)`} fill={EMERALD} stroke={GOLD} strokeWidth={0.35 * u} />
              <Circle cx={corner * 1.82} cy={4 * u} r={1.2 * u} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.3 * u} />
            </G>
          ))}
          {/* A gold lace round the quarter circle: small petals pointing out, a bud at each tip. */}
          {Array.from({ length: 11 }, (_, k) => 4 + k * 8.2).map((deg) => (
            <G key={`s${deg}`} transform={`translate(${f(2 * u + corner * Math.cos(rad(deg)))} ${f(2 * u + corner * Math.sin(rad(deg)))}) rotate(${f(deg + 90)})`}>
              <Path d={petal(lobe * 1.25, lobe * 0.42)} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.3 * u} />
              <Circle cy={-lobe * 1.55} r={0.6 * u} fill={GOLD} />
            </G>
          ))}
          <Path d={`M${f(2 * u)} ${f(2 * u)} H${f(corner)} A${f(corner - 2 * u)} ${f(corner - 2 * u)} 0 0 1 ${f(2 * u)} ${f(corner)} Z`} fill={EMERALD} stroke={GOLD} strokeWidth={1.2 * u} />
          <Path d={`M${f(corner * 0.8)} ${f(2 * u)} A${f(corner * 0.78)} ${f(corner * 0.78)} 0 0 1 ${f(2 * u)} ${f(corner * 0.8)}`} fill="none" stroke={GOLD} strokeWidth={0.6 * u} />
          <Path d={`M${f(corner * 0.76)} ${f(2 * u)} A${f(corner * 0.74)} ${f(corner * 0.74)} 0 0 1 ${f(2 * u)} ${f(corner * 0.76)}`} fill="none" stroke={GOLD_DEEP} strokeWidth={0.35 * u} />
          {Array.from({ length: 11 }, (_, k) => 4 + k * 8.2).map((deg) => (
            <Circle key={`b${deg}`} cx={f(2 * u + corner * 0.88 * Math.cos(rad(deg)))} cy={f(2 * u + corner * 0.88 * Math.sin(rad(deg)))} r={0.75 * u} fill={GOLD} />
          ))}
          {[9, 22, 35, 45, 55, 68, 81].map((deg, k) => (
            <G key={`p${deg}`} transform={`translate(${f(2 * u + corner * 0.32 * Math.cos(rad(deg)))} ${f(2 * u + corner * 0.32 * Math.sin(rad(deg)))}) rotate(${deg + 90})`}>
              <Path d={petal(corner * (k % 2 ? 0.34 : 0.42), corner * 0.1)} fill={k % 2 ? MINT : EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.5 * u} />
              <Path d={petal(corner * 0.22, corner * 0.04)} transform={`translate(0 ${f(-corner * 0.05)})`} fill={GOLD} stroke="none" />
            </G>
          ))}
          <G transform={`translate(${f(corner * 0.21)} ${f(corner * 0.21)})`}>
            <Rosette r={corner * 0.15} n={8} line={0.7 * u} />
          </G>
        </G>
      ))}
    </Svg>
  );
});
