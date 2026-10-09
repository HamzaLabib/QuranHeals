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
    const doc = await IssueReportModel.create({
      category: input.category,
      comment: input.comment,
      email: input.email,
      verseKey: input.verseKey,
      surahNumber: input.surahNumber,
      ayahNumber: input.ayahNumber,
      emotionKey: input.emotionKey,
      appLocale: input.appLocale,
      translationDisplayMode: input.translationDisplayMode,
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
