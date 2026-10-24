import { describe, expect, it, vi } from 'vitest';

// dataset.ts reaches react-native only through its imports' types; pure data here.
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@/surahPreview/bundledDataset', () => ({ bundledSurahPreview: () => null, isSurahPreviewBundled: () => true }));

const { readSurahPreviewDataset, shownStatus, surahsStartingOn, previewLanguage } = await import('@/surahPreview/dataset');
const { arabicAyahNoun } = await import('@/surahPreview/labels');

/** A SYNTHETIC dataset in the generated file's shape (never the sources' words). */
function dataset(edit: (surah: Record<string, unknown>, n: number) => void = () => undefined) {
  return {
    format: 1,
    status: 'official',
    sources: [{ id: 'mukhtasar-quranenc', title: 't', publisher: 'p', url: 'u', retrieved: 'r' }, { id: 'tanzil', title: 't', publisher: 'p', url: 'u', retrieved: 'r' }],
    surahs: Array.from({ length: 114 }, (_, i) => {
      const surah: Record<string, unknown> = {
        surah: i + 1,
        revelation: 'makki',
        ayahCount: 7,
        purpose: { ar: `مقصد ${i + 1}`, en: null },
        themes: { ar: null, en: null },
        status: { purposeAr: 'quoted', purposeEn: 'unavailable', themesAr: 'unavailable', themesEn: 'unavailable' },
        sources: ['mukhtasar-quranenc', 'tanzil'],
      };
      edit(surah, i + 1);
      return surah;
    }),
  };
}
const entry = (raw: unknown, n: number) => {
  const d = readSurahPreviewDataset(raw);
  return d.status === 'official' ? d.forSurah(n) : undefined;
};

describe('Surah Preview dataset: statuses (quoted, approved, pending review, unavailable)', () => {
  it('reads every section with its status and sources; the Arabic purpose is the quoted source text', () => {
    const e = entry(dataset(), 18)!;
    expect(e.purpose.ar).toBe('مقصد 18');
    expect(e.status).toEqual({ purposeAr: 'quoted', purposeEn: 'unavailable', themesAr: 'unavailable', themesEn: 'unavailable' });
    expect(e.sources).toEqual(['mukhtasar-quranenc', 'tanzil']);
    expect(shownStatus(e.status.themesAr)).toBe(false);
  });

  it('approved and pending-review themes are read (and shown, the latter marked); unavailable ones are not', () => {
    const raw = dataset((s, n) => {
      if (n === 18) Object.assign(s, { themes: { ar: ['موضوع أ', 'موضوع ب'], en: null }, status: { ...(s.status as object), themesAr: 'approved' } });
      if (n === 19) Object.assign(s, { themes: { ar: ['موضوع'], en: null }, status: { ...(s.status as object), themesAr: 'pending-review' } });
    });
    expect(entry(raw, 18)!.themes.ar).toEqual(['موضوع أ', 'موضوع ب']);
    expect(entry(raw, 18)!.status.themesAr).toBe('approved');
    expect(entry(raw, 19)!.status.themesAr).toBe('pending-review');
    expect(shownStatus('pending-review')).toBe(true);
    expect(entry(raw, 20)!.themes.ar).toBeNull();
  });

  it('a text and its status must agree: themes without a status, or a status without its text, leave the entry out', () => {
    const textNoStatus = dataset((s, n) => { if (n === 5) s.themes = { ar: ['موضوع'], en: null }; });
    expect(entry(textNoStatus, 5)).toBeNull();
    const statusNoText = dataset((s, n) => { if (n === 5) s.status = { ...(s.status as object), themesAr: 'approved' }; });
    expect(entry(statusNoText, 5)).toBeNull();
    const unknownStatus = dataset((s, n) => { if (n === 5) s.status = { ...(s.status as object), themesEn: 'verified-ish' }; });
    expect(entry(unknownStatus, 5)).toBeNull();
    // Other Surahs are unaffected.
    expect(entry(statusNoText, 6)).not.toBeNull();
  });

  it('no English is ever presented without a status: English text marked unavailable is rejected', () => {
    const raw = dataset((s, n) => { if (n === 1) s.purpose = { ar: 'مقصد', en: 'An English purpose' }; });
    expect(entry(raw, 1)).toBeNull();
  });

  it('a file from before statuses existed: the Arabic purpose quoted, everything else unavailable', () => {
    const legacy = dataset((s) => { delete s.status; delete s.sources; });
    expect(entry(legacy, 2)!.status).toEqual({ purposeAr: 'quoted', purposeEn: 'unavailable', themesAr: 'unavailable', themesEn: 'unavailable' });
  });

  it('anything but 114 entries of format 1 is unavailable as a whole (never partial)', () => {
    expect(readSurahPreviewDataset({ ...dataset(), surahs: dataset().surahs.slice(0, 113) }).status).toBe('unavailable');
    expect(readSurahPreviewDataset({ format: 1, status: 'unavailable' }).status).toBe('unavailable');
    expect(readSurahPreviewDataset(null).status).toBe('unavailable');
  });

  it('the introduction is in English only where an English purpose exists (none today), else Arabic', () => {
    const e = entry(dataset(), 1)!;
    expect(previewLanguage(e, 'en', 'quran-text')).toBe('ar');
    expect(previewLanguage(e, 'ar', 'quran-text')).toBe('ar');
  });
});

describe('Surah Preview: facts', () => {
  it('Arabic counted noun after the number of ayahs: «آيات» for 3–10 (and 103–110), «آية» otherwise', () => {
    expect([3, 7, 10, 11, 18, 99, 100, 103, 110, 111, 200, 286].map((n) => `${n} ${arabicAyahNoun(n)}`)).toEqual([
      '3 آيات', '7 آيات', '10 آيات', '11 آية', '18 آية', '99 آية', '100 آية', '103 آيات', '110 آيات', '111 آية', '200 آية', '286 آية',
    ]);
  });

  it('the Surahs beginning on a page: Al-Kahf on 293, Maryam on 305, three on 604, none on 61', () => {
    expect(surahsStartingOn(293)).toEqual([18]);
    expect(surahsStartingOn(305)).toEqual([19]);
    expect(surahsStartingOn(604)).toEqual([112, 113, 114]);
    expect(surahsStartingOn(61)).toEqual([]);
  });
});
