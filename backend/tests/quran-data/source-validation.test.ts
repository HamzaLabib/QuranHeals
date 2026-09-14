import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import {
  getVerifiedArabicByVerseKey,
  getVerifiedArabicForRecord,
  QuranSourceError,
  resolveMongoVerseKey,
} from '../../src/quran/quranSource';

const sqlitePath = resolve(__dirname, '../../assets/quran/quran.sqlite');

function findLocalArabic(verseKey: string): string {
  const database = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const row = database
      .prepare('SELECT arabic_text FROM verses WHERE verse_key = ?')
      .get(verseKey) as { arabic_text: string } | undefined;
    if (!row) throw new Error(`fixture bug: ${verseKey} not in local sqlite`);
    return row.arabic_text;
  } finally {
    database.close();
  }
}

describe('getVerifiedArabicByVerseKey', () => {
  it('returns the exact local Arabic text for a real verse key', () => {
    expect(getVerifiedArabicByVerseKey('2:153')).toBe(findLocalArabic('2:153'));
    expect(getVerifiedArabicByVerseKey('94:6')).toBe(findLocalArabic('94:6'));
    expect(getVerifiedArabicByVerseKey('1:1')).toBe(findLocalArabic('1:1'));
  });

  it('rejects a verse key that is not one of the 6,236 real verses', () => {
    expect(() => getVerifiedArabicByVerseKey('115:1')).toThrow(QuranSourceError);
    expect(() => getVerifiedArabicByVerseKey('2:287')).toThrow(QuranSourceError);
    expect(() => getVerifiedArabicByVerseKey('not-a-key')).toThrow(QuranSourceError);
  });
});

describe('resolveMongoVerseKey', () => {
  it('resolves from referenceKey alone', () => {
    expect(resolveMongoVerseKey({ referenceKey: '2:153' })).toBe('2:153');
  });

  it('resolves from surahNumber/ayahNumber alone', () => {
    expect(resolveMongoVerseKey({ surahNumber: 94, ayahNumber: 6 })).toBe('94:6');
  });

  it('resolves when referenceKey and numeric fields agree', () => {
    expect(
      resolveMongoVerseKey({ referenceKey: '2:153', surahNumber: 2, ayahNumber: 153 }),
    ).toBe('2:153');
  });

  it('throws when referenceKey and numeric fields conflict', () => {
    expect(() =>
      resolveMongoVerseKey({ referenceKey: '2:153', surahNumber: 2, ayahNumber: 999 }),
    ).toThrow(QuranSourceError);
  });

  it('throws on a malformed referenceKey string (no schema guard for legacy Ayah)', () => {
    expect(() => resolveMongoVerseKey({ referenceKey: 'not-a-key' })).toThrow(QuranSourceError);
  });

  it('throws on an out-of-range numeric reference', () => {
    expect(() => resolveMongoVerseKey({ surahNumber: 115, ayahNumber: 1 })).toThrow(QuranSourceError);
    expect(() => resolveMongoVerseKey({ surahNumber: 2, ayahNumber: 287 })).toThrow(QuranSourceError);
  });

  it('throws when no reference field is present at all', () => {
    expect(() => resolveMongoVerseKey({})).toThrow(QuranSourceError);
  });

  it('throws on a shape-valid but nonexistent verse (999:999)', () => {
    expect(() => resolveMongoVerseKey({ surahNumber: 99, ayahNumber: 999 })).toThrow(QuranSourceError);
  });
});

describe('getVerifiedArabicForRecord', () => {
  it('ignores any arabicText on the record and returns the verified source text instead', () => {
    const record = {
      referenceKey: '2:153',
      surahNumber: 2,
      ayahNumber: 153,
      arabicText: 'WRONG_MONGO_ARABIC_TEST_FIXTURE_DO_NOT_USE',
    };

    expect(getVerifiedArabicForRecord(record)).toBe(findLocalArabic('2:153'));
    expect(getVerifiedArabicForRecord(record)).not.toBe(record.arabicText);
  });

  it('fails explicitly for a record with a conflicting reference, never falling back to its own arabicText', () => {
    const record = {
      referenceKey: '2:153',
      surahNumber: 2,
      ayahNumber: 999,
      arabicText: 'WRONG_MONGO_ARABIC_TEST_FIXTURE_DO_NOT_USE',
    };

    expect(() => getVerifiedArabicForRecord(record)).toThrow(QuranSourceError);
  });
});
