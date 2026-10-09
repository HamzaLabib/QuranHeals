import { randomUUID } from 'node:crypto';

import type { EmailProvider, OutgoingEmail, SendResult } from '../../src/notifications/emailProvider';
import type { IssueReportRepository } from '../../src/services/IssueReportRepository';
import type { ClaimedNotification, IssueReportNotificationStore, NotificationStatusSummary } from '../../src/services/IssueReportNotificationStore';
import type { IssueReportNotificationState } from '../../src/types/accountDomain';
import type { IssueReportInput } from '../../src/types/accountDto';

type StoredReport = IssueReportInput & { id: string; createdAt: Date; notification?: IssueReportNotificationState };

/**
 * One in-memory "database" that is both the issue-report repository (with
 * the outbox job written in the same insert, like MongooseIssueReportRepository
 * with queueNotification) and the notification store. claimNext does its
 * whole read-modify-write before its first await, so — like a MongoDB
 * findOneAndUpdate — two concurrent callers can never claim the same job.
 * Survives "restarts": tests build new notifiers over the same instance.
 */
export class InMemoryOutbox implements IssueReportRepository, IssueReportNotificationStore {
  readonly reports = new Map<string, StoredReport>();
  claims = 0;

  constructor(private readonly options: { queueNotification?: boolean; now?: () => Date; failCreate?: boolean } = {}) {}

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  async create(input: IssueReportInput): Promise<{ id: string }> {
    if (this.options.failCreate) throw new Error('Mongo write failed');
    const id = randomUUID().replace(/-/g, '').slice(0, 24);
    const createdAt = this.now();
    this.reports.set(id, {
      ...input,
      id,
      createdAt,
      ...(this.options.queueNotification === false ? {} : { notification: { state: 'pending', attempts: 0, nextAttemptAt: createdAt } }),
    });
    return { id };
  }

  async claimNext(now: Date, leaseMs: number): Promise<ClaimedNotification | null> {
    const due = [...this.reports.values()]
      .filter((r) => r.notification && (r.notification.state === 'pending' || r.notification.state === 'sending') && r.notification.nextAttemptAt! <= now)
      .sort((a, b) => a.notification!.nextAttemptAt!.getTime() - b.notification!.nextAttemptAt!.getTime());
    const report = due[0];
    if (!report) return null;
    this.claims++;
    const claimToken = randomUUID();
    const n = report.notification!;
    n.state = 'sending';
    n.attempts += 1;
    n.nextAttemptAt = new Date(now.getTime() + leaseMs);
    n.claimToken = claimToken;
    return {
      claimToken,
      attempts: n.attempts,
      report: {
        id: report.id,
        category: report.category,
        comment: report.comment,
        hasContactEmail: Boolean(report.email),
        verseKey: report.verseKey,
        surahNumber: report.surahNumber,
        ayahNumber: report.ayahNumber,
        emotionKey: report.emotionKey,
        appLocale: report.appLocale,
        translationDisplayMode: report.translationDisplayMode,
        appVersion: report.appVersion,
        platform: report.platform,
        createdAt: report.createdAt,
      },
    };
  }

  private held(reportId: string, claimToken: string): IssueReportNotificationState | null {
    const n = this.reports.get(reportId)?.notification;
    return n && n.state === 'sending' && n.claimToken === claimToken ? n : null;
  }

  async markAccepted(reportId: string, claimToken: string, now: Date, providerMessageId?: string): Promise<boolean> {
    const n = this.held(reportId, claimToken);
    if (!n) return false;
    Object.assign(n, { state: 'accepted', acceptedAt: now, providerMessageId, nextAttemptAt: undefined, claimToken: undefined, lastError: undefined });
    return true;
  }

  async scheduleRetry(reportId: string, claimToken: string, nextAttemptAt: Date, errorCode: string): Promise<boolean> {
    const n = this.held(reportId, claimToken);
    if (!n) return false;
    Object.assign(n, { state: 'pending', nextAttemptAt, lastError: errorCode, claimToken: undefined });
    return true;
  }

  async markFailed(reportId: string, claimToken: string, now: Date, errorCode: string): Promise<boolean> {
    const n = this.held(reportId, claimToken);
    if (!n) return false;
    Object.assign(n, { state: 'failed', failedAt: now, lastError: errorCode, nextAttemptAt: undefined, claimToken: undefined });
    return true;
  }

  async status(): Promise<NotificationStatusSummary> {
    const counts = { pending: 0, sending: 0, accepted: 0, failed: 0 };
    let oldest: Date | null = null;
    const failed: NotificationStatusSummary['failed'] = [];
    for (const r of this.reports.values()) {
      const n = r.notification;
      if (!n) continue;
      counts[n.state]++;
      if ((n.state === 'pending' || n.state === 'sending') && (!oldest || n.nextAttemptAt! < oldest)) oldest = n.nextAttemptAt!;
      if (n.state === 'failed') failed.push({ id: r.id, attempts: n.attempts, lastError: n.lastError, failedAt: n.failedAt });
    }
    return { counts, oldestActiveDueAt: oldest, failed };
  }

  only(): StoredReport {
    const [report, ...rest] = [...this.reports.values()];
    if (!report || rest.length > 0) throw new Error(`expected exactly one report, found ${this.reports.size}`);
    return report;
  }
}

/** Records every send; answers from a script of results (default: success). Never touches the network. */
export class FakeEmailProvider implements EmailProvider {
  readonly name = 'fake';
  readonly sent: OutgoingEmail[] = [];
  private readonly script: SendResult[];

  constructor(script: SendResult[] = [], private readonly delayMs = 0) {
    this.script = [...script];
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.sent.push(email);
    return this.script.shift() ?? { ok: true };
  }
}

/** A controllable clock. */
export function testClock(start = '2026-10-09T12:00:00.000Z') {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}
