import { randomUUID } from 'node:crypto';

import { Types } from 'mongoose';

import { IssueReportModel } from '../models/IssueReport';
import { ISSUE_REPORT_NOTIFICATION_STATES, type IssueReportEntity, type IssueReportNotificationStateName } from '../types/accountDomain';
import type { ClaimedNotification, IssueReportNotificationStore, NotificationStatusSummary } from './IssueReportNotificationStore';

type ReportDoc = IssueReportEntity & { _id: unknown };

/** Fields read when a job is claimed. `email` is read only to derive hasContactEmail and is never passed on. */
export const CLAIM_PROJECTION =
  '_id category comment email verseKey surahNumber ayahNumber emotionKey appLocale translationDisplayMode appVersion platform createdAt notification.attempts';

const FAILED_LIST_LIMIT = 50;

export class MongooseIssueReportNotificationStore implements IssueReportNotificationStore {
  async claimNext(now: Date, leaseMs: number): Promise<ClaimedNotification | null> {
    const claimToken = randomUUID();
    // A single findOneAndUpdate is atomic on the document: concurrent
    // workers (another process, or the old and new instance during a
    // deploy) can't both match the same due job. `$exists` restates the
    // partial index's filter so the planner can always use that index.
    const doc = await IssueReportModel.findOneAndUpdate(
      { 'notification.state': { $in: ['pending', 'sending'] }, 'notification.nextAttemptAt': { $exists: true, $lte: now } },
      {
        $set: { 'notification.state': 'sending', 'notification.nextAttemptAt': new Date(now.getTime() + leaseMs), 'notification.claimToken': claimToken },
        $inc: { 'notification.attempts': 1 },
      },
      { sort: { 'notification.nextAttemptAt': 1 }, returnDocument: 'after', projection: CLAIM_PROJECTION },
    ).lean<ReportDoc | null>();
    if (!doc) return null;
    return {
      claimToken,
      attempts: doc.notification?.attempts ?? 1,
      report: {
        id: String(doc._id),
        category: doc.category,
        comment: doc.comment,
        hasContactEmail: Boolean(doc.email),
        verseKey: doc.verseKey,
        surahNumber: doc.surahNumber,
        ayahNumber: doc.ayahNumber,
        emotionKey: doc.emotionKey,
        appLocale: doc.appLocale,
        translationDisplayMode: doc.translationDisplayMode,
        appVersion: doc.appVersion,
        platform: doc.platform,
        // Never `now`: the email must be identical on every attempt. Reports always have createdAt; the id's timestamp is a stable fallback.
        createdAt: doc.createdAt ?? new Types.ObjectId(String(doc._id)).getTimestamp(),
      },
    };
  }

  private async finish(reportId: string, claimToken: string, set: Record<string, unknown>, unset: string[]): Promise<boolean> {
    const result = await IssueReportModel.updateOne(
      { _id: reportId, 'notification.state': 'sending', 'notification.claimToken': claimToken },
      { $set: set, $unset: Object.fromEntries(unset.map((field) => [field, ''])) },
    );
    return result.modifiedCount === 1;
  }

  markAccepted(reportId: string, claimToken: string, now: Date, providerMessageId?: string): Promise<boolean> {
    const set: Record<string, unknown> = { 'notification.state': 'accepted', 'notification.acceptedAt': now };
    if (providerMessageId) set['notification.providerMessageId'] = providerMessageId;
    return this.finish(reportId, claimToken, set, [
      'notification.nextAttemptAt',
      'notification.claimToken',
      'notification.lastError',
    ]);
  }

  scheduleRetry(reportId: string, claimToken: string, nextAttemptAt: Date, errorCode: string): Promise<boolean> {
    return this.finish(
      reportId,
      claimToken,
      { 'notification.state': 'pending', 'notification.nextAttemptAt': nextAttemptAt, 'notification.lastError': errorCode },
      ['notification.claimToken'],
    );
  }

  markFailed(reportId: string, claimToken: string, now: Date, errorCode: string): Promise<boolean> {
    return this.finish(
      reportId,
      claimToken,
      { 'notification.state': 'failed', 'notification.failedAt': now, 'notification.lastError': errorCode },
      ['notification.nextAttemptAt', 'notification.claimToken'],
    );
  }

  async status(): Promise<NotificationStatusSummary> {
    const grouped = await IssueReportModel.aggregate<{ _id: IssueReportNotificationStateName; count: number }>([
      { $match: { 'notification.state': { $exists: true } } },
      { $group: { _id: '$notification.state', count: { $sum: 1 } } },
    ]);
    const counts = Object.fromEntries(ISSUE_REPORT_NOTIFICATION_STATES.map((state) => [state, 0])) as NotificationStatusSummary['counts'];
    for (const { _id, count } of grouped) if (_id in counts) counts[_id] = count;

    const oldest = await IssueReportModel.findOne({ 'notification.state': { $in: ['pending', 'sending'] } })
      .sort({ 'notification.nextAttemptAt': 1 })
      .select('notification.nextAttemptAt')
      .lean<ReportDoc | null>();
    const failed = await IssueReportModel.find({ 'notification.state': 'failed' })
      .sort({ 'notification.failedAt': -1 })
      .limit(FAILED_LIST_LIMIT)
      .select('_id notification.attempts notification.lastError notification.failedAt')
      .lean<ReportDoc[]>();

    return {
      counts,
      oldestActiveDueAt: oldest?.notification?.nextAttemptAt ?? null,
      failed: failed.map((doc) => ({ id: String(doc._id), attempts: doc.notification?.attempts, lastError: doc.notification?.lastError, failedAt: doc.notification?.failedAt })),
    };
  }
}
