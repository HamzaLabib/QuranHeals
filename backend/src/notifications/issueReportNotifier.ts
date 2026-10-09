import { describeError } from '../monitoring/monitoring';
import type { ClaimedNotification, IssueReportNotificationStore } from '../services/IssueReportNotificationStore';
import type { EmailProvider, SendResult } from './emailProvider';
import { buildIssueReportEmail } from './issueReportEmail';

/**
 * Delivers issue-report notification emails from the MongoDB outbox (the
 * `notification` entry each report is saved with). Runs inside the API
 * process: the service is one always-on Render instance, so no separate
 * worker or queue is needed.
 *
 * Reliability:
 *  - Durable: the job is part of the saved report, so a restart loses
 *    nothing — pending jobs are picked up on the next start, and a job whose
 *    worker died mid-send becomes claimable again when its lease expires.
 *  - Exclusive: jobs are claimed atomically (store.claimNext); concurrent
 *    workers never hold the same job at once.
 *  - At-least-once, deduplicated: every attempt for a report uses the same
 *    idempotency key, and all retries finish within Resend's 24-hour key
 *    window, so a retry after an accepted-but-unrecorded send is normally
 *    deduplicated. Exactly-once is NOT guaranteed (for example if the
 *    provider accepted a send and the key window has passed). A retry sends
 *    a byte-identical request (same key, same body): the email is built
 *    only from stored report fields and fixed configuration.
 *  - "accepted" is the provider accepting the email, never proof that it
 *    reached the inbox (check the provider dashboard by providerMessageId).
 *  - Bounded: at most NOTIFICATION_MAX_ATTEMPTS attempts with the backoff
 *    below; then the job is marked failed. The report itself is never
 *    touched, whatever happens to its email.
 */

export const NOTIFICATION_MAX_ATTEMPTS = 8;
/** Wait after failed attempt n (1-based). Total ≈ 13.4 hours: well inside the 24-hour idempotency window. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 2 * 3_600_000, 4 * 3_600_000, 6 * 3_600_000] as const;
/** How long a claim is held; longer than the provider timeout, so a live send is never re-claimed. */
export const CLAIM_LEASE_MS = 2 * 60_000;
export const POLL_INTERVAL_MS = 30_000;
/** Jobs per run, so a backlog is worked through in bounded batches. */
export const MAX_JOBS_PER_RUN = 25;

export function retryDelayMs(attempts: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1];
}

export function notificationIdempotencyKey(reportId: string): string {
  return `issue-report-notification/${reportId}`;
}

/** Reported to error monitoring on a permanent failure: an error code only, never report content. */
export class IssueReportNotificationError extends Error {
  constructor(readonly code: string) {
    super(`Issue-report email notification failed permanently (${code}).`);
    this.name = 'IssueReportNotificationError';
  }
}

export type RunSummary = { accepted: number; retryScheduled: number; failed: number; lostClaims: number };

export type IssueReportNotifierDeps = {
  store: IssueReportNotificationStore;
  provider: EmailProvider;
  from: string;
  to: string;
  now?: () => Date;
  log?: (line: string) => void;
  reportFailure?: (error: Error) => void;
  pollIntervalMs?: number;
};

const LOG_PREFIX = '[issue-report-email]';

export class IssueReportNotifier {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<RunSummary> | null = null;
  private rerun = false;

  constructor(private readonly deps: IssueReportNotifierDeps) {}

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  private log(line: string): void {
    (this.deps.log ?? console.log)(`${LOG_PREFIX} ${line}`);
  }

  /** Starts polling and immediately processes whatever is due (including jobs left by a previous process). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.nudge(), this.deps.pollIntervalMs ?? POLL_INTERVAL_MS);
    this.timer.unref?.();
    this.nudge();
  }

  /** Stops polling and waits for the current run. Unfinished claims are recovered by the next process once their lease expires. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.rerun = false;
    await this.running?.catch(() => undefined);
  }

  /** Asks for a run soon (after a report is saved). Never throws and never delays the caller. */
  nudge(): void {
    void this.processDue().catch(() => undefined);
  }

  /** Processes due jobs. Runs never overlap within a process; a request during a run triggers one more run afterwards. */
  processDue(): Promise<RunSummary> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      const total: RunSummary = { accepted: 0, retryScheduled: 0, failed: 0, lostClaims: 0 };
      try {
        do {
          this.rerun = false;
          const run = await this.runBatch();
          total.accepted += run.accepted;
          total.retryScheduled += run.retryScheduled;
          total.failed += run.failed;
          total.lostClaims += run.lostClaims;
        } while (this.rerun);
      } finally {
        this.running = null;
      }
      return total;
    })();
    return this.running;
  }

  private async runBatch(): Promise<RunSummary> {
    const summary: RunSummary = { accepted: 0, retryScheduled: 0, failed: 0, lostClaims: 0 };
    for (let i = 0; i < MAX_JOBS_PER_RUN; i++) {
      let claimed: ClaimedNotification | null;
      try {
        claimed = await this.deps.store.claimNext(this.now(), CLAIM_LEASE_MS);
      } catch (error) {
        // Database unavailable: nothing is lost, the next poll tries again.
        this.log(`could not read the outbox: ${describeError(error)}`);
        return summary;
      }
      if (!claimed) return summary;
      try {
        const outcome = await this.deliver(claimed);
        summary[outcome]++;
      } catch (error) {
        // Recording the outcome failed; the lease expires and the job is retried with the same idempotency key.
        this.log(`could not record the outcome for report=${claimed.report.id}: ${describeError(error)}`);
      }
    }
    return summary;
  }

  private async deliver(claimed: ClaimedNotification): Promise<keyof RunSummary> {
    const { store } = this.deps;
    const { report, claimToken, attempts } = claimed;

    if (attempts > NOTIFICATION_MAX_ATTEMPTS) {
      // The last allowed attempt was interrupted (its lease expired); don't start another.
      return this.fail(claimed, 'max_attempts');
    }

    let result: SendResult;
    try {
      const email = buildIssueReportEmail(report);
      result = await this.deps.provider.send({ from: this.deps.from, to: this.deps.to, ...email, idempotencyKey: notificationIdempotencyKey(report.id) });
    } catch {
      result = { ok: false, retryable: true, code: 'unexpected' };
    }

    if (result.ok) {
      if (!(await store.markAccepted(report.id, claimToken, this.now(), result.providerMessageId))) return this.lostClaim(report.id);
      this.log(`accepted by ${this.deps.provider.name} report=${report.id} attempt=${attempts}${result.providerMessageId ? ` id=${result.providerMessageId}` : ''} (accepted for delivery; not proof of inbox delivery)`);
      return 'accepted';
    }
    if (result.retryable && attempts < NOTIFICATION_MAX_ATTEMPTS) {
      const nextAttemptAt = new Date(this.now().getTime() + retryDelayMs(attempts));
      if (!(await store.scheduleRetry(report.id, claimToken, nextAttemptAt, result.code))) return this.lostClaim(report.id);
      this.log(`attempt ${attempts}/${NOTIFICATION_MAX_ATTEMPTS} failed (${result.code}) report=${report.id}; retry at ${nextAttemptAt.toISOString()}`);
      return 'retryScheduled';
    }
    // Retryable but out of attempts, or permanent: attempts (stored) tells the two apart.
    return this.fail(claimed, result.code);
  }

  private async fail(claimed: ClaimedNotification, code: string): Promise<keyof RunSummary> {
    const { report, claimToken, attempts } = claimed;
    if (!(await this.deps.store.markFailed(report.id, claimToken, this.now(), code.slice(0, 40)))) return this.lostClaim(report.id);
    this.log(`FAILED permanently (${code}) report=${report.id} after ${Math.min(attempts, NOTIFICATION_MAX_ATTEMPTS)} attempt(s); the report itself is saved.`);
    try {
      this.deps.reportFailure?.(new IssueReportNotificationError(code));
    } catch {
      // Monitoring must never affect delivery.
    }
    return 'failed';
  }

  private lostClaim(reportId: string): keyof RunSummary {
    // The lease expired and another worker re-claimed the job, or the report was deleted meanwhile; its outcome stands.
    this.log(`claim no longer held for report=${reportId}; outcome left to the current holder.`);
    return 'lostClaims';
  }
}
