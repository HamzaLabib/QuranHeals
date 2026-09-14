import { describe, expect, it } from 'vitest';

import { getVerseKeySet, isValidVerseKey } from '../../src/quran/referenceKeys';
import { seedAyahs } from '../../src/seed/ayahs';

describe('Quran reference key set', () => {
  it('contains exactly the 6,236 canonical verse keys across 114 surahs', () => {
    const keys = getVerseKeySet();
    const surahs = new Set([...keys].map((key) => key.split(':')[0]));

    expect(keys.size).toBe(6236);
    expect(surahs.size).toBe(114);
  });

  it('covers the exact ayah range for a short and a long surah', () => {
    for (let ayah = 1; ayah <= 7; ayah += 1) {
      expect(isValidVerseKey(`1:${ayah}`)).toBe(true);
    }
    expect(isValidVerseKey('1:8')).toBe(false);

    for (let ayah = 1; ayah <= 286; ayah += 1) {
      expect(isValidVerseKey(`2:${ayah}`)).toBe(true);
    }
    expect(isValidVerseKey('2:287')).toBe(false);
  });

  it('rejects out-of-range surahs and malformed keys', () => {
    expect(isValidVerseKey('0:1')).toBe(false);
    expect(isValidVerseKey('115:1')).toBe(false);
    expect(isValidVerseKey('2:0')).toBe(false);
    expect(isValidVerseKey('2:287')).toBe(false);
    expect(isValidVerseKey('2')).toBe(false);
    expect(isValidVerseKey('2:3:4')).toBe(false);
    expect(isValidVerseKey('')).toBe(false);
    expect(isValidVerseKey('02:03')).toBe(false);
  });

  it('accepts every existing legacy seed reference key', () => {
    const keys = getVerseKeySet();

    seedAyahs.forEach((ayah) => {
      expect(keys.has(ayah.referenceKey), `missing ${ayah.referenceKey}`).toBe(true);
    });
  });
});
