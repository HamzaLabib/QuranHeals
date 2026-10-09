import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXIT } from '../../src/admin/adminAccountDeletion';
import { DeletionAuditLog } from '../../src/admin/deletionAudit';
import { FileLock, FileLockError, REPOSITORY_ROOT } from '../../src/admin/localFiles';
import { deletionScopeProblems } from '../../src/config/credentialScope';
import { assertScriptMayUseTarget, type DatabaseTarget } from '../../src/config/databaseTarget';
import { candidateCutoff, classifyIssueReports, MAX_DAYS_BETWEEN_RETENTION_RUNS, retentionRunHistory } from '../../src/retention/issueReportRetention';
import { PreservationHoldStore } from '../../src/retention/preservationHolds';
import { DAY_MS, issueReportDeadline } from '../../src/retention/retentionPolicy';
import {
  assertRetentionEnvironment,
  openHoldsFile,
  parseRetentionArgs,
  resolveRetentionProfile,
  retentionScriptAccess,
  retentionStatus,
  runIssueReportRetention,
  runIssueReportRetentionCli,
} from '../../src/scripts/issueReportRetention';
import type { IssueReportRetentionStore } from '../../src/services/MongooseIssueReportRetentionStore';
import { tempDir } from '../admin/adminFakes';

const NOW = new Date('2027-10-09T12:00:00.000Z');
const id = (n: number) => n.toString(16).padStart(24, '0');
const DEV = { environment: 'development', databaseName: 'quranheals_dev' };
const PROD: DatabaseTarget = { environment: 'production', databaseName: 'quranheals_prod' };

type Row = { id: string; createdAt: string | null; comment?: string; email?: string; notification?: { state: string } };

/** In-memory issuereports: same contract as MongooseIssueReportRetentionStore, including the createdAt backstop on delete. */
function memoryStore(initial: Row[], options: { failDeleteAfter?: number; failFind?: boolean } = {}) {
  const rows = initial.map((row) => ({ ...row }));
  let deletes = 0;
  const store: IssueReportRetentionStore = {
    countAll: async () => rows.length,
    findCandidates: async (cutoff) => {
      if (options.failFind) throw new Error('MongoNetworkError: connection closed');
      return rows.filter((r) => !r.createdAt || Date.parse(r.createdAt) <= cutoff.getTime()).map(({ id: rowId, createdAt }) => ({ id: rowId, createdAt }));
    },
    deleteByIds: async (ids, notAfter) => {
      let count = 0;
      for (const target of ids) {
        if (options.failDeleteAfter !== undefined && deletes >= options.failDeleteAfter) {
          throw Object.assign(new Error('not authorized on quranheals_prod to execute command { delete: "issuereports" }'), { name: 'MongoServerError', codeName: 'Unauthorized' });
        }
        const index = rows.findIndex((r) => r.id === target && r.createdAt !== null && Date.parse(r.createdAt) <= notAfter.getTime());
        if (index >= 0) {
          rows.splice(index, 1);
          deletes++;
          count++;
        }
      }
      return count;
    },
    existingIds: async (ids) => ids.filter((target) => rows.some((r) => r.id === target)),
  };
  return { store, rows };
}

function files() {
  const dir = tempDir();
  const holdsPath = join(dir, 'holds.json');
  writeFileSync(holdsPath, '{"formatVersion":1,"holds":{}}\n');
  const auditPath = join(dir, 'audit.jsonl');
  return { dir, holdsPath, auditPath, holds: new PreservationHoldStore(holdsPath), audit: new DeletionAuditLog(auditPath) };
}

const run = (deps: Parameters<typeof runIssueReportRetention>[0], apply = true, confirm: (count: number, database: string) => Promise<boolean> = async () => true, extra: { unattended?: { maxDelete: number } } = {}) =>
  runIssueReportRetention(deps, { apply, now: NOW, ...extra }, confirm);

describe('which reports are deleted (12 calendar months from submission)', () => {
  const reports: Row[] = [
    { id: id(1), createdAt: '2026-10-09T12:00:00.001Z' }, // 1 ms short of 12 months: retained
    { id: id(2), createdAt: '2026-10-09T12:00:00.000Z' }, // exactly 12 months: eligible
    { id: id(3), createdAt: '2025-03-01T00:00:00.000Z' }, // older: eligible
    { id: id(4), createdAt: '2027-06-01T00:00:00.000Z' }, // recent: retained
    { id: id(5), createdAt: null }, // undatable: never removed automatically
  ];

  it('retains younger reports, deletes reports exactly at and past expiration, never undatable ones', async () => {
    const { holds, audit } = files();
    const { store, rows } = memoryStore(reports);

    const result = await run({ store, holds, audit, target: DEV });

    expect(result).toMatchObject({ due: 2, deleted: 2, notYetDue: 2, undatable: 1, total: 5 });
    expect(rows.map((r) => r.id).sort()).toEqual([id(1), id(4), id(5)]);
  });

  it('handles leap days and month ends: 29 Feb is due on 1 Mar a year later, never earlier', async () => {
    const leap: Row[] = [{ id: id(1), createdAt: '2028-02-29T10:00:00.000Z' }, { id: id(2), createdAt: '2028-01-31T10:00:00.000Z' }];
    const before = memoryStore(leap);
    const atFeb28 = await runIssueReportRetention({ store: before.store, holds: files().holds, target: DEV }, { apply: false, now: new Date('2029-02-28T23:59:59.999Z') }, async () => true);
    expect((atFeb28 as { dueIds: string[] }).dueIds).toEqual([id(2)]);
    const atMar1 = await runIssueReportRetention({ store: before.store, holds: files().holds, target: DEV }, { apply: false, now: new Date('2029-03-01T10:00:00.000Z') }, async () => true);
    expect((atMar1 as { dueIds: string[] }).dueIds.sort()).toEqual([id(1), id(2)]);
  });

  it('keeps a report under an active hold, and deletes it once the hold has expired', async () => {
    const { holds, audit } = files();
    holds.place({ kind: 'issue-report', ref: id(3), reason: 'dispute', reviewBy: new Date(NOW.getTime() + 10 * DAY_MS) }, NOW);
    const { store, rows } = memoryStore(reports);

    const held = await run({ store, holds, audit, target: DEV });
    expect(held).toMatchObject({ due: 1, held: 1, deleted: 1 });
    expect(rows.some((r) => r.id === id(3))).toBe(true);

    const later = await runIssueReportRetention({ store, holds, audit, target: DEV }, { apply: true, now: new Date(NOW.getTime() + 11 * DAY_MS) }, async () => true);
    // By then the report that was 1 ms short has also become due.
    expect(later).toMatchObject({ held: 0, deleted: 2 });
    expect(rows.some((r) => r.id === id(3))).toBe(false);
  });

  it('the embedded notification metadata goes with its report: the document is deleted whole', async () => {
    const { holds, audit } = files();
    const { store, rows } = memoryStore([{ id: id(1), createdAt: '2025-01-01T00:00:00.000Z', notification: { state: 'accepted' } }]);
    await run({ store, holds, audit, target: DEV });
    expect(rows).toEqual([]);
  });
});

describe('holds file', () => {
  it('a missing holds file stops the run (a typo must not mean "no holds")', () => {
    expect(() => openHoldsFile(join(tempDir(), 'missing.json'))).toThrow(/Holds file not found/);
  });

  it('an unreadable or wrongly shaped holds file stops the run', () => {
    const dir = tempDir();
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{ not json');
    expect(() => openHoldsFile(broken)).toThrow(/could not be read/);
    const wrong = join(dir, 'wrong.json');
    writeFileSync(wrong, '{"formatVersion":2,"holds":{}}');
    expect(() => openHoldsFile(wrong)).toThrow(/could not be read/);
  });

  it('a holds file inside the repository is refused', () => {
    expect(() => openHoldsFile(join(REPOSITORY_ROOT, 'README.md'))).toThrow(/outside the QuranHeals repository/);
  });
});

describe('dry run', () => {
  it('reports counts, the cutoff and the due ids, deletes nothing and writes no audit entry', async () => {
    const { holds, audit, auditPath } = files();
    const { store, rows } = memoryStore([{ id: id(1), createdAt: '2025-01-01T00:00:00.000Z' }]);

    const result = await run({ store, holds, audit, target: DEV }, false, async () => {
      throw new Error('a dry run never asks');
    });

    expect(result).toMatchObject({ mode: 'dry-run', due: 1, deleted: 0, dueIds: [id(1)], candidateCutoff: '2026-10-09T12:00:00.000Z', rule: '12 calendar months from submission' });
    expect(rows).toHaveLength(1);
    expect(existsSync(auditPath)).toBe(false);
  });
});

describe('confirmation', () => {
  it('needs the exact count and database typed; anything else deletes nothing', async () => {
    const { holds, audit } = files();
    const { store, rows } = memoryStore([{ id: id(1), createdAt: '2025-01-01T00:00:00.000Z' }]);
    const asked: [number, string][] = [];

    await expect(
      run({ store, holds, audit, target: { environment: 'production', databaseName: 'quranheals_prod' } }, true, async (count: number, database: string) => {
        asked.push([count, database]);
        return false;
      }),
    ).rejects.toThrow(/did not match/);

    expect(asked).toEqual([[1, 'quranheals_prod']]);
    expect(rows).toHaveLength(1);
  });

  it('re-reads holds and eligibility after the confirmation: a hold placed meanwhile stops the run', async () => {
    const { holds, audit } = files();
    const { store, rows } = memoryStore([{ id: id(1), createdAt: '2025-01-01T00:00:00.000Z' }, { id: id(2), createdAt: '2025-01-02T00:00:00.000Z' }]);

    await expect(
      run({ store, holds, audit, target: DEV }, true, async () => {
        holds.place({ kind: 'issue-report', ref: id(2), reason: 'security-investigation', reviewBy: new Date(NOW.getTime() + DAY_MS) }, NOW);
        return true;
      }),
    ).rejects.toThrow(/changed after the count was confirmed/);
    expect(rows).toHaveLength(2);
  });

  it('a production --apply needs QURAN_HEALS_CONFIRM_PRODUCTION_WRITE=quranheals_prod before connecting', () => {
    const access = retentionScriptAccess(parseRetentionArgs(['purge', '--holds', 'h', '--audit-log', 'a', '--apply']), true, 'production-retention');
    expect(() => assertScriptMayUseTarget(PROD, access, {})).toThrow(/QURAN_HEALS_CONFIRM_PRODUCTION_WRITE=quranheals_prod/);
    expect(() => assertScriptMayUseTarget(PROD, access, { QURAN_HEALS_CONFIRM_PRODUCTION_WRITE: 'quranheals_prod' })).not.toThrow();
    const preflight = retentionScriptAccess(parseRetentionArgs(['preflight', '--holds', 'h']), true, 'production-read');
    expect(() => assertScriptMayUseTarget(PROD, preflight, {})).not.toThrow();
  });
});

describe('development / production isolation and least privilege', () => {
  const apply = parseRetentionArgs(['purge', '--holds', 'h', '--audit-log', 'a', '--apply']);
  const preflight = parseRetentionArgs(['preflight', '--holds', 'h']);

  it('production needs production-read to look and production-retention to delete, plus the env-profile marker', () => {
    expect(() => resolveRetentionProfile(preflight, PROD, {})).toThrow(/production-read/);
    expect(resolveRetentionProfile(preflight, PROD, { QURAN_HEALS_ADMIN_PROFILE: 'production-read' })).toBe('production-read');
    expect(() => resolveRetentionProfile(apply, PROD, { QURAN_HEALS_ADMIN_PROFILE: 'production-read' })).toThrow(/production-retention/);
    expect(() => resolveRetentionProfile(apply, PROD, { QURAN_HEALS_ADMIN_PROFILE: 'production-delete' })).toThrow(/not a profile/);
    expect(resolveRetentionProfile(apply, PROD, { QURAN_HEALS_ADMIN_PROFILE: 'production-retention' })).toBe('production-retention');
    expect(() => assertRetentionEnvironment(PROD, true, {})).toThrow(/QURAN_HEALS_SKIP_DOTENV=1/);
    expect(() => assertRetentionEnvironment(PROD, true, { QURAN_HEALS_SKIP_DOTENV: '1' })).not.toThrow();
  });

  it('a production profile is refused against the development database, and vice versa', () => {
    const dev: DatabaseTarget = { environment: 'development', databaseName: 'quranheals_dev' };
    expect(() => resolveRetentionProfile(apply, dev, { QURAN_HEALS_ADMIN_PROFILE: 'production-retention' })).toThrow(/production profile/);
    expect(() => resolveRetentionProfile(apply, PROD, { QURAN_HEALS_ADMIN_PROFILE: 'development-retention' })).toThrow(/production-retention/);
    expect(resolveRetentionProfile(apply, dev, {})).toBeUndefined();
    expect(() => resolveRetentionProfile(apply, dev, { QURAN_HEALS_ADMIN_PROFILE: 'development-read' })).toThrow(/development-retention/);
  });

  it('deleting runs require a user limited to find + remove on issuereports, checked strictly', () => {
    const access = retentionScriptAccess(apply, true, 'production-retention');
    expect(access).toMatchObject({ writes: true, strictCredentialScope: true, enforceCredentialScope: true, deletionOnlyCollections: ['issuereports'] });

    const onlyIssueReports = [{ resource: { db: 'quranheals_prod', collection: 'issuereports' }, actions: ['find', 'remove'] }];
    expect(deletionScopeProblems(PROD, onlyIssueReports, ['issuereports'])).toEqual([]);

    // The account-deletion user (8 collections) is deliberately NOT accepted for retention.
    const accountDeletionUser = ['users', 'sessions', 'issuereports'].map((collection) => ({ resource: { db: 'quranheals_prod', collection }, actions: ['find', 'remove'] }));
    expect(deletionScopeProblems(PROD, accountDeletionUser, ['issuereports']).join(' ')).toMatch(/"users"/);

    const readWrite = [{ resource: { db: 'quranheals_prod', collection: '' }, actions: ['find', 'insert', 'remove', 'update'] }];
    expect(deletionScopeProblems(PROD, readWrite, ['issuereports']).join(' ')).toMatch(/database-wide/);
    const otherDatabase = [{ resource: { db: 'quranheals_dev', collection: 'issuereports' }, actions: ['find', 'remove'] }];
    expect(deletionScopeProblems(PROD, otherDatabase, ['issuereports']).join(' ')).toMatch(/quranheals_dev/);
  });

  it('read-only steps use read-only access (strict in production)', () => {
    expect(retentionScriptAccess(preflight, true, 'production-read')).toMatchObject({ writes: false, strictCredentialScope: true });
    expect(retentionScriptAccess(preflight, true, 'production-read')).not.toHaveProperty('deletionOnlyCollections');
  });
});

describe('failures never look like success', () => {
  it('a database failure before deleting rejects and records nothing as done', async () => {
    const { holds, audit, auditPath } = files();
    const { store } = memoryStore([{ id: id(1), createdAt: '2025-01-01T00:00:00.000Z' }], { failFind: true });
    await expect(run({ store, holds, audit, target: DEV })).rejects.toThrow(/MongoNetworkError/);
    expect(existsSync(auditPath) ? readFileSync(auditPath, 'utf8') : '').not.toMatch(/issue-reports-purged/);
  });

  it('a permission failure mid-run stops with the delete exit code and audits exactly what was and was not deleted', async () => {
    const { holds, audit } = files();
    const { store, rows } = memoryStore(
      [1, 2, 3].map((n) => ({ id: id(n), createdAt: '2025-01-01T00:00:00.000Z' })),
      { failDeleteAfter: 1 },
    );

    const error = await run({ store, holds, audit, target: DEV }).catch((e) => e);

    expect(error).toMatchObject({ exitCode: EXIT.delete });
    expect(error.message).toMatch(/1 of 3 reports were deleted/);
    expect(error.message).not.toMatch(/quranheals_prod to execute/); // database error text is scrubbed/summarized, never echoed raw
    expect(rows).toHaveLength(2);
    const entries = audit.entries();
    expect(entries.map((e) => e.result)).toEqual(['issue-reports-purge-started', 'failed:issue-report-purge']);
    expect(entries[1]).toMatchObject({ deleted: { IssueReport: 1 }, reportIds: [id(2), id(3)] });
    expect(entries[0].run).toBe(entries[1].run);
  });

  it('is safe to repeat: a re-run after a partial failure deletes only what is still due, then records a quiet check', async () => {
    const { holds, audit } = files();
    const initial = [1, 2, 3].map((n) => ({ id: id(n), createdAt: '2025-01-01T00:00:00.000Z' }));
    const first = memoryStore(initial, { failDeleteAfter: 1 });
    await run({ store: first.store, holds, audit, target: DEV }).catch(() => undefined);
    const resumed = memoryStore(first.rows);

    const second = await run({ store: resumed.store, holds, audit, target: DEV });
    const third = await run({ store: resumed.store, holds, audit, target: DEV });

    expect(second).toMatchObject({ due: 2, deleted: 2 });
    expect(third).toMatchObject({ due: 0, deleted: 0 });
    expect(resumed.rows).toEqual([]);
    expect(audit.entries().map((e) => e.result)).toEqual([
      'issue-reports-purge-started',
      'failed:issue-report-purge',
      'issue-reports-purge-started',
      'issue-reports-purged',
      'issue-reports-checked',
    ]);
  });
});

describe('audit content', () => {
  it('records run id, report ids, counts, database and environment — never a comment or an email', async () => {
    const { holds, audit, auditPath } = files();
    const { store } = memoryStore([{ id: id(1), createdAt: '2025-01-01T00:00:00.000Z', comment: 'private words', email: 'reporter@example.com' }]);

    await run({ store, holds, audit, target: DEV }, true, async () => true, {});

    const text = readFileSync(auditPath, 'utf8');
    expect(text).not.toContain('private words');
    expect(text).not.toContain('reporter@example.com');
    const [started, purged] = audit.entries();
    expect(Object.keys(started).sort()).toEqual(['action', 'at', 'database', 'environment', 'reportIds', 'result', 'run']);
    expect(purged).toMatchObject({ action: 'issue-report-retention', result: 'issue-reports-purged', database: 'quranheals_dev', environment: 'development', deleted: { IssueReport: 1 } });
  });
});

describe('unattended runs', () => {
  it('delete without a prompt only up to --max-delete; above it nothing is deleted and the refusal is audited', async () => {
    const { holds, audit } = files();
    const { store, rows } = memoryStore([1, 2, 3].map((n) => ({ id: id(n), createdAt: '2025-01-01T00:00:00.000Z' })));
    const never = async () => {
      throw new Error('unattended runs never prompt');
    };

    await expect(run({ store, holds, audit, target: DEV }, true, never, { unattended: { maxDelete: 2 } })).rejects.toThrow(/more than --max-delete 2/);
    expect(rows).toHaveLength(3);
    expect(audit.entries().at(-1)).toMatchObject({ result: 'failed:issue-report-purge', deleted: { IssueReport: 0 } });

    const ok = await run({ store, holds, audit, target: DEV }, true, never, { unattended: { maxDelete: 3 } });
    expect(ok).toMatchObject({ deleted: 3 });
  });

  it('flags are validated: --unattended needs --apply and --max-delete', () => {
    expect(() => parseRetentionArgs(['purge', '--holds', 'h', '--audit-log', 'a', '--unattended', '--max-delete', '5'])).toThrow(/only applies to purge --apply/);
    expect(() => parseRetentionArgs(['purge', '--holds', 'h', '--audit-log', 'a', '--apply', '--unattended'])).toThrow(/needs --max-delete/);
    expect(() => parseRetentionArgs(['purge', '--holds', 'h', '--audit-log', 'a', '--apply', '--max-delete', '5'])).toThrow(/only applies with --unattended/);
    expect(() => parseRetentionArgs(['purge', '--holds', 'h', '--audit-log', 'a', '--apply', '--unattended', '--max-delete', '-1'])).toThrow(/needs a value|whole number/);
    expect(parseRetentionArgs(['purge', '--holds', 'h', '--audit-log', 'a', '--apply', '--unattended', '--max-delete', '25'])).toMatchObject({ unattended: true, maxDelete: 25 });
  });

  it('after an interrupted run, an unattended run refuses before touching the database', async () => {
    const { holdsPath, auditPath, audit } = files();
    audit.append({ at: NOW.toISOString(), action: 'issue-report-retention', result: 'issue-reports-purge-started', run: 'r1', reportIds: [id(1)] });

    await expect(
      runIssueReportRetentionCli(['purge', '--holds', holdsPath, '--audit-log', auditPath, '--apply', '--unattended', '--max-delete', '5'], { now: () => NOW.getTime() }),
    ).rejects.toThrow(/never recorded its result.*Unattended runs stop/);
  });

  it('two runs can never delete at the same time (exclusive run lock beside the audit log)', async () => {
    const { auditPath } = files();
    const lock = new FileLock(`${auditPath}.retention-run`);
    await expect(lock.runAsync(() => new FileLock(`${auditPath}.retention-run`).runAsync(async () => 'second'))).rejects.toBeInstanceOf(FileLockError);
  });
});

describe('status: missed, failed and interrupted runs', () => {
  const at = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();
  const base = { action: 'issue-report-retention' as const };

  it('no run recorded yet needs attention', () => {
    expect(retentionRunHistory([], NOW)).toMatchObject({ ok: false, lastSuccessAt: null });
  });

  it('a recent successful or quiet run is fine', () => {
    const history = retentionRunHistory([{ ...base, at: at(10), result: 'issue-reports-checked', run: 'a', deleted: { IssueReport: 0 } }], NOW);
    expect(history).toMatchObject({ ok: true, daysSinceLastSuccess: 10, lastDeleted: 0 });
  });

  it(`more than ${MAX_DAYS_BETWEEN_RETENTION_RUNS} days without success is a missed run`, () => {
    const history = retentionRunHistory([{ ...base, at: at(40), result: 'issue-reports-purged', run: 'a', deleted: { IssueReport: 2 } }], NOW);
    expect(history.ok).toBe(false);
    expect(history.attention.join(' ')).toMatch(/40 days ago/);
  });

  it('a failed last run and an interrupted run both need attention', () => {
    const history = retentionRunHistory(
      [
        { ...base, at: at(5), result: 'issue-reports-checked', run: 'a' },
        { ...base, at: at(2), result: 'issue-reports-purge-started', run: 'b', reportIds: [id(1), id(2)] },
        { ...base, at: at(1), result: 'failed:issue-report-purge', run: 'c' },
      ],
      NOW,
    );
    expect(history.ok).toBe(false);
    expect(history.interruptedRuns).toEqual([{ run: 'b', at: at(2), reportIds: 2 }]);
    expect(history.lastResult).toBe('failed:issue-report-purge');
  });

  it('the status command reads the audit log only, tolerating unreadable lines', () => {
    const { auditPath } = files();
    writeFileSync(auditPath, `not json\n${JSON.stringify({ ...base, at: at(3), result: 'issue-reports-checked', run: 'a' })}\n`);
    expect(retentionStatus(auditPath, NOW)).toMatchObject({ ok: true, unreadableLines: 1 });
  });
});

describe('365-day database backstop vs the 12-calendar-month rule', () => {
  // Every day 2023-01-01 .. 2033-01-01 at several times of day: covers 3 leap days, every month end and DST-free UTC.
  const created: Date[] = [];
  for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2033, 0, 1); t += DAY_MS) {
    for (const offset of [0, 1, 12 * 3_600_000, DAY_MS - 1]) created.push(new Date(t + offset));
  }

  it('12 calendar months are never shorter than 365 days, so the backstop never blocks a report that is due', () => {
    const shortest = Math.min(...created.map((c) => issueReportDeadline(c).getTime() - c.getTime()));
    expect(shortest).toBeGreaterThanOrEqual(365 * DAY_MS);
    // Hence: due at `now` (now >= deadline) implies createdAt <= now - 365 days, the backstop's condition.
    for (const c of created) expect(candidateCutoff(issueReportDeadline(c)).getTime()).toBeGreaterThanOrEqual(c.getTime());
  });

  it('no report is ever classified due before its exact deadline, even when 365 days have already passed', () => {
    for (const c of created) {
      const deadline = issueReportDeadline(c);
      const justBefore = new Date(deadline.getTime() - 1);
      expect(classifyIssueReports([{ id: id(1), createdAt: c.toISOString() }], justBefore).eligibleIds).toEqual([]);
      expect(classifyIssueReports([{ id: id(1), createdAt: c.toISOString() }], deadline).eligibleIds).toEqual([id(1)]);
    }
  });

  it('where 365 days fall before the calendar deadline (across a leap day), nothing is deleted until the deadline', async () => {
    // 2027-03-01 + 365 days = 2028-02-29 (leap year); 12 calendar months = 2028-03-01.
    const c = '2027-03-01T09:00:00.000Z';
    expect(new Date(Date.parse(c) + 365 * DAY_MS).toISOString()).toBe('2028-02-29T09:00:00.000Z');
    expect(issueReportDeadline(new Date(c)).toISOString()).toBe('2028-03-01T09:00:00.000Z');
    // A leap-day report: 2028-02-29 + 12 months = 2029-03-01, 366 days later.
    expect(issueReportDeadline(new Date('2028-02-29T09:00:00.000Z')).toISOString()).toBe('2029-03-01T09:00:00.000Z');

    const { holds, audit } = files();
    const { store, rows } = memoryStore([{ id: id(1), createdAt: c }]);
    const early = await runIssueReportRetention({ store, holds, audit, target: DEV }, { apply: true, now: new Date('2028-02-29T09:00:00.000Z') }, async () => true);
    expect(early).toMatchObject({ due: 0, deleted: 0 });
    expect(rows).toHaveLength(1);
    const onTime = await runIssueReportRetention({ store, holds, audit, target: DEV }, { apply: true, now: new Date('2028-03-01T09:00:00.000Z') }, async () => true);
    expect(onTime).toMatchObject({ due: 1, deleted: 1 });
  });

  it('the backstop only narrows a delete: it is ANDed with the exact id list, never used on its own', async () => {
    // A wrong id list (simulated by a store that is asked to delete a young report) still cannot remove it.
    const { store, rows } = memoryStore([{ id: id(9), createdAt: '2027-09-01T00:00:00.000Z' }]);
    expect(await store.deleteByIds([id(9)], candidateCutoff(NOW))).toBe(0);
    expect(rows).toHaveLength(1);
  });
});
