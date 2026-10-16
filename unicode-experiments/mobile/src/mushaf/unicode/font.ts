import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import * as Font from 'expo-font';
import { Platform } from 'react-native';

/**
 * The Unicode Mushaf prototype's Quran font: KFGQPC HAFS Uthmanic Script, version 0.18 (© King Fahd Glorious Qur'an
 * Printing Complex), from Quran Foundation's documented font CDN — the same terms as the QCF V1 page fonts: it may be
 * cached or bundled as an integrated part of the app, never offered on its own (docs/mushaf-reader-architecture.md §2).
 *
 * Not in the repository and not in the app binary (the prototype changes neither): downloaded once on first use,
 * accepted only if its size and SHA-256 are exactly the pinned ones (the file the width table was measured from), and
 * kept in the app's documents, so the prototype works offline from then on. The web loads the same URL directly.
 * The font file is used unmodified (its licence forbids altering it); the verified text is handed to it in KFGQPC's
 * sukun encoding (encoding.ts), which it follows, and the two words it cannot draw go to Amiri Quran.
 */
export const UNICODE_FONT = {
  family: 'QH_KFGQPC_Hafs_v18',
  url: 'https://verses.quran.foundation/fonts/quran/hafs/uthmanic_hafs/UthmanicHafs1Ver18.ttf',
  bytes: 242_368,
  sha256: 'a0636e68e375af9552470d67773936f54d536e6586ce2608311b2fe7f9cbec3a',
} as const;

/**
 * Amiri Quran (SIL Open Font License 1.1, via @expo-google-fonts/amiri-quran, a development dependency): the
 * prototype's second font, and KFGQPC Hafs's fallback for the two words it cannot draw. Bundled in development builds
 * only (this module is reached only through the dev-only mushaf/unicode/index.ts).
 */
export const AMIRI_QURAN_FONT = {
  family: 'QH_AmiriQuran',
  source: require('@expo-google-fonts/amiri-quran/400Regular/AmiriQuran_400Regular.ttf'),
  sha256: '6814dda5c41a412ce873da0551b11fa924d01f79592e6294b702911e49b9d3a6',
} as const;

/**
 * QH Old Madina: DigitalKhatt Old Madina (SIL OFL 1.1, https://github.com/DigitalKhatt/oldmadinafont), drawn from the
 * Madina Mushaf in Uthman Taha's hand; in this copy a letter followed by n tatweels takes its n-th calligraphic
 * elongation (the tatweels draw nothing) and its narrow forms are stylistic set ss13 (tools/unicode-mushaf/build-madina-font.py;
 * nothing else changed). OFL: it may be bundled and kept
 * in the repository. Development builds only, like this module.
 */
export const MADINA_FONT = {
  family: 'QH_OldMadina',
  source: require('./fonts/QHOldMadina.ttf'),
  sha256: '87413c86e6a7d96a1444cf0ce82262a9a449710d1455e8c8e0785714ebdfad12',
} as const;

const TIMEOUT_MS = 30_000;

export type UnicodeFontResult = { ok: true; source: 'cache' | 'download' | 'web' | 'loaded' | 'bundled' } | { ok: false; reason: string };

let pending: Promise<UnicodeFontResult> | null = null;

/**
 * Registers the fonts a rendering draws with (once per session); never throws. Every rendering may need Amiri Quran
 * (the fallback for words its font cannot draw, or the font itself).
 */
export async function ensureUnicodeFont(font: 'hafs' | 'hafsPlus' | 'madina' | 'madinaCalligraphic' | 'madinaNatural' | 'amiri' = 'hafs'): Promise<UnicodeFontResult> {
  const amiri = await ensureBundled(AMIRI_QURAN_FONT);
  if (font === 'amiri' || !amiri.ok) return amiri;
  if (font.startsWith('madina')) return ensureBundled(MADINA_FONT);
  if (Font.isLoaded(UNICODE_FONT.family)) return { ok: true, source: 'loaded' };
  pending ??= load().then((result) => {
    if (!result.ok) pending = null; // try again next time
    return result;
  });
  return pending;
}

async function ensureBundled(asset: { family: string; source: number }): Promise<UnicodeFontResult> {
  if (Font.isLoaded(asset.family)) return { ok: true, source: 'loaded' };
  try {
    await Font.loadAsync({ [asset.family]: asset.source });
    return { ok: true, source: 'bundled' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : `${asset.family} could not be loaded` };
  }
}

/** The bytes are the pinned font file. */
export const isPinnedFont = (bytes: Uint8Array) => bytes.length === UNICODE_FONT.bytes && bytesToHex(sha256(bytes)) === UNICODE_FONT.sha256;

async function load(): Promise<UnicodeFontResult> {
  try {
    if (Platform.OS === 'web') {
      await Font.loadAsync({ [UNICODE_FONT.family]: UNICODE_FONT.url });
      return { ok: true, source: 'web' };
    }
    const { Directory, File, Paths } = await import('expo-file-system');
    const dir = new Directory(Paths.document, 'mushaf', 'unicode-prototype');
    const file = new File(dir, 'UthmanicHafs1Ver18.ttf');
    let source: 'cache' | 'download' = 'cache';
    if (!file.exists || !isPinnedFont(await file.bytes())) {
      source = 'download';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let bytes: Uint8Array;
      try {
        const response = await fetch(UNICODE_FONT.url, { signal: controller.signal });
        if (!response.ok) return { ok: false, reason: `font server answered ${response.status}` };
        bytes = new Uint8Array(await response.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }
      if (!isPinnedFont(bytes)) return { ok: false, reason: 'downloaded font does not match the pinned file' };
      if (!dir.exists) dir.create({ intermediates: true });
      const part = new File(dir, 'UthmanicHafs1Ver18.ttf.part');
      if (part.exists) part.delete();
      part.create();
      part.write(bytes);
      await part.move(file, { overwrite: true });
    }
    await Font.loadAsync({ [UNICODE_FONT.family]: file.uri });
    return { ok: true, source };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'font could not be loaded' };
  }
}
