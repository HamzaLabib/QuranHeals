import type { AyahMarker } from '../ayahMarkers';
import { AYAH_MARKER_ARTWORK } from '../generated/ayahMarkerArtwork';

/**
 * The traditional medallion for an ayah number in the Unicode prototype: the very artwork the QPC V1 reader draws
 * (the shared ornament and the traced number, generated/ayahMarkerArtwork.ts) in the same AyahMarkerOrnament, so its
 * look, colours and the ورد's gold are the production ones. Only its place differs: a slot of its own in the line
 * (unicode/layout.ts MARKER_SLOT_EM) instead of over a QCF glyph, so `ink` is unused here.
 */
const markers = new Map<string, AyahMarker>();

export function unicodeAyahMarker(verseKey: string, ayah: number): AyahMarker | null {
  const cached = markers.get(verseKey);
  if (cached) return cached;
  const number = AYAH_MARKER_ARTWORK.numbers[ayah - 1];
  if (!number || number.ayah !== ayah) return null;
  const { ornamentPath, ornamentTransform, ornamentBox } = AYAH_MARKER_ARTWORK;
  const marker: AyahMarker = {
    verseKey,
    ayah,
    ornamentPath,
    ornamentTransform,
    ornamentBox,
    numberTransform: number.numberTransform,
    numberPath: number.numberPath,
    numberBox: number.numberBox,
    ink: { xMin: 0, xMax: 0, yMin: 0, yMax: 0 },
  };
  markers.set(verseKey, marker);
  return marker;
}
