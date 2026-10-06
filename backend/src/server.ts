import { createApp } from './app';
import { connectToDatabase } from './config/database';
import { env } from './config/env';
import { describeError, flushMonitoring, initMonitoring, reportError } from './monitoring/monitoring';

// First, so startup failures and uncaught errors are reported too. A no-op
// without SENTRY_DSN; never throws.
const monitoring = initMonitoring({
  dsn: env.SENTRY_DSN,
  environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
  release: env.SENTRY_RELEASE ?? env.RENDER_GIT_COMMIT,
});

async function startServer() {
  console.log(`Error monitoring: ${monitoring ? 'enabled' : 'disabled'}`);

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

startServer().catch(async (error) => {
  // Only a scrubbed message: DatabaseConfigError never includes the URI.
  console.error('Failed to start Quran Heals API.', describeError(error));
  reportError(error);
  await flushMonitoring();
  process.exit(1);
});
