import { describe, expect, it } from 'vitest';

import { mushafRouteForAyah, requestedAyahOnPage } from '@/mushaf/ayahInMushaf';
import { pageOfAyah, surahStartPage } from '@/mushaf/navigation';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';

/** The reference under an ayah opens the app's own Mushaf: every ayah's route, and what the reader accepts from it. */
describe('mushafRouteForAyah / requestedAyahOnPage', () => {
  it('every one of the 6,236 ayahs: the Mushaf tab, its own page (1–604, never decreasing), and the reader selects exactly it there', () => {
    let count = 0;
    let previous = 1;
    SURAH_AYAH_COUNTS.forEach((ayahs, index) => {
      const surah = index + 1;
      for (let ayah = 1; ayah <= ayahs; ayah++) {
        const route = mushafRouteForAyah(surah, ayah, 123)!;
        const page = Number(route.params.page);
        expect(route).toEqual({ pathname: '/mushaf', params: { page: String(pageOfAyah(surah, ayah)), ayah: `${surah}:${ayah}`, at: '123' } });
        expect(page >= previous && page <= 604, `${surah}:${ayah}`).toBe(true);
        expect(requestedAyahOnPage(route.params.ayah, page)).toBe(`${surah}:${ayah}`);
        previous = page;
        count++;
      }
    });
    expect(count).toBe(6236);
  });

  it('the exact ayah`s page, not its Surah`s first page', () => {
    expect(surahStartPage(2)).toBe(2);
    expect(mushafRouteForAyah(2, 255)!.params.page).toBe('42');
    expect(mushafRouteForAyah(2, 286)!.params.page).toBe('49');
    expect(mushafRouteForAyah(114, 6)!.params.page).toBe('604');
  });

  it('nothing for an ayah that does not exist; the reader never selects one off its page or malformed', () => {
    for (const [surah, ayah] of [[1, 8], [0, 1], [115, 1], [2, 0], [2, 1.5], [Number.NaN, 1]]) expect(mushafRouteForAyah(surah, ayah), `${surah}:${ayah}`).toBeNull();
    expect(requestedAyahOnPage('2:255', 41)).toBeNull();
    expect(requestedAyahOnPage('2:255', null)).toBeNull();
    expect(requestedAyahOnPage(['2:255'], 42)).toBe('2:255');
    for (const raw of [undefined, '', '2-255', '02:255', '2:255x', '1:8', 42]) expect(requestedAyahOnPage(raw, 42), String(raw)).toBeNull();
  });
});
