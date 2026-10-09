import { IssueReportModel } from '../models/IssueReport';
import type { IssueReportAge } from '../retention/issueReportRetention';

export interface IssueReportRetentionStore {
  countAll(): Promise<number>;
  /** Reports with createdAt <= cutoff, plus any without a createdAt. Reads _id and createdAt only — never the comment or email. */
  findCandidates(cutoff: Date): Promise<IssueReportAge[]>;
  /**
   * Deletes exactly these ids (never an open filter), and only those whose
   * createdAt is also <= `notAfter` — a database-side backstop, so even a
   * wrong id list can never remove a report younger than the cutoff. A
   * report's embedded email-notification entry is part of the document and
   * goes with it. Returns the number deleted.
   */
  deleteByIds(ids: string[], notAfter: Date): Promise<number>;
  /** Which of these ids still exist (to verify a deletion independently of its reported count). */
  existingIds(ids: string[]): Promise<string[]>;
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

  async deleteByIds(ids: string[], notAfter: Date): Promise<number> {
    let deleted = 0;
    for (let i = 0; i < ids.length; i += DELETE_BATCH) {
      const result = await IssueReportModel.deleteMany({ _id: { $in: ids.slice(i, i + DELETE_BATCH) }, createdAt: { $lte: notAfter } });
      deleted += result.deletedCount;
    }
    return deleted;
  }

  async existingIds(ids: string[]): Promise<string[]> {
    const found: string[] = [];
    for (let i = 0; i < ids.length; i += DELETE_BATCH) {
      const docs = await IssueReportModel.find({ _id: { $in: ids.slice(i, i + DELETE_BATCH) } }).select('_id').lean<{ _id: unknown }[]>();
      found.push(...docs.map((doc) => String(doc._id)));
    }
    return found;
  }
}
