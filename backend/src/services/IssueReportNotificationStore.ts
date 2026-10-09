import type { IssueReportCategory, IssueReportNotificationStateName } from '../types/accountDomain';

/** The report fields an email notification may use. Deliberately no contact email: only whether one was given. */
export type NotifiableIssueReport = {
  id: string;
  category: IssueReportCategory;
  comment?: string;
  hasContactEmail: boolean;
  verseKey?: string;
  surahNumber?: number;
  ayahNumber?: number;
  emotionKey?: string;
  appLocale?: string;
  translationDisplayMode?: string;
  appVersion?: string;
  platform?: string;
  /** Always the stored submission time, so every attempt's email (and provider payload) is identical. */
  createdAt: Date;
};

export type ClaimedNotification = {
  report: NotifiableIssueReport;
  claimToken: string;
  /** Including the attempt this claim represents. */
  attempts: number;
};

export type NotificationStatusSummary = {
  counts: Record<IssueReportNotificationStateName, number>;
  /** When the oldest still-active (pending/sending) job is next due; null when there is none. */
  oldestActiveDueAt: Date | null;
  /** Ids (and error codes) of reports whose notification failed permanently. Never any content. */
  failed: { id: string; attempts?: number; lastError?: string; failedAt?: Date }[];
};

/**
 * The durable notification outbox. Every state change after a claim is
 * conditional on the claim token, so a worker whose lease expired (and whose
 * job was re-claimed elsewhere) can never overwrite the newer outcome.
 */
export interface IssueReportNotificationStore {
  /**
   * Atomically claims the earliest due job — a pending job whose
   * nextAttemptAt has passed, or a sending job whose lease expired (its
   * worker crashed or restarted) — counts the attempt, and leases it until
   * now + leaseMs. Two workers can never hold the same job at once.
   */
  claimNext(now: Date, leaseMs: number): Promise<ClaimedNotification | null>;
  /** The provider accepted the email (not proof of inbox delivery). */
  markAccepted(reportId: string, claimToken: string, now: Date, providerMessageId?: string): Promise<boolean>;
  scheduleRetry(reportId: string, claimToken: string, nextAttemptAt: Date, errorCode: string): Promise<boolean>;
  markFailed(reportId: string, claimToken: string, now: Date, errorCode: string): Promise<boolean>;
  status(): Promise<NotificationStatusSummary>;
}
