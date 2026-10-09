/**
 * Issue-report retention cleanup: 12 months from submission
 * (`npm run issue-reports:retention -- <command> ...`; docs/data-retention.md).
 *
 *   preflight --holds <file>                                  read-only: how many reports are due now
 *   purge     --holds <file> --audit-log <file> [--apply]     dry run unless --apply; typed confirmation
 *
 * Due reports are deleted by exact _id. Reports under an active
 * preservation hold (hold --kind issue-report in account:admin-delete) and
 * reports without a valid createdAt are never deleted. Reads only _id and
 * createdAt: output never contains a comment or an email.
 *
 * Production is disabled in code (ISSUE_REPORT_RETENTION_PRODUCTION_ENABLED):
 * the production preflight and the first production purge each need their
 * own approval.
 */
import { DeletionAuditLog } from '../admin/deletionAudit';
import { confirmTyped, processTerminal, type TerminalIO, assertInteractive } from '../admin/prompt';
import { connectScriptDatabase, disconnectFromDatabase, getDatabaseTarget } from '../config/database';
import type { DatabaseTarget, ScriptAccess } from '../config/databaseTarget';
import { candidateCutoff, classifyIssueReports } from '../retention/issueReportRetention';
import { PreservationHoldStore, type HoldChecker } from '../retention/preservationHolds';
import { MongooseIssueReportRetentionStore, type IssueReportRetentionStore } from '../services/MongooseIssueReportRetentionStore';
import { toExit } from './adminDeleteAccount';
import { AdminDeletionError, EXIT } from '../admin/adminAccountDeletion';

export const SCRIPT_NAME = 'issue-reports:retention';
export const ISSUE_REPORT_RETENTION_PRODUCTION_ENABLED = false;

type Command = 'preflight' | 'purge';
type Parsed = { command: Command; holds: string; auditLog?: string; apply: boolean };

function refuse(message: string): never {
  throw new AdminDeletionError(message, EXIT.refused);
}

export function parseRetentionArgs(args: string[]): Parsed {
  const [command, ...rest] = args;
  if (command !== 'preflight' && command !== 'purge') refuse('First argument must be preflight or purge.');
  const allowed = command === 'preflight' ? ['--holds'] : ['--holds', '--audit-log', '--apply'];
  const values = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!allowed.includes(flag)) refuse(`${flag} is not valid for "${command}".`);
    if (flag === '--apply') {
      if (apply) refuse('--apply given twice.');
      apply = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) refuse(`${flag} needs a value.`);
    if (values.has(flag)) refuse(`${flag} given twice.`);
    values.set(flag, value);
    i++;
  }
  const holds = values.get('--holds');
  if (!holds) refuse('--holds is required, so preservation holds are always honoured.');
  if (command === 'purge' && !values.get('--audit-log')) refuse('--audit-log is required for purge.');
  return { command, holds, auditLog: values.get('--audit-log'), apply };
}

export function retentionScriptAccess(parsed: Parsed, productionEnabled = ISSUE_REPORT_RETENTION_PRODUCTION_ENABLED): ScriptAccess {
  const writes = parsed.command === 'purge' && parsed.apply;
  return {
    script: SCRIPT_NAME,
    writes,
    productionSupported: productionEnabled,
    enforceCredentialScope: true,
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

/** The cleanup itself, independent of the database connection (tested with an in-memory store). */
export async function runIssueReportRetention(
  deps: { store: IssueReportRetentionStore; holds: HoldChecker; audit?: DeletionAuditLog; target: { environment: string; databaseName: string } },
  input: { apply: boolean; now: Date },
  confirm: (count: number) => Promise<boolean>,
) {
  const total = await deps.store.countAll();
  const classified = classifyIssueReports(await deps.store.findCandidates(candidateCutoff(input.now)), input.now, deps.holds);
  const summary = {
    database: deps.target.databaseName,
    asOf: input.now.toISOString(),
    total,
    due: classified.eligibleIds.length,
    held: classified.held,
    notYetDue: total - classified.eligibleIds.length - classified.held - classified.undatable,
    undatable: classified.undatable,
  };
  if (!input.apply || summary.due === 0) return { mode: input.apply ? 'apply' : 'dry-run', ...summary, deleted: 0 };
  if (!(await confirm(summary.due).catch(() => false))) refuse('Confirmation did not match. Nothing was deleted.');
  deps.audit?.preflight();
  const deleted = await deps.store.deleteByIds(classified.eligibleIds);
  deps.audit?.append({
    at: input.now.toISOString(),
    environment: deps.target.environment,
    database: deps.target.databaseName,
    action: 'issue-report-retention',
    result: 'issue-reports-purged',
    deleted: { IssueReport: deleted },
  });
  return { mode: 'apply', ...summary, deleted };
}

export async function runIssueReportRetentionCli(args: string[], options: { io?: TerminalIO; now?: () => number; productionEnabled?: boolean } = {}) {
  const io = options.io ?? processTerminal();
  const parsed = parseRetentionArgs(args);
  if (parsed.apply) assertInteractive(io, 'purge --apply');
  const holds = new PreservationHoldStore(parsed.holds);
  const audit = parsed.auditLog ? new DeletionAuditLog(parsed.auditLog) : undefined;

  const productionEnabled = options.productionEnabled ?? ISSUE_REPORT_RETENTION_PRODUCTION_ENABLED;
  assertRetentionEnvironment(getDatabaseTarget(), productionEnabled);
  const target = await connectScriptDatabase(retentionScriptAccess(parsed, productionEnabled), { autoIndex: false, autoCreate: false });
  try {
    assertRetentionEnvironment(target, productionEnabled);
    return {
      command: parsed.command,
      ...(await runIssueReportRetention(
        { store: new MongooseIssueReportRetentionStore(), holds, audit, target: { environment: target.environment, databaseName: target.databaseName } },
        { apply: parsed.apply, now: new Date((options.now ?? Date.now)()) },
        (count) => confirmTyped(io, `\n${count} issue report(s) are past 12 months. Type "DELETE ${count}" to delete them: `, `DELETE ${count}`),
      )),
    };
  } finally {
    await disconnectFromDatabase();
  }
}

if (require.main === module) {
  runIssueReportRetentionCli(process.argv.slice(2))
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      const { message, exitCode } = toExit(error);
      console.error(message.replace('account:admin-delete', SCRIPT_NAME));
      process.exitCode = exitCode;
    });
}
