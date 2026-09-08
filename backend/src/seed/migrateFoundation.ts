import { connectToDatabase, disconnectFromDatabase } from '../config/database';
import { env } from '../config/env';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';
import { EmotionModel } from '../models/Emotion';
import { VerseModel } from '../models/Verse';
import { VerseTranslationModel } from '../models/VerseTranslation';
import { seedAyahs } from './ayahs';
import { seedEmotions } from './emotions';
import { buildFoundationSeedData, type SeedEmotionVerseMapping, type SeedVerseTranslation } from './foundation';

type MigrationSummary = {
  emotions: number;
  verses: number;
  translations: number;
  mappings: number;
};

function translationKey(translation: Pick<SeedVerseTranslation, 'verseReferenceKey' | 'language' | 'translator' | 'sourceVersion'>) {
  return [
    translation.verseReferenceKey,
    translation.language,
    translation.translator,
    translation.sourceVersion,
  ].join('|');
}

function mappingKey(mapping: Pick<SeedEmotionVerseMapping, 'verseReferenceKey' | 'emotionKey'>) {
  return `${mapping.verseReferenceKey}|${mapping.emotionKey}`;
}

async function assertMigratedEquivalence(): Promise<MigrationSummary> {
  const { verses, translations, mappings } = buildFoundationSeedData(seedAyahs);
  const referenceKeys = verses.map((verse) => verse.referenceKey);
  const translationKeys = translations.map(translationKey);
  const mappingKeys = mappings.map(mappingKey);
  const failures: string[] = [];

  const [dbVerses, dbTranslations, dbMappings, emotionCount] = await Promise.all([
    VerseModel.find({ referenceKey: { $in: referenceKeys } }).lean(),
    VerseTranslationModel.find({ verseReferenceKey: { $in: referenceKeys } }).lean(),
    EmotionVerseMappingModel.find({ verseReferenceKey: { $in: referenceKeys } }).lean(),
    EmotionModel.countDocuments({ key: { $in: seedEmotions.map((emotion) => emotion.key) } }),
  ]);

  const dbVerseByReference = new Map(dbVerses.map((verse) => [verse.referenceKey, verse]));
  const dbTranslationByKey = new Map(dbTranslations.map((translation) => [translationKey(translation), translation]));
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
      actual.checksum !== expected.checksum ||
      actual.sourceVersion !== expected.sourceVersion
    ) {
      failures.push(`Migrated verse ${expected.referenceKey} does not match expected metadata.`);
    }
  });

  translations.forEach((expected) => {
    const key = translationKey(expected);
    const actual = dbTranslationByKey.get(key);

    if (!actual) {
      failures.push(`Missing migrated translation ${key}.`);
      return;
    }

    if (actual.checksum !== expected.checksum || actual.source !== expected.source) {
      failures.push(`Migrated translation ${key} does not match expected metadata.`);
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

  if (translationKeys.length !== translations.length || dbTranslationByKey.size !== translations.length) {
    failures.push(`Expected ${translations.length} migrated translations, found ${dbTranslationByKey.size}.`);
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
    translations: dbTranslationByKey.size,
    mappings: dbMappingByKey.size,
  };
}

async function assertNoChecksumConflicts() {
  const { verses, translations } = buildFoundationSeedData(seedAyahs);
  const referenceKeys = verses.map((verse) => verse.referenceKey);
  const translationFilters = translations.map((translation) => ({
    verseReferenceKey: translation.verseReferenceKey,
    language: translation.language,
    translator: translation.translator,
    sourceVersion: translation.sourceVersion,
  }));
  const [existingVerses, existingTranslations] = await Promise.all([
    VerseModel.find({ referenceKey: { $in: referenceKeys } }).lean(),
    VerseTranslationModel.find({ $or: translationFilters }).lean(),
  ]);
  const expectedVerseByReference = new Map(
    verses.map((verse) => [verse.referenceKey, verse]),
  );
  const expectedTranslationByKey = new Map(
    translations.map((translation) => [translationKey(translation), translation]),
  );
  const failures: string[] = [];

  existingVerses.forEach((actual) => {
    const expected = expectedVerseByReference.get(actual.referenceKey);

    if (expected && actual.checksum !== expected.checksum) {
      failures.push(`Canonical verse checksum conflict for ${actual.referenceKey}.`);
    }
  });

  existingTranslations.forEach((actual) => {
    const key = translationKey(actual);
    const expected = expectedTranslationByKey.get(key);

    if (expected && actual.checksum !== expected.checksum) {
      failures.push(`Translation checksum conflict for ${key}.`);
    }
  });

  if (failures.length > 0) {
    throw new Error(
      `Foundation migration refused to overwrite conflicting text: ${failures.join(' ')}`,
    );
  }
}

async function migrateFoundation() {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required to migrate the foundation dataset.');
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('Foundation migration is disabled when NODE_ENV=production.');
  }

  const { verses, translations, mappings } = buildFoundationSeedData(seedAyahs);

  await connectToDatabase(env.MONGODB_URI);
  await assertNoChecksumConflicts();

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
        { $set: verse },
        { upsert: true, runValidators: true },
      ),
    ),
  );

  await Promise.all(
    translations.map((translation) =>
      VerseTranslationModel.updateOne(
        {
          verseReferenceKey: translation.verseReferenceKey,
          language: translation.language,
          translator: translation.translator,
          sourceVersion: translation.sourceVersion,
        },
        { $set: translation },
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
    `Migrated foundation dataset: ${summary.emotions} emotions, ${summary.verses} verses, ${summary.translations} translations, ${summary.mappings} mappings.`,
  );
}

migrateFoundation()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown migration error.';
    console.error(`Foundation migration failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectFromDatabase();
  });
