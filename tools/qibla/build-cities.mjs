#!/usr/bin/env node
/**
 * Builds mobile/assets/qibla/cities.json, the offline city list of the Qibla screen's "Choose a city" fallback
 * (docs/qibla.md), from Natural Earth's 1:10m populated places and countries (public domain), pinned by commit and
 * SHA-256 in tools/qibla/cities.lock.json.
 *
 * Kept: every place with a population of at least lock.selection.minPopulation, plus every national capital. Each city:
 * [id (Natural Earth NE_ID), English name, Arabic name, country code, latitude, longitude (4 decimals ≈ 11 m), population,
 * English region or "" (only where the same name occurs twice in one country)]. Countries: code → [English, Arabic].
 * Deterministic: same sources, same bytes.
 *
 *   node tools/qibla/build-cities.mjs                    (downloads the pinned files to a temporary folder)
 *   node tools/qibla/build-cities.mjs --source <folder>  (uses already-downloaded files; their hashes are still checked)
 *   node tools/qibla/build-cities.mjs --check            (rebuilds in memory and fails if the committed file differs)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const lock = JSON.parse(readFileSync(join(here, 'cities.lock.json'), 'utf8'));
const outPath = join(repo, 'mobile/assets/qibla/cities.json');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const round4 = (n) => Math.round(n * 1e4) / 1e4;

async function load(name, sourceDir) {
  const file = lock.files[name];
  let buffer;
  if (sourceDir) {
    buffer = readFileSync(join(sourceDir, file.path.split('/').pop()));
  } else {
    const url = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${lock.commit}/${file.path}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
    buffer = Buffer.from(await response.arrayBuffer());
  }
  const actual = sha256(buffer);
  if (actual !== file.sha256) throw new Error(`${file.path}: sha256 ${actual} does not match the pin ${file.sha256}`);
  return JSON.parse(buffer.toString('utf8'));
}

export function buildCities(placesGeo, countriesGeo, selection) {
  const countries = {};
  for (const feature of countriesGeo.features) {
    const p = feature.properties;
    if (!p.ADM0_A3 || countries[p.ADM0_A3]) continue;
    countries[p.ADM0_A3] = [String(p.NAME_EN ?? p.NAME).trim(), String(p.NAME_AR ?? p.NAME_EN ?? p.NAME).trim()];
  }
  const kept = placesGeo.features
    .map((f) => f.properties)
    .filter((p) => (p.POP_MAX ?? 0) >= selection.minPopulation || (selection.alwaysIncludeCapitals && p.ADM0CAP === 1))
    .filter((p) => Number.isFinite(p.LATITUDE) && Number.isFinite(p.LONGITUDE) && p.NAME_AR);
  // Countries a place names but the countries file lacks (rare territory codes): its English name, twice.
  for (const p of kept) if (!countries[p.ADM0_A3]) countries[p.ADM0_A3] = [String(p.ADM0NAME).trim(), String(p.ADM0NAME).trim()];
  const nameEn = (p) => String(p.NAME_EN ?? p.NAME).trim();
  const count = new Map();
  for (const p of kept) count.set(`${nameEn(p)}|${p.ADM0_A3}`, (count.get(`${nameEn(p)}|${p.ADM0_A3}`) ?? 0) + 1);
  const cities = kept
    .map((p) => [
      Number(p.NE_ID),
      nameEn(p),
      String(p.NAME_AR).trim(),
      p.ADM0_A3,
      round4(p.LATITUDE),
      round4(p.LONGITUDE),
      Math.round(p.POP_MAX ?? 0),
      count.get(`${nameEn(p)}|${p.ADM0_A3}`) > 1 ? String(p.ADM1NAME ?? '').trim() : '',
    ])
    .sort((a, b) => b[6] - a[6] || a[0] - b[0]);
  const usedCountries = Object.fromEntries(
    [...new Set(cities.map((c) => c[3]))].sort().map((code) => [code, countries[code]]),
  );
  return {
    version: 1,
    source: `Natural Earth 1:10m populated places + countries (public domain), natural-earth-vector@${lock.commit.slice(0, 7)}`,
    fields: ['id', 'nameEn', 'nameAr', 'country', 'latitude', 'longitude', 'population', 'regionEn'],
    countries: usedCountries,
    cities,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf('--source');
  const sourceDir = sourceIndex >= 0 ? resolve(args[sourceIndex + 1]) : null;
  const check = args.includes('--check');
  const places = await load('places', sourceDir);
  const countries = await load('countries', sourceDir);
  const json = `${JSON.stringify(buildCities(places, countries, lock.selection))}\n`;
  if (check) {
    const current = readFileSync(outPath, 'utf8');
    if (current !== json) {
      console.error('cities.json differs from a fresh build');
      process.exit(1);
    }
    console.log('cities.json matches a fresh build');
    return;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
  const data = JSON.parse(json);
  console.log(`wrote ${outPath}: ${data.cities.length} cities, ${Object.keys(data.countries).length} countries, ${(json.length / 1024).toFixed(0)} KB`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
