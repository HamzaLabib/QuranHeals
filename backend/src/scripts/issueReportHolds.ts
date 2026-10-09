/**
 * Issue-report retention holds in the database (retentionholds), used by the
 * cloud retention run (`issue-reports:retention -- ... --store mongo`).
 * `npm run issue-reports:holds -- <command> ...`; docs/data-retention.md.
 *
 *   list                                                       read-only (production-read)
 *   init                                                       create the format marker (once)
 *   place   --ref <report id> --reason <code> --review-by <YYYY-MM-DD>
 *   release --ref <report id>
 *
 * Writing commands need the holds-admin user (QURAN_HEALS_ADMIN_PROFILE=production-holds;
 * exactly find/insert/update/remove on retentionholds, checked strictly) and, in production,
 * QURAN_HEALS_CONFIRM_PRODUCTION_WRITE=quranheals_prod. The retention job's own role can only
 * read holds, never place or lift them. Same rules as file holds: a listed reason, a valid
 * report id, and a review date at most 365 days away (retention/preservationHolds.ts).
 */
import { AdminDeletionError, EXIT } from '../admin/adminAccountDeletion';
import { connectScriptDatabase, disconnectFromDatabase, getDatabaseTarget } from '../config/database';
import type { DatabaseTarget, ScriptAccess } from '../config/databaseTarget';
import { describeError } from '../monitoring/monitoring';
import { HoldError, parseHoldReason } from '../retention/preservationHolds';
import { parseTimestamp } from '../retention/retentionPolicy';
import { HOLDS_ADMIN_PRIVILEGES, MongoRetentionHoldsAdmin, RetentionStoreError } from '../services/MongoRetentionStores';
import { ADMIN_PROFILE_ENV } from './adminDeleteAccount';

export const SCRIPT_NAME = 'issue-reports:holds';

type Command = 'list' | 'init' | 'place' | 'release';
export type ParsedHoldsArgs = { command: Command; ref?: string; reason?: string; reviewBy?: string };

function refuse(message: string): never {
  throw new AdminDeletionError(message, EXIT.refused);
}

const FLAGS: Record<Command, string[]> = { list: [], init: [], place: ['--ref', '--reason', '--review-by'], release: ['--ref'] };

export function parseHoldsArgs(args: string[]): ParsedHoldsArgs {
  const [command, ...rest] = args;
  if (!command || !(command in FLAGS)) refuse(`First argument must be one of: ${Object.keys(FLAGS).join(', ')}.`);
  const values = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (!FLAGS[command as Command].includes(flag)) refuse(`${flag} is not valid for "${command}".`);
    if (value === undefined || value.startsWith('--')) refuse(`${flag} needs a value.`);
    if (values.has(flag)) refuse(`${flag} given twice.`);
    values.set(flag, value);
  }
  for (const flag of FLAGS[command as Command]) if (!values.has(flag)) refuse(`${flag} is required for "${command}".`);
  return { command: command as Command, ref: values.get('--ref'), reason: values.get('--reason'), reviewBy: values.get('--review-by') };
}

const writes = (parsed: ParsedHoldsArgs) => parsed.command !== 'list';

/** production-read to list; production-holds to change. Production profiles are refused elsewhere, and vice versa. */
export function resolveHoldsProfile(parsed: ParsedHoldsArgs, target: Pick<DatabaseTarget, 'environment'>, environment: Record<string, string | undefined> = process.env): string | undefined {
  const profile = environment[ADMIN_PROFILE_ENV] || undefined;
  if (target.environment === 'production') {
    if (environment.QURAN_HEALS_SKIP_DOTENV !== '1') refuse('Production runs must load an env profile that sets QURAN_HEALS_SKIP_DOTENV=1. Nothing was read or changed.');
    const expected = writes(parsed) ? 'production-holds' : 'production-read';
    if (profile !== expected) refuse(`This production step needs ${ADMIN_PROFILE_ENV}=${expected} (got ${profile ?? 'none'}). Nothing was read or changed.`);
    return profile;
  }
  if (profile?.startsWith('production')) refuse(`${ADMIN_PROFILE_ENV}=${profile} is a production profile, but the target is ${target.environment}. Nothing was read or changed.`);
  return profile;
}

export function holdsScriptAccess(parsed: ParsedHoldsArgs, profile?: string): ScriptAccess {
  return {
    script: SCRIPT_NAME,
    writes: writes(parsed),
    productionSupported: true,
    enforceCredentialScope: true,
    ...(profile && profile !== 'development' ? { strictCredentialScope: true } : {}),
    ...(writes(parsed) ? { exactPrivileges: HOLDS_ADMIN_PRIVILEGES } : {}),
  };
}

export function parseReviewBy(value: string): Date {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseTimestamp(`${value}T00:00:00.000Z`) : null;
  if (!date) refuse('--review-by must be a date like 2027-01-15 (UTC midnight).');
  return date;
}

export async function runIssueReportHolds(args: string[], options: { now?: () => number; environment?: Record<string, string | undefined> } = {}) {
  const parsed = parseHoldsArgs(args);
  const now = new Date((options.now ?? Date.now)());
  const reason = parsed.command === 'place' ? parseHoldReason(parsed.reason) : undefined;
  const reviewBy = parsed.command === 'place' ? parseReviewBy(parsed.reviewBy!) : undefined;
  const profile = resolveHoldsProfile(parsed, getDatabaseTarget(), options.environment);

  const target = await connectScriptDatabase(holdsScriptAccess(parsed, profile), { autoIndex: false, autoCreate: false });
  try {
    const admin = new MongoRetentionHoldsAdmin();
    switch (parsed.command) {
      case 'list':
        return { command: 'list', database: target.databaseName, holds: await admin.list() };
      case 'init':
        return { command: 'init', database: target.databaseName, result: await admin.init() };
      case 'place':
        return { command: 'place', database: target.databaseName, hold: await admin.place({ ref: parsed.ref!, reason: reason!, reviewBy: reviewBy! }, now) };
      case 'release':
        return { command: 'release', database: target.databaseName, released: await admin.release(parsed.ref!) };
    }
  } finally {
    await disconnectFromDatabase();
  }
}

if (require.main === module) {
  runIssueReportHolds(process.argv.slice(2))
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      const known = error instanceof AdminDeletionError || error instanceof HoldError || error instanceof RetentionStoreError;
      console.error(known ? error.message : `${SCRIPT_NAME} failed: ${describeError(error)}`);
      process.exitCode = error instanceof AdminDeletionError ? error.exitCode : 1;
    });
}
