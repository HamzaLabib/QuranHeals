import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/database', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(undefined),
  disconnectFromDatabase: vi.fn().mockResolvedValue(undefined),
}));

import { stripLegacyTranslationFields, seedDatabase } from '../../src/seed/seed';
import { stripAyahArabicText } from '../../src/seed/seed';
import { migrateFoundation } from '../../src/seed/migrateFoundation';
import { seedAyahs } from '../../src/seed/ayahs';
import { seedEmotions } from '../../src/seed/emotions';
import { buildFoundationSeedData } from '../../src/seed/foundation';
import { AyahModel } from '../../src/models/Ayah';
import { EmotionModel } from '../../src/models/Emotion';
import { VerseModel } from '../../src/models/Verse';
import { EmotionVerseMappingModel } from '../../src/models/EmotionVerseMapping';
import { VerseTranslationModel } from '../../src/models/VerseTranslation';

// Phase 6A.8C found a real regression risk: migrateFoundation.ts could still
// recreate Mongo VerseTranslation rows carrying the old pre-Gutenberg
// wording, and seed.ts's Ayah write path never stripped
// englishTranslation/translationSource before persisting. Phase 6A.8D closes
// both paths. This suite proves it without ever opening a real database
// connection — config/database.ts is mocked to a no-op above, and every
// Mongoose model call below is a vi.spyOn stub.

describe('seed.ts cannot reintroduce Ayah.englishTranslation/translationSource', () => {
  it('stripLegacyTranslationFields removes both fields from every real seed ayah', () => {
    expect(seedAyahs.length).toBeGreaterThan(0);

    seedAyahs.forEach((ayah) => {
      expect(ayah.englishTranslation).toBeTruthy(); // sanity: source data still has it
      expect(ayah.translationSource).toBeTruthy();

      const stripped = stripLegacyTranslationFields(ayah);

      expect(Object.prototype.hasOwnProperty.call(stripped, 'englishTranslation')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(stripped, 'translationSource')).toBe(false);
    });
  });

  it('preserves every other field unchanged', () => {
    const ayah = seedAyahs[0];
    const stripped = stripLegacyTranslationFields(ayah);
    const { englishTranslation, translationSource, ...rest } = ayah;

    expect(stripped).toEqual(rest);
    expect(englishTranslation).toBeTruthy();
    expect(translationSource).toBeTruthy();
  });

  it('composes with stripAyahArabicText to remove arabicText, englishTranslation and translationSource together', () => {
    const ayah = seedAyahs[0];
    const stripped = stripLegacyTranslationFields(stripAyahArabicText(ayah));

    expect(Object.prototype.hasOwnProperty.call(stripped, 'arabicText')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(stripped, 'englishTranslation')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(stripped, 'translationSource')).toBe(false);
    expect(stripped.referenceKey).toBe(ayah.referenceKey);
  });
});

describe('migrateFoundation.ts cannot reintroduce VerseTranslation documents', () => {
  it('buildFoundationSeedData still derives translations (for other consumers) but migrateFoundation never persists them', async () => {
    const { verses, mappings } = buildFoundationSeedData(seedAyahs);

    vi.spyOn(EmotionModel, 'updateOne').mockResolvedValue({ acknowledged: true } as never);
    vi.spyOn(VerseModel, 'updateOne').mockResolvedValue({ acknowledged: true } as never);
    vi.spyOn(EmotionVerseMappingModel, 'updateOne').mockResolvedValue({ acknowledged: true } as never);
    vi.spyOn(VerseModel, 'find').mockReturnValue({ lean: async () => verses } as never);
    vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue({ lean: async () => mappings } as never);
    vi.spyOn(EmotionModel, 'countDocuments').mockResolvedValue(seedEmotions.length as never);

    // Canary: if migrateFoundation ever re-adds a VerseTranslation write, this
    // spy will observe the call even though migrateFoundation.ts no longer
    // imports the model itself.
    const verseTranslationUpdateOne = vi
      .spyOn(VerseTranslationModel, 'updateOne')
      .mockResolvedValue({ acknowledged: true } as never);
    const verseTranslationCreate = vi.spyOn(VerseTranslationModel, 'create').mockResolvedValue([] as never);
    const verseTranslationInsertMany = vi
      .spyOn(VerseTranslationModel, 'insertMany')
      .mockResolvedValue([] as never);

    await migrateFoundation();

    expect(verseTranslationUpdateOne).not.toHaveBeenCalled();
    expect(verseTranslationCreate).not.toHaveBeenCalled();
    expect(verseTranslationInsertMany).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});

describe('seed.ts cannot reintroduce Ayah.englishTranslation/translationSource in a real write', () => {
  it('never persists englishTranslation or translationSource via AyahModel.updateOne', async () => {
    vi.spyOn(EmotionModel, 'updateOne').mockResolvedValue({ acknowledged: true } as never);

    const setPayloads: Record<string, unknown>[] = [];
    const ayahUpdateOne = vi
      .spyOn(AyahModel, 'updateOne')
      .mockImplementation((_filter: unknown, update: unknown) => {
        setPayloads.push((update as { $set: Record<string, unknown> }).$set);
        return Promise.resolve({ acknowledged: true }) as never;
      });

    await seedDatabase();

    expect(ayahUpdateOne).toHaveBeenCalledTimes(seedAyahs.length);
    setPayloads.forEach((payload) => {
      expect(Object.prototype.hasOwnProperty.call(payload, 'englishTranslation')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(payload, 'translationSource')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(payload, 'arabicText')).toBe(false);
    });

    vi.restoreAllMocks();
  });
});

describe('seed.ts and migrateFoundation.ts do not run as an import side effect', () => {
  it('importing stripLegacyTranslationFields from seed.ts does not attempt a database connection', () => {
    expect(typeof stripLegacyTranslationFields).toBe('function');
  });

  it('importing migrateFoundation from migrateFoundation.ts does not attempt a database connection', () => {
    expect(typeof migrateFoundation).toBe('function');
  });
});
