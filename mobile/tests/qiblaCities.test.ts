import { describe, expect, it } from 'vitest';

import { CITY_RADIUS_M, cityById, cityLabel, cityToManualPosition, loadCities, normalizeForSearch, searchCities } from '@/qibla/cities';
import { bearingUncertaintyDegrees, computeQibla } from '@/qibla/qiblaMath';

import citiesFile from '../assets/qibla/cities.json';

const cities = loadCities();
const named = (nameEn: string) => cities.find((c) => c.nameEn === nameEn)!;

describe('the offline city list (Natural Earth, public domain)', () => {
  it('has the documented shape: ~3,100 places, unique IDs, valid coordinates, Arabic and English names', () => {
    expect(citiesFile.version).toBe(1);
    expect(citiesFile.fields).toEqual(['id', 'nameEn', 'nameAr', 'country', 'latitude', 'longitude', 'population', 'regionEn']);
    expect(citiesFile.source).toMatch(/Natural Earth.*public domain/);
    expect(cities.length).toBeGreaterThan(3_000);
    expect(new Set(cities.map((c) => c.id)).size).toBe(cities.length);
    for (const c of cities) {
      expect(c.latitude).toBeGreaterThanOrEqual(-90);
      expect(c.latitude).toBeLessThanOrEqual(90);
      expect(c.longitude).toBeGreaterThanOrEqual(-180);
      expect(c.longitude).toBeLessThanOrEqual(180);
      expect(c.nameEn.length).toBeGreaterThan(0);
      expect(c.nameAr).toMatch(/[؀-ۿ]/);
      expect(c.countryAr.length).toBeGreaterThan(0);
    }
  });

  it('is ordered largest first', () => {
    for (let i = 1; i < cities.length; i += 1) expect(cities[i - 1].population).toBeGreaterThanOrEqual(cities[i].population);
  });

  it('includes the Haramain and major Muslim cities', () => {
    for (const name of ['Mecca', 'Medina', 'Jeddah', 'Cairo', 'Istanbul', 'Jakarta', 'Karachi', 'Dhaka', 'Lagos', 'Casablanca', 'Tehran', 'Riyadh']) {
      expect(named(name), name).toBeDefined();
    }
    expect(named('Mecca').nameAr).toBe('مكة المكرمة');
    expect(named('Medina').nameAr).toBe('المدينة المنورة');
  });

  it('cityById finds a city; an unknown ID is null', () => {
    const cairo = named('Cairo');
    expect(cityById(cairo.id)).toBe(cairo);
    expect(cityById(1)).toBeNull();
  });
});

describe('search, in English or Arabic', () => {
  it('normalises Arabic letter variants and diacritics, and Latin accents', () => {
    expect(normalizeForSearch('القاهرة')).toBe(normalizeForSearch('القاهره'));
    expect(normalizeForSearch('مكّةُ')).toBe('مكه');
    expect(normalizeForSearch('إسطنبول')).toBe(normalizeForSearch('اسطنبول'));
    expect(normalizeForSearch('São Paulo')).toBe('sao paulo');
    expect(normalizeForSearch('  New   York ')).toBe('new york');
  });

  it('finds by the start of a name first, larger places first', () => {
    expect(searchCities('cair')[0].nameEn).toBe('Cairo');
    expect(searchCities('القاهره')[0].nameEn).toBe('Cairo');
    expect(searchCities('مكه')[0].nameEn).toBe('Mecca');
    expect(searchCities('جده')[0].nameEn).toBe('Jeddah');
    expect(searchCities('sao paulo')[0].nameEn).toMatch(/S[aã]o Paulo/);
    expect(searchCities('york').map((c) => c.nameEn)).toEqual(expect.arrayContaining([expect.stringMatching(/New York/)]));
  });

  it('a country name lists its cities first (مصر: Egypt before the Libyan city مصراتة, which still follows)', () => {
    const egypt = searchCities('egypt');
    expect(egypt.length).toBeGreaterThan(3);
    expect(egypt.every((c) => c.country === 'EGY')).toBe(true);
    const misr = searchCities('مصر', 100);
    const firstOther = misr.findIndex((c) => c.country !== 'EGY');
    expect(misr[0].country).toBe('EGY');
    expect(misr.slice(0, firstOther).length).toBeGreaterThan(3);
    expect(misr.slice(firstOther).map((c) => c.nameEn)).toContain('Misrata');
  });

  it('an empty query lists the largest places; nonsense finds nothing; the limit holds', () => {
    expect(searchCities('', 5)).toEqual(cities.slice(0, 5));
    expect(searchCities('zzzzqqqq')).toEqual([]);
    expect(searchCities('a', 7)).toHaveLength(7);
  });
});

describe('a chosen city as the Qibla position', () => {
  it('labels in the app language', () => {
    const cairo = named('Cairo');
    expect(cityLabel(cairo, 'en')).toBe('Cairo, Egypt');
    expect(cityLabel(cairo, 'ar')).toBe('القاهرة، مصر');
    expect(cityLabel(cairo, 'ar-EG')).toBe('القاهرة، مصر');
  });

  it('uses the city centre with a 30 km radius', () => {
    const position = cityToManualPosition(named('London'), 'en');
    expect(position).toEqual({ coordinates: { latitude: named('London').latitude, longitude: named('London').longitude }, accuracyMeters: CITY_RADIUS_M, label: 'London, United Kingdom' });
    expect(CITY_RADIUS_M).toBe(30_000);
  });

  it('far away a city is precise enough for the bearing; near Makkah it is not, and Makkah itself means "face the Kaaba"', () => {
    const london = named('London');
    expect(bearingUncertaintyDegrees({ latitude: london.latitude, longitude: london.longitude }, CITY_RADIUS_M)).toBeLessThan(1);
    const jeddah = named('Jeddah');
    expect(bearingUncertaintyDegrees({ latitude: jeddah.latitude, longitude: jeddah.longitude }, CITY_RADIUS_M)).toBeGreaterThan(3);
    const mecca = named('Mecca');
    expect(computeQibla({ latitude: mecca.latitude, longitude: mecca.longitude }, CITY_RADIUS_M).kind).toBe('atKaaba');
  });
});
