/**
 * Adapter for King Fahd Complex's developer package of «التفسير الميسر» (hafs_tafseerMouaser_v3.zip; README.md).
 * Reads its tab-separated text file (hafs_tafseerMouaser_v3_data/tafseerMouaser_v03.txt: one row per ayah, columns
 * sura_no, aya_no, aya_tafseer, …) and keeps each row's commentary exactly, except for these structural steps, each
 * checked rather than assumed:
 *
 *  1. The leading ayah label («[186] », and the source's variants «186] », «[39]ثم», «[33، 34] ») is removed only
 *     when its number(s) are that row's ayah; what follows it (a comma or full stop continuing a sentence included) is
 *     kept. Any other label stops the build.
 *  2. A label naming two consecutive ayahs on BOTH rows with the identical commentary («[33، 34]» on 28:33 and 28:34)
 *     is the source's own passage: kept once, as the range 33–34, never twice. A two-ayah label on only one row whose
 *     neighbour has its own commentary (68:22 «[21، 22]») stays on its own ayah and is reported in `anomalies`.
 *  3. Quranic quotations are marked in the source with <span class='aya'>…</span> and bracketed with two code points
 *     the Complex's own Hafs font draws as ornate brackets (U+FD61 opening, U+FD60 closing; in any other font they
 *     are unrelated ligatures). The tag is removed and those two brackets become the standard ornate brackets
 *     ﴿ (U+FD3F) and ﴾ (U+FD3E), as the app's other King Fahd text (المعاني) writes them. They occur only inside the
 *     tag (checked); no other character is touched.
 *
 * No other HTML is allowed (any other tag stops the build).
 */
import { readZipEntry } from '../../word-meanings/ghareeb-docx.mjs';
import { tidy } from '../lib.mjs';

export const ENTRY = 'hafs_tafseerMouaser_v3_data/tafseerMouaser_v03.txt';
const OPEN = 'ﵡ';
const CLOSE = 'ﵠ';

export const anomalies = [];

export function quotations(text) {
  let count = 0;
  const outside = text.replace(/<span class='aya'>([\s\S]*?)<\/span>/g, () => '');
  if (outside.includes(OPEN) || outside.includes(CLOSE)) throw new Error('kfgqpc-mouaser: a font bracket outside a quotation');
  const result = text.replace(/<span class='aya'>([\s\S]*?)<\/span>/g, (_, inner) => {
    count += 1;
    return inner.replaceAll(OPEN, '﴿').replaceAll(CLOSE, '﴾');
  });
  if (/<[^>]*>/.test(result)) throw new Error('kfgqpc-mouaser: unexpected markup');
  return { text: result, count };
}

/** The row's label and the text after it. */
export function splitLabel(raw) {
  const match = /^\[?(\d+)(?:،\s*(\d+))?\]\s*/.exec(raw);
  if (!match) return null;
  return { first: Number(match[1]), second: match[2] ? Number(match[2]) : null, rest: raw.slice(match[0].length) };
}

export function rowsFromTable(table) {
  const lines = table.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line !== '');
  const header = lines[0].split('\t');
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`kfgqpc-mouaser: no ${name} column`);
    return i;
  };
  const [s, a, t] = [col('sura_no'), col('aya_no'), col('aya_tafseer')];
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    if (cells.length !== header.length) throw new Error(`kfgqpc-mouaser: row with ${cells.length} cells`);
    return { surah: Number(cells[s]), ayah: Number(cells[a]), raw: cells[t] };
  });
}

export function convertRows(rows, counts) {
  anomalies.length = 0;
  if (rows.length !== 6236) throw new Error(`kfgqpc-mouaser: ${rows.length} rows`);
  const bySurah = Array.from({ length: 114 }, () => []);
  const seen = new Set();
  const parsed = rows.map((row) => {
    const key = `${row.surah}:${row.ayah}`;
    if (seen.has(key) || !(row.surah >= 1 && row.surah <= 114 && row.ayah >= 1 && row.ayah <= counts[row.surah - 1])) throw new Error(`kfgqpc-mouaser: row ${key}`);
    seen.add(key);
    const label = splitLabel(row.raw);
    if (!label) throw new Error(`kfgqpc-mouaser: ${key} has no ayah label`);
    const named = label.second === null ? [label.first] : [label.first, label.second];
    if (!named.includes(row.ayah) || (label.second !== null && label.second !== label.first + 1)) throw new Error(`kfgqpc-mouaser: ${key} is labelled [${named.join('، ')}]`);
    const { text } = quotations(label.rest);
    return { ...row, label, text: tidy(text) };
  });
  const at = new Map(parsed.map((row) => [`${row.surah}:${row.ayah}`, row]));
  for (const row of parsed) {
    const { label } = row;
    if (label.second !== null) {
      const other = at.get(`${row.surah}:${row.ayah === label.first ? label.second : label.first}`);
      const shared = other && other.label.first === label.first && other.label.second === label.second && other.text === row.text;
      if (shared) {
        // The passage, once: on its first ayah's row only.
        if (row.ayah === label.first) bySurah[row.surah - 1].push([label.first, label.second, row.text]);
        continue;
      }
      anomalies.push(`${row.surah}:${row.ayah} is labelled [${label.first}، ${label.second}] but ${row.surah}:${row.ayah === label.first ? label.second : label.first} has its own commentary; kept on ${row.surah}:${row.ayah} alone`);
    }
    bySurah[row.surah - 1].push([row.ayah, row.ayah, row.text]);
  }
  for (const list of bySurah) list.sort((x, y) => x[0] - y[0]);
  return bySurah;
}

export function convert(bytes, counts) {
  return convertRows(rowsFromTable(readZipEntry(bytes, ENTRY).toString('utf8')), counts);
}
