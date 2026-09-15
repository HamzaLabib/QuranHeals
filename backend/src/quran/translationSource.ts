import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { isValidVerseKey } from './referenceKeys';

// Backend-owned verified translation asset — see
// tools/quran-import/generate-translations-sqlite.mjs. Deliberately does not
// reach into tools/ at runtime: a backend-only deployment must work on its
// own (mirrors quran/quranSource.ts's asset handling).
const databasePath = resolve(__dirname, '../../assets/quran/translations.sqlite');

const expectedHash = 'c6d825a2f9de0395a1391339477fce58e5850805b1df161b53dcb7816c898ce8';
const expectedRowCount = 6236;
const expectedApplicationId = 0x51485452; // 'QHTR'
const expectedUserVersion = 1;

/** The sole translation currently bundled — see generate-translations-sqlite.mjs's translation_sources row. */
export const PRIMARY_TRANSLATION_ID = 'en.pickthall.gutenberg16955';

/**
 * Provenance label for translation text served straight from the verified
 * SQLite asset. Matches the equivalent mobile-facing convention of
 * `quranSource.ts`'s `VERIFIED_QURAN_TEXT_SOURCE` — a fixed, human-readable
 * citation string rather than a per-request database read.
 */
export const VERIFIED_TRANSLATION_SOURCE =
  'Marmaduke Pickthall — The Meaning of the Glorious Koran — Project Gutenberg eBook #16955';

export class TranslationSourceError extends Error {
  constructor(message: string, readonly kind: 'integrity' | 'not_found' = 'integrity') {
    super(message);
    this.name = 'TranslationSourceError';
  }
}

type TranslationRow = { text: string; verse_key: string };
type SourceMetadataRow = {
  id: string;
  language: string;
  translator: string;
  title: string;
  source_name: string;
  source_version: string | null;
  license_note: string;
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
    throw new TranslationSourceError('The verified translation database failed its integrity pin.');
  }

  const candidate = new DatabaseSync(databasePath, { readOnly: true });

  try {
    candidate.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;');

    const counts = candidate
      .prepare('SELECT COUNT(*) AS rows FROM translations WHERE translation_id = ?')
      .get(PRIMARY_TRANSLATION_ID) as { rows: number };
    const version = candidate.prepare('PRAGMA user_version').get() as { user_version: number };
    const identity = candidate.prepare('PRAGMA application_id').get() as { application_id: number };

    if (
      counts.rows !== expectedRowCount ||
      version.user_version !== expectedUserVersion ||
      identity.application_id !== expectedApplicationId
    ) {
      throw new TranslationSourceError('The verified translation database failed structural verification.');
    }
  } catch (error) {
    candidate.close();
    throw error;
  }

  db = candidate;
  return db;
}

/**
 * Returns the verified Pickthall translation text for a canonical verseKey
 * ("surah:ayah"). Throws if the key is malformed or does not resolve — no
 * empty-string fallback, no MongoDB fallback. This is the sole runtime
 * authority for English Quran translation text (Phase 6A.8B); a Mongo
 * `VerseTranslation` or legacy `Ayah.englishTranslation` field, if present,
 * must never override it.
 */
export function getVerifiedTranslationByVerseKey(verseKey: string): string {
  if (!isValidVerseKey(verseKey)) {
    throw new TranslationSourceError(`"${verseKey}" is not a valid Quran reference.`, 'not_found');
  }

  const database = open();
  const row = database
    .prepare('SELECT text, verse_key FROM translations WHERE verse_key = ? AND translation_id = ?')
    .get(verseKey, PRIMARY_TRANSLATION_ID) as TranslationRow | undefined;

  if (!row || row.verse_key !== verseKey || typeof row.text !== 'string' || row.text.length === 0) {
    throw new TranslationSourceError(`Verified translation source has no resolvable entry for "${verseKey}".`, 'not_found');
  }

  return row.text;
}

export type TranslationSourceMetadata = {
  id: string;
  language: string;
  translator: string;
  title: string;
  sourceName: string;
  sourceVersion: string | null;
  licenseNote: string;
};

let cachedMetadata: TranslationSourceMetadata | undefined;

/** Source-level provenance metadata for the primary bundled translation (stored once, not per-verse). */
export function getPrimaryTranslationSourceMetadata(): TranslationSourceMetadata {
  if (cachedMetadata) {
    return cachedMetadata;
  }

  const database = open();
  const row = database
    .prepare(
      'SELECT id, language, translator, title, source_name, source_version, license_note FROM translation_sources WHERE id = ?',
    )
    .get(PRIMARY_TRANSLATION_ID) as SourceMetadataRow | undefined;

  if (!row) {
    throw new TranslationSourceError('translation_sources row missing for the primary translation.');
  }

  cachedMetadata = {
    id: row.id,
    language: row.language,
    translator: row.translator,
    title: row.title,
    sourceName: row.source_name,
    sourceVersion: row.source_version,
    licenseNote: row.license_note,
  };
  return cachedMetadata;
}
