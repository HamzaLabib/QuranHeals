import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_FAVORITE_RECITER_ID, getReciter, isReciterId, ON_HOLD_RECITER_IDS, orderedReciters, RECITER_ORDER, RECITERS, withDevelopmentTiming, withPerAyahPreview, withTimedPreview } from '@/audio/reciters';
import { DEVELOPMENT_TIMING } from '@/audio/generated/developmentTiming';
import { PER_AYAH_PREVIEW } from '@/audio/generated/perAyahPreview';
import { GENERATED_RECITERS } from '@/audio/generated/reciterCatalog';
import { TIMED_PREVIEW } from '@/audio/generated/timedPreview';
import { parseFavoriteReciter } from '@/audio/favoriteReciterPreference';

/** The owner's order (2026-10-24), the same in English and Arabic. */
const ORDER = [
  ['minshawi', 'Muhammad Siddiq Al-Minshawi', 'محمد صديق المنشاوي'],
  ['husary', 'Mahmoud Khalil Al-Husary', 'محمود خليل الحصري'],
  ['abdulbasit', 'Abdul Basit Abdus Samad', 'عبد الباسط عبد الصمد'],
  ['banna', 'Mahmoud Ali Al-Banna', 'محمود علي البنا'],
  ['shuraim', 'Saud Al-Shuraim', 'سعود الشريم'],
  ['hudhaifi', 'Ali Al-Hudhaifi', 'علي بن عبد الرحمن الحذيفي'],
  ['sufi', 'Abdul Rashid Ali Sufi', 'عبد الرشيد علي صوفي'],
  ['ahmed-salama', 'Ahmed Mohamed Salama', 'أحمد محمد سلامة'],
  ['shatri', 'Abu Bakr Al-Shatri', 'أبو بكر الشاطري'],
  ['ajmi', 'Ahmed Al-Agamy', 'أحمد العجمي'],
  ['maher', 'Maher Al-Muaiqly', 'ماهر المعيقلي'],
  ['jaber', 'Ali Abdullah Jaber', 'علي عبد الله جابر'],
  ['basfar', 'Abdullah Basfar', 'عبد الله بصفر'],
  ['yasser-salama', 'Yasser Mahmoud Salama', 'ياسر محمود سلامة'],
  ['naina', 'Ahmed Naina', 'أحمد نعينع'],
  ['islam-sobhi', 'Islam Sobhi', 'إسلام صبحي'],
  ['saleh-talib', 'Saleh Al-Talib', 'صالح آل طالب'],
] as const;
const NOT_OFFERED = ['rifaat', 'gebril'];

describe('the reciters the app offers (owner, 2026-10-24)', () => {
  it('a development build: exactly the 17, in the owner\'s order, English and Arabic, no duplicates', () => {
    const dev = orderedReciters(withPerAyahPreview(withTimedPreview(withDevelopmentTiming(GENERATED_RECITERS, DEVELOPMENT_TIMING), TIMED_PREVIEW), PER_AYAH_PREVIEW));
    expect(dev.map((r) => [r.id, r.nameEn, r.nameAr])).toEqual(ORDER.map((x) => [...x]));
    expect(new Set(dev.map((r) => r.id)).size).toBe(17);
    expect(new Set(dev.map((r) => r.nameAr)).size).toBe(17);
  });

  it('a release build (tests run as one): the same order, Ali Abdullah Jaber included (released per-ayah recording, 2026-10-25)', () => {
    expect(RECITERS.map((r) => r.id)).toEqual(ORDER.map(([id]) => id));
    expect(RECITER_ORDER).toEqual(ORDER.map(([id]) => id));
  });

  it('one Ahmed Al-Agamy only (أحمد العجمي, MP3Quran reciter 5): no "Ali Al-Ajmi" exists in the catalogue', () => {
    const ajmi = GENERATED_RECITERS.filter((r) => /العجمي/.test(r.nameAr));
    expect(ajmi.map((r) => [r.id, r.mp3quranReciterId, r.nameAr])).toEqual([['ajmi', 5, 'أحمد العجمي']]);
    expect(getReciter('ajmi')!.nameEn).toBe('Ahmed Al-Agamy');
    // The display name changes only: the recording, its id and its timing are the catalogue's (plus released surahs).
    const own = GENERATED_RECITERS.find((r) => r.id === 'ajmi')!;
    expect(getReciter('ajmi')!.server).toBe(own.server);
    for (const [s, entry] of Object.entries(own.timed)) expect(getReciter('ajmi')!.timed[Number(s)], s).toEqual(entry);
  });

  it("Ali Al-Hudhaifi at #6 (owner's order): the Arabic display name only; recording and measured timing are the catalogue's", () => {
    const h = getReciter('hudhaifi')!;
    const own = GENERATED_RECITERS.find((r) => r.id === 'hudhaifi')!;
    expect(RECITERS.map((r) => r.id).indexOf('hudhaifi')).toBe(5);
    expect([h.nameEn, h.nameAr, own.nameAr]).toEqual(['Ali Al-Hudhaifi', 'علي بن عبد الرحمن الحذيفي', 'علي الحذيفي']);
    expect([h.server, h.timingSource]).toEqual([own.server, own.timingSource]);
    for (const [s, entry] of Object.entries(own.timed)) expect(h.timed[Number(s)], s).toEqual(entry); // released surahs only add
  });

  it('on hold (Muhammad Rifaat, Mohamed Gebril) not offered, not playable in the app', () => {
    expect(ON_HOLD_RECITER_IDS).toEqual(['rifaat', 'gebril']);
    for (const id of NOT_OFFERED) {
      expect(getReciter(id), id).toBeNull();
      expect(isReciterId(id), id).toBe(false);
    }
  });

  it('their data is kept: the catalogue, the development preview data and the review tools still have them', async () => {
    expect(GENERATED_RECITERS.map((r) => r.id)).toEqual(expect.arrayContaining(['rifaat', 'hudhaifi']));
    expect(PER_AYAH_PREVIEW.map((p) => p.reciterId)).toContain('gebril');
    const tools = path.resolve(__dirname, '../../tools/quran-audio');
    const lib = await import(pathToFileURL(path.join(tools, 'review/dashboard/dashboard-lib.mjs')).href);
    for (const id of NOT_OFFERED) expect(lib.RECITER.has(id), id).toBe(true); // the review dashboard keeps them
  });

  it('a Favorite Reciter on hold reads as the default while on hold; the stored choice is never rewritten', () => {
    expect(parseFavoriteReciter('rifaat')).toBe(DEFAULT_FAVORITE_RECITER_ID);
    expect(parseFavoriteReciter('gebril')).toBe(DEFAULT_FAVORITE_RECITER_ID);
    expect(parseFavoriteReciter('saleh-talib')).toBe('saleh-talib'); // active again (owner correction, 2026-10-24)
    expect(parseFavoriteReciter('maher')).toBe('maher');
    // Loading only reads: nothing deletes or overwrites the stored id, so it returns if the reciter is reinstated.
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'audio', 'favoriteReciterPreference.ts'), 'utf8');
    const load = src.slice(src.indexOf('export async function loadFavoriteReciter'), src.indexOf('export async function saveFavoriteReciter'));
    expect(load).not.toMatch(/setItem|removeItem/);
  });
});
