import { memo } from 'react';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { SURAH_HEADER_INKS } from '@/constants/mushafTheme';
import { BORDER_INKS } from '@/mushaf/borderPattern';

/**
 * Mushaf pages 1 and 2 (approved circular opening design, 2026-10-12): a large emerald-and-gold ornamental circle
 * round the whole text (title, Basmala, ayahs), floral crests at its top and bottom and on its band at the sides, and
 * arabesque ornaments in the frame's four inner corners. An original vector drawing, made for this app.
 *
 * Drawn for the frame's box (the page's border keeps its own drawing), so every size follows the page width: the
 * circle's outer radius is OPENING_CIRCLE_RADIUS of the inner frame width, its band OPENING_CIRCLE_BAND of that
 * radius; it is centred in the inner frame (Normal and Full-Screen alike). The centre is not filled: the page's own
 * paper shows behind the Quran text, in every appearance. The text is centred on the circle by QpcV1PageText.
 */
export const OPENING_CIRCLE_RADIUS = 0.485;
export const OPENING_CIRCLE_BAND = 0.095;

const { emerald: EMERALD, emeraldLight: EMERALD_LIGHT, gold: GOLD, goldDeep: GOLD_DEEP } = SURAH_HEADER_INKS;
const CREAM = BORDER_INKS.cream;
const MINT = BORDER_INKS.mint;

const f = (v: number) => Number(v.toFixed(2));
/** A petal pointing up from (0, 0): `l` long, `w` wide. */
const petal = (l: number, w: number) => `M0 0 C${f(w)} ${f(-0.3 * l)} ${f(0.85 * w)} ${f(-0.78 * l)} 0 ${f(-l)} C${f(-0.85 * w)} ${f(-0.78 * l)} ${f(-w)} ${f(-0.3 * l)} 0 0 Z`;
/** A scrolling leaf from (0, 0) to the right, curling up: `s` long. */
const scroll = (s: number) => `M0 0 C${f(0.25 * s)} ${f(-0.42 * s)} ${f(0.7 * s)} ${f(-0.5 * s)} ${f(s)} ${f(-0.2 * s)} C${f(0.72 * s)} ${f(-0.26 * s)} ${f(0.42 * s)} ${f(-0.14 * s)} ${f(0.3 * s)} ${f(0.1 * s)} C${f(0.2 * s)} ${f(0.04 * s)} ${f(0.1 * s)} ${f(0.01 * s)} 0 0 Z`;

/** A rosette at the origin: `n` emerald petals ringed in gold, gold petals between, a gold heart. */
function Rosette({ r, n = 8, line }: { r: number; n?: number; line: number }) {
  const step = 360 / n;
  return (
    <G>
      <Circle r={r * 1.02} fill={CREAM} stroke={GOLD_DEEP} strokeWidth={line * 0.9} />
      {Array.from({ length: n }, (_, i) => <Path key={`o${i}`} d={petal(r * 0.96, r * 0.36)} transform={`rotate(${i * step})`} fill={EMERALD} stroke={GOLD} strokeWidth={line * 0.7} />)}
      {Array.from({ length: n }, (_, i) => <Path key={`i${i}`} d={petal(r * 0.62, r * 0.2)} transform={`rotate(${i * step + step / 2})`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={line * 0.4} />)}
      {Array.from({ length: n }, (_, i) => <Path key={`m${i}`} d={petal(r * 0.5, r * 0.13)} transform={`rotate(${i * step})`} fill={MINT} stroke="none" />)}
      <Circle r={r * 0.24} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={line * 0.5} />
      <Circle r={r * 0.1} fill={EMERALD} />
    </G>
  );
}

/** The circle's geometry for a frame `width` × `height` (pt), in the frame's coordinates. */
export function openingCircleGeometry(width: number, height: number) {
  const tile = width / 20;
  const innerW = width - 2 * tile;
  const outer = OPENING_CIRCLE_RADIUS * innerW;
  const band = OPENING_CIRCLE_BAND * outer;
  return { cx: width / 2, cy: height / 2, outer, inner: outer - band, band, tile, innerW, innerH: height - 2 * tile };
}

type OpeningPageOrnamentProps = { width: number; height: number; left: number; top: number; testID?: string };

export const OpeningPageOrnament = memo(function OpeningPageOrnament({ width, height, left, top, testID }: OpeningPageOrnamentProps) {
  const { cx, cy, outer, inner, band, tile, innerW, innerH } = openingCircleGeometry(width, height);
  const u = width / 396; // a point on the reference iPhone page
  const mid = outer - band / 2;
  // The band's vine: a gold line waving between the band's edges.
  const vine = Array.from({ length: 361 }, (_, i) => {
    const a = (i / 360) * 2 * Math.PI;
    const r = mid + band * 0.22 * Math.sin(28 * a);
    return `${i === 0 ? 'M' : 'L'}${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
  }).join(' ') + ' Z';
  const annulus = `M${f(cx + outer)} ${f(cy)} A${f(outer)} ${f(outer)} 0 1 0 ${f(cx - outer)} ${f(cy)} A${f(outer)} ${f(outer)} 0 1 0 ${f(cx + outer)} ${f(cy)} Z `
    + `M${f(cx + inner)} ${f(cy)} A${f(inner)} ${f(inner)} 0 1 1 ${f(cx - inner)} ${f(cy)} A${f(inner)} ${f(inner)} 0 1 1 ${f(cx + inner)} ${f(cy)} Z`;
  // Motifs round the band: rosettes and leaf pairs, alternately; none where the crests sit.
  const motifs = Array.from({ length: 64 }, (_, i) => i * (360 / 64)).filter((deg) => [0, 90, 180, 270, 360].every((c) => Math.abs(deg - c) > 9));
  const beads = Array.from({ length: 180 }, (_, i) => (i / 180) * 2 * Math.PI);
  const sideGap = (innerW - 2 * outer) / 2;
  const sideCrest = Math.min(0.72 * band, band / 2 + sideGap - 1);
  const corner = 0.16 * width;
  return (
    <Svg pointerEvents="none" testID={testID} width={width} height={height} viewBox={`0 0 ${f(width)} ${f(height)}`} style={{ position: 'absolute', left, top }}>
      {/* The circle's band: emerald between gold rings, a gold vine, rosettes and leaves. */}
      <Path d={annulus} fill={EMERALD} fillRule="evenodd" stroke="none" />
      <Path d={vine} fill="none" stroke={GOLD} strokeWidth={0.75 * u} />
      {motifs.map((deg, i) => (
        <G key={deg} transform={`translate(${f(cx)} ${f(cy)}) rotate(${f(deg)}) translate(${f(mid)} 0)`}>
          {i % 2 === 0 ? (
            <Rosette r={band * 0.36} n={8} line={0.6 * u} />
          ) : (
            <G>
              <Path d={petal(band * 0.4, band * 0.15)} transform="rotate(35)" fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.45 * u} />
              <Path d={petal(band * 0.4, band * 0.15)} transform="rotate(145)" fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.45 * u} />
              <Path d={petal(band * 0.4, band * 0.15)} transform="rotate(-35)" fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.45 * u} />
              <Path d={petal(band * 0.4, band * 0.15)} transform="rotate(-145)" fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.45 * u} />
              <Circle r={band * 0.11} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.3 * u} />
            </G>
          )}
        </G>
      ))}
      {/* Gold beads along both rims, and a lace of gold dots just outside the band. */}
      {beads.map((a, i) => (
        <G key={i}>
          <Circle cx={f(cx + (outer - 3.2 * u) * Math.cos(a))} cy={f(cy + (outer - 3.2 * u) * Math.sin(a))} r={0.55 * u} fill={GOLD} />
          <Circle cx={f(cx + (inner + 3.2 * u) * Math.cos(a))} cy={f(cy + (inner + 3.2 * u) * Math.sin(a))} r={0.55 * u} fill={GOLD} />
          {i % 2 === 0 && <Circle cx={f(cx + (outer + 2.4 * u) * Math.cos(a))} cy={f(cy + (outer + 2.4 * u) * Math.sin(a))} r={0.7 * u} fill={GOLD} />}
        </G>
      ))}
      <Circle cx={cx} cy={cy} r={outer} fill="none" stroke={GOLD} strokeWidth={1.3 * u} />
      <Circle cx={cx} cy={cy} r={outer - 1.6 * u} fill="none" stroke={GOLD_DEEP} strokeWidth={0.45 * u} />
      <Circle cx={cx} cy={cy} r={inner} fill="none" stroke={GOLD} strokeWidth={1.3 * u} />
      <Circle cx={cx} cy={cy} r={inner + 1.6 * u} fill="none" stroke={GOLD_DEEP} strokeWidth={0.45 * u} />

      {/* Crests: at the top and bottom, a palmette outward from the band over a rosette; at the sides, on the band. */}
      {[-90, 90].map((deg) => (
        <G key={deg} transform={`translate(${f(cx)} ${f(cy)}) rotate(${deg + 90}) translate(0 ${f(-mid)})`}>
          <Path d={petal(band * 2.4, band * 0.95)} transform={`translate(0 ${f(-band * 0.2)})`} fill={EMERALD} stroke={GOLD} strokeWidth={1 * u} />
          <Path d={petal(band * 1.7, band * 0.58)} transform={`translate(0 ${f(-band * 0.35)})`} fill={MINT} stroke={GOLD} strokeWidth={0.6 * u} />
          <Path d={petal(band * 1.2, band * 0.36)} transform={`translate(0 ${f(-band * 0.5)})`} fill={EMERALD_LIGHT} stroke={GOLD_DEEP} strokeWidth={0.5 * u} />
          <Path d={scroll(band * 1.5)} transform={`translate(${f(band * 0.25)} ${f(-band * 0.55)}) rotate(-35)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.45 * u} />
          <Path d={scroll(band * 1.5)} transform={`translate(${f(-band * 0.25)} ${f(-band * 0.55)}) scale(-1 1) rotate(-35)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.45 * u} />
          <Path d={petal(band * 0.8, band * 0.25)} transform={`translate(0 ${f(-band * 2.5)})`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.45 * u} />
          <Circle cy={-band * 2.62} r={band * 0.12} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.4 * u} />
          <Path d={petal(band * 0.9, band * 0.4)} transform={`translate(${f(band * 0.55)} 0) rotate(60)`} fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.5 * u} />
          <Path d={petal(band * 0.9, band * 0.4)} transform={`translate(${f(-band * 0.55)} 0) rotate(-60)`} fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.5 * u} />
          <Rosette r={band * 0.78} line={u} />
        </G>
      ))}
      {[0, 180].map((deg) => (
        <G key={deg} transform={`translate(${f(cx)} ${f(cy)}) rotate(${deg}) translate(${f(mid)} 0)`}>
          <Path d={petal(band * 0.75, band * 0.32)} transform="translate(0 0) rotate(-90)" fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.5 * u} />
          <Path d={petal(band * 0.75, band * 0.32)} transform="rotate(-150)" fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.5 * u} />
          <Path d={petal(band * 0.75, band * 0.32)} transform="rotate(-30)" fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.5 * u} />
          <Rosette r={sideCrest} line={0.8 * u} />
        </G>
      ))}

      {/* Corner ornaments: an emerald quarter-fan in each inner corner, gold-rimmed, its petals radiating from a rosette,
          gold tendrils along the frame; clear of the circle. */}
      {[[tile, tile, 1, 1], [width - tile, tile, -1, 1], [tile, tile + innerH, 1, -1], [width - tile, tile + innerH, -1, -1]].map(([x, y, sx, sy], i) => (
        <G key={i} transform={`translate(${f(x)} ${f(y)}) scale(${sx} ${sy})`}>
          <Path d={scroll(corner * 0.55)} transform={`translate(${f(corner * 0.95)} ${f(2.5 * u)}) rotate(4) scale(0.6)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.45 * u} />
          <Path d={scroll(corner * 0.55)} transform={`translate(${f(2.5 * u)} ${f(corner * 0.95)}) rotate(86) scale(0.6 -0.6)`} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.45 * u} />
          <Path d={`M${f(2 * u)} ${f(2 * u)} H${f(corner)} A${f(corner - 2 * u)} ${f(corner - 2 * u)} 0 0 1 ${f(2 * u)} ${f(corner)} Z`} fill={EMERALD} stroke={GOLD} strokeWidth={1.2 * u} />
          <Path d={`M${f(corner * 0.74)} ${f(2 * u)} A${f(corner * 0.72)} ${f(corner * 0.72)} 0 0 1 ${f(2 * u)} ${f(corner * 0.74)}`} fill="none" stroke={GOLD} strokeWidth={0.6 * u} />
          {Array.from({ length: 9 }, (_, k) => 5 + k * 10).map((deg) => (
            <Circle key={`b${deg}`} cx={f(2 * u + (corner - 4.2 * u) * Math.cos((deg * Math.PI) / 180))} cy={f(2 * u + (corner - 4.2 * u) * Math.sin((deg * Math.PI) / 180))} r={0.7 * u} fill={GOLD} />
          ))}
          {[12, 31, 45, 59, 78].map((deg) => (
            <G key={`p${deg}`} transform={`translate(${f(2 * u + corner * 0.3 * Math.cos((deg * Math.PI) / 180))} ${f(2 * u + corner * 0.3 * Math.sin((deg * Math.PI) / 180))}) rotate(${deg + 90})`}>
              <Path d={petal(corner * 0.4, corner * 0.1)} fill={EMERALD_LIGHT} stroke={GOLD} strokeWidth={0.5 * u} />
              <Path d={petal(corner * 0.26, corner * 0.05)} transform={`translate(0 ${f(-corner * 0.04)})`} fill={MINT} stroke="none" />
            </G>
          ))}
          <G transform={`translate(${f(corner * 0.2)} ${f(corner * 0.2)})`}>
            <Rosette r={corner * 0.13} line={0.7 * u} />
          </G>
          <Circle cx={corner * 1.5} cy={3.2 * u} r={1 * u} fill={GOLD} />
          <Circle cx={3.2 * u} cy={corner * 1.5} r={1 * u} fill={GOLD} />
        </G>
      ))}
    </Svg>
  );
});
