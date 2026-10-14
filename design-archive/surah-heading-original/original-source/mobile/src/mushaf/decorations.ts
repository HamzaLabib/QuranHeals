/**
 * The Mushaf's decorations: which design each one draws. Two independent choices, each a one-line change, so either
 * can go back to its earlier design (kept, working, in the repository) without touching the other. See
 * docs/mushaf-decorations.md.
 *
 * - Pages 1–2: 'rich' — OpeningPageOrnamentRich, the richer illumination (approved 2026-10-14, the default);
 *   'original' — OpeningPageOrnament, the earlier approved circle ornament.
 * - Surah headings (every page but 1–2, which keep their own compact cartouche): 'traditional' —
 *   SurahHeadingTraditional, the olive-and-gold band (approved 2026-10-14, the default); 'original' —
 *   SurahHeaderOrnament, the earlier emerald cartouche.
 *
 * Development builds can preview either without editing: /mushaf?opening=original|rich and
 * /mushaf?heading=original|traditional. Release builds always use the constants. Nothing here is a user setting.
 */
export type OpeningDecoration = 'rich' | 'original';
export type HeadingDecoration = 'traditional' | 'original';

export const OPENING_PAGES_DECORATION: OpeningDecoration = 'rich';
export const SURAH_HEADING_DECORATION: HeadingDecoration = 'traditional';

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  const first = Array.isArray(value) ? value[0] : value;
  return allowed.includes(first as T) ? (first as T) : fallback;
};

/** The decorations to draw: the constants, or (development builds only) a preview named in the route's parameters. */
export function resolveDecorations(params: Readonly<Record<string, unknown>>, dev: boolean): { opening: OpeningDecoration; heading: HeadingDecoration } {
  if (!dev) return { opening: OPENING_PAGES_DECORATION, heading: SURAH_HEADING_DECORATION };
  return {
    opening: pick(params.opening, ['rich', 'original'] as const, OPENING_PAGES_DECORATION),
    heading: pick(params.heading, ['traditional', 'original'] as const, SURAH_HEADING_DECORATION),
  };
}
