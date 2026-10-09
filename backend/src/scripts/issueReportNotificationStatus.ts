/**
 * Read-only status of issue-report email notifications
 * (`npm run issue-reports:notifications`; docs/backend-operations.md).
 *
 * Prints counts per state (pending, sending, accepted, failed), when the oldest
 * active job is due, and the ids + error codes of permanently failed
 * notifications. Never prints a description, an email address or any other
 * report content. Production uses the read-only profile, like the retention
 * preflight.
 *
 * `accepted` = Resend accepted the email for delivery. It is not proof of
 * inbox delivery: check the Resend dashboard (Emails) or the inbox.
 */
import { connectScriptDatabase, disconnectFromDatabase, getDatabaseTarget } from '../config/database';
import { DatabaseConfigError, type DatabaseTarget } from '../config/databaseTarget';
import { describeError } from '../monitoring/monitoring';
import type { IssueReportNotificationStore } from '../services/IssueReportNotificationStore';
import { MongooseIssueReportNotificationStore } from '../services/MongooseIssueReportNotificationStore';

export const SCRIPT_NAME = 'issue-reports:notifications';

/** Same rule as the other production tools: a production run loads an env profile (prod-read.env) and never backend/.env. */
export function assertStatusEnvironment(target: Pick<DatabaseTarget, 'environment'>, environment: Record<string, string | undefined> = process.env): void {
  if (target.environment === 'production' && environment.QURAN_HEALS_SKIP_DOTENV !== '1') {
    throw new DatabaseConfigError(`${SCRIPT_NAME}: production runs must load an env profile that sets QURAN_HEALS_SKIP_DOTENV=1 (the read-only profile). Nothing was read.`);
  }
}

export async function notificationStatusReport(store: IssueReportNotificationStore, now: Date) {
  const status = await store.status();
  const oldest = status.oldestActiveDueAt;
  return {
    asOf: now.toISOString(),
    ...status.counts,
    // A pending job due more than a few minutes ago means the worker isn't running or the provider keeps failing.
    oldestActiveDueAt: oldest?.toISOString() ?? null,
    oldestActiveOverdueMinutes: oldest ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 60_000)) : null,
    failedReports: status.failed.map((entry) => ({ id: entry.id, attempts: entry.attempts ?? null, lastError: entry.lastError ?? null, failedAt: entry.failedAt?.toISOString() ?? null })),
  };
}

if (require.main === module) {
  (async () => {
    assertStatusEnvironment(getDatabaseTarget());
    await connectScriptDatabase({ script: SCRIPT_NAME, writes: false, productionSupported: true, enforceCredentialScope: true }, { autoIndex: false, autoCreate: false });
    try {
      console.log(JSON.stringify(await notificationStatusReport(new MongooseIssueReportNotificationStore(), new Date()), null, 2));
    } finally {
      await disconnectFromDatabase();
    }
  })().catch((error) => {
    console.error(`${SCRIPT_NAME} failed: ${describeError(error)}`);
    process.exitCode = 1;
  });
}
