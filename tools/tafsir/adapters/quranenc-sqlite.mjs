/**
 * Adapter for a QuranEnc.com edition's SQLite download (`database_url`, a zip holding <key>.sqlite with one table:
 * translations(id, sura, aya, translation, footnotes) — one row per ayah). Used for «التفسير الميسر» (`arabic_moyassar`).
 *
 * QuranEnc's terms allow re-publishing only with "no modification, addition, or deletion of the content"
 * (tools/tafsir/RIGHTS.md), so the text is taken byte for byte: no trimming, no normalisation, no markup removal. The
 * build stops instead if anything would need changing (empty text, surrounding spaces, markup, a footnote, a missing,
 * extra or out-of-order row).
 *
 * Commentary the source gives jointly for several ayahs is stored there as the identical text repeated on each of them
 * (e.g. 28:33–34, 68:21–22). A run of CONSECUTIVE ayahs of one Surah with byte-identical text becomes one entry with
 * that range, so the reader shows it once (every ayah of the run is still listed with its own Arabic). Nothing else is
 * merged: the same text on ayahs that are not adjacent (a refrain like 55:13, 55:16, …; 30:1, 31:1, 32:1) stays on each
 * ayah, and a run interrupted by a different text (96:10–12, 96:13, 96:14–19) stays as the source has it. Those repeats
 * are reported in `repeats`.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { readZipEntry } from '../../word-meanings/ghareeb-docx.mjs';

export const repeats = [];

/** The validated rows, in Mushaf order: [{ surah, ayah, text }] (6,236). */
export function rowsFromDatabase(path, counts) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const columns = db.prepare("SELECT name FROM pragma_table_info('translations') ORDER BY cid").all().map((c) => c.name);
    if (columns.join(',') !== 'id,sura,aya,translation,footnotes') throw new Error(`quranenc-sqlite: columns ${columns.join(',')}`);
    const rows = db.prepare('SELECT id, sura, aya, translation, footnotes FROM translations ORDER BY id').all();
    return validateRows(rows, counts);
  } finally {
    db.close();
  }
}

export function validateRows(rows, counts) {
  const expected = counts.reduce((n, c) => n + c, 0);
  if (rows.length !== expected) throw new Error(`quranenc-sqlite: ${rows.length} rows, expected ${expected}`);
  const out = [];
  let i = 0;
  for (let s = 1; s <= 114; s += 1) {
    for (let a = 1; a <= counts[s - 1]; a += 1) {
      const row = rows[i];
      i += 1;
      if (row.id !== i || row.sura !== s || row.aya !== a) throw new Error(`quranenc-sqlite: row ${i} is ${row.sura}:${row.aya}, expected ${s}:${a}`);
      const text = row.translation;
      if (typeof text !== 'string' || text.trim() === '') throw new Error(`quranenc-sqlite: ${s}:${a} has no text`);
      if (text !== text.trim()) throw new Error(`quranenc-sqlite: ${s}:${a} has surrounding spaces`);
      if (/<[^>]+>/.test(text)) throw new Error(`quranenc-sqlite: ${s}:${a} has markup`);
      if (row.footnotes !== null && row.footnotes !== '') throw new Error(`quranenc-sqlite: ${s}:${a} has footnotes (not shown by the reader)`);
      out.push({ surah: s, ayah: a, text });
    }
  }
  return out;
}

/** Consecutive identical texts of one Surah → one range; the text itself is never touched. */
export function entriesFromRows(rows) {
  repeats.length = 0;
  const bySurah = Array.from({ length: 114 }, () => []);
  for (const row of rows) {
    const list = bySurah[row.surah - 1];
    const last = list[list.length - 1];
    if (last && last[2] === row.text && last[1] === row.ayah - 1) last[1] = row.ayah;
    else list.push([row.ayah, row.ayah, row.text]);
  }
  // The same text in more than one entry (not adjacent): kept apart, reported.
  const seen = new Map();
  bySurah.forEach((list, s) => list.forEach(([from, to, text]) => {
    const where = `${s + 1}:${from}${to > from ? `-${to}` : ''}`;
    seen.set(text, [...(seen.get(text) ?? []), where]);
  }));
  for (const places of seen.values()) if (places.length > 1) repeats.push(places);
  return bySurah;
}

export function convert(bytes, counts, source) {
  const inner = readZipEntry(bytes, source.entry);
  const digest = createHash('sha256').update(inner).digest('hex');
  if (digest !== source.entrySha256) throw new Error(`quranenc-sqlite: ${source.entry} SHA-256 ${digest} does not match its pin`);
  const dir = mkdtempSync(join(tmpdir(), 'quranenc-'));
  try {
    const path = join(dir, 'edition.sqlite');
    writeFileSync(path, inner);
    return entriesFromRows(rowsFromDatabase(path, counts));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
