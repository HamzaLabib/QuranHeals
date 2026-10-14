import { IssueReportModel } from '../models/IssueReport';
import type { IssueReportInput } from '../types/accountDto';
import type { IssueReportRepository } from './IssueReportRepository';

export type MongooseIssueReportRepositoryOptions = {
  /**
   * Record an email-notification job with each report (ISSUE_REPORT_EMAIL
   * not `off`). The job is part of the same single-document insert, so a
   * saved report always has its job and a failed save never leaves one.
   */
  queueNotification?: boolean;
  now?: () => Date;
};

export class MongooseIssueReportRepository implements IssueReportRepository {
  constructor(private readonly options: MongooseIssueReportRepositoryOptions = {}) {}

  async create(input: IssueReportInput): Promise<{ id: string }> {
    // Feedback never carries a category or ayah context (the validator drops them); listed per type so nothing else is ever written.
    const content = input.type === 'feedback'
      ? { type: 'feedback' as const, comment: input.comment, source: input.source }
      : {
          type: 'issue' as const,
          category: input.category,
          comment: input.comment,
          source: input.source,
          verseKey: input.verseKey,
          surahNumber: input.surahNumber,
          ayahNumber: input.ayahNumber,
          translationDisplayMode: input.translationDisplayMode,
        };
    const doc = await IssueReportModel.create({
      ...content,
      email: input.email,
      appLocale: input.appLocale,
      appVersion: input.appVersion,
      platform: input.platform,
      status: 'new',
      ...(this.options.queueNotification
        ? { notification: { state: 'pending', attempts: 0, nextAttemptAt: (this.options.now ?? (() => new Date()))() } }
        : {}),
    });
    return { id: String(doc._id) };
  }
}
