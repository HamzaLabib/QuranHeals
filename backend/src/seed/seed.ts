import { connectToDatabase, disconnectFromDatabase } from '../config/database';
import { env } from '../config/env';
import { AyahModel } from '../models/Ayah';
import { EmotionModel } from '../models/Emotion';
import { seedAyahs } from './ayahs';
import { seedEmotions } from './emotions';
import type { SeedAyah } from './types';

/**
 * MongoDB is reference-only for Quran Arabic (see
 * backend/src/quran/quranSource.ts) — arabicText is intentionally excluded
 * from what this command writes so it can never reintroduce it.
 */
export function stripAyahArabicText<T extends Pick<SeedAyah, 'arabicText'>>(
  ayah: T,
): Omit<T, 'arabicText'> {
  const { arabicText: _arabicText, ...ayahWithoutArabicText } = ayah;

  return ayahWithoutArabicText;
}

/**
 * MongoDB is reference-only for English translation too (see
 * backend/src/quran/translationSource.ts, Phase 6A.8B-D) —
 * englishTranslation/translationSource are intentionally excluded from what
 * this command writes so normal seeding can never reintroduce Mongo
 * translation storage or the pre-Gutenberg wording `seedAyahs` still
 * literally carries for historical/foundation-split reasons (see
 * backend/src/seed/foundation.ts).
 */
export function stripLegacyTranslationFields<
  T extends Pick<SeedAyah, 'englishTranslation' | 'translationSource'>,
>(ayah: T): Omit<T, 'englishTranslation' | 'translationSource'> {
  const {
    englishTranslation: _englishTranslation,
    translationSource: _translationSource,
    ...ayahWithoutTranslation
  } = ayah;

  return ayahWithoutTranslation;
}

export async function seedDatabase() {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required to seed the database.');
  }

  await connectToDatabase(env.MONGODB_URI);

  await Promise.all(
    seedEmotions.map((emotion) =>
      EmotionModel.updateOne({ key: emotion.key }, { $set: emotion }, { upsert: true }),
    ),
  );

  await Promise.all(
    seedAyahs.map((ayah) =>
      AyahModel.updateOne(
        { referenceKey: ayah.referenceKey },
        { $set: stripLegacyTranslationFields(stripAyahArabicText(ayah)) },
        { upsert: true },
      ),
    ),
  );

  console.log(`Seeded ${seedEmotions.length} emotions and ${seedAyahs.length} ayahs.`);
}

if (require.main === module) {
  seedDatabase()
    .catch((error) => {
      console.error('Database seed failed.', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectFromDatabase();
    });
}

