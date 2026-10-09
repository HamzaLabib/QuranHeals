/**
 * Development-only administrative account deletion for verified email
 * requests (`npm run account:admin-delete -- <command> ...`). Production is
 * hard-blocked in this phase. Not an API: it runs only from a terminal.
 *
 *   lookup        --email <addr> [--provider apple|google]
 *   challenge     --case <id> --user-id <id> --provider <p> --email <addr> --case-store <file>
 *   verify        --case <id> --code <code> --case-store <file>
 *   delete        --case <id> --user-id <id> --provider <p> --email <addr>            (dry run)
 *   delete        ... --apply --confirm delete-account:<id> --case-store <file> --audit-log <file>
 *                 [--acknowledge-no-apple-token]
 *   issue-reports --email <addr>                                                      (dry run)
 *   issue-reports ... --apply --case <id> --confirm delete-issue-reports:<n> --case-store <file> --audit-log <file>
 *   restore-check --audit-log <file>
 *
 * The case store and audit log must be outside the repository. Output
 * never includes an email, token, code (except the one `challenge` creates,
 * shown once) or any account content.
 */
import { HttpAppleRevocationClient } from '../auth/appleRevocationClient';
import {
  AdminDeletionError,
  EXIT,
  applyDeletion,
  deleteIssueReports,
  lookupAccounts,
  parseProvider,
  planDeletion,
  restoreCheck,
  startChallenge,
  type AccountIdentity,
} from '../admin/adminAccountDeletion';
import { DeletionAuditLog } from '../admin/deletionAudit';
import { CaseError, DeletionCaseStore, assertCaseId, normalizeEmail } from '../admin/deletionCases';
import { connectScriptDatabase, disconnectFromDatabase, getDatabaseTarget } from '../config/database';
import type { DatabaseTarget, ScriptAccess } from '../config/databaseTarget';
import { describeError } from '../monitoring/monitoring';
import { MongooseAccountDeletionService } from '../services/MongooseAccountDeletionService';
import { MongooseAdminAccountStore } from '../services/MongooseAdminAccountStore';
import { MongooseAppleCredentialRepository } from '../services/MongooseAppleCredentialRepository';

export const SCRIPT_NAME = 'account:admin-delete';
export const COMMANDS = ['lookup', 'challenge', 'verify', 'delete', 'issue-reports', 'restore-check'] as const;
export type Command = (typeof COMMANDS)[number];

const VALUE_FLAGS = ['--email', '--provider', '--case', '--user-id', '--code', '--case-store', '--audit-log', '--confirm'] as const;
const BOOLEAN_FLAGS = ['--apply', '--acknowledge-no-apple-token'] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];
type BooleanFlag = (typeof BOOLEAN_FLAGS)[number];

const ALLOWED: Record<Command, readonly (ValueFlag | BooleanFlag)[]> = {
  lookup: ['--email', '--provider'],
  challenge: ['--case', '--user-id', '--provider', '--email', '--case-store'],
  verify: ['--case', '--code', '--case-store'],
  delete: ['--case', '--user-id', '--provider', '--email', '--apply', '--confirm', '--case-store', '--audit-log', '--acknowledge-no-apple-token'],
  'issue-reports': ['--email', '--apply', '--case', '--confirm', '--case-store', '--audit-log'],
  'restore-check': ['--audit-log'],
};

export type ParsedArgs = { command: Command; values: Map<ValueFlag, string>; flags: Set<BooleanFlag> };

function refuse(message: string): never {
  throw new AdminDeletionError(message, EXIT.refused);
}

export function parseAdminArgs(args: string[]): ParsedArgs {
  const [command, ...rest] = args;
  if (!COMMANDS.includes(command as Command)) refuse(`First argument must be one of: ${COMMANDS.join(', ')}.`);
  const allowed = ALLOWED[command as Command];
  const values = new Map<ValueFlag, string>();
  const flags = new Set<BooleanFlag>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!allowed.includes(flag as ValueFlag | BooleanFlag)) refuse(`${flag} is not valid for "${command}".`);
    if ((BOOLEAN_FLAGS as readonly string[]).includes(flag)) {
      if (flags.has(flag as BooleanFlag)) refuse(`${flag} given twice.`);
      flags.add(flag as BooleanFlag);
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) refuse(`${flag} needs a value.`);
    if (values.has(flag as ValueFlag)) refuse(`${flag} given twice.`);
    values.set(flag as ValueFlag, value);
    i++;
  }
  return { command: command as Command, values, flags };
}

function required(parsed: ParsedArgs, flag: ValueFlag): string {
  const value = parsed.values.get(flag)?.trim();
  if (!value) refuse(`${flag} is required for "${parsed.command}".`);
  return value;
}

function identity(parsed: ParsedArgs): AccountIdentity {
  return { userId: required(parsed, '--user-id'), provider: parseProvider(required(parsed, '--provider')), email: required(parsed, '--email') };
}

export function writesDatabase(parsed: ParsedArgs): boolean {
  return (parsed.command === 'delete' || parsed.command === 'issue-reports') && parsed.flags.has('--apply');
}

/** Phase 1: never production (refused by connectScriptDatabase too), and never anything but the development database. */
export function scriptAccess(parsed: ParsedArgs): ScriptAccess {
  return { script: SCRIPT_NAME, writes: writesDatabase(parsed), productionSupported: false };
}

export function assertDevelopmentOnly(target: DatabaseTarget): void {
  if (target.environment !== 'development') {
    refuse(`${SCRIPT_NAME} runs only against the development database in this phase (got environment=${target.environment}).`);
  }
}

/** Checks everything that needs no database, so a bad invocation never connects. */
export function validateBeforeConnecting(parsed: ParsedArgs): void {
  const caseId = parsed.values.get('--case');
  if (caseId) {
    try {
      assertCaseId(caseId);
    } catch (error) {
      refuse((error as Error).message);
    }
  }
  if (parsed.command === 'delete' && parsed.flags.has('--apply')) {
    required(parsed, '--confirm');
    required(parsed, '--case-store');
    required(parsed, '--audit-log');
  }
  if (parsed.command === 'delete' && !parsed.flags.has('--apply') && (parsed.values.has('--confirm') || parsed.flags.has('--acknowledge-no-apple-token'))) {
    refuse('--confirm and --acknowledge-no-apple-token only apply with --apply.');
  }
  if (parsed.command === 'issue-reports' && parsed.flags.has('--apply')) {
    required(parsed, '--case');
    required(parsed, '--confirm');
    required(parsed, '--case-store');
    required(parsed, '--audit-log');
  }
}

export async function runAdminDeleteAccount(args: string[]): Promise<unknown> {
  const parsed = parseAdminArgs(args);
  validateBeforeConnecting(parsed);

  if (parsed.command === 'verify') {
    // Local file only — never connects to a database.
    const cases = new DeletionCaseStore(required(parsed, '--case-store'));
    try {
      const entry = cases.verify(required(parsed, '--case'), required(parsed, '--code'));
      return { command: 'verify', case: entry.caseId, status: entry.status, userId: entry.userId, provider: entry.provider };
    } catch (error) {
      if (error instanceof CaseError) refuse(error.message);
      throw error;
    }
  }

  assertDevelopmentOnly(getDatabaseTarget());
  const target = await connectScriptDatabase(scriptAccess(parsed), { autoIndex: false });
  try {
    assertDevelopmentOnly(target);
    const store = new MongooseAdminAccountStore();
    const targetInfo = { environment: target.environment, databaseName: target.databaseName };

    switch (parsed.command) {
      case 'lookup': {
        const provider = parsed.values.has('--provider') ? parseProvider(parsed.values.get('--provider')) : undefined;
        const matches = await lookupAccounts(store, required(parsed, '--email'), provider);
        return { command: 'lookup', matches: matches.length, accounts: matches };
      }
      case 'challenge': {
        const cases = new DeletionCaseStore(required(parsed, '--case-store'));
        const caseId = required(parsed, '--case');
        try {
          const code = await startChallenge(store, cases, caseId, identity(parsed));
          return {
            command: 'challenge',
            case: caseId,
            code,
            note: 'Email this code to the address stored on the account (never the request\'s From address). It is shown once, expires in 14 days, and allows 5 attempts.',
          };
        } catch (error) {
          if (error instanceof CaseError) refuse(error.message);
          throw error;
        }
      }
      case 'delete': {
        const who = identity(parsed);
        if (!parsed.flags.has('--apply')) return { command: 'delete', mode: 'dry-run', plan: await planDeletion(store, who) };
        const report = await applyDeletion(
          {
            store,
            cases: new DeletionCaseStore(required(parsed, '--case-store')),
            audit: new DeletionAuditLog(required(parsed, '--audit-log')),
            appleCredentialRepository: new MongooseAppleCredentialRepository(),
            appleRevocationClient: new HttpAppleRevocationClient(),
            accountDeletionService: new MongooseAccountDeletionService(),
            target: targetInfo,
          },
          { ...who, caseId: required(parsed, '--case'), confirm: parsed.values.get('--confirm'), acknowledgeNoAppleToken: parsed.flags.has('--acknowledge-no-apple-token') },
        );
        return { command: 'delete', mode: 'apply', ...report };
      }
      case 'issue-reports': {
        const email = required(parsed, '--email');
        if (!parsed.flags.has('--apply')) {
          return { command: 'issue-reports', mode: 'dry-run', matching: await store.countIssueReportsByEmail(normalizeEmail(email)) };
        }
        const result = await deleteIssueReports(
          {
            store,
            cases: new DeletionCaseStore(required(parsed, '--case-store')),
            audit: new DeletionAuditLog(required(parsed, '--audit-log')),
            target: targetInfo,
          },
          { caseId: required(parsed, '--case'), email, confirm: parsed.values.get('--confirm') },
        );
        return { command: 'issue-reports', mode: 'apply', ...result };
      }
      case 'restore-check':
        return { command: 'restore-check', ...(await restoreCheck(store, new DeletionAuditLog(required(parsed, '--audit-log')))) };
    }
  } finally {
    await disconnectFromDatabase();
  }
}

if (require.main === module) {
  runAdminDeleteAccount(process.argv.slice(2))
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      // Known refusals carry a safe message; anything else is scrubbed (never a URI, token or email).
      console.error(error instanceof AdminDeletionError ? error.message : `${SCRIPT_NAME} failed: ${describeError(error)}`);
      process.exitCode = error instanceof AdminDeletionError ? error.exitCode : 1;
    });
}
