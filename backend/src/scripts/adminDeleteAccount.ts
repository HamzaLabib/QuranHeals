/**
 * Administrative account deletion for verified email requests
 * (`npm run account:admin-delete -- <command> ...`). Not an API: it runs only
 * from an interactive terminal on the operator's machine. Runbook:
 * docs/account-deletion-requests.md.
 *
 *   lookup        [--provider apple|google]                                   email asked at a hidden prompt
 *   challenge     --case <id> --provider <p> --case-store <file>              email hidden; account picked from the lookup
 *   verify        --case <id> --case-store <file>                             code asked at a hidden prompt
 *   delete        --case <id> --case-store <file>                             (dry run; the account comes from the case)
 *   delete        ... --apply --audit-log <file> [--acknowledge-no-apple-token]   typed final confirmation
 *   issue-reports --case <id> --case-store <file> [--apply --audit-log <file>]   email hidden
 *   prune         --case-store <file> --holds <file> [--apply --audit-log <file>]
 *   audit-prune   --audit-log <file> --holds <file> [--apply]
 *   hold          --holds <file> --kind deletion-case|issue-report --ref <id> --reason <r> --review-by <YYYY-MM-DD>
 *   release       --holds <file> --kind <k> --ref <id>
 *   holds         --holds <file>
 *   restore-check --audit-log <file>
 *
 * Emails, verification codes and user ids are never command-line
 * arguments (so they never reach PowerShell history or npm's echoed command
 * line). Prompts and the one-time code go to the terminal (stderr); the JSON
 * report on stdout never contains an email, code, token or connection
 * string. Production is disabled in code (PRODUCTION_EMAIL_DELETION_ENABLED).
 */
import { HttpAppleRevocationClient } from '../auth/appleRevocationClient';
import { generateAppleClientSecret } from '../auth/appleClientSecret';
import {
  AdminDeletionError,
  DELETION_COLLECTIONS,
  EXIT,
  applyDeletion,
  countIssueReportsForCase,
  deleteIssueReports,
  finalConfirmationPhrase,
  lookupAccounts,
  parseProvider,
  planDeletion,
  restoreCheck,
  startChallenge,
  type ConfirmationPlan,
  type LookupMatch,
} from '../admin/adminAccountDeletion';
import { DeletionAuditLog } from '../admin/deletionAudit';
import { CaseError, DeletionCaseStore, assertCaseId } from '../admin/deletionCases';
import { cloudSyncWarning, FileLockError } from '../admin/localFiles';
import { assertInteractive, chooseIndex, confirmTyped, processTerminal, PromptError, readHidden, type TerminalIO } from '../admin/prompt';
import { connectScriptDatabase, disconnectFromDatabase, getDatabaseTarget } from '../config/database';
import type { DatabaseTarget, ScriptAccess } from '../config/databaseTarget';
import { describeError } from '../monitoring/monitoring';
import { HoldError, parseHoldKind, parseHoldReason, PreservationHoldStore } from '../retention/preservationHolds';
import { MongooseAccountDeletionService } from '../services/MongooseAccountDeletionService';
import { MongooseAdminAccountStore } from '../services/MongooseAdminAccountStore';
import { MongooseAppleCredentialRepository } from '../services/MongooseAppleCredentialRepository';

export const SCRIPT_NAME = 'account:admin-delete';

/**
 * Production email deletion stays OFF until a separately reviewed change
 * flips this. Every production check below (env profile, read-only and
 * deletion-only credential scope, the production-write confirmation) is
 * implemented and tested with this injected as true, but nothing can reach
 * quranheals_prod while it is false.
 */
export const PRODUCTION_EMAIL_DELETION_ENABLED = false;

export const COMMANDS = ['lookup', 'challenge', 'verify', 'delete', 'issue-reports', 'prune', 'audit-prune', 'hold', 'release', 'holds', 'restore-check'] as const;
export type Command = (typeof COMMANDS)[number];

const VALUE_FLAGS = ['--provider', '--case', '--case-store', '--audit-log', '--holds', '--kind', '--ref', '--reason', '--review-by'] as const;
const BOOLEAN_FLAGS = ['--apply', '--acknowledge-no-apple-token'] as const;
/** Sensitive values that used to be flags; now asked at a hidden prompt or taken from the verified case. */
const REMOVED_FLAGS: Record<string, string> = {
  '--email': 'The email is asked at a hidden prompt, never passed as an argument.',
  '--code': 'The verification code is asked at a hidden prompt, never passed as an argument.',
  '--user-id': 'The account is chosen from the lookup (challenge) or taken from the verified case (delete); a user id is never typed.',
  '--confirm': 'Deletion is confirmed at an interactive prompt immediately before anything is deleted.',
};
type ValueFlag = (typeof VALUE_FLAGS)[number];
type BooleanFlag = (typeof BOOLEAN_FLAGS)[number];

const ALLOWED: Record<Command, readonly (ValueFlag | BooleanFlag)[]> = {
  lookup: ['--provider'],
  challenge: ['--case', '--provider', '--case-store'],
  verify: ['--case', '--case-store'],
  delete: ['--case', '--case-store', '--audit-log', '--apply', '--acknowledge-no-apple-token'],
  'issue-reports': ['--case', '--case-store', '--audit-log', '--apply'],
  prune: ['--case-store', '--holds', '--audit-log', '--apply'],
  'audit-prune': ['--audit-log', '--holds', '--apply'],
  hold: ['--holds', '--kind', '--ref', '--reason', '--review-by'],
  release: ['--holds', '--kind', '--ref'],
  holds: ['--holds'],
  'restore-check': ['--audit-log'],
};

/** Commands that connect to MongoDB. All others use local files only. */
const DATABASE_COMMANDS: readonly Command[] = ['lookup', 'challenge', 'delete', 'issue-reports', 'restore-check'];

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
    if (flag in REMOVED_FLAGS) refuse(`${flag} is not accepted. ${REMOVED_FLAGS[flag]}`);
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

export function writesDatabase(parsed: ParsedArgs): boolean {
  return (parsed.command === 'delete' || parsed.command === 'issue-reports') && parsed.flags.has('--apply');
}

/** Whether this invocation needs an interactive terminal (hidden input or a typed confirmation). */
export function needsTerminal(parsed: ParsedArgs): boolean {
  switch (parsed.command) {
    case 'lookup':
    case 'challenge':
    case 'verify':
    case 'issue-reports':
      return true;
    case 'delete':
    case 'prune':
    case 'audit-prune':
      return parsed.flags.has('--apply');
    default:
      return false;
  }
}

/**
 * The shared script guard's view of this run: production only when enabled
 * in code; every credential-scope problem is fatal; a writing run must use
 * the deletion-only user (find/remove on DELETION_COLLECTIONS only).
 */
export function scriptAccess(parsed: ParsedArgs, productionEnabled = PRODUCTION_EMAIL_DELETION_ENABLED, profile?: AdminProfile): ScriptAccess {
  const writes = writesDatabase(parsed);
  return {
    script: SCRIPT_NAME,
    writes,
    productionSupported: productionEnabled,
    enforceCredentialScope: true,
    // Explicit profiles (development rehearsal and production) get the strict, fail-closed checks.
    ...(isStrictDevelopmentProfile(profile) || profile === 'production-read' || profile === 'production-delete' ? { strictCredentialScope: true } : {}),
    ...(writes ? { deletionOnlyCollections: DELETION_COLLECTIONS } : {}),
  };
}

/** Development always; production only when enabled in code. Any other environment is refused. */
export function assertEnvironmentAllowed(target: DatabaseTarget, productionEnabled = PRODUCTION_EMAIL_DELETION_ENABLED): void {
  if (target.environment === 'development') return;
  if (target.environment === 'production' && productionEnabled) return;
  refuse(
    target.environment === 'production'
      ? `${SCRIPT_NAME}: production email deletion is not enabled. Nothing was changed.`
      : `${SCRIPT_NAME} runs only against development${productionEnabled ? ' or production' : ''} (got environment=${target.environment}).`,
  );
}

export const ADMIN_PROFILE_ENV = 'QURAN_HEALS_ADMIN_PROFILE';
/**
 * `development` (or no profile): the normal development user, as before.
 * `development-read` / `development-delete`: a rehearsal of production on
 * the development database with restricted users — the same read-only and
 * deletion-only checks as production, made fatal.
 */
export const ADMIN_PROFILES = ['production-read', 'production-delete', 'development-read', 'development-delete', 'development'] as const;
export type AdminProfile = (typeof ADMIN_PROFILES)[number];

export function isStrictDevelopmentProfile(profile: AdminProfile | undefined): boolean {
  return profile === 'development-read' || profile === 'development-delete';
}

/**
 * Production runs must come from the matching env profile file (loaded with
 * Node's --env-file, outside the repository): lookups and dry runs from the
 * read-only profile, writes from the deletion profile. The profile must
 * also set QURAN_HEALS_SKIP_DOTENV=1, so backend/.env (development) never
 * fills in a missing value. A production profile can never be used against
 * development, and vice versa.
 */
export function assertProfile(parsed: ParsedArgs, target: DatabaseTarget, environment: Record<string, string | undefined>): AdminProfile | undefined {
  const raw = environment[ADMIN_PROFILE_ENV];
  if (raw !== undefined && !ADMIN_PROFILES.includes(raw as AdminProfile)) {
    refuse(`${ADMIN_PROFILE_ENV}=${raw} is not a known profile (${ADMIN_PROFILES.join(', ')}). Nothing was changed.`);
  }
  const profile = raw as AdminProfile | undefined;

  if (target.environment !== 'production') {
    if (profile === 'production-read' || profile === 'production-delete') {
      refuse(`${ADMIN_PROFILE_ENV}=${profile} is a production profile, but the target is ${target.environment}. Nothing was changed.`);
    }
    if (!isStrictDevelopmentProfile(profile)) return profile;
    if (environment.QURAN_HEALS_SKIP_DOTENV !== '1') {
      refuse(`The ${profile} profile must be loaded from an env file that sets QURAN_HEALS_SKIP_DOTENV=1, so backend/.env never supplies its credentials. Nothing was changed.`);
    }
    const expected: AdminProfile = writesDatabase(parsed) ? 'development-delete' : 'development-read';
    if (profile !== expected) refuse(`This step must run with the ${expected} profile (got ${profile}). Nothing was changed.`);
    return profile;
  }

  if (profile === 'development-read' || profile === 'development-delete' || profile === 'development') {
    refuse(`${ADMIN_PROFILE_ENV}=${profile} is a development profile, but the target is production. Nothing was changed.`);
  }
  if (environment.QURAN_HEALS_SKIP_DOTENV !== '1') {
    refuse('Production runs must load an env profile that sets QURAN_HEALS_SKIP_DOTENV=1, so backend/.env is never read. Nothing was changed.');
  }
  const expected: AdminProfile = writesDatabase(parsed) ? 'production-delete' : 'production-read';
  if (profile !== expected) refuse(`This step must run with the ${expected} profile (got ${profile ?? 'none'}). Nothing was changed.`);
  return profile;
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
  const apply = parsed.flags.has('--apply');
  if (parsed.command === 'delete') {
    required(parsed, '--case');
    required(parsed, '--case-store');
    if (apply) required(parsed, '--audit-log');
    if (!apply && (parsed.values.has('--audit-log') || parsed.flags.has('--acknowledge-no-apple-token'))) {
      refuse('--audit-log and --acknowledge-no-apple-token only apply with --apply.');
    }
  }
  if (parsed.command === 'issue-reports') {
    required(parsed, '--case');
    required(parsed, '--case-store');
    if (apply) required(parsed, '--audit-log');
  }
  if (parsed.command === 'challenge') parseProvider(required(parsed, '--provider'));
  if (parsed.command === 'prune') {
    required(parsed, '--case-store');
    required(parsed, '--holds');
    if (apply) required(parsed, '--audit-log');
  }
  if (parsed.command === 'audit-prune') {
    required(parsed, '--audit-log');
    required(parsed, '--holds');
  }
}

export type RunOptions = {
  io?: TerminalIO;
  now?: () => number;
  productionEnabled?: boolean;
  env?: Record<string, string | undefined>;
};

function warnIfCloudSynced(io: TerminalIO, parsed: ParsedArgs, env: Record<string, string | undefined>): void {
  for (const flag of ['--case-store', '--audit-log', '--holds'] as const) {
    const path = parsed.values.get(flag);
    const warning = path ? cloudSyncWarning(path, env) : null;
    if (warning) io.output.write(`${warning}\n`);
  }
}

function describeAppleHandling(plan: ConfirmationPlan): string {
  if (plan.apple === 'revoke-stored-token') return 'revoke Quran Heals\' Apple authorization with the stored token FIRST; nothing is deleted if that fails';
  if (plan.apple === 'no-stored-token') return 'no stored Apple token (acknowledged): Apple access cannot be revoked from here; send the owner the manual-removal instructions';
  return 'not applicable (Google account)';
}

/** The summary the operator reads immediately before the final confirmation. Never contains an email or token. */
export function describePlan(plan: ConfirmationPlan): string {
  const r = plan.records;
  return [
    '',
    `Database:   ${plan.database} (${plan.environment})`,
    `Case:       ${plan.caseId}`,
    `Account:    ${plan.userId} (reference ${plan.accountRef})`,
    `Provider:   ${plan.provider}`,
    'Will permanently delete:',
    `  users ${r.User}, sessions ${r.Session} (signs out every device)`,
    `  userfavorites ${r.UserFavorite} (incl. ${r.tombstones.UserFavorite} removal markers), userpreferences ${r.UserPreference}`,
    `  userreflections ${r.UserReflection} (incl. ${r.tombstones.UserReflection} deletion markers), usersynckeys ${r.UserSyncKey}, applecredentials ${r.AppleCredential}`,
    `Apple:      ${describeAppleHandling(plan)}`,
    'Issue reports are not touched (use issue-reports if the owner asked).',
    '',
  ].join('\n');
}

function formatMatches(matches: LookupMatch[]): string {
  return matches
    .map((m, i) => {
      const total = m.records.User + m.records.Session + m.records.UserFavorite + m.records.UserPreference + m.records.UserReflection + m.records.UserSyncKey + m.records.AppleCredential;
      return `  ${i + 1}. ${m.provider} account ${m.userId} (reference ${m.accountRef}), created ${m.createdAt ?? 'unknown'}, ${total} records, email verification: ${m.emailVerification}`;
    })
    .join('\n');
}

function parseReviewBy(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) refuse('--review-by must be a date like 2027-03-31.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) refuse('--review-by is not a valid date.');
  return date;
}

/** Local-file commands: never connect to a database. */
async function runLocal(parsed: ParsedArgs, io: TerminalIO, now: () => number): Promise<unknown> {
  switch (parsed.command) {
    case 'verify': {
      const cases = new DeletionCaseStore(required(parsed, '--case-store'));
      const caseId = required(parsed, '--case');
      const code = await readHidden(io, `Code from the owner's reply for ${caseId} (hidden): `);
      const entry = cases.verify(caseId, code, now());
      return { command: 'verify', case: entry.caseId, status: entry.status, accountRef: entry.userId.slice(-6), provider: entry.provider };
    }
    case 'prune': {
      const cases = new DeletionCaseStore(required(parsed, '--case-store'));
      const holds = new PreservationHoldStore(required(parsed, '--holds'));
      const at = new Date(now());
      const preview = cases.prune(at, { apply: false, holds });
      const eligible = DeletionCaseStore.eligibleCount(preview);
      if (!parsed.flags.has('--apply')) return { command: 'prune', ...preview, expiredHolds: holds.pruneExpired(at, false) };
      if (eligible > 0) {
        const audit = new DeletionAuditLog(required(parsed, '--audit-log'));
        audit.preflight();
        io.output.write(`\n${eligible} case record(s) have reached the end of their retention period (${JSON.stringify(preview.eligible)}).\n`);
        if (!(await confirmTyped(io, `Type "PRUNE ${eligible}" to remove them: `, `PRUNE ${eligible}`))) refuse('Confirmation did not match. Nothing was removed.');
        const report = cases.prune(at, { apply: true, holds, expectedCount: eligible });
        audit.append({ at: at.toISOString(), action: 'prune-cases', result: 'cases-pruned', deleted: { DeletionCase: report.removed } });
        return { command: 'prune', ...report, expiredHoldsRemoved: holds.pruneExpired(at, true) };
      }
      return { command: 'prune', ...preview, expiredHoldsRemoved: holds.pruneExpired(at, true) };
    }
    case 'audit-prune': {
      const audit = new DeletionAuditLog(required(parsed, '--audit-log'));
      const holds = new PreservationHoldStore(required(parsed, '--holds'));
      const at = new Date(now());
      const preview = audit.prune(at, { apply: false, holds });
      if (!parsed.flags.has('--apply') || preview.eligible === 0) return { command: 'audit-prune', ...preview };
      io.output.write(`\n${preview.eligible} audit entr${preview.eligible === 1 ? 'y is' : 'ies are'} older than 3 years. A record of this pruning is appended to the log.\n`);
      if (!(await confirmTyped(io, `Type "PRUNE ${preview.eligible}" to remove them: `, `PRUNE ${preview.eligible}`))) refuse('Confirmation did not match. Nothing was removed.');
      return { command: 'audit-prune', ...audit.prune(at, { apply: true, holds, expectedCount: preview.eligible }) };
    }
    case 'hold': {
      const holds = new PreservationHoldStore(required(parsed, '--holds'));
      const hold = holds.place(
        { kind: parseHoldKind(required(parsed, '--kind')), ref: required(parsed, '--ref'), reason: parseHoldReason(required(parsed, '--reason')), reviewBy: parseReviewBy(required(parsed, '--review-by')) },
        new Date(now()),
      );
      return { command: 'hold', hold };
    }
    case 'release': {
      const holds = new PreservationHoldStore(required(parsed, '--holds'));
      return { command: 'release', released: holds.release(parseHoldKind(required(parsed, '--kind')), required(parsed, '--ref')) };
    }
    case 'holds': {
      const holds = new PreservationHoldStore(required(parsed, '--holds'));
      const at = now();
      return { command: 'holds', holds: holds.list().map((hold) => ({ ...hold, active: at < Date.parse(hold.reviewBy) })) };
    }
    default:
      throw new Error(`${parsed.command} is not a local command.`);
  }
}

export async function runAdminDeleteAccount(args: string[], options: RunOptions = {}): Promise<unknown> {
  const io = options.io ?? processTerminal();
  const now = options.now ?? Date.now;
  const environment = options.env ?? process.env;
  const productionEnabled = options.productionEnabled ?? PRODUCTION_EMAIL_DELETION_ENABLED;

  const parsed = parseAdminArgs(args);
  validateBeforeConnecting(parsed);
  if (needsTerminal(parsed)) assertInteractive(io, `"${parsed.command}${parsed.flags.has('--apply') ? ' --apply' : ''}"`);
  warnIfCloudSynced(io, parsed, environment);

  if (!DATABASE_COMMANDS.includes(parsed.command)) return runLocal(parsed, io, now);

  const preTarget = getDatabaseTarget();
  assertEnvironmentAllowed(preTarget, productionEnabled);
  const profile = assertProfile(parsed, preTarget, environment);
  // Collections are never created and indexes never built by this tool (the deletion-only user cannot).
  const target = await connectScriptDatabase(scriptAccess(parsed, productionEnabled, profile), { autoIndex: false, autoCreate: false });
  try {
    assertEnvironmentAllowed(target, productionEnabled);
    const store = new MongooseAdminAccountStore();
    const targetInfo = { environment: target.environment, databaseName: target.databaseName };

    switch (parsed.command) {
      case 'lookup': {
        const provider = parsed.values.has('--provider') ? parseProvider(parsed.values.get('--provider')) : undefined;
        const email = await readHidden(io, 'Email from the request (hidden): ');
        const matches = await lookupAccounts(store, email, provider);
        return { command: 'lookup', matches: matches.length, accounts: matches };
      }
      case 'challenge': {
        const cases = new DeletionCaseStore(required(parsed, '--case-store'));
        const caseId = required(parsed, '--case');
        const provider = parseProvider(required(parsed, '--provider'));
        const email = await readHidden(io, `Email of the ${provider} account (hidden): `);
        const matches = await lookupAccounts(store, email, provider);
        if (matches.length === 0) refuse(`No ${provider} account has that email. Nothing was created.`);
        io.output.write(`\nMatching ${provider} accounts:\n${formatMatches(matches)}\n`);
        const chosen = matches[await chooseIndex(io, `Number of the account the owner asked to delete (1-${matches.length}): `, matches.length)];
        const code = await startChallenge(store, cases, caseId, { userId: chosen.userId, provider: chosen.provider }, email, now());
        io.output.write(
          `\nOne-time code for ${caseId} (shown once, valid 15 minutes, 5 attempts): ${code}\n` +
            'Email it now to the address you entered (the one stored on the account), never to a different From address.\n' +
            'Then clear this terminal (Clear-Host). Any earlier pending code for this account no longer works.\n',
        );
        return { command: 'challenge', case: caseId, accountRef: chosen.accountRef, provider: chosen.provider, codeValidMinutes: 15 };
      }
      case 'delete': {
        const cases = new DeletionCaseStore(required(parsed, '--case-store'));
        const caseId = required(parsed, '--case');
        if (!parsed.flags.has('--apply')) return { command: 'delete', mode: 'dry-run', database: target.databaseName, plan: await planDeletion(store, cases, caseId) };
        const report = await applyDeletion(
          {
            store,
            cases,
            audit: new DeletionAuditLog(required(parsed, '--audit-log')),
            appleCredentialRepository: new MongooseAppleCredentialRepository(),
            appleRevocationClient: new HttpAppleRevocationClient(),
            accountDeletionService: new MongooseAccountDeletionService(),
            // Signs a client secret locally (no network): proves the Apple key and ids are present and usable.
            assertAppleRevocationConfigured: () => void generateAppleClientSecret(),
            target: targetInfo,
            now,
          },
          { caseId, acknowledgeNoAppleToken: parsed.flags.has('--acknowledge-no-apple-token') },
          async (plan) => {
            io.output.write(describePlan(plan));
            const phrase = finalConfirmationPhrase(plan.userId);
            return confirmTyped(io, `Type "${phrase}" to delete this account now, or anything else to cancel: `, phrase);
          },
        );
        return { command: 'delete', mode: 'apply', ...report };
      }
      case 'issue-reports': {
        const cases = new DeletionCaseStore(required(parsed, '--case-store'));
        const caseId = required(parsed, '--case');
        const email = await readHidden(io, 'Email the owner entered in their issue reports (hidden): ');
        if (!parsed.flags.has('--apply')) {
          return { command: 'issue-reports', mode: 'dry-run', matching: await countIssueReportsForCase({ store, cases }, { caseId, email }) };
        }
        const result = await deleteIssueReports(
          { store, cases, audit: new DeletionAuditLog(required(parsed, '--audit-log')), target: targetInfo, now },
          { caseId, email },
          (count) => confirmTyped(io, `\n${count} issue report(s) carry this email. Type "DELETE ${count}" to delete them: `, `DELETE ${count}`),
        );
        return { command: 'issue-reports', mode: 'apply', ...result };
      }
      case 'restore-check':
        return { command: 'restore-check', ...(await restoreCheck(store, new DeletionAuditLog(required(parsed, '--audit-log')))) };
      default:
        throw new Error(`${parsed.command} does not use the database.`);
    }
  } finally {
    await disconnectFromDatabase();
  }
}

/** Known refusals carry a safe message and a "nothing was done" exit code. */
export function toExit(error: unknown): { message: string; exitCode: number } {
  if (error instanceof AdminDeletionError) return { message: error.message, exitCode: error.exitCode };
  if (error instanceof PromptError || error instanceof CaseError || error instanceof HoldError || error instanceof FileLockError) {
    return { message: error.message, exitCode: EXIT.refused };
  }
  // Anything else is scrubbed (never a URI, token or email).
  return { message: `${SCRIPT_NAME} failed: ${describeError(error)}`, exitCode: 1 };
}

if (require.main === module) {
  runAdminDeleteAccount(process.argv.slice(2))
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      const { message, exitCode } = toExit(error);
      console.error(message);
      process.exitCode = exitCode;
    });
}
