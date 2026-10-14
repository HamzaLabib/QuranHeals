export function fitMushafPage(area: { width: number; height: number }, bottomInset: number, fullScreen = false, taller = false) {
  const viewportHeight = Math.max(0, area.height - (fullScreen ? FULL_SCREEN_BOTTOM_GAP + bottomInset : PAGE_PANEL_GAP + MUSHAF_PANEL_HEIGHT + MUSHAF_PANEL_MARGIN + bottomInset));
  const available = viewportHeight - (fullScreen ? 0 : WIRD_ROW_HEIGHT);
  const width = Math.floor(Math.max(0, Math.min(area.width - SIDE_MARGIN * 2, available / PAGE_ASPECT)));
  // Taller: at that same width, the tallest whole-tile frame that still fits.
  let tilesDown = BORDER_TILES_DOWN;
  while (taller && width > 0 && tilesDown < TALLER_MAX_TILES_DOWN && pageHeightFor(width, tilesDown + 1) <= available) tilesDown += 1;
  return {
    viewport: { width: Math.max(0, area.width), height: viewportHeight },
    page: { width, height: width > 0 ? pageHeightFor(width, tilesDown) : 0 },
    tilesDown,
  };
}
