import { TAFSIR_RELEASE, type TafsirReleasePin } from './generated/tafsirRelease';

/**
 * The tafsir editions the reader offers, in their fixed order (the same in every app language).
 *
 * Whether an edition can actually be read is never decided here: it comes from the release pins
 * (generated/tafsirRelease.ts), written by tools/tafsir/ only after the edition's source file was fetched, checked against
 * its published checksums, converted and validated, AND its redistribution rights were recorded as verified
 * (tools/tafsir/RIGHTS.md). An edition without such a pin is listed as unavailable, with its reason, and can never be
 * downloaded or shown.
 *
 * - التفسير الميسر: bundled with the app (works offline on a fresh install, no download).
 * - The other three: optional downloads, each on its own, kept side by side on the device.
 */
export type TafsirEditionId = 'muyassar' | 'saadi' | 'jalalayn' | 'zilal';

export const TAFSIR_EDITION_IDS: readonly TafsirEditionId[] = ['muyassar', 'saadi', 'jalalayn', 'zilal'];

/** The edition the reader falls back to whenever the preferred one cannot be read. */
export const DEFAULT_TAFSIR_EDITION: TafsirEditionId = 'muyassar';

export type TafsirEditionInfo = {
  id: TafsirEditionId;
  /** The work's Arabic title, exactly as shown in the selector (the tafsir texts are Arabic in this release). */
  title: string;
  /** How the edition reaches the device. */
  delivery: 'bundled' | 'download';
  /** Its release pin, or null while the edition is unavailable (source or rights not verified). */
  pin: TafsirReleasePin | null;
  /** Why it is unavailable (for the record and tests; the app shows its own localized wording). */
  blockedReason: string | null;
};

const TITLES: Record<TafsirEditionId, string> = {
  muyassar: 'التفسير الميسر',
  saadi: 'تفسير السعدي',
  jalalayn: 'تفسير الجلالين',
  zilal: 'في ظلال القرآن',
};

export function isTafsirEditionId(value: unknown): value is TafsirEditionId {
  return typeof value === 'string' && (TAFSIR_EDITION_IDS as readonly string[]).includes(value);
}

export function tafsirEdition(id: TafsirEditionId, release = TAFSIR_RELEASE): TafsirEditionInfo {
  const entry = release[id];
  return {
    id,
    title: TITLES[id],
    delivery: id === 'muyassar' ? 'bundled' : 'download',
    pin: entry.status === 'ready' ? entry : null,
    blockedReason: entry.status === 'blocked' ? entry.reason : null,
  };
}

export function tafsirEditions(release = TAFSIR_RELEASE): readonly TafsirEditionInfo[] {
  return TAFSIR_EDITION_IDS.map((id) => tafsirEdition(id, release));
}

/**
 * Whether this build offers the tafsir reader at all: at least one edition has a verified release (bundled, or to
 * download). Until then the Mushaf's ayah menu has no Tafsir entry (MushafAyahPopups), so no one is led to a reader with
 * nothing to show; the entry appears by itself once tools/tafsir/build.mjs marks an edition ready.
 */
export function isTafsirReaderAvailable(release = TAFSIR_RELEASE): boolean {
  return tafsirEditions(release).some((edition) => edition.pin !== null);
}
