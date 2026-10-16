import type { DimensionValue, ViewStyle } from 'react-native';

/**
 * Window size classes, from the window's own width (never the device or its brand): a phone, a phone or tablet in
 * split screen, a narrow resizable window and a folded foldable are all `compact`, and get the phone layouts exactly as
 * they were. Breakpoints are Android's window size classes (in dp; iOS points are the same unit for this purpose).
 */
export type WindowClass = 'compact' | 'medium' | 'expanded';

export const WINDOW_BREAKPOINTS = { medium: 600, expanded: 840 } as const;

/** Shared tablet measures (pt/dp). Compact windows never use them. */
export const LAYOUT_TOKENS = {
  /** General screen content (lists, cards, settings). */
  contentMaxWidth: 720,
  /** Quran Arabic and translation reading width (ayah screens). */
  readingMaxWidth: 680,
  /** Bottom sheets and their forms. */
  sheetMaxWidth: 560,
  /** The five tabs, centred as one group. */
  tabBarMaxWidth: 600,
} as const;

export function windowClassFor(width: number): WindowClass {
  if (!Number.isFinite(width) || width < WINDOW_BREAKPOINTS.medium) return 'compact';
  return width < WINDOW_BREAKPOINTS.expanded ? 'medium' : 'expanded';
}

/** Emotion grid columns: 2 (the phone grid, unchanged), 3, 4. */
export function emotionGridColumns(windowClass: WindowClass): number {
  return windowClass === 'compact' ? 2 : windowClass === 'medium' ? 3 : 4;
}

/**
 * A grid card's flex basis for `columns` per row (cards also flexGrow, so a row's cards share its width): the phone's
 * original 47.5% for two, and bases that fit exactly 3 or 4 per row with the grid's column gap on tablet widths.
 */
export function gridCardBasis(columns: number): DimensionValue {
  if (columns >= 4) return '22%';
  if (columns === 3) return '30%';
  return '47.5%';
}

/** Empty cells that complete the last row, so its cards keep the other rows' width instead of growing to fill it. */
export function gridFillerCount(items: number, columns: number): number {
  if (columns <= 2 || items <= 0) return 0;
  return (columns - (items % columns)) % columns;
}

const EMPTY: ViewStyle = {};

/**
 * A centred column at most `maxWidth` wide, for a ScrollView's or FlatList's contentContainerStyle (or any content
 * View). Compact windows get no style at all, so phone layouts are untouched.
 */
export function contentColumnStyle(windowClass: WindowClass, maxWidth: number = LAYOUT_TOKENS.contentMaxWidth): ViewStyle {
  if (windowClass === 'compact') return EMPTY;
  return { alignSelf: 'center', maxWidth, width: '100%' };
}

/**
 * Bottom sheets on tablets: still anchored at the bottom (the same keyboard and dismissal behaviour as on phones), but
 * centred and at most LAYOUT_TOKENS.sheetMaxWidth wide. Compact: no style.
 * - 'absolute': a sheet positioned with left: 0, right: 0, bottom: 0; its sides move inward.
 * - 'flow': a sheet in a flex column (e.g. at the end of a justifyContent: 'flex-end' overlay); it is centred.
 */
export function sheetFrameStyle(windowClass: WindowClass, windowWidth: number, placement: 'absolute' | 'flow'): ViewStyle {
  if (windowClass === 'compact') return EMPTY;
  if (placement === 'flow') return { alignSelf: 'center', maxWidth: LAYOUT_TOKENS.sheetMaxWidth, width: '100%' };
  const side = Math.max(0, (windowWidth - LAYOUT_TOKENS.sheetMaxWidth) / 2);
  return { left: side, right: side };
}
