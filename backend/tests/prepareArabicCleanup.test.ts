import { describe, expect, it } from 'vitest';

import {
  analyzeQuranTextCollection,
  hasBlockingIssues,
  unaffectedCollectionReport,
  type QuranTextRecord,
} from '../src/scripts/prepareArabicCleanup';

describe('Arabic cleanup dry-run analysis', () => {
  it('reports totals, arabic presence and valid verse keys for clean records', () => {
    const records: QuranTextRecord[] = [
      { _id: 'a', referenceKey: '2:153', surahNumber: 2, ayahNumber: 153, arabicText: 'نص' },
      { _id: 'b', referenceKey: '94:5', surahNumber: 94, ayahNumber: 5, arabicText: 'نص' },
      { _id: 'c', referenceKey: '1:1', surahNumber: 1, ayahNumber: 1, arabicText: '' },
    ];

    const report = analyzeQuranTextCollection('verses', records, ['arabicText', 'checksum']);

    expect(report.total).toBe(3);
    expect(report.withArabic).toBe(2);
    expect(report.validVerseKey).toBe(3);
    expect(report.unresolved).toEqual([]);
    expect(report.conflicting).toEqual([]);
    expect(report.fieldsToRemove).toEqual(['arabicText', 'checksum']);
    expect(report.recordsRemaining).toBe(3);
  });

  it('flags unresolved references for missing or invalid verse keys', () => {
    const records: QuranTextRecord[] = [
      { _id: 'a', referenceKey: '115:1', surahNumber: 115, ayahNumber: 1, arabicText: 'x' },
      { _id: 'b', referenceKey: undefined, surahNumber: 2, ayahNumber: 1, arabicText: 'x' },
      { _id: 'c', referenceKey: '2:287', surahNumber: 2, ayahNumber: 287, arabicText: 'x' },
    ];

    const report = analyzeQuranTextCollection('ayahs', records, ['arabicText']);

    expect(report.validVerseKey).toBe(0);
    expect(report.unresolved).toHaveLength(3);
    expect(report.unresolved.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('flags conflicting references where referenceKey disagrees with surah/ayah numbers', () => {
    const records: QuranTextRecord[] = [
      { _id: 'a', referenceKey: '2:153', surahNumber: 2, ayahNumber: 154, arabicText: 'x' },
      { _id: 'b', referenceKey: '2:153', surahNumber: 2, ayahNumber: 153, arabicText: 'x' },
    ];

    const report = analyzeQuranTextCollection('verses', records, ['arabicText', 'checksum']);

    expect(report.conflicting).toEqual([{ id: 'a', referenceKey: '2:153', numericKey: '2:154' }]);
  });

  it('reports unaffected collections with zero removed fields and full record retention', () => {
    const report = unaffectedCollectionReport('emotionversemappings', 43);

    expect(report).toEqual({
      collection: 'emotionversemappings',
      total: 43,
      withArabic: 0,
      validVerseKey: 43,
      unresolved: [],
      conflicting: [],
      fieldsToRemove: [],
      recordsRemaining: 43,
    });
  });

  it('blocks on any unresolved reference across collections', () => {
    const clean = analyzeQuranTextCollection(
      'verses',
      [{ _id: 'a', referenceKey: '1:1', surahNumber: 1, ayahNumber: 1 }],
      ['arabicText'],
    );
    const dirty = analyzeQuranTextCollection(
      'ayahs',
      [{ _id: 'b', referenceKey: '0:0', surahNumber: 0, ayahNumber: 0 }],
      ['arabicText'],
    );

    expect(hasBlockingIssues([clean])).toBe(false);
    expect(hasBlockingIssues([clean, dirty])).toBe(true);
  });
});
