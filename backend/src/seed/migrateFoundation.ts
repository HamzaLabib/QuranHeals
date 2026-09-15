import { connectToDatabase, disconnectFromDatabase } from '../config/database';
import { env } from '../config/env';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';
import { EmotionModel } from '../models/Emotion';
import { VerseModel } from '../models/Verse';
import { seedAyahs } from './ayahs';
import { seedEmotions } from './emotions';
import {
  buildFoundationSeedData,
  type SeedEmotionVerseMapping,
  type SeedVerse,
} from './foundation';

/**
 * MongoDB is reference-only for Quran Arabic (see
 * backend/src/quran/quranSource.ts) — arabicText/checksum are intentionally
 * excluded from what this command writes so it can never reintroduce them.
 */
export function stripVerseArabicFields(verse: SeedVerse): Omit<SeedVerse, 'arabicText' | 'checksum'> {
  const { arabicText: _arabicText, checksum: _checksum, ...verseWithoutArabic } = verse;

  return verseWithoutArabic;
}

type MigrationSummary = {
  emotions: number;
  verses: number;
  mappings: number;
};

function mappingKey(mapping: Pick<SeedEmotionVerseMapping, 'verseReferenceKey' | 'emotionKey'>) {
  return `${mapping.verseReferenceKey}|${mapping.emotionKey}`;
}

async function assertMigratedEquivalence(): Promise<MigrationSummary> {
  const { verses, mappings } = buildFoundationSeedData(seedAyahs);
  const referenceKeys = verses.map((verse) => verse.referenceKey);
  const mappingKeys = mappings.map(mappingKey);
  const failures: string[] = [];

  const [dbVerses, dbMappings, emotionCount] = await Promise.all([
    VerseModel.find({ referenceKey: { $in: referenceKeys } }).lean(),
    EmotionVerseMappingModel.find({ verseReferenceKey: { $in: referenceKeys } }).lean(),
    EmotionModel.countDocuments({ key: { $in: seedEmotions.map((emotion) => emotion.key) } }),
  ]);

  const dbVerseByReference = new Map(dbVerses.map((verse) => [verse.referenceKey, verse]));
  const dbMappingByKey = new Map(dbMappings.map((mapping) => [mappingKey(mapping), mapping]));

  verses.forEach((expected) => {
    const actual = dbVerseByReference.get(expected.referenceKey);

    if (!actual) {
      failures.push(`Missing migrated verse ${expected.referenceKey}.`);
      return;
    }

    if (
      actual.surahNumber !== expected.surahNumber ||
      actual.ayahNumber !== expected.ayahNumber ||
      actual.sourceVersion !== expected.sourceVersion
    ) {
      failures.push(`Migrated verse ${expected.referenceKey} does not match expected metadata.`);
    }
  });

  mappings.forEach((expected) => {
    const key = mappingKey(expected);
    const actual = dbMappingByKey.get(key);

    if (!actual) {
      failures.push(`Missing migrated mapping ${key}.`);
      return;
    }

    if (
      actual.status !== expected.status ||
      actual.mappingVersion !== expected.mappingVersion ||
      actual.confidence !== expected.confidence
    ) {
      failures.push(`Migrated mapping ${key} does not match expected metadata.`);
    }
  });

  if (dbVerses.length !== verses.length) {
    failures.push(`Expected ${verses.length} migrated verses, found ${dbVerses.length}.`);
  }

  if (mappingKeys.length !== mappings.length || dbMappingByKey.size !== mappings.length) {
    failures.push(`Expected ${mappings.length} migrated mappings, found ${dbMappingByKey.size}.`);
  }

  if (emotionCount !== seedEmotions.length) {
    failures.push(`Expected ${seedEmotions.length} emotions, found ${emotionCount}.`);
  }

  if (failures.length > 0) {
    throw new Error(`Foundation migration equivalence failed: ${failures.join(' ')}`);
  }

  return {
    emotions: emotionCount,
    verses: dbVerses.length,
    mappings: dbMappingByKey.size,
  };
}

export async function migrateFoundation() {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required to migrate the foundation dataset.');
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('Foundation migration is disabled when NODE_ENV=production.');
  }

  // VerseTranslation is intentionally never written here (Phase 6A.8D).
  // English translation is served exclusively from translations.sqlite (see
  // backend/src/quran/translationSource.ts); buildFoundationSeedData(...)
  // still computes a `translations` array (consumed elsewhere, e.g.
  // backend/tests/quran-data/foundation-integrity.test.ts), but this
  // migration deliberately never persists it, so a normal re-run can never
  // recreate Mongo translation storage or the pre-Gutenberg wording
  // `seedAyahs` still literally carries. See
  // backend/tests/quran-data/no-translation-reintroduction.test.ts.
  const { verses, mappings } = buildFoundationSeedData(seedAyahs);

  await connectToDatabase(env.MONGODB_URI);

  await Promise.all(
    seedEmotions.map((emotion) =>
      EmotionModel.updateOne(
        { key: emotion.key },
        { $set: emotion },
        { upsert: true, runValidators: true },
      ),
    ),
  );

  await Promise.all(
    verses.map((verse) =>
      VerseModel.updateOne(
        { referenceKey: verse.referenceKey },
        { $set: stripVerseArabicFields(verse) },
        { upsert: true, runValidators: true },
      ),
    ),
  );

  await Promise.all(
    mappings.map((mapping) =>
      EmotionVerseMappingModel.updateOne(
        { verseReferenceKey: mapping.verseReferenceKey, emotionKey: mapping.emotionKey },
        { $set: mapping },
        { upsert: true, runValidators: true },
      ),
    ),
  );

  const summary = await assertMigratedEquivalence();

  console.log(
    `Migrated foundation dataset: ${summary.emotions} emotions, ${summary.verses} verses, ${summary.mappings} mappings.`,
  );
}

if (require.main === module) {
  migrateFoundation()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown migration error.';
      console.error(`Foundation migration failed: ${message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectFromDatabase();
    });
}
