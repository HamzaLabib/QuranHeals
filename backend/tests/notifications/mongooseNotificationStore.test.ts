import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IssueReportModel } from '../../src/models/IssueReport';
import { ISSUE_REPORT_RETENTION_MONTHS, issueReportDeadline } from '../../src/retention/retentionPolicy';
import { assertStatusEnvironment } from '../../src/scripts/issueReportNotificationStatus';
import { ISSUE_REPORT_RETENTION_PRODUCTION_ENABLED, runIssueReportRetention } from '../../src/scripts/issueReportRetention';
import { MongooseIssueReportNotificationStore } from '../../src/services/MongooseIssueReportNotificationStore';
import { MongooseIssueReportRepository } from '../../src/services/MongooseIssueReportRepository';
import { MongooseIssueReportRetentionStore } from '../../src/services/MongooseIssueReportRetentionStore';

/**
 * No database: the model is stubbed to capture what would be sent to
 * MongoDB, so the atomicity-critical query shapes are pinned.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const input = { category: 'other' as const, comment: 'hello', email: 'reporter@example.com' };
const NOW = new Date('2026-10-09T12:00:00.000Z');

function captureCreate() {
  const created: Record<string, unknown>[] = [];
  vi.spyOn(IssueReportModel, 'create').mockImplementation((async (doc: Record<string, unknown>) => {
    created.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  }) as never);
  return created;
}

describe('MongooseIssueReportRepository', () => {
  it('with notifications on, writes the pending job in the same single insert as the report', async () => {
    const created = captureCreate();
    await new MongooseIssueReportRepository({ queueNotification: true, now: () => NOW }).create(input);
    expect(IssueReportModel.create).toHaveBeenCalledTimes(1);
    expect(created[0]).toMatchObject({ category: 'other', comment: 'hello', status: 'new', notification: { state: 'pending', attempts: 0, nextAttemptAt: NOW } });
  });

  it('with notifications off (the default), saves exactly what it saved before — no notification field', async () => {
    const created = captureCreate();
    await new MongooseIssueReportRepository().create(input);
    expect(created[0]).not.toHaveProperty('notification');
  });
});

describe('IssueReport schema', () => {
  it('keeps the createdAt index and adds one partial index for due jobs only', () => {
    const indexes = IssueReportModel.schema.indexes();
    expect(indexes).toContainEqual([{ createdAt: -1 }, expect.anything()]);
    expect(indexes).toContainEqual([
      { 'notification.nextAttemptAt': 1 },
      expect.objectContaining({ partialFilterExpression: { 'notification.nextAttemptAt': { $exists: true } } }),
    ]);
  });

  it('stores no content in the notification entry, and existing documents stay valid without one', async () => {
    const notification = IssueReportModel.schema.path('notification') as unknown as { schema: mongoose.Schema };
    expect(Object.keys(notification.schema.paths).sort()).toEqual(['acceptedAt', 'attempts', 'claimToken', 'failedAt', 'lastError', 'nextAttemptAt', 'providerMessageId', 'state']);
    const legacy = new IssueReportModel({ category: 'other', comment: 'x' });
    await expect(legacy.validate()).resolves.toBeUndefined();
    expect(legacy.toObject()).not.toHaveProperty('notification');
  });
});

describe('MongooseIssueReportNotificationStore', () => {
  it('claims atomically with one findOneAndUpdate: only due pending jobs or expired leases, earliest first, counting the attempt', async () => {
    const id = new mongoose.Types.ObjectId();
    let call: { filter: unknown; update: Record<string, Record<string, unknown>>; options: Record<string, unknown> } | undefined;
    vi.spyOn(IssueReportModel, 'findOneAndUpdate').mockImplementation(((filter: unknown, update: never, options: never) => {
      call = { filter, update, options };
      return { lean: async () => ({ _id: id, category: 'other', comment: 'c', email: 'reporter@example.com', createdAt: NOW, notification: { attempts: 3 } }) };
    }) as never);

    const claimed = await new MongooseIssueReportNotificationStore().claimNext(NOW, 120_000);

    expect(call!.filter).toEqual({ 'notification.state': { $in: ['pending', 'sending'] }, 'notification.nextAttemptAt': { $exists: true, $lte: NOW } });
    expect(call!.update.$set).toEqual({
      'notification.state': 'sending',
      'notification.nextAttemptAt': new Date(NOW.getTime() + 120_000),
      'notification.claimToken': claimed!.claimToken,
    });
    expect(call!.update.$inc).toEqual({ 'notification.attempts': 1 });
    expect(call!.options).toMatchObject({ sort: { 'notification.nextAttemptAt': 1 }, returnDocument: 'after' });
    expect(call!.options).not.toHaveProperty('new');
    expect(claimed).toMatchObject({ attempts: 3, report: { id: String(id), hasContactEmail: true } });
    // The address itself is reduced to a boolean and never passed on.
    expect(JSON.stringify(claimed)).not.toContain('reporter@example.com');
  });

  it('the submission time in the email never depends on the attempt: a missing createdAt falls back to the id timestamp, not "now"', async () => {
    const id = new mongoose.Types.ObjectId();
    vi.spyOn(IssueReportModel, 'findOneAndUpdate').mockImplementation((() => ({
      lean: async () => ({ _id: id, category: 'other', notification: { attempts: 1 } }),
    })) as never);
    const store = new MongooseIssueReportNotificationStore();

    const first = await store.claimNext(NOW, 120_000);
    const second = await store.claimNext(new Date(NOW.getTime() + 3_600_000), 120_000);

    expect(first!.report.createdAt).toEqual(id.getTimestamp());
    expect(second!.report.createdAt).toEqual(first!.report.createdAt);
  });

  it('every outcome write is conditional on the current claim token, so a stale worker cannot overwrite it', async () => {
    const calls: { filter: unknown; update: Record<string, Record<string, unknown>> }[] = [];
    vi.spyOn(IssueReportModel, 'updateOne').mockImplementation((async (filter: unknown, update: never) => {
      calls.push({ filter, update });
      return { modifiedCount: 0 };
    }) as never);
    const store = new MongooseIssueReportNotificationStore();
    const id = new mongoose.Types.ObjectId().toString();

    expect(await store.markAccepted(id, 'token', NOW, 're_msg_123')).toBe(false);
    await store.scheduleRetry(id, 'token', NOW, 'http_503');
    await store.markFailed(id, 'token', NOW, 'http_422');

    for (const { filter } of calls) expect(filter).toEqual({ _id: id, 'notification.state': 'sending', 'notification.claimToken': 'token' });
    expect(calls[0].update.$set).toEqual({ 'notification.state': 'accepted', 'notification.acceptedAt': NOW, 'notification.providerMessageId': 're_msg_123' });
    expect(Object.keys(calls[0].update.$unset)).toEqual(['notification.nextAttemptAt', 'notification.claimToken', 'notification.lastError']);
    expect(calls[1].update.$set).toEqual({ 'notification.state': 'pending', 'notification.nextAttemptAt': NOW, 'notification.lastError': 'http_503' });
    expect(calls[2].update.$set).toEqual({ 'notification.state': 'failed', 'notification.failedAt': NOW, 'notification.lastError': 'http_422' });
    expect(Object.keys(calls[2].update.$unset)).toContain('notification.nextAttemptAt');
  });
});

describe('status command', () => {
  it('refuses a production run that could read backend/.env; development needs no profile', () => {
    expect(() => assertStatusEnvironment({ environment: 'production' }, {})).toThrow(/QURAN_HEALS_SKIP_DOTENV=1/);
    expect(() => assertStatusEnvironment({ environment: 'production' }, { QURAN_HEALS_SKIP_DOTENV: '1' })).not.toThrow();
    expect(() => assertStatusEnvironment({ environment: 'development' }, {})).not.toThrow();
  });
});

describe('12-month retention is unchanged', () => {
  it('still 12 calendar months from submission, and still disabled for production in code', () => {
    expect(ISSUE_REPORT_RETENTION_MONTHS).toBe(12);
    expect(issueReportDeadline(new Date('2026-10-09T14:32:05.000Z')).toISOString()).toBe('2027-10-09T14:32:05.000Z');
    expect(ISSUE_REPORT_RETENTION_PRODUCTION_ENABLED).toBe(false);
  });

  it('the retention cleanup still reads only _id and createdAt — never notification state or content', async () => {
    let selected: string | undefined;
    vi.spyOn(IssueReportModel, 'find').mockImplementation((() => ({
      select: (fields: string) => {
        selected = fields;
        return { lean: async () => [] };
      },
    })) as never);
    await new MongooseIssueReportRetentionStore().findCandidates(NOW);
    expect(selected).toBe('_id createdAt');
  });

  it('a due report is purged whatever its notification state (pending, failed or accepted): its job goes with it', async () => {
    const rows = [
      { id: 'a'.repeat(24), createdAt: '2025-01-01T00:00:00.000Z' },
      { id: 'b'.repeat(24), createdAt: '2025-01-02T00:00:00.000Z' },
    ];
    const deleted: string[] = [];
    const result = await runIssueReportRetention(
      {
        store: { countAll: async () => rows.length, findCandidates: async () => rows, deleteByIds: async (ids) => (deleted.push(...ids), ids.length) },
        holds: { isHeld: () => false },
        target: { environment: 'development', databaseName: 'quranheals_dev' },
      },
      { apply: true, now: NOW },
      async () => true,
    );
    expect(result).toMatchObject({ due: 2, deleted: 2 });
    expect(deleted).toEqual(rows.map((r) => r.id));
  });
});
