// Checks mobile/src/mushaf/surahOpenings.ts against all 604 QPC V1 pages (the local Content Sync snapshot):
// every Surah gets exactly one heading, every Surah but 1 and 9 one Basmala, and every empty line
// on every page is exactly one heading or Basmala slot.
// Usage: npx tsx tools/mushaf-audit/audit-surah-openings.mts backend/data/mushaf-sync/records-<seq>.json.gz
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const { surahOpeningSlots } = await import(pathToFileURL(resolve(root, 'mobile/src/mushaf/surahOpenings.ts')).href);
const xml = readFileSync(resolve(root, 'tools/quran-verification/input/quran-data.xml'), 'utf8');
const counts = [...xml.matchAll(/<sura index="\d+" ayas="(\d+)"/g)].map((m) => Number(m[1]));
const verseKeys: string[] = [];
counts.forEach((n, s) => { for (let a = 1; a <= n; a++) verseKeys.push(`${s + 1}:${a}`); });

const records = JSON.parse(gunzipSync(readFileSync(process.argv[2])).toString('utf8'));
const pages = new Map<number, Map<number, { verseKey: string; position: number; pos: number }[]>>();
for (const r of records) {
  if (r.record_type !== 'mushaf_word' || r.mushaf_id !== 2) continue;
  const lines = pages.get(r.page_number) ?? new Map();
  const words = lines.get(r.line_number) ?? [];
  words.push({ verseKey: verseKeys[r.verse_id - 1], position: r.position_in_verse, pos: r.position_in_page }); // page order: position_in_line is unreliable at line starts
  lines.set(r.line_number, words);
  pages.set(r.page_number, lines);
}
const headings = new Map<number, number[]>();
const basmalas = new Map<number, number[]>();
const problems: string[] = [];
for (let page = 1; page <= 604; page++) {
  const lines = [...pages.get(page)!.entries()].map(([line, words]) => ({ line, words: words.sort((a, b) => a.pos - b.pos) }));
  const slots = surahOpeningSlots({ lines });
  const used = new Set(lines.map((l) => l.line));
  const slotLines = new Set(slots.map((s: { line: number }) => s.line));
  for (const s of slots) {
    if (used.has(s.line)) problems.push(`page ${page}: slot on text line ${s.line}`);
    (s.kind === 'heading' ? headings : basmalas).set(s.surah, [...((s.kind === 'heading' ? headings : basmalas).get(s.surah) ?? []), page]);
  }
  const first = Math.min(...used);
  for (let l = 1; l <= 15; l++) {
    // Pages 1–2 sit low in Quran Foundation's grid: the lines above their opening are not slots.
    if (page <= 2 && l < first - (page === 1 ? 1 : 2)) continue;
    if (!used.has(l) && !slotLines.has(l)) problems.push(`page ${page}: empty line ${l} unassigned`);
  }
}
const missingHeadings = Array.from({ length: 114 }, (_, i) => i + 1).filter((s) => (headings.get(s) ?? []).length !== 1);
const missingBasmalas = Array.from({ length: 114 }, (_, i) => i + 1).filter((s) => s !== 1 && s !== 9 && (basmalas.get(s) ?? []).length !== 1);
const split = [...basmalas.entries()].filter(([s, [p]]) => headings.get(s)?.[0] !== p).map(([s]) => s);
console.log(JSON.stringify({ headings: headings.size, basmalas: basmalas.size, missingHeadings, missingBasmalas, extraBasmalaFor1or9: [1, 9].filter((s) => basmalas.has(s)), splitAcrossPages: split, problems: problems.slice(0, 20), problemCount: problems.length }, null, 1));
