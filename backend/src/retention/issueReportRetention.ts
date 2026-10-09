import type { AuditEntry } from '../admin/deletionAudit';
import { DAY_MS, isDue, issueReportDeadline, parseTimestamp } from './retentionPolicy';
import { NO_HOLDS, type HoldChecker } from './preservationHolds';

/**
 * Issue-report retention: 12 months from submission (docs/data-retention.md).
 *
 * Enforced by an operator-run cleanup (scripts/issueReportRetention.ts),
 * deliberately NOT a MongoDB TTL index: a TTL index would delete every
 * existing report older than the period the moment it is built, could not
 * honour preservation holds (an unresolved report kept for a dispute or
 * security investigation), and could not be dry-run first. Reports are
 * deleted by exact _id, never by a filter.
 */

export type IssueReportAge = { id: string; createdAt: Date | string | null | undefined };

export type IssueReportRetentionReport = {
  /** Reports examined (every report at least 365 days old: the only ones that can be due). */
  candidates: number;
  eligibleIds: string[];
  held: number;
  /** Older than 365 days but whose 12 calendar months have not ended yet. */
  notYetDue: number;
  /** No valid createdAt: never removed automatically. */
  undatable: number;
};

/**
 * The earliest createdAt that can never be due yet. Twelve calendar months
 * are always at least 365 days, so querying `createdAt <= now - 365 days`
 * returns a superset of the due reports; classifyIssueReports then applies
 * the exact calendar rule.
 */
export function candidateCutoff(now: Date): Date {
  return new Date(now.getTime() - 365 * DAY_MS);
}

export function classifyIssueReports(reports: IssueReportAge[], now: Date, holds: HoldChecker = NO_HOLDS): IssueReportRetentionReport {
  const report: IssueReportRetentionReport = { candidates: reports.length, eligibleIds: [], held: 0, notYetDue: 0, undatable: 0 };
  for (const { id, createdAt } of reports) {
    const created = parseTimestamp(createdAt);
    if (!created) report.undatable++;
    else if (!isDue(issueReportDeadline(created), now)) report.notYetDue++;
    else if (holds.isHeld('issue-report', id, now)) report.held++;
    else report.eligibleIds.push(id);
  }
  return report;
}

/** A monthly cleanup is due on the first working day; anything beyond this many days without a successful run is a missed run. */
export const MAX_DAYS_BETWEEN_RETENTION_RUNS = 35;

type RetentionAuditEntry = Pick<AuditEntry, 'at' | 'action' | 'result' | 'run' | 'reportIds' | 'deleted'>;

export type RetentionRunHistory = {
  lastRunAt: string | null;
  lastResult: string | null;
  lastSuccessAt: string | null;
  daysSinceLastSuccess: number | null;
  lastDeleted: number | null;
  /** Runs that recorded `issue-reports-purge-started` but never their result (crash, lost connection, closed terminal). */
  interruptedRuns: { run: string; at: string; reportIds: number }[];
  ok: boolean;
  attention: string[];
};

/**
 * Reads the issue-report retention entries of the audit log: when the last
 * run was, whether it succeeded, and whether a run was missed (no success
 * for MAX_DAYS_BETWEEN_RETENTION_RUNS days), failed, or was interrupted.
 */
export function retentionRunHistory(entries: RetentionAuditEntry[], now: Date): RetentionRunHistory {
  // `verify` entries prove permissions only: they are never a cleanup run, so they can't hide a missed or failed month.
  const runs = entries
    .filter((entry) => entry.action === 'issue-report-retention' && entry.result !== 'issue-reports-verified' && parseTimestamp(entry.at))
    .sort((a, b) => parseTimestamp(a.at)!.getTime() - parseTimestamp(b.at)!.getTime());
  const finished = new Set(runs.filter((entry) => entry.run && entry.result !== 'issue-reports-purge-started').map((entry) => entry.run));
  const interruptedRuns = runs
    .filter((entry) => entry.result === 'issue-reports-purge-started' && entry.run && !finished.has(entry.run))
    .map((entry) => ({ run: entry.run!, at: entry.at, reportIds: entry.reportIds?.length ?? 0 }));
  const outcomes = runs.filter((entry) => entry.result !== 'issue-reports-purge-started');
  const last = outcomes.at(-1);
  const lastSuccess = [...outcomes].reverse().find((entry) => entry.result === 'issue-reports-purged' || entry.result === 'issue-reports-checked');
  const daysSinceLastSuccess = lastSuccess ? Math.floor((now.getTime() - parseTimestamp(lastSuccess.at)!.getTime()) / DAY_MS) : null;

  const attention: string[] = [];
  if (!lastSuccess) attention.push('No successful cleanup run is recorded in this audit log.');
  else if (daysSinceLastSuccess! > MAX_DAYS_BETWEEN_RETENTION_RUNS) {
    attention.push(`The last successful cleanup was ${daysSinceLastSuccess} days ago (more than ${MAX_DAYS_BETWEEN_RETENTION_RUNS}): a monthly run was missed.`);
  }
  if (last && last.result !== 'issue-reports-purged' && last.result !== 'issue-reports-checked') attention.push(`The most recent run ended with ${last.result}.`);
  if (interruptedRuns.length > 0) attention.push(`${interruptedRuns.length} run(s) started deleting and never recorded a result; see "Recovery" in docs/data-retention.md.`);

  return {
    lastRunAt: last?.at ?? null,
    lastResult: last?.result ?? null,
    lastSuccessAt: lastSuccess?.at ?? null,
    daysSinceLastSuccess,
    lastDeleted: lastSuccess?.deleted?.IssueReport ?? null,
    interruptedRuns,
    ok: attention.length === 0,
    attention,
  };
}
