/**
 * Adapter for a JSON array of ayah-keyed rows, the usual shape of developer tafsir datasets:
 *   [{ "<surah field>": 2, "<ayah field>": 186, "<text field>": "…" }, …]
 * and, for commentary on a passage, an optional "<to field>" (the passage's last ayah). Field names come from the
 * edition's `source.fields` in editions.json ({ surah, ayah, text, to? }).
 *
 * Strict: every row must name a real ayah, rows may come in any order but never twice for one ayah, and nothing is
 * merged, split or rewritten — only tidy() (line endings and trailing spaces). Coverage is checked by build.mjs.
 */
import { tidy } from '../lib.mjs';

export function convert(bytes, counts, source) {
  const fields = source.fields ?? { surah: 'sura', ayah: 'aya', text: 'text' };
  const rows = JSON.parse(bytes.toString('utf8').replace(/^﻿/, ''));
  if (!Array.isArray(rows)) throw new Error('rows-json: not an array');
  const bySurah = Array.from({ length: 114 }, () => []);
  const seen = new Set();
  for (const row of rows) {
    const surah = Number(row[fields.surah]);
    const from = Number(row[fields.ayah]);
    const to = fields.to && row[fields.to] !== undefined && row[fields.to] !== null ? Number(row[fields.to]) : from;
    if (!Number.isInteger(surah) || surah < 1 || surah > 114) throw new Error(`rows-json: bad surah ${row[fields.surah]}`);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > counts[surah - 1]) throw new Error(`rows-json: bad range ${surah}:${from}-${to}`);
    for (let ayah = from; ayah <= to; ayah += 1) {
      const key = `${surah}:${ayah}`;
      if (seen.has(key)) throw new Error(`rows-json: ${key} twice`);
      seen.add(key);
    }
    bySurah[surah - 1].push([from, to, tidy(row[fields.text] ?? '')]);
  }
  for (const list of bySurah) list.sort((a, b) => a[0] - b[0]);
  return bySurah;
}
