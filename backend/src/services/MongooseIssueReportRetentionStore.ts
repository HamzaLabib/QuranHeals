import { IssueReportModel } from '../models/IssueReport';
import type { IssueReportAge } from '../retention/issueReportRetention';

export interface IssueReportRetentionStore {
  countAll(): Promise<number>;
  /** Reports with createdAt <= cutoff, plus any without a createdAt. Reads _id and createdAt only — never the comment or email. */
  findCandidates(cutoff: Date): Promise<IssueReportAge[]>;
  /** Deletes exactly these ids (never a filter). Returns the number deleted. */
  deleteByIds(ids: string[]): Promise<number>;
}

const DELETE_BATCH = 500;

export class MongooseIssueReportRetentionStore implements IssueReportRetentionStore {
  async countAll(): Promise<number> {
    return IssueReportModel.countDocuments({});
  }

  async findCandidates(cutoff: Date): Promise<IssueReportAge[]> {
    const docs = await IssueReportModel.find({ $or: [{ createdAt: { $lte: cutoff } }, { createdAt: { $exists: false } }] })
      .select('_id createdAt')
      .lean<{ _id: unknown; createdAt?: Date }[]>();
    return docs.map((doc) => ({ id: String(doc._id), createdAt: doc.createdAt ?? null }));
  }

  async deleteByIds(ids: string[]): Promise<number> {
    let deleted = 0;
    for (let i = 0; i < ids.length; i += DELETE_BATCH) {
      const result = await IssueReportModel.deleteMany({ _id: { $in: ids.slice(i, i + DELETE_BATCH) } });
      deleted += result.deletedCount;
    }
    return deleted;
  }
}
