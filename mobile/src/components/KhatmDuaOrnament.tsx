import Svg, { Circle, Path } from 'react-native-svg';

import { SURAH_HEADER_INKS } from '@/constants/mushafTheme';

/**
 * The du'a screen's ornament (app/khatm-dua.tsx): drawn shapes only — no
 * lettering, calligraphy or text of any kind. In the Mushaf's own inks
 * (SURAH_HEADER_INKS: emerald and antique gold), read here and never
 * changed. Lines are deep gold on the light card (4.5:1) and gold on the dark
 * one (6.5:1). Purely decorative: hidden from screen readers.
 */

const { emeraldLight: EMERALD, gold: GOLD, goldDeep: GOLD_DEEP } = SURAH_HEADER_INKS;

/** The panel's fine inner rule (app/khatm-dua.tsx): the ornament's line gold, which the screen softens with opacity. */
export function khatmDuaFrameColor(dark: boolean): string {
  return dark ? GOLD : GOLD_DEEP;
}

/** `dark`: the app appearance. `card`: the colour behind the ornament (palette.card), for the star's pierced centre. */
type OrnamentProps = { dark: boolean; card: string };

/** An eight-point star (the classic geometric khatam), centred on (cx, cy). */
function star(cx: number, cy: number, outer: number, inner: number): string {
  const points = Array.from({ length: 16 }, (_, i) => {
    const angle = (Math.PI / 8) * i - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    return `${(cx + r * Math.cos(angle)).toFixed(2)} ${(cy + r * Math.sin(angle)).toFixed(2)}`;
  });
  return `M${points.join(' L')} Z`;
}

const hidden = { accessible: false, importantForAccessibility: 'no-hide-descendants' as const };

/**
 * A pointed Islamic arch over the du'a, as in a manuscript's opening panel: a
 * gold outline, a fine emerald line inside it, and an eight-point star at the
 * apex. Its sides stop at the bottom edge, so it reads as the top of a frame
 * around the text below.
 */
export function KhatmDuaArch({ dark, card }: OrnamentProps) {
  const line = dark ? GOLD : GOLD_DEEP;
  return (
    <Svg testID="khatm-dua-arch" width="100%" height={60} viewBox="0 0 240 60" preserveAspectRatio="xMidYMax meet" {...hidden}>
      <Path d="M22 60 V40 C22 22 72 14 120 3 C168 14 218 22 218 40 V60" fill="none" stroke={line} strokeWidth={1.4} strokeLinecap="round" />
      <Path d="M31 60 V42 C31 27 77 20 120 11 C163 20 209 27 209 42 V60" fill="none" stroke={EMERALD} strokeWidth={0.8} strokeLinecap="round" opacity={0.85} />
      <Path d={star(120, 30, 9, 4.2)} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.6} strokeLinejoin="round" />
      <Circle cx={120} cy={30} r={1.8} fill={card} />
      <Circle cx={22} cy={40} r={2.4} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.5} />
      <Circle cx={218} cy={40} r={2.4} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.5} />
    </Svg>
  );
}

/** A fine divider: gold rules either side of a small eight-point star, with an emerald dot at each inner end. */
export function KhatmDuaDivider({ dark }: Pick<OrnamentProps, 'dark'>) {
  const line = dark ? GOLD : GOLD_DEEP;
  return (
    <Svg testID="khatm-dua-divider" width="100%" height={16} viewBox="0 0 240 16" preserveAspectRatio="xMidYMid meet" {...hidden}>
      <Path d="M30 8 H100 M140 8 H210" stroke={line} strokeWidth={1} strokeLinecap="round" />
      <Circle cx={105} cy={8} r={1.6} fill={EMERALD} />
      <Circle cx={135} cy={8} r={1.6} fill={EMERALD} />
      <Path d={star(120, 8, 6.5, 3)} fill={GOLD} stroke={GOLD_DEEP} strokeWidth={0.5} strokeLinejoin="round" />
    </Svg>
  );
}
