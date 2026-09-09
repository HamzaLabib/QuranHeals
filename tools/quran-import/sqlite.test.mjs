import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { databasePath, generateDatabase, openReadonlyDatabase, verifyBundle, verifyDatabase } from './generate-sqlite.mjs';
import { readVerifiedSource, repoRoot, sha256, sourcePath, sourceSha256, validateRows } from './tanzil-source.mjs';

const sourceBytes = readFileSync(resolve(repoRoot, sourcePath));
const source = readVerifiedSource(sourceBytes);
const bundledDatabase = resolve(repoRoot, databasePath);

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'quran-sqlite-test-'));
  // Cleanup is restricted to this unique directory created by the test.
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function changedDatabase(t, sql) {
  const path = join(temporaryDirectory(t), 'test.sqlite');
  copyFileSync(bundledDatabase, path);
  const db = new DatabaseSync(path);
  try { db.exec(sql); } finally { db.close(); }
  return path;
}

test('canonical source pin, all 6,236 keys and all 114 surahs remain valid', () => {
  assert.equal(sha256(sourceBytes), sourceSha256);
  assert.deepEqual(source.validation, {
    ayahCount: 6236, surahCount: 114, duplicateKeys: [], missingKeys: [], invalidKeys: [], emptyTextKeys: [],
  });
});

test('source hash failure stops generation before creating any output', t => {
  const directory = join(temporaryDirectory(t), 'must-not-exist');
  assert.throws(() => generateDatabase({ outputDirectory: directory, sourceBytes: Buffer.concat([sourceBytes, Buffer.from('\n')]) }), /source SHA-256 mismatch/);
  assert.equal(existsSync(directory), false);
});

test('source structure rejects wrong counts, missing surahs, duplicate/missing keys and invalid references', () => {
  const rows = source.rows;
  assert.throws(() => validateRows(rows.slice(1)), /structure invalid/);
  assert.throws(() => validateRows(rows.filter(row => row.surah !== 114)), /structure invalid/);
  assert.throws(() => validateRows([rows[1], ...rows.slice(1)]), /"duplicateKeys":\["1:2"\]/);
  assert.throws(() => validateRows([{ ...rows[0], verse_key: '1:8', ayah: 8 }, ...rows.slice(1)]), /"invalidKeys":\["1:8"\]/);
  assert.throws(() => validateRows([{ ...rows[0], surah: 2 }, ...rows.slice(1)]), /"invalidKeys":\["1:1"\]/);
  assert.throws(() => validateRows([{ ...rows[0], arabic_text: '' }, ...rows.slice(1)]), /"emptyTextKeys":\["1:1"\]/);
});

test('all SQLite Arabic strings and UTF-8 bytes equal independently extracted original record payloads', () => {
  // Independent of the generator parser: identify the first two pipe delimiters
  // by position, then keep the remainder of each original LF-delimited record.
  const originals = new Map();
  for (const line of sourceBytes.toString('utf8').split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const first = line.indexOf('|'), second = line.indexOf('|', first + 1);
    assert.ok(first > 0 && second > first);
    originals.set(`${line.slice(0, first)}:${line.slice(first + 1, second)}`, line.slice(second + 1));
  }
  assert.equal(originals.size, 6236);
  const db = openReadonlyDatabase();
  try {
    const rows = db.prepare('SELECT surah, ayah, verse_key, arabic_text, CAST(arabic_text AS BLOB) AS bytes FROM verses').all();
    assert.equal(rows.length, 6236);
    for (const row of rows) {
      assert.equal(row.verse_key, `${row.surah}:${row.ayah}`);
      assert.equal(row.arabic_text, originals.get(row.verse_key), row.verse_key);
      assert.ok(Buffer.from(originals.get(row.verse_key), 'utf8').equals(row.bytes), row.verse_key);
    }
  } finally { db.close(); }
  const report = verifyDatabase();
  assert.equal(report.exactMatches, 6236);
  assert.equal(report.mismatches, 0);
});

test('bundled manifest authenticates source, database, schema, counts and exact unchanged copyright notice', () => {
  const manifest = verifyBundle();
  assert.equal(manifest.source.sha256, sourceSha256);
  assert.equal(manifest.database.sha256, sha256(readFileSync(bundledDatabase)));
  assert.equal(manifest.verification.exactMatches, 6236);
});

test('two fresh builds are byte-identical to each other and the bundled database; rebuilding is idempotent', t => {
  const directory = temporaryDirectory(t);
  const first = join(directory, 'first'), second = join(directory, 'second');
  const firstManifest = generateDatabase({ outputDirectory: first });
  const secondManifest = generateDatabase({ outputDirectory: second });
  assert.deepEqual(firstManifest, secondManifest);
  for (const name of ['quran.sqlite', 'quran-manifest.json', 'TANZIL-NOTICE.txt']) {
    assert.ok(readFileSync(join(first, name)).equals(readFileSync(join(second, name))), name);
  }
  assert.ok(readFileSync(join(first, 'quran.sqlite')).equals(readFileSync(bundledDatabase)));
  assert.deepEqual(generateDatabase({ outputDirectory: first }), firstManifest);
  assert.equal(readdirSync(first).length, 3);
});

test('generation refuses to overwrite differing artifacts and leaves no partial output', t => {
  const directory = temporaryDirectory(t);
  const existing = Buffer.from('existing artifact');
  writeFileSync(join(directory, 'quran-manifest.json'), existing);
  assert.throws(() => generateDatabase({ outputDirectory: directory }), /refusing to overwrite/);
  assert.deepEqual(readdirSync(directory), ['quran-manifest.json']);
  assert.ok(readFileSync(join(directory, 'quran-manifest.json')).equals(existing));
});

test('read-only database access rejects writes even after query_only is disabled', () => {
  const db = openReadonlyDatabase();
  try {
    assert.throws(() => db.exec('DELETE FROM verses'), /readonly/i);
    db.exec('PRAGMA query_only = OFF');
    assert.throws(() => db.exec('DELETE FROM verses'), /readonly/i);
  } finally { db.close(); }
});

test('SQL constraints reject duplicate references, inconsistent keys and noninteger references', t => {
  const path = changedDatabase(t, '');
  const db = new DatabaseSync(path);
  try {
    assert.throws(() => db.exec('INSERT INTO verses SELECT * FROM verses WHERE verse_key = \'1:1\''), /UNIQUE constraint failed/);
    assert.throws(() => db.exec("UPDATE verses SET verse_key = '1:01' WHERE verse_key = '1:1'"), /CHECK constraint failed/);
    assert.throws(() => db.exec("UPDATE verses SET ayah = 1.5 WHERE verse_key = '1:1'"), /INTEGER/);
  } finally { db.close(); }
});

test('SQLite integrity rejects a missing verse', t => {
  const path = changedDatabase(t, "DELETE FROM verses WHERE verse_key = '1:1'");
  assert.throws(() => verifyDatabase(path), /SQLite structure invalid/);
});

test('SQLite integrity rejects an entire missing surah', t => {
  const path = changedDatabase(t, 'DELETE FROM verses WHERE surah = 114');
  assert.throws(() => verifyDatabase(path), /"surahCount":113/);
});

test('SQLite integrity rejects invalid verse keys even with the expected row count', t => {
  const path = changedDatabase(t, "UPDATE verses SET ayah = 7, verse_key = '114:7' WHERE verse_key = '114:6'");
  assert.throws(() => verifyDatabase(path), /"invalidKeys":\["114:7"\]/);
});

test('SQLite integrity rejects schema drift even when all Quran text is identical', t => {
  // Alter only the SQL schema in a disposable copy, leaving all text untouched.
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  const changedSql = schema.replace(' CHECK (ayah > 0)', '').replace(') STRICT;', ');');
  const path = changedDatabase(t, `ALTER TABLE verses RENAME TO previous_verses; ${changedSql}
    INSERT INTO verses SELECT * FROM previous_verses; DROP TABLE previous_verses;`);
  assert.throws(() => verifyDatabase(path), /table SQL\/constraints or schema objects mismatch/);
});

test('SQLite integrity rejects unexpected views and a different page size', t => {
  const viewPath = changedDatabase(t, 'CREATE VIEW unexpected AS SELECT verse_key FROM verses');
  assert.throws(() => verifyDatabase(viewPath), /schema objects mismatch/);
  const pagePath = changedDatabase(t, 'PRAGMA page_size = 8192; VACUUM');
  assert.throws(() => verifyDatabase(pagePath), /page size mismatch/);
});

test('SQLite integrity detects a single added whitespace code point', t => {
  const path = changedDatabase(t, "UPDATE verses SET arabic_text = arabic_text || char(32) WHERE verse_key = '2:153'");
  assert.throws(() => verifyDatabase(path), /"exactMatches":6235,"mismatches":1,"mismatchKeys":\["2:153"\]/);
});

test('SQLite integrity detects a single removed text code point', t => {
  const path = changedDatabase(t, "UPDATE verses SET arabic_text = substr(arabic_text, 1, length(arabic_text) - 1) WHERE verse_key = '2:153'");
  assert.throws(() => verifyDatabase(path), /SQLite Arabic mismatch/);
});

test('bundle verification rejects tampered manifest hashes and notice', t => {
  const directory = temporaryDirectory(t);
  generateDatabase({ outputDirectory: directory });
  const path = join(directory, 'quran-manifest.json');
  const original = readFileSync(path);
  const manifest = JSON.parse(original);
  manifest.database.sha256 = '0'.repeat(64);
  writeFileSync(path, JSON.stringify(manifest));
  assert.throws(() => verifyBundle(directory), /manifest does not match/);
  writeFileSync(path, original);
  writeFileSync(join(directory, 'TANZIL-NOTICE.txt'), '');
  assert.throws(() => verifyBundle(directory), /notice differs/);
});
