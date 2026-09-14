import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { isValidVerseKey } from './referenceKeys';

// Backend-owned, verified copy of the mobile Quran asset — see
// tools/quran-import/sync-backend-quran-asset.mjs. Deliberately does not
// reach into mobile/ or tools/: a backend-only deployment must work on its
// own.
const databasePath = resolve(__dirname, '../../assets/quran/quran.sqlite');

const expectedHash = 'c380a5952e5bf946a5f35335f5f3551be7559224e81a7ebd312df195c1b30d5b';
const expectedRowCount = 6236;
const expectedSurahCount = 114;
const expectedApplicationId = 1363694158;
const expectedUserVersion = 1;

const referenceKeyPattern = /^[1-9]\d{0,2}:[1-9]\d{0,2}$/;

/**
 * Provenance label for Arabic served straight from the verified SQLite asset
 * when no Mongo `Verse` document exists to supply its own `quranTextSource`
 * (see `resolveMongoVerseKey`/`getVerifiedArabicByVerseKey` callers). Matches
 * the equivalent mobile-side constant in
 * `mobile/src/services/quranRepository.ts`.
 */
export const VERIFIED_QURAN_TEXT_SOURCE = 'Tanzil Quran Text — Uthmani 1.1 — https://tanzil.net';

export class QuranSourceError extends Error {
  constructor(message: string, readonly kind: 'integrity' | 'invalid_reference' = 'integrity') {
    super(message);
    this.name = 'QuranSourceError';
  }
}

type VerseRow = { surah: number; ayah: number; verse_key: string; arabic_text: string };
type MongoQuranReference = {
  referenceKey?: unknown;
  surahNumber?: unknown;
  ayahNumber?: unknown;
};

function hashFile(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

let db: DatabaseSync | undefined;

function open(): DatabaseSync {
  if (db) {
    return db;
  }

  if (hashFile(databasePath) !== expectedHash) {
    throw new QuranSourceError('The verified Quran database failed its integrity pin.');
  }

  const candidate = new DatabaseSync(databasePath, { readOnly: true });

  try {
    candidate.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;');

    const counts = candidate
      .prepare('SELECT COUNT(*) AS rows, COUNT(DISTINCT surah) AS surahs, COUNT(DISTINCT verse_key) AS keys FROM verses')
      .get() as { rows: number; surahs: number; keys: number };
    const version = candidate.prepare('PRAGMA user_version').get() as { user_version: number };
    const identity = candidate.prepare('PRAGMA application_id').get() as { application_id: number };

    if (
      counts.rows !== expectedRowCount ||
      counts.surahs !== expectedSurahCount ||
      counts.keys !== expectedRowCount ||
      version.user_version !== expectedUserVersion ||
      identity.application_id !== expectedApplicationId
    ) {
      throw new QuranSourceError('The verified Quran database failed structural verification.');
    }
  } catch (error) {
    candidate.close();
    throw error;
  }

  db = candidate;
  return db;
}

/** Looks up the exact, unmodified Arabic text for a verse key. No normalization, trimming, or rewriting. */
export function getVerifiedArabicByVerseKey(verseKey: string): string {
  if (!isValidVerseKey(verseKey)) {
    throw new QuranSourceError(`"${verseKey}" is not a valid Quran reference.`, 'invalid_reference');
  }

  const database = open();
  const rows = database
    .prepare('SELECT surah, ayah, verse_key, arabic_text FROM verses WHERE verse_key = ?')
    .all(verseKey) as VerseRow[];

  if (
    rows.length !== 1 ||
    rows[0].verse_key !== verseKey ||
    typeof rows[0].arabic_text !== 'string' ||
    rows[0].arabic_text.length === 0
  ) {
    throw new QuranSourceError(`Verified Quran source has no resolvable entry for "${verseKey}".`);
  }

  return rows[0].arabic_text;
}

/**
 * Derives a stable verseKey from a Mongo record's reference/numeric fields
 * only — never from Arabic text. Requires every present candidate field to
 * agree, and requires the result to be one of the 6,236 real verses (neither
 * Verse nor legacy Ayah constrains referenceKey to the real verse set at the
 * schema level, and Ayah has no shape validation on referenceKey at all).
 */
export function resolveMongoVerseKey(record: MongoQuranReference): string {
  const candidates: string[] = [];

  if (typeof record.referenceKey === 'string') {
    if (!referenceKeyPattern.test(record.referenceKey)) {
      throw new QuranSourceError(
        `"${record.referenceKey}" is not a valid Quran reference.`,
        'invalid_reference',
      );
    }
    candidates.push(record.referenceKey);
  }

  if (record.surahNumber !== undefined || record.ayahNumber !== undefined) {
    const { surahNumber, ayahNumber } = record;
    if (
      typeof surahNumber !== 'number' ||
      typeof ayahNumber !== 'number' ||
      !Number.isInteger(surahNumber) ||
      !Number.isInteger(ayahNumber) ||
      surahNumber < 1 ||
      surahNumber > 114 ||
      ayahNumber < 1 ||
      ayahNumber > 286
    ) {
      throw new QuranSourceError('This record has an invalid Quran surah/ayah reference.', 'invalid_reference');
    }
    candidates.push(`${surahNumber}:${ayahNumber}`);
  }

  if (candidates.length === 0 || candidates.some((key) => key !== candidates[0])) {
    throw new QuranSourceError('This record has a missing or conflicting Quran reference.', 'invalid_reference');
  }

  const [verseKey] = candidates;

  if (!isValidVerseKey(verseKey)) {
    throw new QuranSourceError(`"${verseKey}" is not a valid Quran reference.`, 'invalid_reference');
  }

  return verseKey;
}

export function getVerifiedArabicForRecord(record: MongoQuranReference): string {
  return getVerifiedArabicByVerseKey(resolveMongoVerseKey(record));
}
