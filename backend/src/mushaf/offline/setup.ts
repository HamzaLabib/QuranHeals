import { resolve } from 'node:path';

import { getAllVerifiedVerses } from '../../quran/quranSource';
import { getSurahAyahCounts } from '../../quran/referenceKeys';
import { createQfContentClient, type QfCredentials } from '../../quranFoundation/qfContentClient';
import type { CanonicalQuran } from './dataset';
import { createMushafSyncStore } from './store';
import { createMushafSyncService } from './syncService';

/** backend/data/mushaf-sync (src/ and dist/ sit at the same depth), unless MUSHAF_SYNC_DIR is set. */
export const resolveMushafSyncDir = (env: { MUSHAF_SYNC_DIR?: string }) => env.MUSHAF_SYNC_DIR?.trim() || resolve(__dirname, '../../../data/mushaf-sync');

/** The verified Tanzil text and canonical surah counts, loaded once (both integrity-pinned). */
let canonical: CanonicalQuran | undefined;
export function canonicalQuran(): CanonicalQuran {
  if (!canonical) {
    const text = new Map(getAllVerifiedVerses().map((verse) => [verse.verseKey, verse.arabicText]));
    canonical = {
      surahCounts: getSurahAyahCounts(),
      text: (verseKey) => {
        const value = text.get(verseKey);
        if (value === undefined) throw new Error(`No verified text for ${verseKey}`);
        return value;
      },
    };
  }
  return canonical;
}

export function createDefaultMushafSync(credentials: QfCredentials, dir: string, log?: (line: string) => void) {
  return createMushafSyncService({
    client: createQfContentClient(credentials, { timeoutMs: 30_000 }),
    environment: credentials.environment,
    store: createMushafSyncStore(dir),
    quran: canonicalQuran,
    log,
  });
}
