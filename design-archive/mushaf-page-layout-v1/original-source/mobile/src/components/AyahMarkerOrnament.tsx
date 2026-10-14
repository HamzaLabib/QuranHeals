import { memo } from 'react';
import Svg, { Defs, Ellipse, G, LinearGradient, Path, Stop } from 'react-native-svg';

import type { AyahMarkerColors } from '@/mushaf/appearance';
import type { AyahMarker, PageBox } from '@/mushaf/ayahMarkers';

type AyahMarkerOrnamentProps = {
  marker: AyahMarker;
  colors: AyahMarkerColors;
  /** Where the ornament goes, relative to the marker glyph's box (ayahMarkers.markerOverlayBox). */
  box: PageBox;
  /** Distinguishes gradient ids when one ayah's marker is drawn more than once. */
  idSuffix?: string;
};

/** A little room around the artwork so anti-aliased edges are never clipped. */
const PAD = 0.03;

/**
 * Where the caps end and the sides begin, as fractions of the ornament's
 * height: below the inner ring's top arc and above its bottom one
 * (measured on the artwork: ring y 0.26–0.77, outer oval 0.11–0.93).
 */
const CAP_TOP = 0.31;
const CAP_BOTTOM = 0.72;
/** Fills, as fractions of the ornament's box: the outer oval (cap fill), the inner ring (side fill), the light centre. */
const OUTER = { cx: 0.5, cy: 0.52, rx: 0.48, ry: 0.4 };
const RING = { cx: 0.5, cy: 0.515, rx: 0.465, ry: 0.252 };
/** As tall as the ring but narrower, so the side fill shows as two crescents, like the print's side bars. */
const INNER = { cx: 0.5, cy: 0.515, rx: 0.37, ry: 0.252 };

/** Hard-edged vertical bands: `a` above `top`, `b` between, `a` below `bottom` (fractions of the shape's height). */
function Bands({ id, a, b, top, bottom }: { id: string; a: string; b: string; top: number; bottom: number }) {
  return (
    <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <Stop offset="0" stopColor={a} />
      <Stop offset={top} stopColor={a} />
      <Stop offset={top} stopColor={b} />
      <Stop offset={bottom} stopColor={b} />
      <Stop offset={bottom} stopColor={a} />
      <Stop offset="1" stopColor={a} />
    </LinearGradient>
  );
}

/**
 * One ayah-end medallion: the Quran SVG page's ornament and this ayah's
 * number, copied verbatim and placed by their original transforms; the
 * viewBox is the ornament's box on that page. Colours come from a marker
 * style (mushaf/appearance.ts). Decorative and untouchable: taps pass to
 * the line, which maps them to the ayah.
 */
export const AyahMarkerOrnament = memo(function AyahMarkerOrnament({ marker, colors, box, idSuffix = '' }: AyahMarkerOrnamentProps) {
  const o = marker.ornamentBox;
  const viewBox = [o.x - o.width * PAD, o.y - o.height * PAD, o.width * (1 + 2 * PAD), o.height * (1 + 2 * PAD)].join(' ');
  const id = `qh-marker-${marker.verseKey.replace(':', '-')}${idSuffix}`;
  const at = (fx: number, fy: number) => ({ x: o.x + o.width * fx, y: o.y + o.height * fy });
  const ellipse = (e: typeof OUTER, fill: string | null) => {
    if (!fill) return null;
    const c = at(e.cx, e.cy);
    return <Ellipse cx={c.x} cy={c.y} rx={o.width * e.rx} ry={o.height * e.ry} fill={fill} />;
  };
  const banded = colors.caps !== colors.sides;
  // The artwork's y axis points up (its transform's y scale is negative), so its
  // gradient, laid out in the path's own coordinates, runs bottom to top.
  const flipped = Number(marker.ornamentTransform.match(/^matrix\(\S+ \S+ \S+ (\S+)/)?.[1]) < 0;
  const lineTop = flipped ? 1 - CAP_BOTTOM : CAP_TOP;
  const lineBottom = flipped ? 1 - CAP_TOP : CAP_BOTTOM;

  return (
    <Svg
      pointerEvents="none"
      style={{ position: 'absolute', left: box.x - box.width * PAD, top: box.y - box.height * PAD }}
      width={box.width * (1 + 2 * PAD)}
      height={box.height * (1 + 2 * PAD)}
      viewBox={viewBox}>
      <Defs>
        {banded && <Bands id={`${id}-line`} a={colors.caps} b={colors.sides} top={lineTop} bottom={lineBottom} />}
      </Defs>
      {ellipse(OUTER, colors.capFill)}
      {ellipse(RING, colors.sideFill)}
      {ellipse(INNER, colors.innerFill)}
      <G transform={marker.ornamentTransform}>
        <Path d={marker.ornamentPath} fill={banded ? `url(#${id}-line)` : colors.caps} fillRule="evenodd" />
      </G>
      <G transform={marker.numberTransform}>
        <Path d={marker.numberPath} fill={colors.number} fillRule="evenodd" />
      </G>
    </Svg>
  );
});
