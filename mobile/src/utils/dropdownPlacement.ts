/**
 * Where a dropdown anchored to a selector opens, and which way the selector's
 * chevron points (the Wird selectors on Home and in the Mushaf).
 *
 * The chevron always shows the menu's real movement: opening below, it points
 * down (the menu comes down); opening above, up. While the menu closes it
 * points the way the menu goes back to the selector (up for a menu below,
 * down for one above). Closed, it rests pointing down.
 */

export type DropdownPlacement = 'below' | 'above';
export type DropdownPhase = 'closed' | 'open' | 'closing';
export type ChevronDirection = 'down' | 'up';

/** Between the selector and its menu (pt). */
export const DROPDOWN_GAP = 6;

type PlacementInput = {
  /** The selector's top and bottom edges, in window coordinates. */
  anchorTop: number;
  anchorBottom: number;
  /** The menu's full height (its rows), before any limit. */
  menuHeight: number;
  /** The tallest the menu may be anywhere (a share of the screen). */
  maxHeight: number;
  windowHeight: number;
  /** Safe areas at the top and bottom (status bar, home indicator). */
  safeTop: number;
  safeBottom: number;
  /** Where the menu goes when it fits there. */
  preferred: DropdownPlacement;
};

/**
 * The side the menu opens on, and how tall it may be there: the preferred
 * side whenever the whole menu fits; otherwise whichever side fits it (or
 * has more room), the menu then scrolling within that room. Never past the
 * safe areas.
 */
export function resolveDropdownPlacement(input: PlacementInput): { placement: DropdownPlacement; maxHeight: number } {
  const wanted = Math.min(input.menuHeight, input.maxHeight);
  const room: Record<DropdownPlacement, number> = {
    below: Math.max(0, input.windowHeight - input.safeBottom - input.anchorBottom - DROPDOWN_GAP),
    above: Math.max(0, input.anchorTop - input.safeTop - DROPDOWN_GAP),
  };
  const other: DropdownPlacement = input.preferred === 'below' ? 'above' : 'below';
  const placement = room[input.preferred] >= wanted || room[input.preferred] >= room[other] ? input.preferred : other;
  return { placement, maxHeight: Math.min(input.maxHeight, room[placement]) };
}

/** The chevron's direction: toward where the menu is going (see above). */
export function chevronDirection(phase: DropdownPhase, placement: DropdownPlacement): ChevronDirection {
  if (phase === 'open') return placement === 'below' ? 'down' : 'up';
  if (phase === 'closing') return placement === 'below' ? 'up' : 'down';
  return 'down';
}
