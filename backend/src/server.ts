import { createApp } from './app';
import { connectToDatabase } from './config/database';
import { env } from './config/env';

async function startServer() {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required to start the backend.');
  }

  await connectToDatabase(env.MONGODB_URI);

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`Quran Heals API listening on port ${env.PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start Quran Heals API.', error);
  process.exit(1);
});

