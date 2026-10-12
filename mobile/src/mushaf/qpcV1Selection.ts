import { markerOverlayBox, type AyahMarker } from './ayahMarkers';
import { QPC_V1_SELECTION_INK } from './generated/qpcV1SelectionInk';
import type { WordBox } from './qpcV1Layout';

/**
 * A rendered word's box with its drawn ink past the box (points), for the selection highlight: an ayah-end marker's
 * medallion (drawn by the app: its box is exact), or a word's own ink where it can end a selection
 * (generated/qpcV1SelectionInk.ts, from the real outlines). Other words: the box alone.
 */
export function withSelectionInk(
  box: WordBox,
  page: number,
  word: { verseKey: string; position: number },
  fontSize: number,
  marker: AyahMarker | null,
): WordBox {
  if (marker) {
    const medallion = markerOverlayBox(marker, fontSize, 0);
    return { ...box, inkLeft: Math.max(0, -medallion.x), inkRight: Math.max(0, medallion.x + medallion.width - box.width) };
  }
  const ink = QPC_V1_SELECTION_INK[page]?.[`${word.verseKey}:${word.position}`];
  return ink ? { ...box, inkLeft: (ink[0] / 100) * fontSize, inkRight: (ink[1] / 100) * fontSize } : box;
}
