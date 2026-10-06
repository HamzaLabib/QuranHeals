import { createApp } from './app';
import { connectToDatabase } from './config/database';
import { env } from './config/env';

async function startServer() {
  // Validates NODE_ENV + MONGODB_URI + MONGODB_DB_NAME first (see
  // config/databaseTarget.ts): a production process never starts against
  // MongoDB's default `test` or the development database.
  const target = await connectToDatabase();
  console.log(`Connected to MongoDB: environment=${target.environment} database=${target.databaseName}`);

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`Quran Heals API listening on port ${env.PORT}`);
  });
}

startServer().catch((error) => {
  // Only the error's own message: DatabaseConfigError never includes the URI.
  console.error('Failed to start Quran Heals API.', error instanceof Error ? error.message : error);
  process.exit(1);
});
