import { IssueReportModel } from '../models/IssueReport';
import type { IssueReportInput } from '../types/accountDto';
import type { IssueReportRepository } from './IssueReportRepository';

export class MongooseIssueReportRepository implements IssueReportRepository {
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
    });
    return { id: String(doc._id) };
  }
}
