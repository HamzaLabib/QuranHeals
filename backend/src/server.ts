import { createApp } from './app';
import { readAppLinksConfig } from './appLinks/appLinks';
import { createDefaultMushafSync, resolveMushafSyncDir } from './mushaf/offline/setup';
import { readQfCredentials } from './quranFoundation/qfContentClient';
import { assertAuthConfig } from './config/authConfig';
import { connectToDatabase } from './config/database';
import { env } from './config/env';
import { resolveIssueReportEmailConfig } from './config/issueReportEmailConfig';
import { createIssueReportNotifier } from './notifications/setup';
import { MongooseIssueReportRepository } from './services/MongooseIssueReportRepository';
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

  // Production refuses to start with incomplete Google/Apple sign-in config
  // (config/authConfig.ts); messages name variables only.
  if (env.NODE_ENV === 'production') assertAuthConfig(env, { production: true });

  // Off unless ISSUE_REPORT_EMAIL is set; an enabled but incomplete setup
  // stops startup (messages name variables only).
  const issueReportEmail = resolveIssueReportEmailConfig(env, { production: env.NODE_ENV === 'production' });
  console.log(`Issue-report email: ${issueReportEmail.mode}`);

  // Optional; a malformed value is left out (never served) and named here.
  const appLinks = readAppLinksConfig(env);
  for (const problem of appLinks.problems) console.warn(`Ayah links: ${problem}`);
  const quranFoundation = readQfCredentials(env);
  for (const problem of quranFoundation.problems) console.warn(`Quran Foundation: ${problem}`);
  console.log(`Quran Foundation content: ${quranFoundation.credentials ? `configured (${quranFoundation.credentials.environment})` : 'not configured'}`);
  console.log(`Ayah links: iOS ${appLinks.config.appleTeamId ? 'verified' : 'not configured'}, Android ${appLinks.config.androidSha256Fingerprints.length > 0 ? 'verified' : 'not configured'}, App Store ${appLinks.config.appStoreUrl ? 'set' : 'not set'}, Google Play ${appLinks.config.playStoreUrl ? 'set' : 'not set'}`);

  // Validates NODE_ENV + MONGODB_URI + MONGODB_DB_NAME first (see
  // config/databaseTarget.ts): a production process never starts against
  // MongoDB's default `test` or the development database.
  const target = await connectToDatabase();
  console.log(`Connected to MongoDB: environment=${target.environment} database=${target.databaseName}`);

  const notifier = createIssueReportNotifier(issueReportEmail, { reportFailure: (error) => reportError(error) });
  const app = createApp({
    issueReportRepository: new MongooseIssueReportRepository({ queueNotification: notifier !== null }),
    onIssueReportSaved: notifier ? () => notifier.nudge() : undefined,
  });
  app.listen(env.PORT, () => {
    console.log(`Quran Heals API listening on port ${env.PORT}`);
    // Also delivers anything left pending by a previous process.
    notifier?.start();
    // Offline QPC V1 Mushaf: keep the mushafs:2 Content Sync copy current (opt-in).
    if (env.MUSHAF_SYNC_ENABLED === 'true' && quranFoundation.credentials) {
      createDefaultMushafSync(quranFoundation.credentials, resolveMushafSyncDir(env)).start();
      console.log('Offline Mushaf sync: enabled (at least daily)');
    } else {
      console.log(`Offline Mushaf sync: ${env.MUSHAF_SYNC_ENABLED === 'true' ? 'needs Quran Foundation credentials' : 'off'}`);
    }
  });
}

startServer().catch(async (error) => {
  // Only a scrubbed message: DatabaseConfigError never includes the URI.
  console.error('Failed to start Quran Heals API.', describeError(error));
  reportError(error);
  await flushMonitoring();
  process.exit(1);
});
