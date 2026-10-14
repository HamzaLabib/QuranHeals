import { describe, expect, it } from 'vitest';

import { chevronDirection, DROPDOWN_GAP, resolveDropdownPlacement } from '@/utils/dropdownPlacement';

/** A 390 × 844 phone (safe areas 47 / 34), a 32-pt selector at `top`, a menu `menu` tall (at most 320). */
const at = (top: number, menu: number, preferred: 'below' | 'above' = 'below') => resolveDropdownPlacement({
  anchorTop: top, anchorBottom: top + 32, menuHeight: menu, maxHeight: 320, windowHeight: 844, safeTop: 47, safeBottom: 34, preferred,
});

describe('where a Wird menu opens (resolveDropdownPlacement)', () => {
  it('opens on its preferred side whenever the whole menu fits there', () => {
    expect(at(200, 160)).toEqual({ placement: 'below', maxHeight: 320 });
    expect(at(600, 160, 'above')).toEqual({ placement: 'above', maxHeight: 320 });
  });

  it('near the bottom of the screen (above the home indicator) it opens upward instead', () => {
    // Below the selector at 700: 844 − 34 − 732 − 6 = 72 pt, too little for 160; above: 700 − 47 − 6 = 647.
    expect(at(700, 160)).toEqual({ placement: 'above', maxHeight: 320 });
  });

  it('near the top (under the status bar) an upward-preferring menu opens downward instead', () => {
    expect(at(60, 160, 'above')).toEqual({ placement: 'below', maxHeight: 320 });
  });

  it('where it fits neither way, the roomier side, the menu scrolling within that room (never past the safe areas)', () => {
    const tall = resolveDropdownPlacement({ anchorTop: 380, anchorBottom: 412, menuHeight: 2000, maxHeight: 2000, windowHeight: 844, safeTop: 47, safeBottom: 34, preferred: 'below' });
    // Below: 844 − 34 − 412 − 6 = 392; above: 380 − 47 − 6 = 327.
    expect(tall).toEqual({ placement: 'below', maxHeight: 392 });
    const higher = resolveDropdownPlacement({ anchorTop: 500, anchorBottom: 532, menuHeight: 2000, maxHeight: 2000, windowHeight: 844, safeTop: 47, safeBottom: 34, preferred: 'below' });
    expect(higher).toEqual({ placement: 'above', maxHeight: 500 - 47 - DROPDOWN_GAP });
  });

  it('a short menu keeps its own height; a long one stops at the limit and scrolls', () => {
    expect(at(200, 2000).maxHeight).toBe(320);
  });
});

describe('which way the chevron points (chevronDirection): the menu`s real movement', () => {
  it('opening: down for a menu below, up for a menu above', () => {
    expect(chevronDirection('open', 'below')).toBe('down');
    expect(chevronDirection('open', 'above')).toBe('up');
  });

  it('closing: back toward the selector, up for a menu below, down for a menu above', () => {
    expect(chevronDirection('closing', 'below')).toBe('up');
    expect(chevronDirection('closing', 'above')).toBe('down');
  });

  it('closed: at rest, pointing down, wherever it opened last', () => {
    expect(chevronDirection('closed', 'below')).toBe('down');
    expect(chevronDirection('closed', 'above')).toBe('down');
  });
});
