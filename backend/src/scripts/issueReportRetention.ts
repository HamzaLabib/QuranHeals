/**
 * Issue-report retention cleanup: 12 calendar months from submission
 * (`npm run issue-reports:retention -- <command> ...`; docs/data-retention.md).
 *
 *   preflight --holds <file>                                   read-only: totals, cutoff, due/held counts, due ids
 *   purge     --holds <file> --audit-log <file>                 dry run (read-only) unless --apply
 *             [--apply] [--unattended --max-delete <n>]
 *   status    --audit-log <file>                               local file only: last run, missed/failed/interrupted runs
 *
 * Safety, in order:
 *  - Due = the exact calendar rule (retention/issueReportRetention.ts). Held
 *    reports and reports without a valid createdAt are never deleted.
 *  - The holds file must exist and be valid: a mistyped path must never
 *    silently mean "no holds".
 *  - --apply asks for `DELETE <n> FROM <database>` to be typed, or with
 *    --unattended refuses when more than --max-delete reports are due, or
 *    when an earlier run was interrupted.
 *  - After the confirmation, holds and eligibility are read again; any
 *    change refuses. Deletion is by exact _id with a database-side
 *    createdAt backstop, then verified by re-reading the ids.
 *  - Audit (ids and counts only): `issue-reports-purge-started` with the run
 *    id and report ids before deleting, then `issue-reports-purged` or
 *    `failed:issue-report-purge` with the verified count. An --apply run
 *    with nothing due records `issue-reports-checked`, so `status` can tell
 *    a quiet month from a missed run.
 *  - One run at a time: an exclusive lock beside the audit log for the whole run.
 *  - Production: an env profile with QURAN_HEALS_SKIP_DOTENV=1; read steps
 *    need QURAN_HEALS_ADMIN_PROFILE=production-read (read-only user);
 *    --apply needs production-retention (a user with find + remove on
 *    issuereports only, checked strictly) and
 *    QURAN_HEALS_CONFIRM_PRODUCTION_WRITE=quranheals_prod.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { DeletionAuditLog, type AuditEntry } from '../admin/deletionAudit';
import { FileLock } from '../admin/localFiles';
import { confirmTyped, processTerminal, type TerminalIO, assertInteractive } from '../admin/prompt';
import { connectScriptDatabase, disconnectFromDatabase, getDatabaseTarget } from '../config/database';
import type { DatabaseTarget, ScriptAccess } from '../config/databaseTarget';
import { describeError } from '../monitoring/monitoring';
import { candidateCutoff, classifyIssueReports, retentionRunHistory, type RetentionRunHistory } from '../retention/issueReportRetention';
import { PreservationHoldStore, type HoldChecker } from '../retention/preservationHolds';
import { MongooseIssueReportRetentionStore, type IssueReportRetentionStore } from '../services/MongooseIssueReportRetentionStore';
import { ADMIN_PROFILE_ENV, toExit } from './adminDeleteAccount';
import { AdminDeletionError, EXIT } from '../admin/adminAccountDeletion';

export const SCRIPT_NAME = 'issue-reports:retention';
/**
 * Production is supported. Every production run still needs the env
 * profile, the matching admin profile, a strictly checked least-privilege
 * user and, for --apply, the production write confirmation plus the typed
 * (or capped unattended) confirmation.
 */
export const ISSUE_REPORT_RETENTION_PRODUCTION_ENABLED = true;
/** `status` exit code when a run is overdue, failed or was interrupted. */
export const EXIT_ATTENTION = 6;

type Command = 'preflight' | 'purge' | 'status';
export type ParsedRetentionArgs = {
  command: Command;
  holds?: string;
  auditLog?: string;
  apply: boolean;
  unattended: boolean;
  maxDelete?: number;
};

function refuse(message: string): never {
  throw new AdminDeletionError(message, EXIT.refused);
}

const ALLOWED_FLAGS: Record<Command, string[]> = {
  preflight: ['--holds'],
  purge: ['--holds', '--audit-log', '--apply', '--unattended', '--max-delete'],
  status: ['--audit-log'],
};
const BOOLEAN_FLAGS = new Set(['--apply', '--unattended']);

export function parseRetentionArgs(args: string[]): ParsedRetentionArgs {
  const [command, ...rest] = args;
  if (command !== 'preflight' && command !== 'purge' && command !== 'status') refuse('First argument must be preflight, purge or status.');
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!ALLOWED_FLAGS[command].includes(flag)) refuse(`${flag} is not valid for "${command}".`);
    if (BOOLEAN_FLAGS.has(flag)) {
      if (flags.has(flag)) refuse(`${flag} given twice.`);
      flags.add(flag);
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) refuse(`${flag} needs a value.`);
    if (values.has(flag)) refuse(`${flag} given twice.`);
    values.set(flag, value);
    i++;
  }
  const holds = values.get('--holds');
  const auditLog = values.get('--audit-log');
  if (command !== 'status' && !holds) refuse('--holds is required, so preservation holds are always honoured.');
  if (command !== 'preflight' && !auditLog) refuse(`--audit-log is required for ${command}.`);
  const apply = flags.has('--apply');
  const unattended = flags.has('--unattended');
  const rawMax = values.get('--max-delete');
  if (unattended && !apply) refuse('--unattended only applies to purge --apply.');
  if (unattended && rawMax === undefined) refuse('--unattended needs --max-delete <n>: the most reports a run may delete without a person confirming.');
  if (!unattended && rawMax !== undefined) refuse('--max-delete only applies with --unattended.');
  if (rawMax !== undefined && !/^\d{1,6}$/.test(rawMax)) refuse('--max-delete must be a whole number.');
  return { command, holds, auditLog, apply, unattended, ...(rawMax !== undefined ? { maxDelete: Number(rawMax) } : {}) };
}

/** Admin profiles this script accepts (QURAN_HEALS_ADMIN_PROFILE; same variable as account:admin-delete). */
export const RETENTION_PROFILES = ['production-read', 'production-retention', 'development', 'development-read', 'development-retention'] as const;
export type RetentionProfile = (typeof RETENTION_PROFILES)[number];

function writesDatabase(parsed: ParsedRetentionArgs): boolean {
  return parsed.command === 'purge' && parsed.apply;
}

/**
 * Production needs the profile matching the step: production-read
 * (read-only user) to look, production-retention (find + remove on
 * issuereports only) to delete. Development accepts no profile or
 * `development`; the rehearsal profiles development-read and
 * development-retention apply the production credential checks to
 * quranheals_dev.
 */
export function resolveRetentionProfile(
  parsed: ParsedRetentionArgs,
  target: Pick<DatabaseTarget, 'environment'>,
  environment: Record<string, string | undefined> = process.env,
): RetentionProfile | undefined {
  const raw = environment[ADMIN_PROFILE_ENV] || undefined;
  if (raw !== undefined && !RETENTION_PROFILES.includes(raw as RetentionProfile)) {
    refuse(`${ADMIN_PROFILE_ENV}=${raw} is not a profile ${SCRIPT_NAME} accepts (${RETENTION_PROFILES.join(', ')}). Nothing was read or changed.`);
  }
  const profile = raw as RetentionProfile | undefined;
  if (target.environment === 'production') {
    const expected: RetentionProfile = writesDatabase(parsed) ? 'production-retention' : 'production-read';
    if (profile !== expected) refuse(`This production step needs ${ADMIN_PROFILE_ENV}=${expected} (got ${profile ?? 'none'}). Nothing was read or changed.`);
    return profile;
  }
  if (profile?.startsWith('production')) refuse(`${ADMIN_PROFILE_ENV}=${profile} is a production profile, but the target is ${target.environment}. Nothing was read or changed.`);
  if (profile === 'development-read' && writesDatabase(parsed)) refuse(`--apply needs ${ADMIN_PROFILE_ENV}=development-retention, not development-read.`);
  if (profile === 'development-retention' && !writesDatabase(parsed)) refuse(`Read-only steps use ${ADMIN_PROFILE_ENV}=development-read, not development-retention.`);
  return profile;
}

export function retentionScriptAccess(
  parsed: ParsedRetentionArgs,
  productionEnabled = ISSUE_REPORT_RETENTION_PRODUCTION_ENABLED,
  profile?: RetentionProfile,
): ScriptAccess {
  const writes = writesDatabase(parsed);
  return {
    script: SCRIPT_NAME,
    writes,
    productionSupported: productionEnabled,
    enforceCredentialScope: true,
    ...(profile && profile !== 'development' ? { strictCredentialScope: true } : {}),
    ...(writes ? { deletionOnlyCollections: ['issuereports'] } : {}),
  };
}

export function assertRetentionEnvironment(
  target: DatabaseTarget,
  productionEnabled = ISSUE_REPORT_RETENTION_PRODUCTION_ENABLED,
  environment: Record<string, string | undefined> = process.env,
): void {
  if (target.environment === 'development') return;
  if (target.environment === 'production' && productionEnabled) {
    // Same rule as the deletion tool: a production run comes from an env profile that never reads backend/.env.
    if (environment.QURAN_HEALS_SKIP_DOTENV !== '1') refuse('Production runs must load an env profile that sets QURAN_HEALS_SKIP_DOTENV=1. Nothing was read or changed.');
    return;
  }
  refuse(`${SCRIPT_NAME} is not enabled for environment=${target.environment}. Nothing was read or changed.`);
}

/** The holds file must exist and parse; a missing or unreadable file stops the run before anything is read from the database. */
export function openHoldsFile(path: string): PreservationHoldStore {
  if (!existsSync(path)) {
    refuse(`Holds file not found: ${path}. Every cleanup must read the real holds file; create it once as described in docs/data-retention.md. Nothing was read or changed.`);
  }
  const store = new PreservationHoldStore(path);
  try {
    store.list();
  } catch (error) {
    refuse(`Holds file ${path} could not be read (${error instanceof Error ? error.message : 'invalid'}). Nothing was read or changed.`);
  }
  return store;
}

/** Audit entries that parse; malformed lines are counted, never fatal (the log is append-only and may be hand-inspected). */
export function readAuditEntriesLenient(path: string): { entries: AuditEntry[]; unreadable: number } {
  if (!existsSync(path)) return { entries: [], unreadable: 0 };
  const entries: AuditEntry[] = [];
  let unreadable = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      unreadable++;
    }
  }
  return { entries, unreadable };
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((value, index) => value === sorted[index]);
}

export type RetentionDeps = {
  store: IssueReportRetentionStore;
  holds: HoldChecker;
  audit?: DeletionAuditLog;
  target: { environment: string; databaseName: string };
  newRunId?: () => string;
};

export type RetentionInput = { apply: boolean; now: Date; unattended?: { maxDelete: number } };

/** The cleanup itself, independent of the database connection (tested with an in-memory store). */
export async function runIssueReportRetention(deps: RetentionDeps, input: RetentionInput, confirm: (count: number, database: string) => Promise<boolean>) {
  const { store, holds, target } = deps;
  const cutoff = candidateCutoff(input.now);
  const total = await store.countAll();
  const classified = classifyIssueReports(await store.findCandidates(cutoff), input.now, holds);
  const summary = {
    environment: target.environment,
    database: target.databaseName,
    asOf: input.now.toISOString(),
    rule: '12 calendar months from submission',
    /** Reports created after this can't be due yet; candidates at or before it are checked with the exact calendar rule. */
    candidateCutoff: cutoff.toISOString(),
    total,
    due: classified.eligibleIds.length,
    held: classified.held,
    notYetDue: total - classified.eligibleIds.length - classified.held - classified.undatable,
    undatable: classified.undatable,
  };
  if (!input.apply) return { mode: 'dry-run' as const, ...summary, dueIds: classified.eligibleIds, deleted: 0 };

  const audit = deps.audit;
  if (!audit) refuse('--audit-log is required for --apply.');
  audit.preflight();
  const run = (deps.newRunId ?? randomUUID)();
  const entry = (fields: Omit<AuditEntry, 'at' | 'environment' | 'database' | 'action' | 'run'>): AuditEntry => ({
    at: new Date().toISOString(),
    environment: target.environment,
    database: target.databaseName,
    action: 'issue-report-retention',
    run,
    ...fields,
  });

  if (summary.due === 0) {
    audit.append(entry({ result: 'issue-reports-checked', deleted: { IssueReport: 0 } }));
    return { mode: 'apply' as const, ...summary, run, deleted: 0 };
  }

  if (input.unattended && summary.due > input.unattended.maxDelete) {
    audit.append(entry({ result: 'failed:issue-report-purge', deleted: { IssueReport: 0 } }));
    refuse(`${summary.due} reports are due, more than --max-delete ${input.unattended.maxDelete}. Nothing was deleted; review the preflight and run the cleanup interactively.`);
  }
  const confirmed = input.unattended ? true : await confirm(summary.due, target.databaseName).catch(() => false);
  if (!confirmed) refuse('Confirmation did not match. Nothing was deleted.');

  // Re-read holds and eligibility after the (possibly slow) confirmation.
  const recheck = classifyIssueReports(await store.findCandidates(cutoff), input.now, holds);
  if (!sameIds(recheck.eligibleIds, classified.eligibleIds)) {
    refuse('Eligibility or holds changed after the count was confirmed. Nothing was deleted; run the cleanup again.');
  }
  const ids = recheck.eligibleIds;

  audit.append(entry({ result: 'issue-reports-purge-started', reportIds: ids }));
  try {
    await store.deleteByIds(ids, cutoff);
  } catch (error) {
    const remaining = await store.existingIds(ids).catch(() => null);
    audit.append(entry({ result: 'failed:issue-report-purge', ...(remaining ? { deleted: { IssueReport: ids.length - remaining.length }, reportIds: remaining } : {}) }));
    throw new AdminDeletionError(
      `Deletion failed (${describeError(error)}). ${remaining ? `${ids.length - remaining.length} of ${ids.length} reports were deleted.` : 'How many were deleted could not be verified.'} ` +
        'The audit log records the run. Running the cleanup again is safe: it only selects reports that are still due.',
      EXIT.delete,
    );
  }

  const remaining = await store.existingIds(ids);
  const deleted = ids.length - remaining.length;
  if (remaining.length > 0) {
    audit.append(entry({ result: 'failed:issue-report-purge', deleted: { IssueReport: deleted }, reportIds: remaining }));
    throw new AdminDeletionError(`${remaining.length} of ${ids.length} due reports are still present after deletion; nothing else was touched. The audit log lists their ids.`, EXIT.delete);
  }
  audit.append(entry({ result: 'issue-reports-purged', deleted: { IssueReport: deleted } }));
  return { mode: 'apply' as const, ...summary, run, deleted };
}

export function retentionStatus(auditLogPath: string, now: Date): RetentionRunHistory & { unreadableLines: number } {
  const { entries, unreadable } = readAuditEntriesLenient(auditLogPath);
  return { ...retentionRunHistory(entries, now), unreadableLines: unreadable };
}

export async function runIssueReportRetentionCli(
  args: string[],
  options: { io?: TerminalIO; now?: () => number; productionEnabled?: boolean; environment?: Record<string, string | undefined> } = {},
) {
  const io = options.io ?? processTerminal();
  const environment = options.environment ?? process.env;
  const now = new Date((options.now ?? Date.now)());
  const parsed = parseRetentionArgs(args);

  if (parsed.command === 'status') {
    new DeletionAuditLog(parsed.auditLog!); // refuses a path inside the repository
    const status = retentionStatus(parsed.auditLog!, now);
    return { command: parsed.command, ...status };
  }

  if (parsed.apply && !parsed.unattended) assertInteractive(io, 'purge --apply');
  const holds = openHoldsFile(parsed.holds!);
  const audit = parsed.auditLog ? new DeletionAuditLog(parsed.auditLog) : undefined;
  if (parsed.apply && audit) {
    const history = retentionStatus(parsed.auditLog!, now);
    if (history.interruptedRuns.length > 0) {
      const message = `An earlier cleanup run (${history.interruptedRuns.map((r) => r.run).join(', ')}) started deleting and never recorded its result.`;
      if (parsed.unattended) refuse(`${message} Unattended runs stop until a person has checked it (docs/data-retention.md, "Recovery").`);
      io.output.write(`WARNING ${message} This run re-selects only reports that are still due, so it also completes that one.\n`);
    }
  }

  const productionEnabled = options.productionEnabled ?? ISSUE_REPORT_RETENTION_PRODUCTION_ENABLED;
  const initialTarget = getDatabaseTarget();
  assertRetentionEnvironment(initialTarget, productionEnabled, environment);
  const profile = resolveRetentionProfile(parsed, initialTarget, environment);

  const work = async () => {
    const target = await connectScriptDatabase(retentionScriptAccess(parsed, productionEnabled, profile), { autoIndex: false, autoCreate: false });
    try {
      assertRetentionEnvironment(target, productionEnabled, environment);
      return {
        command: parsed.command,
        ...(await runIssueReportRetention(
          { store: new MongooseIssueReportRetentionStore(), holds, audit, target: { environment: target.environment, databaseName: target.databaseName } },
          { apply: parsed.apply, now, ...(parsed.unattended ? { unattended: { maxDelete: parsed.maxDelete! } } : {}) },
          (count, database) =>
            confirmTyped(
              io,
              `\n${count} issue report(s) in ${database} are past 12 calendar months and not held. Type "DELETE ${count} FROM ${database}" to delete them: `,
              `DELETE ${count} FROM ${database}`,
            ),
        )),
      };
    } finally {
      await disconnectFromDatabase();
    }
  };
  // One deleting run at a time, across processes (a scheduled run and a manual one, for example).
  return parsed.apply ? new FileLock(`${parsed.auditLog}.retention-run`).runAsync(work) : work();
}

if (require.main === module) {
  runIssueReportRetentionCli(process.argv.slice(2))
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.command === 'status' && !(report as { ok?: boolean }).ok) process.exitCode = EXIT_ATTENTION;
    })
    .catch((error) => {
      const { message, exitCode } = toExit(error);
      console.error(message.replace('account:admin-delete', SCRIPT_NAME));
      process.exitCode = exitCode;
    });
}
