import { describe, expect, it } from 'vitest';

import { stripAyahArabicText } from '../../src/seed/seed';
import { stripVerseArabicFields } from '../../src/seed/migrateFoundation';
import { seedAyahs } from '../../src/seed/ayahs';
import { buildFoundationSeedData } from '../../src/seed/foundation';

// Phase 4C removed Verse.arabicText, Verse.checksum, and Ayah.arabicText from
// MongoDB so it is reference-only for Quran Arabic (see
// backend/src/quran/quranSource.ts). backend/src/seed/seed.ts and
// backend/src/seed/migrateFoundation.ts are the only active writers that
// previously wrote those fields via `$set` of a whole seed object; both now
// route through stripAyahArabicText / stripVerseArabicFields before writing.
// This suite proves those two functions actually remove the fields, using
// the real seed data (which still legitimately carries Arabic text as
// historical/foundational source content), without opening a database
// connection.

describe('seed.ts cannot reintroduce Ayah.arabicText', () => {
  it('stripAyahArabicText removes arabicText from every real seed ayah', () => {
    expect(seedAyahs.length).toBeGreaterThan(0);

    seedAyahs.forEach((ayah) => {
      expect(ayah.arabicText).toBeTruthy(); // sanity: the source data still has it
      const stripped = stripAyahArabicText(ayah);
      expect(Object.prototype.hasOwnProperty.call(stripped, 'arabicText')).toBe(false);
      expect((stripped as Record<string, unknown>).arabicText).toBeUndefined();
    });
  });

  it('preserves every other field unchanged', () => {
    const ayah = seedAyahs[0];
    const stripped = stripAyahArabicText(ayah);
    const { arabicText, ...rest } = ayah;
    expect(stripped).toEqual(rest);
    expect(arabicText).toBeTruthy();
  });
});

describe('migrateFoundation.ts cannot reintroduce Verse.arabicText/checksum', () => {
  it('stripVerseArabicFields removes arabicText and checksum from every real foundation verse', () => {
    const { verses } = buildFoundationSeedData(seedAyahs);
    expect(verses.length).toBeGreaterThan(0);

    verses.forEach((verse) => {
      expect(verse.arabicText).toBeTruthy(); // sanity: the built seed data still has it
      expect(verse.checksum).toMatch(/^[a-f0-9]{64}$/);

      const stripped = stripVerseArabicFields(verse);
      expect(Object.prototype.hasOwnProperty.call(stripped, 'arabicText')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(stripped, 'checksum')).toBe(false);
    });
  });

  it('preserves every other field unchanged', () => {
    const { verses } = buildFoundationSeedData(seedAyahs);
    const verse = verses[0];
    const stripped = stripVerseArabicFields(verse);
    const { arabicText, checksum, ...rest } = verse;
    expect(stripped).toEqual(rest);
    expect(arabicText).toBeTruthy();
    expect(checksum).toBeTruthy();
  });
});

describe('seed.ts and migrateFoundation.ts do not run as an import side effect', () => {
  it('importing stripAyahArabicText from seed.ts does not attempt a database connection', () => {
    // Structural: if seed.ts's seedDatabase()/disconnectFromDatabase() call
    // at module scope were not guarded by `require.main === module`, merely
    // importing this module (as this test file does above) would already
    // have thrown (no MONGODB_URI in the test environment) or hung trying to
    // connect. Reaching this line at all is the proof.
    expect(typeof stripAyahArabicText).toBe('function');
  });

  it('importing stripVerseArabicFields from migrateFoundation.ts does not attempt a database connection', () => {
    expect(typeof stripVerseArabicFields).toBe('function');
  });
});
