/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { AYAH_LINK_HOST, buildAyahLink, isExistingAyah, parseAyahLinkParams, SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

/** Smart ayah links: generation, validation against the real Quran, and the native association config. */

const db = new DatabaseSync(fileURLToPath(new URL('../assets/quran/quran.sqlite', import.meta.url)), { readOnly: true });
afterAll(() => db.close());
const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf-8');

describe('ayah counts', () => {
  it('match the bundled verified Quran (6,236 ayahs) exactly', () => {
    const rows = db.prepare('SELECT surah, COUNT(*) AS n FROM verses GROUP BY surah ORDER BY surah').all() as { surah: number; n: number }[];
    expect(rows.map((row) => row.n)).toEqual(SURAH_AYAH_COUNTS);
    expect(SURAH_AYAH_COUNTS.reduce((sum, count) => sum + count, 0)).toBe(6236);
  });

  it('match the backend`s verified surah-counts.json (the link server validates with it)', () => {
    const { counts } = JSON.parse(read('../backend/assets/quran/surah-counts.json')) as { counts: number[] };
    expect(counts).toEqual(SURAH_AYAH_COUNTS);
  });

  it('accept every real ayah and nothing else', () => {
    const keys = new Set((db.prepare('SELECT verse_key AS k FROM verses').all() as { k: string }[]).map((row) => row.k));
    for (let surah = 0; surah <= 115; surah += 1) {
      for (let ayah = 0; ayah <= 290; ayah += 1) {
        expect(isExistingAyah(surah, ayah), `${surah}:${ayah}`).toBe(keys.has(`${surah}:${ayah}`));
      }
    }
    expect(isExistingAyah(2.5, 1)).toBe(false);
    expect(isExistingAyah(Number.NaN, 1)).toBe(false);
  });
});

describe('link generation', () => {
  it('builds the HTTPS link for the exact ayah', () => {
    expect(buildAyahLink(94, 5)).toBe('https://quran-heals-api.onrender.com/ayah/94/5');
    expect(buildAyahLink(1, 1)).toBe('https://quran-heals-api.onrender.com/ayah/1/1');
    expect(buildAyahLink(2, 286)).toBe('https://quran-heals-api.onrender.com/ayah/2/286');
    expect(buildAyahLink(114, 6)).toBe('https://quran-heals-api.onrender.com/ayah/114/6');
  });

  it('never builds a link to an ayah that does not exist', () => {
    for (const [surah, ayah] of [[94, 9], [115, 1], [0, 1], [1, 0], [1, 8], [-2, 5]]) expect(buildAyahLink(surah, ayah)).toBeNull();
  });

  it('a link carries only the reference — no query, user, reflection or emotion data', () => {
    const link = new URL(buildAyahLink(2, 255)!);
    expect(link.protocol).toBe('https:');
    expect(link.pathname).toBe('/ayah/2/255');
    expect(link.search).toBe('');
    expect(link.hash).toBe('');
    expect(link.username + link.password).toBe('');
  });

  it('parses route params strictly', () => {
    expect(parseAyahLinkParams('94', '5')).toBe('94:5');
    expect(parseAyahLinkParams('2', '286')).toBe('2:286');
    for (const [surah, ayah] of [['94', '9'], ['02', '5'], ['2', '05'], ['2', ' 5'], ['2', '5a'], ['1e1', '1'], [['2'], '5'], [2, 5], [undefined, '1']]) {
      expect(parseAyahLinkParams(surah, ayah), JSON.stringify([surah, ayah])).toBeNull();
    }
  });
});

describe('native association', () => {
  const config = JSON.parse(read('app.json')).expo;

  it('iOS claims the link host through Associated Domains', () => {
    expect(config.ios.associatedDomains).toEqual([`applinks:${AYAH_LINK_HOST}`]);
  });

  it('Android verifies an App Link for https://<host>/ayah/… only', () => {
    expect(config.android.intentFilters).toEqual([{
      action: 'VIEW',
      autoVerify: true,
      data: [{ scheme: 'https', host: AYAH_LINK_HOST, pathPrefix: '/ayah/' }],
      category: ['BROWSABLE', 'DEFAULT'],
    }]);
  });

  it('the "Open in Quran Heals" fallback uses the app`s existing scheme', () => {
    expect(config.scheme).toBe('quranheals');
    expect(read('../backend/src/appLinks/appLinks.ts')).toMatch(/export const APP_SCHEME = 'quranheals';/);
    expect(read('../backend/src/appLinks/appLinks.ts')).toMatch(/export const APP_IDENTIFIER = 'com\.quranheals\.app';/);
    expect(config.ios.bundleIdentifier).toBe('com.quranheals.app');
    expect(config.android.package).toBe('com.quranheals.app');
  });
});
