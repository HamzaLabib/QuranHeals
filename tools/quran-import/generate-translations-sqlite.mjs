import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

// Phase 6A.8B — deterministic generator for translations.sqlite from the
// Phase 6A.8A verified/hash-pinned Gutenberg-Pickthall extraction. Mirrors
// tools/quran-import/generate-sqlite.mjs's build conventions (fixed PRAGMAs,
// sorted insertion order, temp-dir build + atomic rename, verify-before-
// publish) so the two Quran SQLite assets stay structurally consistent.
//
// Deliberately does NOT read the raw Gutenberg text at runtime — the
// approved tracked JSON (tools/quran-verification/pickthall-gutenberg-16955.json)
// is the sole generation input, hash-pinned below. Never touches MongoDB.

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(__dirname, '../..');

export const sourceJsonPath = 'tools/quran-verification/pickthall-gutenberg-16955.json';
export const expectedSourceJsonSha256 = 'f22e7ef2958bab19b36e5c604f927da8241148e73ec9763100bc9ffc27c8a4b4';
export const expectedRawGutenbergSha256 = '8ea8efcdf76a20ac1a6a3948c292f44fc7acda597ed7cbc50ac2dc4c254be7a8';

export const translationId = 'en.pickthall.gutenberg16955';
export const schemaPath = resolve(__dirname, 'translations-schema.sql');
const schema = readFileSync(schemaPath, 'utf8');

export const schemaVersion = 1;
export const applicationId = 0x51485452; // 'QHTR' — Quran Heals TRanslations (distinct from quran.sqlite's 'QHRN')
export const generatorVersion = '1.0.0';

// Phase 6A.8F — the SQLite container bytes buildDatabase() writes depend on
// the embedded SQLite version bundled with node:sqlite, not just on the
// schema/source content; two builds on different Node/SQLite versions can be
// logically identical (same rows, same text) yet byte-different. Canonical
// asset generation (the only place these are checked) is pinned to the
// toolchain both development machines have independently verified produce
// SHA-256 c6d825a2f9de0395a1391339477fce58e5850805b1df161b53dcb7816c898ce8.
// Read-only verification (verifyDatabase/openReadonlyDatabase below) is
// deliberately NOT gated by this — an already-published database must stay
// checkable from any Node version; only writing a new canonical database
// requires the pinned toolchain.
export const requiredCanonicalBuildNodeVersion = '24.21.0';
export const requiredCanonicalBuildSqliteVersion = '3.53.4';

function assertCanonicalBuildToolchain() {
  const actualNode = process.versions.node;
  const actualSqlite = process.versions.sqlite;
  if (actualNode !== requiredCanonicalBuildNodeVersion || actualSqlite !== requiredCanonicalBuildSqliteVersion) {
    throw new Error(
      `Canonical translations.sqlite generation requires Node ${requiredCanonicalBuildNodeVersion} / SQLite ${requiredCanonicalBuildSqliteVersion}. ` +
        `Current environment: Node ${actualNode} / SQLite ${actualSqlite ?? 'unavailable'}.`,
    );
  }
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Deterministic corpus checksum: sort rows by (surah, ayah), concatenate
 * `JSON.stringify([verseKey, exactText]) + '\n'` for every row (including a
 * final LF), SHA-256 the resulting UTF-8 stream. Mirrors the exact method
 * already used for Arabic/translation corpus checksums in
 * tools/quran-import/tanzil-source.mjs and backend/src/import/fullQuran.ts,
 * so the same method can be reused to compare the JSON source, the built
 * SQLite database, and the pre-existing full-corpus pins.
 */
export function corpusChecksum(rows) {
  const sorted = [...rows].sort((a, b) => a.surah - b.surah || a.ayah - b.ayah);
  const stream = sorted.map((r) => JSON.stringify([r.verseKey, r.text]) + '\n').join('');
  return sha256(Buffer.from(stream, 'utf-8'));
}

function loadSurahCounts() {
  return JSON.parse(readFileSync(resolve(repoRoot, 'backend/assets/quran/surah-counts.json'), 'utf8')).counts;
}

/** Reads and validates the approved verified Pickthall JSON. Never touches Mongo or the raw Gutenberg text. */
export function readVerifiedSource(bytes = readFileSync(resolve(repoRoot, sourceJsonPath))) {
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== expectedSourceJsonSha256) {
    throw new Error(`${sourceJsonPath} failed its integrity pin: expected ${expectedSourceJsonSha256}, got ${actualSha256}.`);
  }

  const parsed = JSON.parse(bytes.toString('utf-8'));
  if (parsed.sourceFileSha256 !== expectedRawGutenbergSha256) {
    throw new Error(`Embedded sourceFileSha256 does not match the approved Gutenberg raw-file hash.`);
  }
  if (parsed.translator !== 'Marmaduke Pickthall' || parsed.language !== 'en') {
    throw new Error('Unexpected translator/language in verified source JSON — refusing to generate.');
  }

  const surahCounts = loadSurahCounts();
  const canonicalKeys = new Set();
  for (let s = 1; s <= 114; s++) {
    for (let a = 1; a <= surahCounts[s - 1]; a++) canonicalKeys.add(`${s}:${a}`);
  }

  const verses = parsed.verses;
  if (!Array.isArray(verses)) throw new Error('Verified source JSON has no verses array.');

  const seen = new Set();
  const duplicates = [];
  const empty = [];
  const invalid = [];
  for (const v of verses) {
    if (typeof v.verseKey !== 'string' || !/^[0-9]{1,3}:[0-9]{1,3}$/.test(v.verseKey)) { invalid.push(v.verseKey); continue; }
    if (seen.has(v.verseKey)) duplicates.push(v.verseKey);
    seen.add(v.verseKey);
    if (typeof v.text !== 'string' || v.text.trim().length === 0) empty.push(v.verseKey);
  }
  const missing = [...canonicalKeys].filter((k) => !seen.has(k));
  const extra = [...seen].filter((k) => !canonicalKeys.has(k));

  if (invalid.length || duplicates.length || missing.length || extra.length || empty.length) {
    throw new Error(
      `Verified source JSON failed validation: ${JSON.stringify({
        invalid: invalid.length,
        duplicates: duplicates.length,
        missing: missing.length,
        extra: extra.length,
        empty: empty.length,
      })}`,
    );
  }
  if (seen.size !== 6236) throw new Error(`Expected exactly 6236 canonical verseKeys, found ${seen.size}.`);

  const rows = verses.map((v) => {
    const [surah, ayah] = v.verseKey.split(':').map(Number);
    return { surah, ayah, verseKey: v.verseKey, text: v.text };
  });

  return {
    bytes,
    sha256: actualSha256,
    rows,
    sourceFileSha256: parsed.sourceFileSha256,
    translator: parsed.translator,
    language: parsed.language,
  };
}

export function openReadonlyDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;');
  return db;
}

/** Deterministically builds translations.sqlite into `outputPath` (must not already exist) and returns its bytes. */
export function buildDatabase(outputPath, source = readVerifiedSource()) {
  assertCanonicalBuildToolchain();
  const db = new DatabaseSync(outputPath);
  try {
    db.exec(
      `PRAGMA page_size = 4096; PRAGMA encoding = 'UTF-8'; PRAGMA auto_vacuum = NONE; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA application_id = ${applicationId}; PRAGMA user_version = ${schemaVersion}; BEGIN IMMEDIATE;`,
    );
    db.exec(schema);

    const insertSource = db.prepare(
      'INSERT INTO translation_sources (id, language, translator, title, source_name, source_version, source_sha256, corpus_sha256, license_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertSource.run(
      translationId,
      'en',
      'Marmaduke Pickthall',
      'The Meaning of the Glorious Koran',
      'Project Gutenberg eBook #16955 (https://www.gutenberg.org/ebooks/16955)',
      '16955-2020-12-12',
      source.sourceFileSha256,
      source.sha256,
      "Gutenberg catalog page: 'Public domain in the USA.' Gutenberg License section 1.D: 'The Foundation makes no representations concerning the copyright status of any work in any country outside the United States.' See tools/quran-import/raw/gutenberg-16955/README.md and backend/reports/quran-data/gutenberg-pickthall-verification.md for full provenance.",
    );

    const insertVerse = db.prepare('INSERT INTO translations (surah, ayah, verse_key, translation_id, text) VALUES (?, ?, ?, ?, ?)');
    for (const row of [...source.rows].sort((a, b) => a.surah - b.surah || a.ayah - b.ayah)) {
      insertVerse.run(row.surah, row.ayah, row.verseKey, translationId, row.text);
    }
    db.exec('COMMIT;');
  } finally {
    db.close();
  }
  return readFileSync(outputPath);
}

/** Read-only structural + content verification of a built translations.sqlite. */
export function verifyDatabase(path, source = readVerifiedSource()) {
  const db = openReadonlyDatabase(path);
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('SQLite integrity_check failed.');
    if (
      db.prepare('PRAGMA user_version').get().user_version !== schemaVersion ||
      db.prepare('PRAGMA application_id').get().application_id !== applicationId ||
      db.prepare('PRAGMA encoding').get().encoding !== 'UTF-8' ||
      db.prepare('PRAGMA page_size').get().page_size !== 4096
    ) {
      throw new Error('SQLite schema version/application ID/encoding/page size mismatch.');
    }

    const rows = db
      .prepare('SELECT surah, ayah, verse_key, text, CAST(text AS BLOB) AS utf8 FROM translations ORDER BY surah, ayah')
      .all();
    if (rows.length !== 6236) throw new Error(`Expected 6236 translation rows, found ${rows.length}.`);

    const originals = new Map(source.rows.map((r) => [r.verseKey, r.text]));
    const mismatchKeys = [];
    let exactMatches = 0;
    for (const row of rows) {
      const original = originals.get(row.verse_key);
      if (original === row.text && Buffer.from(original, 'utf8').equals(row.utf8)) exactMatches++;
      else mismatchKeys.push(row.verse_key);
    }
    if (mismatchKeys.length) {
      throw new Error(`Translation text mismatch: ${JSON.stringify({ exactMatches, mismatches: mismatchKeys.length, mismatchKeys })}`);
    }

    const sourceRow = db.prepare('SELECT * FROM translation_sources WHERE id = ?').get(translationId);
    if (!sourceRow) throw new Error('translation_sources row missing.');
    if (sourceRow.source_sha256 !== source.sourceFileSha256 || sourceRow.corpus_sha256 !== source.sha256) {
      throw new Error('translation_sources hash fields do not match the verified source.');
    }

    const sourceCorpusChecksum = corpusChecksum(source.rows);
    const sqliteCorpusChecksum = corpusChecksum(rows.map((r) => ({ surah: r.surah, ayah: r.ayah, verseKey: r.verse_key, text: r.text })));
    if (sourceCorpusChecksum !== sqliteCorpusChecksum) {
      throw new Error(`Corpus checksum mismatch: source ${sourceCorpusChecksum} vs SQLite ${sqliteCorpusChecksum}.`);
    }

    return {
      rowCount: rows.length,
      exactMatches,
      mismatches: mismatchKeys.length,
      integrityCheck: 'ok',
      sourceRow,
      corpusChecksum: sqliteCorpusChecksum,
    };
  } finally {
    db.close();
  }
}

/** Builds translations.sqlite twice into independent OS-temp paths and proves the output bytes are identical. */
export function proveDeterministicBuild(source = readVerifiedSource()) {
  const dirA = mkdtempSync(join(tmpdir(), 'qh-translations-build-a-'));
  const dirB = mkdtempSync(join(tmpdir(), 'qh-translations-build-b-'));
  try {
    const pathA = join(dirA, 'translations.sqlite');
    const pathB = join(dirB, 'translations.sqlite');
    const bytesA = buildDatabase(pathA, source);
    const bytesB = buildDatabase(pathB, source);
    const hashA = sha256(bytesA);
    const hashB = sha256(bytesB);
    return {
      pathA,
      pathB,
      sizeA: bytesA.length,
      sizeB: bytesB.length,
      hashA,
      hashB,
      byteIdentical: hashA === hashB && bytesA.equals(bytesB),
    };
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
}

/** Builds into a fresh OS-temp path, verifies, then atomically publishes to the repo destination. Refuses to silently overwrite a differing existing file. */
export function generateAndPublish(destinationPath = resolve(repoRoot, 'backend/assets/quran/translations.sqlite')) {
  const source = readVerifiedSource();
  const buildDir = mkdtempSync(join(tmpdir(), 'qh-translations-publish-'));
  try {
    const buildPath = join(buildDir, 'translations.sqlite');
    const bytes = buildDatabase(buildPath, source);
    const verification = verifyDatabase(buildPath, source);
    mkdirSync(dirname(destinationPath), { recursive: true });
    if (existsSync(destinationPath)) {
      const existing = readFileSync(destinationPath);
      if (!existing.equals(bytes)) {
        throw new Error(`${destinationPath} already exists and differs from the newly generated bytes; refusing to overwrite silently.`);
      }
    } else {
      renameSync(buildPath, destinationPath);
    }
    return { destinationPath, sha256: sha256(bytes), bytes: bytes.length, verification };
  } finally {
    rmSync(buildDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    if (mode === '--prove-deterministic') {
      const result = proveDeterministicBuild();
      console.log(JSON.stringify(result, null, 2));
      if (!result.byteIdentical) process.exitCode = 1;
    } else if (mode === '--publish') {
      const result = generateAndPublish();
      console.log(JSON.stringify(result, null, 2));
    } else {
      throw new Error('Use node tools/quran-import/generate-translations-sqlite.mjs [--prove-deterministic|--publish]');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
