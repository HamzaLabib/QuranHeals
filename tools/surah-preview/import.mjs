#!/usr/bin/env node
/**
 * Surah Preview (عن السورة) data: builds mobile/assets/surah-preview/surah-preview.json (git-ignored) from
 *  - «من مقاصد السورة» of المختصر في تفسير القرآن الكريم (Tafsir Center for Quranic Studies), as QuranEnc publishes it on
 *    https://quranenc.com/ar/browse/arabic_mokhtasar/{n}: the text of the one span after that heading, tags stripped,
 *    entities decoded, whitespace trimmed — nothing else changed;
 *  - Makki/Madani and the ayah count from Tanzil's quran-data.xml, via the repository's pinned
 *    backend/assets/quran/surah-names.json.
 *
 * Every objective must match source.lock.json (its SHA-256, one per Surah): a changed page stops the import (the old
 * file stays) until the change is reviewed and the lock updated with --update-lock. The Mukhtasar has no «موضوعات
 * السورة» and its English objectives were withdrawn (README.md), so themes and English come only from a reviewed file:
 *
 *   tools/surah-preview/reviewed-content.json (optional; absent until a source is approved for use), shaped
 *   { sources: [{ id, title, publisher, url, retrieved, permission }], surahs: { "<n>": { themesAr?: { items: string[],
 *   status: 'approved' | 'pending-review', sources: string[] }, purposeEn?: …, themesEn?: … } } }
 *
 *   Every item must cite a listed source and carry a status; nothing in it may claim 'quoted'.
 *
 * Each entry records each section's status ('quoted' | 'approved' | 'pending-review' | 'unavailable') and its sources.
 *
 * Usage: node tools/surah-preview/import.mjs [--cache <dir of 001.html…114.html>] [--update-lock]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = join(root, 'mobile/assets/surah-preview/surah-preview.json');
const lockPath = join(here, 'source.lock.json');
const reviewedPath = join(here, 'reviewed-content.json');
const metadataPath = join(root, 'backend/assets/quran/surah-names.json');
const PAGE = (n) => `https://quranenc.com/ar/browse/arabic_mokhtasar/${n}`;
const HEADING = '<b>من مقاصد السورة:</b>';

const args = process.argv.slice(2);
const cacheDir = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : null;
const updateLock = args.includes('--update-lock');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);

/** The objective: the first <span> after the heading, exactly one heading per page. */
export function extractObjective(html) {
  const at = html.indexOf(HEADING);
  if (at < 0 || html.indexOf(HEADING, at + 1) >= 0) return null;
  const span = /<span>([\s\S]*?)<\/span>/.exec(html.slice(at, at + 2000));
  if (!span) return null;
  const text = decode(span[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : null;
}

async function page(n) {
  const file = cacheDir ? join(cacheDir, `${String(n).padStart(3, '0')}.html`) : null;
  if (file && existsSync(file)) return readFileSync(file, 'utf8');
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(PAGE(n), { headers: { 'Accept-Language': 'ar' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      if (attempt >= 3) throw new Error(`${PAGE(n)}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
if (metadata.surahs?.length !== 114) throw new Error('surah-names.json: expected 114 Surahs');
const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;

// The reviewed file, checked strictly: an item that does not cite a listed source or carries an unknown status stops the import.
const reviewed = existsSync(reviewedPath) ? JSON.parse(readFileSync(reviewedPath, 'utf8')) : { sources: [], surahs: {} };
const reviewedIds = new Set((reviewed.sources ?? []).map((source) => source.id));
const REVIEW_STATUSES = new Set(['approved', 'pending-review']);
function reviewedSection(n, key, kind) {
  const section = reviewed.surahs?.[String(n)]?.[key];
  if (!section) return null;
  const value = kind === 'list' ? section.items : section.text;
  const ok = kind === 'list' ? Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim()) : typeof value === 'string' && value.trim();
  if (!ok || !REVIEW_STATUSES.has(section.status) || !Array.isArray(section.sources) || section.sources.length === 0 || !section.sources.every((id) => reviewedIds.has(id))) {
    throw new Error(`reviewed-content.json: Surah ${n} ${key} needs text, a status (approved | pending-review) and listed sources`);
  }
  return { value: kind === 'list' ? value.map((item) => item.trim()) : value.trim(), status: section.status, sources: section.sources };
}

const surahs = [];
const hashes = [];
const changed = [];
for (let n = 1; n <= 114; n++) {
  const objective = extractObjective(await page(n));
  if (!objective) throw new Error(`Surah ${n}: no single «من مقاصد السورة» block on ${PAGE(n)}`);
  const hash = sha256(objective);
  hashes.push(hash);
  if (lock && lock.objectivesSha256[n - 1] !== hash) changed.push(n);
  const meta = metadata.surahs[n - 1];
  if (meta.surahNumber !== n || !['Meccan', 'Medinan'].includes(meta.revelationType)) throw new Error(`Surah ${n}: unexpected metadata`);
  const themesAr = reviewedSection(n, 'themesAr', 'list');
  const themesEn = reviewedSection(n, 'themesEn', 'list');
  const purposeEn = reviewedSection(n, 'purposeEn', 'text');
  surahs.push({
    surah: n,
    revelation: meta.revelationType === 'Meccan' ? 'makki' : 'madani',
    ayahCount: meta.ayahCount,
    purpose: { ar: objective, en: purposeEn?.value ?? null },
    themes: { ar: themesAr?.value ?? null, en: themesEn?.value ?? null },
    status: {
      purposeAr: 'quoted',
      purposeEn: purposeEn?.status ?? 'unavailable',
      themesAr: themesAr?.status ?? 'unavailable',
      themesEn: themesEn?.status ?? 'unavailable',
    },
    sources: [...new Set(['mukhtasar-quranenc', 'tanzil', ...[themesAr, themesEn, purposeEn].flatMap((section) => section?.sources ?? [])])],
  });
}

if (changed.length && !updateLock) {
  console.error(`Objectives differ from source.lock.json for Surahs ${changed.join(', ')}: review them, then run with --update-lock.`);
  process.exit(1);
}
if (!lock || updateLock) {
  writeFileSync(lockPath, `${JSON.stringify({
    source: 'https://quranenc.com/ar/browse/arabic_mokhtasar/{n} — «من مقاصد السورة»',
    retrieved: new Date().toISOString().slice(0, 10),
    metadata: { file: 'backend/assets/quran/surah-names.json', sourceSha256: metadata.sourceSha256 },
    objectivesSha256: hashes,
  }, null, 2)}\n`);
}

const data = {
  format: 1,
  status: 'official',
  sources: [
    { id: 'mukhtasar-quranenc', title: 'المختصر في تفسير القرآن الكريم — من مقاصد السورة', publisher: 'مركز تفسير للدراسات القرآنية', url: 'https://quranenc.com/ar/browse/arabic_mokhtasar', retrieved: (lock && !updateLock ? lock.retrieved : new Date().toISOString().slice(0, 10)) },
    { id: 'tanzil', title: 'Tanzil quran-data.xml (Makki/Madani, ayah count)', publisher: 'Tanzil', url: metadata.source, retrieved: `pinned sha256 ${metadata.sourceSha256}` },
    ...(reviewed.sources ?? []).map(({ id, title, publisher, url, retrieved }) => ({ id, title, publisher, url, retrieved })),
  ],
  surahs,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}.partial`, `${JSON.stringify(data)}\n`);
renameSync(`${out}.partial`, out);
console.log(`Wrote ${out}: 114 Surahs, ${surahs.filter((s) => s.revelation === 'makki').length} Makki.`);
