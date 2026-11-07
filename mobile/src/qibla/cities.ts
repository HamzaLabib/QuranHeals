import type { AppLocale } from '@/localization/locales';
import { isRtlLocale } from '@/localization/locales';

import type { ManualPosition } from './qiblaCompassController';

/**
 * The offline city list of the Qibla screen's "Choose a city" (assets/qibla/cities.json, built by
 * tools/qibla/build-cities.mjs from Natural Earth, public domain). A city's coordinates are its public centre, never the
 * user's position; only the chosen city's ID is ever stored (manualCityStorage.ts), on the device.
 */

export type City = {
  id: number;
  nameEn: string;
  nameAr: string;
  country: string;
  countryEn: string;
  countryAr: string;
  latitude: number;
  longitude: number;
  population: number;
  regionEn: string;
};

type CitiesFile = {
  version: number;
  countries: Record<string, [string, string]>;
  cities: [number, string, string, string, number, number, number, string][];
};

/** A city's centre stands for the whole place: assume this radius (it caps the compass via bearingUncertainty). */
export const CITY_RADIUS_M = 30_000;

let cache: City[] | null = null;

/** Parsed on first use (the picker opening), not at app start. */
export function loadCities(): City[] {
  if (cache) return cache;
  const file = require('../../assets/qibla/cities.json') as CitiesFile;
  cache = file.cities.map(([id, nameEn, nameAr, country, latitude, longitude, population, regionEn]) => {
    const [countryEn, countryAr] = file.countries[country] ?? [country, country];
    return { id, nameEn, nameAr, country, countryEn, countryAr, latitude, longitude, population, regionEn };
  });
  return cache;
}

export function cityById(id: number, cities: readonly City[] = loadCities()): City | null {
  return cities.find((city) => city.id === id) ?? null;
}

/**
 * Search form: Arabic without diacritics, tatweel and letter variants (أإآٱ→ا, ة→ه, ى→ي, ؤ→و, ئ→ي), Latin without
 * accents, lower case, single spaces.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // Latin accents
    .replace(/[ً-ٰٟۖ-ۭـ]/g, '') // Arabic harakat, Quranic marks, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

type Indexed = { city: City; names: string[]; countries: string[] };
let index: Indexed[] | null = null;

function searchIndex(cities: readonly City[]): Indexed[] {
  if (index && cities === cache) return index;
  const built = cities.map((city) => ({
    city,
    names: [city.nameEn, city.nameAr].map(normalizeForSearch),
    countries: [city.countryEn, city.countryAr].map(normalizeForSearch),
  }));
  if (cities === cache) index = built;
  return built;
}

/**
 * Cities matching the query, best first: the query IS a country's name (its cities, e.g. «مصر» lists Egypt before the
 * Libyan city مصراتة), then a name starting with it, then a word of a name starting with it, then a name containing it,
 * then a country starting with it; larger places first within each. Empty query: the largest places.
 */
export function searchCities(query: string, limit = 50, cities: readonly City[] = loadCities()): City[] {
  const q = normalizeForSearch(query);
  if (!q) return cities.slice(0, limit);
  const scored: { city: City; score: number }[] = [];
  for (const entry of searchIndex(cities)) {
    let score = entry.countries.includes(q) ? 4 : -1;
    for (const name of entry.names) {
      if (name.startsWith(q)) score = Math.max(score, 3);
      else if (name.split(' ').some((word) => word.startsWith(q))) score = Math.max(score, 2);
      else if (name.includes(q)) score = Math.max(score, 1);
    }
    if (score < 0 && entry.countries.some((country) => country.startsWith(q))) score = 0;
    if (score >= 0) scored.push({ city: entry.city, score });
  }
  scored.sort((a, b) => b.score - a.score || b.city.population - a.city.population || a.city.id - b.city.id);
  return scored.slice(0, limit).map((s) => s.city);
}

/** "Cairo, Egypt" / «القاهرة، مصر»; a region is added where one country has two places of that name. */
export function cityLabel(city: City, locale: AppLocale): string {
  if (isRtlLocale(locale)) return `${city.nameAr}، ${city.countryAr}`;
  return city.regionEn ? `${city.nameEn}, ${city.regionEn}, ${city.countryEn}` : `${city.nameEn}, ${city.countryEn}`;
}

export function cityToManualPosition(city: City, locale: AppLocale): ManualPosition {
  return { coordinates: { latitude: city.latitude, longitude: city.longitude }, accuracyMeters: CITY_RADIUS_M, label: cityLabel(city, locale) };
}
