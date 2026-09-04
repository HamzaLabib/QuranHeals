import { connectToDatabase, disconnectFromDatabase } from '../config/database';
import { env } from '../config/env';
import { AyahModel } from '../models/Ayah';
import { EmotionModel } from '../models/Emotion';
import { seedAyahs } from './ayahs';
import { seedEmotions } from './emotions';

async function seedDatabase() {
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
      AyahModel.updateOne({ referenceKey: ayah.referenceKey }, { $set: ayah }, { upsert: true }),
    ),
  );

  console.log(`Seeded ${seedEmotions.length} emotions and ${seedAyahs.length} ayahs.`);
}

seedDatabase()
  .catch((error) => {
    console.error('Database seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectFromDatabase();
  });

