import { createApp } from './app';
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
  });
}

startServer().catch(async (error) => {
  // Only a scrubbed message: DatabaseConfigError never includes the URI.
  console.error('Failed to start Quran Heals API.', describeError(error));
  reportError(error);
  await flushMonitoring();
  process.exit(1);
});
