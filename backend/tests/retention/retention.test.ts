import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DeletionAuditLog } from '../../src/admin/deletionAudit';
import { candidateCutoff, classifyIssueReports } from '../../src/retention/issueReportRetention';
import { PreservationHoldStore } from '../../src/retention/preservationHolds';
import {
  addCalendarMonthsUTC,
  auditEntryDeadline,
  completedCaseDeadline,
  DAY_MS,
  issueReportDeadline,
  uncompletedCaseDeadline,
} from '../../src/retention/retentionPolicy';
import { assertRetentionEnvironment, parseRetentionArgs, retentionScriptAccess, runIssueReportRetention } from '../../src/scripts/issueReportRetention';
import type { IssueReportRetentionStore } from '../../src/services/MongooseIssueReportRetentionStore';
import { tempDir } from '../admin/adminFakes';

const iso = (value: string) => new Date(value);

describe('retention deadlines (UTC, never early)', () => {
  it('12 months from submission for issue reports, at the same time of day', () => {
    expect(issueReportDeadline(iso('2026-10-08T13:45:00.000Z')).toISOString()).toBe('2027-10-08T13:45:00.000Z');
  });

  it('a day the target month lacks rolls forward, never back', () => {
    expect(addCalendarMonthsUTC(iso('2028-02-29T10:00:00.000Z'), 12).toISOString()).toBe('2029-03-01T10:00:00.000Z');
    expect(addCalendarMonthsUTC(iso('2026-01-31T00:00:00.000Z'), 1).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(addCalendarMonthsUTC(iso('2026-12-15T00:00:00.000Z'), 1).toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });

  it('three years for audit entries, including across a leap day', () => {
    expect(auditEntryDeadline(iso('2026-10-08T00:00:00.000Z')).toISOString()).toBe('2029-10-08T00:00:00.000Z');
    expect(auditEntryDeadline(iso('2028-02-29T00:00:00.000Z')).toISOString()).toBe('2031-03-01T00:00:00.000Z');
  });

  it('60 days after completion, 30 days after code expiry for verification cases', () => {
    expect(completedCaseDeadline(iso('2026-10-08T00:00:00.000Z')).toISOString()).toBe('2026-12-07T00:00:00.000Z');
    expect(uncompletedCaseDeadline(iso('2026-10-08T00:15:00.000Z')).toISOString()).toBe('2026-11-07T00:15:00.000Z');
  });
});

describe('preservation holds', () => {
  const now = iso('2026-10-08T00:00:00.000Z');

  it('requires a listed reason, a future review date, at most 365 days away, and a valid reference', () => {
    const holds = new PreservationHoldStore(join(tempDir(), 'holds.json'));
    expect(() => holds.place({ kind: 'deletion-case', ref: 'DEL-20261008-01', reason: 'dispute', reviewBy: now }, now)).toThrow(/future/);
    expect(() => holds.place({ kind: 'deletion-case', ref: 'DEL-20261008-01', reason: 'dispute', reviewBy: new Date(now.getTime() + 366 * DAY_MS) }, now)).toThrow(/365/);
    expect(() => holds.place({ kind: 'issue-report', ref: 'DEL-20261008-01', reason: 'dispute', reviewBy: new Date(now.getTime() + DAY_MS) }, now)).toThrow(/report id/);
    holds.place({ kind: 'issue-report', ref: 'aaaaaaaaaaaaaaaaaaaaaaaa', reason: 'security-investigation', reviewBy: new Date(now.getTime() + DAY_MS) }, now);
    expect(holds.isHeld('issue-report', 'aaaaaaaaaaaaaaaaaaaaaaaa', now)).toBe(true);
  });

  it('protects nothing once its review date passes, and can be released', () => {
    const holds = new PreservationHoldStore(join(tempDir(), 'holds.json'));
    const reviewBy = new Date(now.getTime() + DAY_MS);
    holds.place({ kind: 'deletion-case', ref: 'DEL-20261008-01', reason: 'legal-obligation', reviewBy }, now);
    expect(holds.isHeld('deletion-case', 'DEL-20261008-01', new Date(reviewBy.getTime() - 1))).toBe(true);
    expect(holds.isHeld('deletion-case', 'DEL-20261008-01', reviewBy)).toBe(false);
    expect(holds.pruneExpired(reviewBy, false)).toBe(1);
    expect(holds.list()).toHaveLength(1);
    expect(holds.release('deletion-case', 'DEL-20261008-01')).toBe(true);
    expect(holds.list()).toEqual([]);
  });
});

describe('audit log retention (3 years)', () => {
  function seededLog() {
    const dir = tempDir();
    const audit = new DeletionAuditLog(join(dir, 'audit.jsonl'));
    audit.append({ case: 'DEL-20231008-01', at: '2023-10-08T00:00:00.000Z', action: 'delete-account', result: 'deleted', userId: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
    audit.append({ case: 'DEL-20231009-01', at: '2023-10-09T00:00:00.000Z', action: 'delete-account', result: 'deleted' });
    audit.append({ case: 'DEL-20261008-01', at: '2026-10-08T00:00:00.000Z', action: 'delete-account', result: 'deleted' });
    return { dir, audit, path: join(dir, 'audit.jsonl') };
  }

  it('removes nothing before the cutoff, and an entry exactly at its 3-year deadline', () => {
    const { audit } = seededLog();
    expect(audit.prune(iso('2026-10-07T23:59:59.999Z'), { apply: false }).eligible).toBe(0);
    expect(audit.prune(iso('2026-10-08T00:00:00.000Z'), { apply: false })).toMatchObject({ eligible: 1, retained: 2 });
  });

  it('a dry run changes nothing', () => {
    const { audit, path } = seededLog();
    const before = readFileSync(path, 'utf8');
    expect(audit.prune(iso('2030-01-01T00:00:00.000Z'), { apply: false }).eligible).toBe(3);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('apply keeps undatable lines and held cases, appends a record of the pruning, and is safe to repeat', () => {
    const { dir, audit, path } = seededLog();
    writeFileSync(path, `${readFileSync(path, 'utf8')}not json\n{"case":"DEL-X","action":"delete-account","result":"deleted"}\n`);
    const holds = new PreservationHoldStore(join(dir, 'holds.json'));
    const now = iso('2026-10-10T00:00:00.000Z');
    holds.place({ kind: 'deletion-case', ref: 'DEL-20231009-01', reason: 'dispute', reviewBy: new Date(now.getTime() + 30 * DAY_MS) }, now);

    const report = audit.prune(now, { apply: true, holds });
    expect(report).toMatchObject({ total: 5, eligible: 1, held: 1, retained: 1, undatable: 2, removed: 1 });
    expect(report.sha256After).toMatch(/^[a-f0-9]{64}$/);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toContain('not json');
    expect(lines.some((line) => line.includes('DEL-20231008-01'))).toBe(false);
    expect(lines.some((line) => line.includes('DEL-20231009-01'))).toBe(true);
    expect(JSON.parse(lines[lines.length - 1])).toMatchObject({ action: 'audit-prune', result: 'audit-entries-pruned', deleted: { AuditEntry: 1 } });

    expect(audit.prune(now, { apply: true, holds }).removed).toBe(0);
  });

  it('refuses to apply when the eligible count differs from what was confirmed', () => {
    const { audit, path } = seededLog();
    const before = readFileSync(path, 'utf8');
    expect(() => audit.prune(iso('2030-01-01T00:00:00.000Z'), { apply: true, expectedCount: 2 })).toThrow(/changed/);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});

describe('issue-report retention (12 months)', () => {
  const now = iso('2027-10-08T12:00:00.000Z');
  const id = (n: number) => n.toString(16).padStart(24, '0');

  it('candidate query cutoff is 365 days, a superset of the exact 12-calendar-month rule', () => {
    expect(candidateCutoff(now).toISOString()).toBe('2026-10-08T12:00:00.000Z');
    const report = classifyIssueReports(
      [
        { id: id(1), createdAt: '2026-10-08T12:00:00.000Z' }, // exactly 12 months: due
        { id: id(2), createdAt: '2026-10-08T12:00:00.001Z' }, // 1 ms short: not yet
        { id: id(3), createdAt: '2025-01-01T00:00:00.000Z' },
        { id: id(4), createdAt: null },
      ],
      now,
    );
    expect(report).toMatchObject({ candidates: 4, eligibleIds: [id(1), id(3)], notYetDue: 1, undatable: 1 });
  });

  it('a leap-day report is not due until 1 March of the next year', () => {
    expect(classifyIssueReports([{ id: id(1), createdAt: '2028-02-29T00:00:00.000Z' }], iso('2029-02-28T23:59:59.999Z')).eligibleIds).toEqual([]);
    expect(classifyIssueReports([{ id: id(1), createdAt: '2028-02-29T00:00:00.000Z' }], iso('2029-03-01T00:00:00.000Z')).eligibleIds).toEqual([id(1)]);
  });

  function fakeStore(reports: { id: string; createdAt: string | null }[]) {
    const rows = [...reports];
    const deletedIds: string[] = [];
    const store: IssueReportRetentionStore = {
      countAll: async () => rows.length,
      findCandidates: async (cutoff) => rows.filter((r) => !r.createdAt || Date.parse(r.createdAt) <= cutoff.getTime()),
      deleteByIds: async (ids) => {
        for (const target of ids) {
          const index = rows.findIndex((r) => r.id === target);
          if (index >= 0) { rows.splice(index, 1); deletedIds.push(target); }
        }
        return ids.length;
      },
    };
    return { store, rows, deletedIds };
  }

  it('preflight/dry run reports counts and deletes nothing', async () => {
    const { store, rows } = fakeStore([{ id: id(1), createdAt: '2025-01-01T00:00:00.000Z' }, { id: id(2), createdAt: '2027-09-01T00:00:00.000Z' }]);
    const target = { environment: 'development', databaseName: 'quranheals_dev' };
    const result = await runIssueReportRetention({ store, holds: { isHeld: () => false }, target }, { apply: false, now }, async () => { throw new Error('no confirm in dry run'); });
    expect(result).toMatchObject({ mode: 'dry-run', total: 2, due: 1, held: 0, notYetDue: 1, deleted: 0 });
    expect(rows).toHaveLength(2);
  });

  it('purge deletes only due, unheld reports by exact id after the typed count, audits the count, and is safe to repeat', async () => {
    const dir = tempDir();
    const { store, rows, deletedIds } = fakeStore([
      { id: id(1), createdAt: '2025-01-01T00:00:00.000Z' },
      { id: id(2), createdAt: '2025-02-01T00:00:00.000Z' },
      { id: id(3), createdAt: '2027-09-01T00:00:00.000Z' },
    ]);
    const holds = new PreservationHoldStore(join(dir, 'holds.json'));
    holds.place({ kind: 'issue-report', ref: id(2), reason: 'security-investigation', reviewBy: new Date(now.getTime() + 30 * DAY_MS) }, now);
    const audit = new DeletionAuditLog(join(dir, 'audit.jsonl'));
    const target = { environment: 'development', databaseName: 'quranheals_dev' };

    await expect(runIssueReportRetention({ store, holds, audit, target }, { apply: true, now }, async (n) => n === 2)).rejects.toThrow(/did not match/);
    expect(rows).toHaveLength(3);

    const result = await runIssueReportRetention({ store, holds, audit, target }, { apply: true, now }, async (n) => n === 1);
    expect(result).toMatchObject({ mode: 'apply', due: 1, held: 1, deleted: 1 });
    expect(deletedIds).toEqual([id(1)]);
    expect(audit.entries()).toEqual([expect.objectContaining({ action: 'issue-report-retention', deleted: { IssueReport: 1 } })]);

    const again = await runIssueReportRetention({ store, holds, audit, target }, { apply: true, now }, async () => true);
    expect(again).toMatchObject({ due: 0, deleted: 0 });
  });

  it('the script requires holds, is disabled for production in code, and needs a deletion-only user to purge', () => {
    expect(() => parseRetentionArgs(['preflight'])).toThrow(/--holds is required/);
    expect(() => parseRetentionArgs(['purge', '--holds', 'h.json'])).toThrow(/--audit-log is required/);
    const purge = parseRetentionArgs(['purge', '--holds', 'h.json', '--audit-log', 'a.jsonl', '--apply']);
    expect(retentionScriptAccess(purge)).toMatchObject({ writes: true, productionSupported: false, enforceCredentialScope: true, deletionOnlyCollections: ['issuereports'] });
    expect(() => assertRetentionEnvironment({ environment: 'production', databaseName: 'quranheals_prod' })).toThrow(/not enabled/);
    expect(() => assertRetentionEnvironment({ environment: 'production', databaseName: 'quranheals_prod' }, true, {})).toThrow(/QURAN_HEALS_SKIP_DOTENV/);
    expect(() => assertRetentionEnvironment({ environment: 'development', databaseName: 'quranheals_dev' })).not.toThrow();
  });
});
