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
