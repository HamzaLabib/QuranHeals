import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readVerifiedSource, repoRoot, sha256, sourcePath, validateRows } from './tanzil-source.mjs';

export const databasePath = 'mobile/assets/quran/quran.sqlite';
export const manifestPath = 'mobile/assets/quran/quran-manifest.json';
export const noticePath = 'mobile/assets/quran/TANZIL-NOTICE.txt';
export const schemaVersion = 1;
export const applicationId = 0x5148524e; // QHRN
export const generatorVersion = '1.0.0';
export const buildSqliteVersion = '3.51.3';
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function openReadonlyDatabase(path = resolve(repoRoot, databasePath)) {
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;');
  return db;
}

export function verifyDatabase(path = resolve(repoRoot, databasePath), source = readVerifiedSource()) {
  validateRows(source.rows, 'Source');
  const db = openReadonlyDatabase(path);
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('SQLite integrity_check failed.');
    if (db.prepare('PRAGMA user_version').get().user_version !== schemaVersion ||
        db.prepare('PRAGMA application_id').get().application_id !== applicationId ||
        db.prepare('PRAGMA encoding').get().encoding !== 'UTF-8' ||
        db.prepare('PRAGMA page_size').get().page_size !== 4096) throw new Error('SQLite schema version/application ID/encoding/page size mismatch.');
    const columns = db.prepare('PRAGMA table_info(verses)').all().map(row => [row.name, row.type, row.notnull, row.pk]);
    if (JSON.stringify(columns) !== JSON.stringify([
      ['surah', 'INTEGER', 1, 1], ['ayah', 'INTEGER', 1, 2], ['verse_key', 'TEXT', 1, 0], ['arabic_text', 'TEXT', 1, 0],
    ])) throw new Error('SQLite verses schema mismatch.');
    const objects = db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE type IN ('table', 'view', 'trigger') ORDER BY name").all();
    // SQLite omits the final statement delimiter in sqlite_schema. This removes
    // only that SQL delimiter, never any Quran text.
    const expectedSql = schema.replace(/;\n$/u, '');
    if (objects.length !== 1 || objects[0].type !== 'table' || objects[0].name !== 'verses' ||
        objects[0].sql !== expectedSql) throw new Error('SQLite table SQL/constraints or schema objects mismatch.');
    const indexes = db.prepare('PRAGMA index_list(verses)').all();
    if (indexes.length !== 2 || indexes.some(index => index.unique !== 1) ||
        !indexes.some(index => index.origin === 'pk') || !indexes.some(index => index.origin === 'u')) throw new Error('SQLite unique indexes missing.');
    // Read the stored UTF-8 bytes too, so SQL text decoding cannot hide a byte change.
    const rows = db.prepare('SELECT surah, ayah, verse_key, arabic_text, CAST(arabic_text AS BLOB) AS utf8 FROM verses ORDER BY surah, ayah').all();
    const validation = validateRows(rows, 'SQLite');
    const originals = new Map(source.rows.map(row => [row.verse_key, row.arabic_text]));
    const mismatchKeys = [];
    let exactMatches = 0;
    for (const row of rows) {
      const original = originals.get(row.verse_key);
      if (original === row.arabic_text && Buffer.from(original, 'utf8').equals(row.utf8)) exactMatches++;
      else mismatchKeys.push(row.verse_key);
    }
    if (mismatchKeys.length) throw new Error(`SQLite Arabic mismatch: ${JSON.stringify({ exactMatches, mismatches: mismatchKeys.length, mismatchKeys })}`);
    return { ...validation, exactMatches, mismatches: mismatchKeys.length, integrityCheck: 'ok' };
  } finally { db.close(); }
}

function makeManifest(source, verification, dbBytes, sqliteVersion) {
  return {
    schemaVersion,
    source: { path: sourcePath, sha256: source.sha256, bytes: source.bytes, name: 'Tanzil Quran Text', edition: 'Uthmani', version: '1.1', url: 'https://tanzil.net', noticePath },
    surahCount: verification.surahCount,
    ayahCount: verification.ayahCount,
    generator: { path: 'tools/quran-import/generate-sqlite.mjs', version: generatorVersion, nodeVersion: process.versions.node, sqliteVersion },
    database: { path: databasePath, sha256: sha256(dbBytes), bytes: dbBytes.length, schemaPath: 'tools/quran-import/schema.sql', schemaSha256: sha256(schema), applicationId, pageSize: 4096, encoding: 'UTF-8' },
    verification,
    timestampPolicy: 'Omitted: database and manifest are reproducible with the recorded generator, schema, source and runtime.',
    sourcePolicy: 'Tanzil is canonical. King Fahd is an independent verification/reference source only. No text transformations.',
  };
}

export function verifyBundle(directory = resolve(repoRoot, dirname(databasePath))) {
  const source = readVerifiedSource();
  const path = join(directory, 'quran.sqlite');
  const verification = verifyDatabase(path, source);
  const manifest = JSON.parse(readFileSync(join(directory, 'quran-manifest.json'), 'utf8'));
  const expected = makeManifest(source, verification, readFileSync(path), buildSqliteVersion);
  // A different Node version may verify a release without rewriting its build provenance.
  if (typeof manifest.generator?.nodeVersion !== 'string') throw new Error('Missing generator Node version.');
  expected.generator.nodeVersion = manifest.generator.nodeVersion;
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) throw new Error('SQLite manifest does not match the verified source/database/schema.');
  if (!readFileSync(join(directory, 'TANZIL-NOTICE.txt')).equals(Buffer.from(source.notice, 'utf8'))) throw new Error('Tanzil notice differs from the source notice.');
  return manifest;
}

export function generateDatabase({ outputDirectory = resolve(repoRoot, dirname(databasePath)), sourceBytes } = {}) {
  const source = readVerifiedSource(sourceBytes);
  const probe = new DatabaseSync(':memory:');
  let sqliteVersion;
  try { sqliteVersion = probe.prepare('SELECT sqlite_version() AS version').get().version; }
  finally { probe.close(); }
  if (sqliteVersion !== buildSqliteVersion) throw new Error(`Reproducible builds require SQLite ${buildSqliteVersion} (reference Node 24.15.0); found ${sqliteVersion}. Review toolchain changes explicitly.`);
  mkdirSync(outputDirectory, { recursive: true });
  // A new DB and fixed insertion order avoid old pages, journal state and timestamps.
  const temporary = mkdtempSync(join(outputDirectory, '.quran-build-'));
  const temporaryDatabase = join(temporary, 'quran.sqlite');
  try {
    const db = new DatabaseSync(temporaryDatabase);
    try {
      db.exec(`PRAGMA page_size = 4096; PRAGMA encoding = 'UTF-8'; PRAGMA auto_vacuum = NONE; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA application_id = ${applicationId}; PRAGMA user_version = ${schemaVersion}; BEGIN IMMEDIATE;`);
      db.exec(schema);
      const insert = db.prepare('INSERT INTO verses (surah, ayah, verse_key, arabic_text) VALUES (?, ?, ?, ?)');
      for (const row of [...source.rows].sort((a, b) => a.surah - b.surah || a.ayah - b.ayah)) {
        insert.run(row.surah, row.ayah, row.verse_key, row.arabic_text);
      }
      db.exec('COMMIT;');
    } finally { db.close(); }
    const verification = verifyDatabase(temporaryDatabase, source);
    const manifest = makeManifest(source, verification, readFileSync(temporaryDatabase), sqliteVersion);
    writeFileSync(join(temporary, 'quran-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    writeFileSync(join(temporary, 'TANZIL-NOTICE.txt'), source.notice, { encoding: 'utf8', flag: 'wx' });
    verifyBundle(temporary);
    const names = ['quran.sqlite', 'quran-manifest.json', 'TANZIL-NOTICE.txt'];
    // Idempotent builds never replace a different existing release artifact.
    // Check all files before publishing any, including manifest and notice.
    for (const name of names) {
      const destination = join(outputDirectory, name);
      if (existsSync(destination) && !readFileSync(destination).equals(readFileSync(join(temporary, name)))) {
        throw new Error(`Existing ${name} differs; refusing to overwrite. Generate into a new review directory for an intentional release change.`);
      }
    }
    for (const name of names) {
      const destination = join(outputDirectory, name);
      if (!existsSync(destination)) renameSync(join(temporary, name), destination);
    }
    return manifest;
  } finally {
    // Only remove the uniquely created temporary child, never a supplied directory.
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some(arg => !['--verify', '--generate'].includes(arg))) throw new Error('Use node tools/quran-import/generate-sqlite.mjs [--generate|--verify]');
    const manifest = args[0] === '--verify' ? verifyBundle() : generateDatabase();
    console.log(JSON.stringify(manifest, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
